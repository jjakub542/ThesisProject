import * as THREE from 'three';

export class Visualizer {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private particles!: THREE.InstancedMesh;

    constructor(canvas: HTMLCanvasElement) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 5;

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        this.initScene();
        this.animate();
    }

    private initScene() {
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(10, 10, 10);
        this.scene.add(light);

        // Geometria testowa - cylinder reprezentujący rdzeń
        const geometry = new THREE.CylinderGeometry(1, 1, 4, 32);
        const material = new THREE.MeshPhongMaterial({ color: 0x888888, wireframe: true });
        const cylinder = new THREE.Mesh(geometry, material);
        this.scene.add(cylinder);

        // TODO: Tutaj dodasz system cząsteczek (InstancedMesh) poruszających się na podstawie danych z workera
    }

    public updateData(velocityData: Float64Array) {
        // TODO: Aktualizacja pozycji cząsteczek na podstawie Float64Array z workera
        // velocityData zawiera płaski przekrój 2D
    }

    private animate = () => {
        requestAnimationFrame(this.animate);
        this.renderer.render(this.scene, this.camera);
    }
}