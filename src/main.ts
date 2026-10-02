import './style.css';
import './panel.css';
import { Visualizer, turbo, type ViewMode, type Stats, type LayerStyle } from './view/Visualizer';
import {
    CONVERGENCE_TOL,
    DEFAULTS,
    FORCING_TERM,
    FORMATIONS,
    GRID_SIZE,
    MAX_DIAMETER_RATIO,
    MAX_ECCENTRICITY,
    MAX_ROUGHNESS_PCT,
    MIN_DIAMETER_RATIO,
    MM_PER_INCH,
    OUTER_RADIUS_CELLS,
    PRESETS,
    WELLBORE_MAX_MM,
    WELLBORE_MIN_MM,
} from './config';

type Unit = 'in' | 'mm';

/** Single source of truth for the UI. Diameters are kept in mm internally. */
const state = { ...DEFAULTS, unit: 'in' as Unit };

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

    <div class="group">
      <h3>Geometry</h3>
      <div class="inline">
        <label>Preset
          <select id="preset">
            <option value="custom">Custom</option>
            ${PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('')}
          </select>
        </label>
        <label>Unit
          <select id="unit">
            <option value="in">inch</option>
            <option value="mm">mm</option>
          </select>
        </label>
      </div>
      <label>Wellbore Ø
        <span class="field"><input id="wellbore" type="number" /><span class="unit"></span></span>
      </label>
      <label>Drill pipe OD
        <span class="field"><input id="pipe" type="number" /><span class="unit"></span></span>
      </label>
      <label>Eccentricity <output id="eccOut"></output>
        <input id="ecc" type="range" min="0" max="${MAX_ECCENTRICITY}" step="0.01" value="${state.eccentricity}" />
      </label>
      <div id="geoInfo"></div>
      <div id="geoWarn"></div>
    </div>

    <div class="group">
      <h3>Wellbore wall</h3>
      <label>Formation
        <select id="formation">
          <option value="custom">Custom</option>
          ${FORMATIONS.map((f, i) => `<option value="${i}">${f.label}</option>`).join('')}
        </select>
      </label>
      <label>Roughness ε/D <output id="roughOut"></output>
        <input id="rough" type="range" min="0" max="${MAX_ROUGHNESS_PCT}" step="0.1" value="${state.roughnessPct}" />
      </label>
      <div id="formationNote"></div>
    </div>

    <div class="group">
      <h3>Layers</h3>
      <div class="layer">
        <div class="head">
          <label class="check"><input type="checkbox" id="showString" ${state.showString ? 'checked' : ''} />
            <span class="swatch silver"></span>Drill string</label>
          <output id="opacityStringOut"></output>
        </div>
        <input type="range" id="opacityString" min="0.05" max="1" step="0.05" value="${state.stringOpacity}" />
      </div>
      <div class="layer">
        <div class="head">
          <label class="check"><input type="checkbox" id="showWellbore" ${state.showWellbore ? 'checked' : ''} />
            <span class="swatch brown"></span>Wellbore wall</label>
          <output id="opacityWellboreOut"></output>
        </div>
        <input type="range" id="opacityWellbore" min="0.05" max="1" step="0.05" value="${state.wellboreOpacity}" />
      </div>
    </div>

    <canvas id="legend" width="256" height="1"></canvas>
    <div class="range"><span id="minLabel">0</span><span id="legendTitle"></span><span id="maxLabel"></span></div>
    <div id="flow"></div>
    <div id="friction"></div>
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

// ---- HUD ----
// Values are shown in dimensionless form, so they stay comparable between diameters:
//   u*   = u * mu / (G * R^2)      G = -dp/dz, R = wellbore radius
//   |∇u|* = |∇u| * mu / (G * R)
const TITLES: Record<ViewMode, string> = {
    velocity: 'u* = uμ/(G·R²)',
    shear: '|∇u|* = |∇u|μ/(G·R)',
    pressure: 'p / p_inlet',
};
const NOTES: Record<ViewMode, string> = {
    velocity: 'Height and color = axial velocity. Note the dead zone in the narrow gap.',
    shear: 'Height and color = |∇u|. Highest shear sits at the walls of the wide gap.',
    pressure:
        'Fully developed laminar flow has constant dp/dz, so pressure falls linearly along the well (bottom → top). Eccentricity and diameters change the flow rate Q reached for that drop. Raise the layer opacity to 100% for solid walls.',
};

let lastHud: [Stats, ViewMode] | null = null;
let converged = false;                  // both the rough and the smooth-wall solution have settled
let referenceFlow: number | null = null; // smooth-wall flow (cell units); null when roughness = 0

