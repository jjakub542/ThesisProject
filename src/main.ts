import './style.css';
import './panel.css';
import { Visualizer, turbo, type ViewMode, type Stats } from './view/Visualizer';

const GRID_SIZE = 100;
const CONVERGENCE_TOL = 1e-6;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="canvas3d"></canvas>
  <div id="panel">
    <label>View
      <select id="mode">
        <option value="velocity">Velocity</option>
        <option value="shear">Shear rate |∇u|</option>
        <option value="pressure">Pressure drop</option>
      </select>
    </label>
    <label>Eccentricity <output id="eccOut">0.50</output>
      <input id="ecc" type="range" min="0" max="0.95" step="0.01" value="0.1" />
    </label>
    <canvas id="legend" width="256" height="1"></canvas>
    <div class="range"><span id="minLabel">0</span><span id="legendTitle"></span><span id="maxLabel"></span></div>
    <div id="flow"></div>
    <div id="status"></div>
    <p id="note"></p>
  </div>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- legend ----
const legend = $<HTMLCanvasElement>('legend');
const lctx = legend.getContext('2d')!;
for (let x = 0; x < legend.width; x++) {
    const [r, g, b] = turbo(x / (legend.width - 1));
    lctx.fillStyle = `rgb(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0})`;
    lctx.fillRect(x, 0, 1, 1);
}

const TITLES: Record<ViewMode, string> = {
    velocity: 'axial velocity u',
    shear: 'shear rate |∇u|',
    pressure: 'p / p_inlet',
};
const NOTES: Record<ViewMode, string> = {
    velocity: 'Height and color = axial velocity. Note the dead zone in the narrow gap.',
    shear: 'Height and color = |∇u|. Highest shear sits at the walls of the wide gap.',
    pressure:
        'Fully developed laminar flow has constant dp/dz, so pressure falls linearly along the well (bottom → top). Eccentricity changes the flow rate Q reached for that drop.',
};

function updateHud(s: Stats, mode: ViewMode) {
    $('minLabel').textContent = mode === 'pressure' ? '0 (outlet)' : s.min.toFixed(2);
    $('maxLabel').textContent = mode === 'pressure' ? '1 (inlet)' : s.max.toFixed(3);
    $('legendTitle').textContent = TITLES[mode];
    $('flow').textContent = `Flow rate Q ∝ ${s.flow.toFixed(1)}`;
    $('note').textContent = NOTES[mode];
}

// ---- scene + worker ----
const visualizer = new Visualizer($<HTMLCanvasElement>('canvas3d'), GRID_SIZE);
visualizer.onStats = updateHud;

const worker = new Worker(new URL('./solver/cfd.worker.ts', import.meta.url), { type: 'module' });

let busy = false;
function requestCompute() {
    if (busy) return;
    busy = true;
    $('status').textContent = 'Solving…';
    worker.postMessage({ type: 'COMPUTE' });
}

worker.onmessage = (e) => {
    const { type } = e.data;

    if (type === 'READY' || type === 'GEOMETRY') {
        visualizer.setGeometry(e.data);
        requestCompute();
    }

    if (type === 'RESULT') {
        busy = false;
        visualizer.updateData(e.data.velocity);
        if (e.data.delta > CONVERGENCE_TOL) requestCompute();
        else $('status').textContent = 'Converged ✓';
    }
};

worker.postMessage({ type: 'INIT', payload: { size: GRID_SIZE } });

// ---- controls ----
$<HTMLSelectElement>('mode').addEventListener('change', (e) => {
    visualizer.setMode((e.target as HTMLSelectElement).value as ViewMode);
});

$<HTMLInputElement>('ecc').addEventListener('input', (e) => {
    const ecc = parseFloat((e.target as HTMLInputElement).value);
    $('eccOut').textContent = ecc.toFixed(2);
    worker.postMessage({ type: 'SET_GEOMETRY', payload: { eccentricity: ecc } });
});

visualizer.setMode('velocity');
