import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ViewMode = 'velocity' | 'shear' | 'pressure';

export interface GeometryInfo {
    mask: Uint8Array;
    radiusOuter: number;
    radiusInner: number;
    eccentricity: number;
}

export interface Stats {
    min: number;
    max: number;
    flow: number; // sum of velocity over fluid cells (proportional to flow rate Q)
}

/** Google "turbo" colormap polynomial approximation, t in [0,1]. */
export function turbo(t: number): [number, number, number] {
    t = Math.min(1, Math.max(0, t));
    const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
    const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
    const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
    const c = (v: number) => Math.min(1, Math.max(0, v));
    return [c(r), c(g), c(b)];
}

export class Visualizer {
    public onStats?: (s: Stats, mode: ViewMode) => void;

    private scene = new THREE.Scene();
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;

    private N: number;
    private worldScale = 0.05;
    private chartHeight = 2.5;
    private tubeLength = 4;

    private surface!: THREE.Mesh;
    private tubeGroup = new THREE.Group();

    private velocity: Float64Array | null = null;
    private geo: GeometryInfo | null = null;
    private mode: ViewMode = 'velocity';
    private dirty = false;

    private readonly rockColor = new THREE.Color(0x1b1f27);
    private readonly steelColor = new THREE.Color(0x9aa4b2);

    constructor(canvas: HTMLCanvasElement, gridSize: number) {
        this.N = gridSize;

        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
        this.camera.up.set(0, 0, 1); // z-up: like a vertical well
        this.camera.position.set(5.5, -6.5, 5);

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x0d0f14);

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const key = new THREE.DirectionalLight(0xffffff, 1.1);
        key.position.set(6, -8, 12);
        this.scene.add(key);
        const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
        fill.position.set(-8, 6, 4);
        this.scene.add(fill);

        this.initSurface();
        this.scene.add(this.tubeGroup);
        this.applyModeVisibility();

        window.addEventListener('resize', this.onWindowResize);
        this.animate();
    }

    // ---------- public API ----------

    public setGeometry(info: GeometryInfo) {
        this.geo = info;
        this.buildTube();
        this.dirty = true;
    }

    public updateData(velocity: Float64Array) {
        this.velocity = velocity;
        this.dirty = true;
    }

    public setMode(mode: ViewMode) {
        this.mode = mode;
        this.applyModeVisibility();
        this.dirty = true;
    }

    // ---------- surface chart ----------

    private initSurface() {
        const N = this.N;
        const c = N / 2;
        const positions = new Float32Array(N * N * 3);
        const colors = new Float32Array(N * N * 3);

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
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));

        this.surface = new THREE.Mesh(
            g,
            new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.99, metalness: 0.01, side: THREE.DoubleSide })
        );
        this.scene.add(this.surface);
    }

    private computeShear(v: Float64Array, m: Uint8Array): Float64Array {
        const N = this.N;
        const out = new Float64Array(N * N);
        for (let y = 1; y < N - 1; y++) {
            for (let x = 1; x < N - 1; x++) {
                const i = x + y * N;
                if (m[i] !== 0) continue;
                out[i] = Math.hypot((v[i + 1] - v[i - 1]) / 2, (v[i + N] - v[i - N]) / 2);
            }
        }
        return out;
    }

    private rebuildSurface() {
        if (!this.velocity || !this.geo) return;
        const N = this.N;
        const m = this.geo.mask;
        const v = this.velocity;
        const field = this.mode === 'shear' ? this.computeShear(v, m) : v;

        let max = 1e-12, flow = 0;
        for (let i = 0; i < N * N; i++) {
            if (m[i] !== 0) continue;
            if (field[i] > max) max = field[i];
            flow += v[i];
        }

        const pos = this.surface.geometry.getAttribute('position') as THREE.BufferAttribute;
        const col = this.surface.geometry.getAttribute('color') as THREE.BufferAttribute;

        for (let i = 0; i < N * N; i++) {
            if (m[i] === 0) {
                const t = field[i] / max;
                const [r, g, b] = turbo(t);
                pos.setZ(i, t * this.chartHeight);
                col.setXYZ(i, r, g, b);
            } else {
                const c = m[i] === 2 ? this.steelColor : this.rockColor;
                pos.setZ(i, 0);
                col.setXYZ(i, c.r, c.g, c.b);
            }
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        this.surface.geometry.computeVertexNormals();

        this.onStats?.({ min: 0, max, flow }, this.mode);
    }

    // ---------- pressure tube ----------

    private buildTube() {
        if (!this.geo) return;

        this.tubeGroup.traverse((o) => {
            if (o instanceof THREE.Mesh) {
                o.geometry.dispose();
                (o.material as THREE.Material).dispose();
            }
        });
        this.tubeGroup.clear();

        const s = this.worldScale;
        const L = this.tubeLength;
        const Ro = this.geo.radiusOuter * s;
        const Ri = this.geo.radiusInner * s;
        const offset = this.geo.eccentricity * (this.geo.radiusOuter - this.geo.radiusInner) * s;

        // Color by height: p = 1 at the bottom (inlet), 0 at the top (outlet)
        const makeCylinder = (radius: number, cx: number, side: THREE.Side) => {
            const g = new THREE.CylinderGeometry(radius, radius, L, 128, 96, true);
            g.rotateX(Math.PI / 2); // axis -> z
            g.translate(cx, 0, L / 2);
            const p = g.getAttribute('position');
            const colors = new Float32Array(p.count * 3);
            for (let i = 0; i < p.count; i++) {
                const [r, gr, b] = turbo(1 - p.getZ(i) / L);
                colors.set([r, gr, b], i * 3);
            }
            g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side, roughness: 0.5 }));
        };

        this.tubeGroup.add(makeCylinder(Ro, 0, THREE.BackSide));   // borehole wall (seen from inside)
        this.tubeGroup.add(makeCylinder(Ri, offset, THREE.FrontSide)); // drill pipe

        // Annulus end caps
        const shape = new THREE.Shape();
        shape.absarc(0, 0, Ro, 0, Math.PI * 2, false);
        const hole = new THREE.Path();
        hole.absarc(offset, 0, Ri, 0, Math.PI * 2, true);
        shape.holes.push(hole);

        [[0, 1], [L, 0]].forEach(([z, p]) => {
            const [r, g, b] = turbo(p);
            const cap = new THREE.Mesh(
                new THREE.ShapeGeometry(shape, 96),
                new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide })
            );
            cap.position.z = z;
            this.tubeGroup.add(cap);
        });
    }

    private applyModeVisibility() {
        const pressure = this.mode === 'pressure';
        this.surface.visible = !pressure;
        this.tubeGroup.visible = pressure;
        this.controls.target.set(0, 0, pressure ? this.tubeLength / 2 : this.chartHeight / 2);
    }

    // ---------- loop ----------

    private animate = () => {
        requestAnimationFrame(this.animate);

        if (this.dirty) {
            this.dirty = false;
            if (this.mode === 'pressure') {
                if (this.velocity) {
                    let flow = 0;
                    const m = this.geo!.mask;
                    for (let i = 0; i < m.length; i++) if (m[i] === 0) flow += this.velocity[i];
                    this.onStats?.({ min: 0, max: 1, flow }, this.mode);
                }
            } else {
                this.rebuildSurface();
            }
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