function updateHud(s: Stats, mode: ViewMode) {
    lastHud = [s, mode];
    const R = OUTER_RADIUS_CELLS;

    if (mode === 'pressure') {
        $('minLabel').textContent = '0 (outlet)';
        $('maxLabel').textContent = '1 (inlet)';
    } else {
        const scale = mode === 'shear' ? FORCING_TERM * R : FORCING_TERM * R * R;
        $('minLabel').textContent = '0';
        $('maxLabel').textContent = (s.max / scale).toFixed(3);
    }
    $('legendTitle').textContent = TITLES[mode];

    // Q = sum(u) dx^2, with u = u_cell * (G dx^2 / mu) / f   =>   Q*mu/G = dx^4 * sum(u_cell) / f
    const dxMm = state.wellboreMm / 2 / R;
    const qMm4 = (dxMm ** 4 * s.flow) / FORCING_TERM;
    const q = state.unit === 'in' ? qMm4 / MM_PER_INCH ** 4 : qMm4;
    $('flow').textContent = `Q·μ/G = ${q.toPrecision(3)} ${state.unit}⁴`;

    // Friction impact: flow with the rough wall vs. the same geometry with a smooth wall.
    if (state.roughnessPct <= 0) {
        $('friction').textContent = 'Wall: smooth (reference)';
    } else if (converged && referenceFlow && s.flow > 0) {
        const change = (s.flow / referenceFlow - 1) * 100;
        $('friction').textContent = `Wall friction: Q ${change.toFixed(1)} % vs smooth wall`;
    } else {
        $('friction').textContent = 'Wall friction: solving…';
    }
    $('note').textContent = NOTES[mode];
}

// ---- scene + worker ----
const visualizer = new Visualizer($<HTMLCanvasElement>('canvas3d'), GRID_SIZE);
visualizer.onStats = updateHud;

const worker = new Worker(new URL('./solver/cfd.worker.ts', import.meta.url), { type: 'module' });

let computeBusy = false;
let geometryBusy = false;   // a geometry request is in flight
let geometryDirty = false;  // newer parameters arrived while it was in flight

const geometryPayload = () => ({
    diameterRatio: state.pipeMm / state.wellboreMm,
    eccentricity: state.eccentricity,
    roughness: state.roughnessPct / 100, // eps / D
});

function requestCompute() {
    if (computeBusy) return;
    computeBusy = true;
    $('status').textContent = 'Solving…';
    worker.postMessage({ type: 'COMPUTE' });
}

/** Coalesces rapid parameter changes (slider drags) into at most one request in flight. */
function requestGeometry() {
    converged = false;
    $('status').textContent = 'Solving…';
    if (geometryBusy) {
        geometryDirty = true;
        return;
    }
    geometryBusy = true;
    geometryDirty = false;
    worker.postMessage({ type: 'SET_GEOMETRY', payload: geometryPayload() });
}

worker.onmessage = (e) => {
    const { type } = e.data;

    if (type === 'READY' || type === 'GEOMETRY') {
        geometryBusy = false;
        referenceFlow = null; // belongs to the previous geometry
        visualizer.setGeometry(e.data);
        if (geometryDirty) requestGeometry();
        else requestCompute();
    }

    if (type === 'RESULT') {
        computeBusy = false;
        referenceFlow = e.data.referenceFlow;
        converged = !geometryBusy && e.data.delta <= CONVERGENCE_TOL;
        visualizer.updateData(e.data.velocity); // HUD refreshes on the next frame and reads `converged`
        if (geometryBusy) return; // stale solve; the GEOMETRY reply restarts it
        if (!converged) requestCompute();
        else $('status').textContent = 'Converged ✓';
    }
};

// ---- geometry UI ----
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const show = (mm: number) => (state.unit === 'in' ? (mm / MM_PER_INCH).toFixed(3) : mm.toFixed(1));
const fromDisplay = (v: number) => (state.unit === 'in' ? v * MM_PER_INCH : v);

function matchPreset(): string {
    const i = PRESETS.findIndex(
        (p) =>
            Math.abs(p.wellboreIn * MM_PER_INCH - state.wellboreMm) < 0.01 &&
            Math.abs(p.pipeIn * MM_PER_INCH - state.pipeMm) < 0.01
    );
    return i >= 0 ? String(i) : 'custom';
}

function syncGeometryUi(adjusted = false) {
    const step = state.unit === 'in' ? '0.125' : '1';
    for (const id of ['wellbore', 'pipe']) $<HTMLInputElement>(id).step = step;
    $<HTMLInputElement>('wellbore').value = show(state.wellboreMm);
    $<HTMLInputElement>('pipe').value = show(state.pipeMm);
    document.querySelectorAll('.unit').forEach((el) => (el.textContent = state.unit));
    $<HTMLSelectElement>('preset').value = matchPreset();
    $('eccOut').textContent = state.eccentricity.toFixed(2);

    const ratio = state.pipeMm / state.wellboreMm;
    const gap = (state.wellboreMm - state.pipeMm) / 2;
    $('geoInfo').textContent =
        `d/D = ${ratio.toFixed(2)}   ·   gap = ${show(gap)} ${state.unit}\n` +
        `hydraulic Ø = ${show(state.wellboreMm - state.pipeMm)} ${state.unit}`;

    $('geoWarn').textContent = adjusted
        ? `Adjusted to the allowed range: wellbore Ø ${show(WELLBORE_MIN_MM)}–${show(WELLBORE_MAX_MM)} ${state.unit}, ` +
          `pipe OD ${MIN_DIAMETER_RATIO * 100}–${MAX_DIAMETER_RATIO * 100}% of wellbore Ø.`
        : '';
    syncWallUi();
}

