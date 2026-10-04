import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GeometryInfo, LayerStyle, ViewMode } from '../types';
import { turbo } from './turbo';

/** 256-entry colour table: much cheaper than evaluating the polynomial for every vertex of a fine mesh. */
const LUT = (() => {
    const t = new Float32Array(256 * 3);
    for (let i = 0; i < 256; i++) t.set(turbo(i / 255), i * 3);
    return t;
})();

/** Upper limit for the chart mesh: a 400 x 400 mesh (160 k vertices) can still be rebuilt every frame. */
const MAX_RENDER_SIDE = 400;

/**
 * Three.js scene: a height-field chart of the velocity (or shear-rate) field over the annulus cross-section,
 * enclosed by two translucent cylinders for the wellbore wall (brown) and the drill string (silver).
 *
 * The chart is drawn on a mesh that is finer than the solver grid: every solver cell is split into
 * `smoothing` x `smoothing` render cells (capped, see MAX_RENDER_SIDE), the field is interpolated bilinearly, and the wall and pipe edges are
 * the exact circles instead of the solver's staircase mask. The visualiser knows the grid and the cell size,
 * but nothing about fluids or hydraulics.
 */
export class Visualizer {
    /** Called after every chart rebuild with the maximum of the plotted field (m/s or 1/s). */
    onChartMax?: (max: number, mode: ViewMode) => void;

    private readonly scene = new THREE.Scene();
    private readonly camera: THREE.PerspectiveCamera;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly controls: OrbitControls;

    private readonly worldScale = 0.05; // world units per solver cell at the standard resolution (40 cells/radius)
    private readonly chartHeight = 2.5;

