import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GeometryInfo, LayerStyle, ViewMode } from '../types';
import { turbo } from './turbo';

/**
 * Three.js scene: a height-field chart of the velocity (or shear-rate) field over the annulus cross-section,
 * enclosed by two translucent cylinders for the wellbore wall (brown) and the drill string (silver).
 *
 * The visualiser only draws. It knows the grid and the cell size, but nothing about fluids or hydraulics.
 */
export class Visualizer {
    /** Called after every chart rebuild with the maximum of the plotted field (m/s or 1/s). */
    onChartMax?: (max: number, mode: ViewMode) => void;

    private readonly scene = new THREE.Scene();
    private readonly camera: THREE.PerspectiveCamera;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly controls: OrbitControls;

    private readonly N: number;
    private readonly worldScale = 0.05; // world units per cell
    private readonly chartHeight = 2.5;

    private surface!: THREE.Mesh;
    private wellMesh: THREE.Mesh | null = null;
    private pipeMesh: THREE.Mesh | null = null;
    private readonly shells = new THREE.Group();

    private readonly wellMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9, side: THREE.DoubleSide, transparent: true });
    private readonly pipeMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide, transparent: true });

    private stringStyle: LayerStyle = { visible: true, opacity: 0.4 };
    private wellStyle: LayerStyle = { visible: true, opacity: 0.25 };

    private velocity: Float64Array | null = null;
    private readonly field: Float64Array;
    private geo: GeometryInfo | null = null;
    private mode: ViewMode = 'velocity';
    private dirty = false;

    private readonly rockColor = new THREE.Color(0x1b1f27);
    private readonly steelColor = new THREE.Color(0x9aa4b2);

    constructor(canvas: HTMLCanvasElement, gridSize: number) {
        this.N = gridSize;
        this.field = new Float64Array(gridSize * gridSize);

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

        this.initSurface();
        this.scene.add(this.shells);

        window.addEventListener('resize', this.onWindowResize);
        this.animate();
    }

    // ---------- public API ----------

    setGeometry(info: GeometryInfo) {
        this.geo = info;
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

    /** Drill string (inner cylinder, silver). */
    setStringStyle(style: LayerStyle) {
        this.applyLayer(this.pipeMesh, this.pipeMat, style);
        this.stringStyle = style;
    }

    /** Wellbore wall (outer cylinder, brown). */
    setWellboreStyle(style: LayerStyle) {
        this.applyLayer(this.wellMesh, this.wellMat, style);
        this.wellStyle = style;
    }

    // ---------- chart ----------

    private initSurface() {
        const N = this.N;
        const c = N / 2;
        const positions = new Float32Array(N * N * 3);

        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const i = (x + y * N) * 3;
                positions[i] = (x - c) * this.worldScale;
                positions[i + 1] = (y - c) * this.worldScale;
            }
        }

        const indices: number[] = [];
        for (let y = 0; y < N - 1; y++) {
            for (let x = 0; x < N - 1; x++) {
                const a = x + y * N, b = a + 1, cc = a + N, d = cc + 1;
                indices.push(a, b, cc, b, d, cc);
            }
        }

        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * N * 3), 3));
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));

        this.surface = new THREE.Mesh(
            g,
            new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.99, metalness: 0.01, side: THREE.DoubleSide })
        );
        this.scene.add(this.surface);
    }

    /** Fills `this.field` with the plotted quantity in SI units (m/s or 1/s). */
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
    }

    private rebuildSurface() {
        if (!this.velocity || !this.geo) return;
        const N = this.N;
        const { mask, cellSizeM } = this.geo;
        this.computeField(this.velocity, mask, cellSizeM);

        let max = 1e-12;
        for (let i = 0; i < N * N; i++) if (mask[i] === 0 && this.field[i] > max) max = this.field[i];

        const pos = this.surface.geometry.getAttribute('position') as THREE.BufferAttribute;
        const col = this.surface.geometry.getAttribute('color') as THREE.BufferAttribute;

        for (let i = 0; i < N * N; i++) {
            if (mask[i] === 0) {
                const t = this.field[i] / max;
                const [r, g, b] = turbo(t);
                pos.setZ(i, t * this.chartHeight);
                col.setXYZ(i, r, g, b);
            } else {
                const c = mask[i] === 2 ? this.steelColor : this.rockColor;
                pos.setZ(i, 0);
                col.setXYZ(i, c.r, c.g, c.b);
            }
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        this.surface.geometry.computeVertexNormals();

        this.onChartMax?.(max, this.mode);
    }

    // ---------- drill string + wellbore cylinders ----------

    private buildShells() {
        if (!this.geo) return;
        this.shells.traverse((o) => {
            if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        this.shells.clear();

        const s = this.worldScale;
        const h = this.chartHeight;
        const offset = this.geo.eccentricity * (this.geo.radiusOuter - this.geo.radiusInner) * s;

        const cylinder = (radius: number, cx: number, material: THREE.Material) => {
            const g = new THREE.CylinderGeometry(radius, radius, h, 96, 1, true);
            g.rotateX(Math.PI / 2); // axis -> z
            g.translate(cx, 0, h / 2);
            const mesh = new THREE.Mesh(g, material);
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