function setDiameters(wellboreMm: number, pipeMm: number) {
    const w = clamp(wellboreMm, WELLBORE_MIN_MM, WELLBORE_MAX_MM);
    const p = clamp(pipeMm, w * MIN_DIAMETER_RATIO, w * MAX_DIAMETER_RATIO);
    const adjusted = Math.abs(w - wellboreMm) > 1e-6 || Math.abs(p - pipeMm) > 1e-6;
    state.wellboreMm = w;
    state.pipeMm = p;
    syncGeometryUi(adjusted);
    requestGeometry();
}

function onDiameterInput(which: 'wellbore' | 'pipe') {
    const v = parseFloat($<HTMLInputElement>(which).value);
    if (!isFinite(v) || v <= 0) return syncGeometryUi(); // revert garbage input
    if (which === 'wellbore') setDiameters(fromDisplay(v), state.pipeMm);
    else setDiameters(state.wellboreMm, fromDisplay(v));
}

$<HTMLInputElement>('wellbore').addEventListener('change', () => onDiameterInput('wellbore'));
$<HTMLInputElement>('pipe').addEventListener('change', () => onDiameterInput('pipe'));

$<HTMLSelectElement>('preset').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v === 'custom') return;
    const p = PRESETS[Number(v)];
    setDiameters(p.wellboreIn * MM_PER_INCH, p.pipeIn * MM_PER_INCH);
});

$<HTMLSelectElement>('unit').addEventListener('change', (e) => {
    state.unit = (e.target as HTMLSelectElement).value as Unit;
    syncGeometryUi();
    if (lastHud) updateHud(...lastHud);
});

$<HTMLInputElement>('ecc').addEventListener('input', (e) => {
    state.eccentricity = parseFloat((e.target as HTMLInputElement).value);
    $('eccOut').textContent = state.eccentricity.toFixed(2);
    requestGeometry();
});

$<HTMLSelectElement>('mode').addEventListener('change', (e) => {
    visualizer.setMode((e.target as HTMLSelectElement).value as ViewMode);
});

// ---- wellbore wall UI (formation presets + roughness) ----
function matchFormation(): string {
    const i = FORMATIONS.findIndex((f) => Math.abs(f.roughnessPct - state.roughnessPct) < 0.05);
    return i >= 0 ? String(i) : 'custom';
}

function syncWallUi() {
    const key = matchFormation();
    const roughMm = (state.wellboreMm * state.roughnessPct) / 100;
    $<HTMLInputElement>('rough').value = String(state.roughnessPct);
    $('roughOut').textContent = `${state.roughnessPct.toFixed(1)} % ≈ ${show(roughMm)} ${state.unit}`;
    $<HTMLSelectElement>('formation').value = key;
    $('formationNote').textContent = key === 'custom' ? 'Custom effective roughness.' : FORMATIONS[Number(key)].note;
}

$<HTMLSelectElement>('formation').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v === 'custom') return;
    state.roughnessPct = FORMATIONS[Number(v)].roughnessPct;
    syncWallUi();
    requestGeometry();
});

$<HTMLInputElement>('rough').addEventListener('input', (e) => {
    state.roughnessPct = parseFloat((e.target as HTMLInputElement).value);
    syncWallUi();
    requestGeometry();
});

// ---- layer UI (drill string / wellbore wall) ----
function bindLayer(id: 'String' | 'Wellbore', apply: (s: Partial<LayerStyle>) => void) {
    const check = $<HTMLInputElement>(`show${id}`);
    const slider = $<HTMLInputElement>(`opacity${id}`);
    const out = $(`opacity${id}Out`);
    const update = () => {
        out.textContent = `${Math.round(+slider.value * 100)}%`;
        slider.disabled = !check.checked;
        apply({ visible: check.checked, opacity: +slider.value });
    };
    check.addEventListener('change', update);
    slider.addEventListener('input', update);
    update();
}

bindLayer('String', (s) => visualizer.setStringStyle(s));
bindLayer('Wellbore', (s) => visualizer.setWellboreStyle(s));

// ---- start ----
syncGeometryUi();
visualizer.setMode('velocity');
geometryBusy = true; // INIT is answered with READY
worker.postMessage({ type: 'INIT', payload: { size: GRID_SIZE, ...geometryPayload() } });
