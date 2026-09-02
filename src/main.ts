import './style.css';
import { Visualizer } from './view/Visualizer';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="canvas3d"></canvas>
`;

const canvas = document.getElementById('canvas3d') as HTMLCanvasElement;
const visualizer = new Visualizer(canvas);

// Inicjalizacja Web Workera
const worker = new Worker(new URL('./solver/cfd.worker.ts', import.meta.url), { type: 'module' });

worker.onmessage = (e) => {
    const { type, velocity } = e.data;

    if (type === 'READY') {
        console.log('Worker gotowy, start symulacji');
        worker.postMessage({ type: 'COMPUTE' });
    }

    if (type === 'RESULT') {
        // Przekazujemy dane do Three.js
        visualizer.updateData(velocity);
        
        // Zlecamy kolejny krok obliczeń
        worker.postMessage({ type: 'COMPUTE' });
    }
};

// Startujemy
worker.postMessage({ type: 'INIT', payload: { size: 100 } });