    // chart
    private surface: THREE.Mesh | null = null;
    private surfaceKey = '';
    private readonly surfaceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.99, metalness: 0.01, side: THREE.DoubleSide });
    private smoothing = 2;
    private N = 0; // solver grid size
    private field = new Float64Array(0);

    // cylinders
    private readonly shells = new THREE.Group();
    private wellMesh: THREE.Mesh | null = null;
    private pipeMesh: THREE.Mesh | null = null;
    private readonly wellMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9, side: THREE.DoubleSide, transparent: true });
    private readonly pipeMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide, transparent: true });
    private stringStyle: LayerStyle = { visible: true, opacity: 0.4 };
    private wellStyle: LayerStyle = { visible: true, opacity: 0.25 };
    private tubeLength = 1;

    private velocity: Float64Array | null = null;
    private geo: GeometryInfo | null = null;
    private mode: ViewMode = 'velocity';
    private dirty = false;

    private readonly rockColor = new THREE.Color(0x1b1f27);
    private readonly steelColor = new THREE.Color(0x9aa4b2);

    constructor(canvas: HTMLCanvasElement) {
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
        this.camera.up.set(0, 0, 1); // z-up, like a vertical well
        this.camera.position.set(5.5, -6.5, 5);

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x0d0f14);

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.target.set(0, 0, this.chartHeight / 2);

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const key = new THREE.DirectionalLight(0xffffff, 1.1);
        key.position.set(6, -8, 12);
        this.scene.add(key);
        const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
        fill.position.set(-8, 6, 4);
        this.scene.add(fill);
        this.scene.add(this.shells);

        window.addEventListener('resize', this.onWindowResize);
        this.animate();
    }

    // ---------- public API ----------

    setGeometry(info: GeometryInfo) {
        this.geo = info;
        this.N = info.gridSize;
        this.field = new Float64Array(this.N * this.N);
        this.velocity = new Float64Array(this.N * this.N); // show the new walls at once, with a flat field
        this.buildShells();
        this.dirty = true;
    }

    updateData(velocity: Float64Array) {
        this.velocity = velocity;
        this.dirty = true;
    }

    setMode(mode: ViewMode) {
        this.mode = mode;
        this.dirty = true;
    }

    /** Render cells per solver cell, along each axis. */
    setSmoothing(perCell: number) {
        this.smoothing = perCell;
        this.dirty = true;
    }

    /** Drill string (inner cylinder, silver). */
    setStringStyle(style: LayerStyle) {
        this.stringStyle = style;
        this.applyLayer(this.pipeMesh, this.pipeMat, style);
    }

    /** Wellbore wall (outer cylinder, brown). */
    setWellboreStyle(style: LayerStyle) {
        this.wellStyle = style;
        this.applyLayer(this.wellMesh, this.wellMat, style);
    }

    /** Cylinder length as a multiple of the chart height, extended equally above and below the chart. */
    setTubeLength(factor: number) {
        this.tubeLength = factor;
        for (const m of [this.wellMesh, this.pipeMesh]) if (m) m.scale.z = factor;
    }

    // ---------- chart ----------

    /** World units per solver cell: the wellbore always has the same size on screen, whatever the resolution. */
    private cellWorld(): number {
        return (this.worldScale * 40) / this.geo!.radiusOuter;
    }

    /** Smoothing, reduced on very fine solver grids so that the mesh never exceeds MAX_RENDER_SIDE vertices per side. */
    private renderScale(): number {
        return Math.max(1, Math.min(this.smoothing, Math.floor(MAX_RENDER_SIDE / (this.N - 1))));
    }

    /** (Re)creates the mesh when the grid size or the smoothing changed. */
    private ensureSurface() {
        const N = this.N;
        const up = this.renderScale();
        const key = `${N}x${up}`;
        if (key === this.surfaceKey) return;
        this.surfaceKey = key;

        if (this.surface) {
            this.scene.remove(this.surface);
            this.surface.geometry.dispose();
        }

        const M = (N - 1) * up + 1; // render vertices per side
        const c = N / 2;
        const s = this.cellWorld();
        const positions = new Float32Array(M * M * 3);
        for (let iy = 0; iy < M; iy++) {
            for (let ix = 0; ix < M; ix++) {
                const i = (ix + iy * M) * 3;
                positions[i] = (ix / up - c) * s;
                positions[i + 1] = (iy / up - c) * s;
            }
        }

        const indices = new Uint32Array((M - 1) * (M - 1) * 6);
        let k = 0;
        for (let iy = 0; iy < M - 1; iy++) {
            for (let ix = 0; ix < M - 1; ix++) {
                const a = ix + iy * M, b = a + 1, cc = a + M, d = cc + 1;
                indices.set([a, b, cc, b, d, cc], k);
                k += 6;
            }
        }

        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(M * M * 3), 3));
        g.setIndex(new THREE.BufferAttribute(indices, 1));
        this.surface = new THREE.Mesh(g, this.surfaceMat);
        this.scene.add(this.surface);
    }

    /** Fills `this.field` (solver grid) with the plotted quantity in SI units: m/s or 1/s. */
    private computeField(v: Float64Array, mask: Uint8Array, cellSizeM: number) {
        const N = this.N;
        const f = this.field;
        f.fill(0);

        if (this.mode === 'velocity') {
            for (let i = 0; i < N * N; i++) if (mask[i] === 0) f[i] = v[i];
            return;
        }

        const inv = 1 / (2 * cellSizeM);
        for (let y = 1; y < N - 1; y++) {
            for (let x = 1; x < N - 1; x++) {
                const i = x + y * N;
                if (mask[i] === 0) f[i] = Math.hypot(v[i + 1] - v[i - 1], v[i + N] - v[i - N]) * inv;
            }
        }
        // The shear rate is largest AT the walls, so a zero in the wall cells would pull the interpolated field
        // down exactly there. Extend the nearest fluid values one cell into the walls instead.
        for (let y = 1; y < N - 1; y++) {
            for (let x = 1; x < N - 1; x++) {
                const i = x + y * N;
                if (mask[i] === 0) continue;
                let sum = 0, count = 0;
                for (const j of [i - 1, i + 1, i - N, i + N]) if (mask[j] === 0) { sum += f[j]; count++; }
                if (count) f[i] = sum / count;
            }
        }
    }

    private rebuildSurface() {
        if (!this.velocity || !this.geo) return;
        this.ensureSurface();
        const { N, geo } = this;
        const up = this.renderScale();
        const M = (N - 1) * up + 1;

        this.computeField(this.velocity, geo.mask, geo.cellSizeM);
        const f = this.field;

        // exact circles in solver-cell coordinates, same convention as the solver (centre N/2)
        const cx = N / 2;
        const pipeX = cx + geo.eccentricity * (geo.radiusOuter - geo.radiusInner);
        const Ro2 = geo.radiusOuter ** 2, Ri2 = geo.radiusInner ** 2;

        const values = new Float32Array(M * M);
        const kind = new Uint8Array(M * M); // 0 = fluid, 1 = rock, 2 = pipe
        let max = 1e-12;

        for (let iy = 0; iy < M; iy++) {
            const gy = iy / up, dy = gy - cx;
            const y0 = Math.min(Math.floor(gy), N - 2), fy = gy - y0;
            for (let ix = 0; ix < M; ix++) {
                const i = ix + iy * M;
                const gx = ix / up, dx = gx - cx;
                if (dx * dx + dy * dy >= Ro2) { kind[i] = 1; continue; }
                if ((gx - pipeX) ** 2 + dy * dy <= Ri2) { kind[i] = 2; continue; }

                const x0 = Math.min(Math.floor(gx), N - 2), fx = gx - x0;
                const k = x0 + y0 * N;
                const v = (f[k] * (1 - fx) + f[k + 1] * fx) * (1 - fy) + (f[k + N] * (1 - fx) + f[k + N + 1] * fx) * fy;
                values[i] = v;
                if (v > max) max = v;
            }
        }

        const pos = (this.surface!.geometry.getAttribute('position') as THREE.BufferAttribute);
        const col = (this.surface!.geometry.getAttribute('color') as THREE.BufferAttribute);
        const pa = pos.array as Float32Array, ca = col.array as Float32Array;

        for (let i = 0; i < M * M; i++) {
            if (kind[i] === 0) {
                const t = Math.min(1, values[i] / max);
                const l = Math.round(t * 255) * 3;
                pa[i * 3 + 2] = t * this.chartHeight;
                ca[i * 3] = LUT[l]; ca[i * 3 + 1] = LUT[l + 1]; ca[i * 3 + 2] = LUT[l + 2];
            } else {
                const c = kind[i] === 2 ? this.steelColor : this.rockColor;
                pa[i * 3 + 2] = 0;
                ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b;
            }
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        this.surface!.geometry.computeVertexNormals();

        this.onChartMax?.(max, this.mode);
    }

    // ---------- drill string + wellbore cylinders ----------

    private buildShells() {
        if (!this.geo) return;
        this.shells.traverse((o) => {
            if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        this.shells.clear();

        const s = this.cellWorld();
        const h = this.chartHeight;
        const offset = this.geo.eccentricity * (this.geo.radiusOuter - this.geo.radiusInner) * s;

        // Built with the height of the chart and centred on it; the length option scales them along z.
        const cylinder = (radius: number, cx: number, material: THREE.Material) => {
            const g = new THREE.CylinderGeometry(radius, radius, h, 128, 1, true);
            g.rotateX(Math.PI / 2); // axis -> z
            const mesh = new THREE.Mesh(g, material);
            mesh.position.set(cx, 0, h / 2);
            mesh.scale.z = this.tubeLength;
            mesh.renderOrder = 1; // after the opaque chart
            return mesh;
        };

        this.wellMesh = cylinder(this.geo.radiusOuter * s, 0, this.wellMat);
        this.pipeMesh = cylinder(this.geo.radiusInner * s, offset, this.pipeMat);
        this.shells.add(this.wellMesh, this.pipeMesh);
        this.applyLayer(this.wellMesh, this.wellMat, this.wellStyle);
        this.applyLayer(this.pipeMesh, this.pipeMat, this.stringStyle);
    }

    private applyLayer(mesh: THREE.Mesh | null, mat: THREE.MeshStandardMaterial, style: LayerStyle) {
        mat.opacity = style.opacity;
        mat.depthWrite = style.opacity >= 0.99; // translucent layers must not hide the chart
        if (mesh) mesh.visible = style.visible;
    }

    // ---------- loop ----------

    private animate = () => {
        requestAnimationFrame(this.animate);
        if (this.dirty) {
            this.dirty = false;
            this.rebuildSurface();
        }
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    };

    private onWindowResize = () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    };
}