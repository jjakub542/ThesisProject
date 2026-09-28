import * as THREE from 'three';

interface Particle {
    x: number; // Pozycja w przestrzeni 3D
    y: number;
    z: number;
    gridX: number; // Indeks na siatce 2D
    gridY: number;
}

export class Visualizer {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    
    private particleMesh!: THREE.InstancedMesh;
    private particles: Particle[] = [];
    private particleCount = 4000;
    
    private velocityData: Float64Array | null = null;
    private gridSize = 100; // Musi pasować do rozmiaru z Main.ts
    
    // Wymiary rury w świecie 3D
    private pipeLength = 20;
    private worldScale = 0.05; // Skalowanie siatki gridu na świat 3D

    constructor(canvas: HTMLCanvasElement, gridSize: number = 128) {
        this.gridSize = gridSize;
        this.scene = new THREE.Scene();
        
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 0, 15);

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x111111);

        this.initScene();
        this.initParticles();
        this.animate();

        window.addEventListener('resize', this.onWindowResize);
    }

    private initScene() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(10, 20, 10);
        this.scene.add(dirLight);

        // Subtelny szkielet rury zewnętrznej dla kontekstu
        const outerGeo = new THREE.CylinderGeometry(this.gridSize * this.worldScale / 2, this.gridSize * this.worldScale / 2, this.pipeLength, 32, 1, true);
        const outerMat = new THREE.MeshBasicMaterial({ color: 0x333333, wireframe: true, transparent: true, opacity: 0.2 });
        const outerPipe = new THREE.Mesh(outerGeo, outerMat);
        outerPipe.rotation.x = Math.PI / 2;
        this.scene.add(outerPipe);
    }

    private initParticles() {
        // Mała sferyczna geometria dla pojedynczej cząsteczki
        const geometry = new THREE.SphereGeometry(0.04, 8, 8);
        
        // Dynamiczny materiał zmieniający kolor na podstawie prędkości (opcjonalnie)
        const material = new THREE.MeshStandardMaterial({ color: 0x00ffcc, roughness: 0.3 });

        this.particleMesh = new THREE.InstancedMesh(geometry, material, this.particleCount);
        this.scene.add(this.particleMesh);

        const dummy = new THREE.Object3D();
        const center = this.gridSize / 2;
        const radius = this.gridSize * 0.35; // Obszar generowania cząsteczek wewnątrz szczeliny

        for (let i = 0; i < this.particleCount; i++) {
            // Losowy punkt w przestrzeni pierścieniowej
            const angle = Math.random() * Math.PI * 2;
            const r = (0.3 + Math.random() * 0.6) * radius; // Pomiędzy wiertłem a ścianą
            
            const gx = Math.floor(center + Math.cos(angle) * r);
            const gy = Math.floor(center + Math.sin(angle) * r);

            // Przeliczenie na współrzędne świata 3D (wyśrodkowane)
            const x = (gx - center) * this.worldScale;
            const y = (gy - center) * this.worldScale;
            const z = (Math.random() - 0.5) * this.pipeLength;

            this.particles.push({ x, y, z, gridX: gx, gridY: gy });

            dummy.position.set(x, y, z);
            dummy.updateMatrix();
            this.particleMesh.setMatrixAt(i, dummy.matrix);
        }

        this.particleMesh.instanceMatrix.needsUpdate = true;
    }

    public updateData(velocityData: Float64Array) {
        this.velocityData = velocityData;
    }

    private updateParticles() {
        if (!this.velocityData) return;

        const dummy = new THREE.Object3D();
        const halfLength = this.pipeLength / 2;
        const center = this.gridSize / 2;

        for (let i = 0; i < this.particleCount; i++) {
            const p = this.particles[i];

            // Pobranie prędkości z siatki 2D obliczonej przez Workera
            const gridIndex = p.gridX + p.gridY * this.gridSize;
            const speed = this.velocityData[gridIndex] || 0.001; // Zabezpieczenie przed zerem

            // Przesunięcie cząsteczki wzdłuż osi Z proporcjonalnie do lokalnej prędkości płynu
            p.z += speed * 0.5; 

            // Jeśli cząsteczka wylatuje poza koniec rury, wraca na początek
            if (p.z > halfLength) {
                p.z = -halfLength;
            }

            dummy.position.set(p.x, p.y, p.z);
            dummy.updateMatrix();
            this.particleMesh.setMatrixAt(i, dummy.matrix);
        }

        this.particleMesh.instanceMatrix.needsUpdate = true;
    }

    private animate = () => {
        requestAnimationFrame(this.animate);

        // Aktualizacja pozycji cząsteczek na podstawie najnowszych danych CFD
        this.updateParticles();

        // Lekki obrót sceny, by dobrze widzieć efekt mimośrodowości
        this.scene.rotation.y += 0.002;

        this.renderer.render(this.scene, this.camera);
    }

    private onWindowResize = () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}