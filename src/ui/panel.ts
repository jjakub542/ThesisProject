import { LIMITS } from '../config';
import { BIT_PRESETS, FORMATIONS, MUD_PRESETS } from '../presets';
import type { FluidBase, RheologyModel, ViewMode } from '../types';
import { fromDisplay, plain, toDisplay, unitLabel, type Quantity, type UnitSystem } from '../units';
import { clamp } from '../util';
import { turbo } from '../view/turbo';
import { applyMudPreset, constrainGeometry, type AppState } from './state';

export interface PanelHooks {
    /** Anything the solver depends on changed. */
    onSolverChange(): void;
    onModeChange(): void;
    onLayersChange(): void;
    /** Only the display units changed. */
    onUnitsChange(): void;
}

/** A numeric <input> bound to one value of the state. `quantity` converts to and from the display unit. */
interface NumberField {
    id: string;
    quantity?: Quantity;
    min: number;
    max: number;
    get(): number;
    set(v: number): void;
    /** Called after a user edit, e.g. to mark a mud preset as customised. */
    onEdit?(): void;
    unitText?(): string;
    labelText?(): string;
}

const numberRow = (id: string, label: string) =>
    `<label id="${id}Row"><span id="${id}Label">${label}</span>
       <span class="field"><input id="${id}" type="number" step="any" /><span class="unit" id="${id}Unit"></span></span></label>`;

const options = (items: { value: string; label: string }[]) =>
    items.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');

const TEMPLATE = `
  <canvas id="canvas3d"></canvas>
  <div id="panel">
    <div class="inline">
      <label>View
        <select id="mode">${options([
            { value: 'velocity', label: 'Velocity' },
            { value: 'shear', label: 'Shear rate |∇u|' },
        ])}</select>
      </label>
      <label>Units
        <select id="units">${options([
            { value: 'field', label: 'Field' },
            { value: 'si', label: 'SI' },
        ])}</select>
      </label>
    </div>

    <div class="group">
      <h3>Geometry</h3>
      <label>Bit / pipe preset <select id="bitPreset"></select></label>
      ${numberRow('wellbore', 'Wellbore Ø')}
      ${numberRow('pipe', 'Drill pipe OD')}
      <label>Eccentricity <output id="eccOut"></output>
        <input id="ecc" type="range" min="0" max="${LIMITS.eccentricity.max}" step="0.01" /></label>
      <div id="geoInfo" class="note"></div>
      <div id="geoWarn" class="warn"></div>
    </div>

    <div class="group">
      <h3>Hydraulics</h3>
      ${numberRow('flow', 'Pump rate')}
      ${numberRow('depth', 'Well depth (TVD)')}
    </div>

    <div class="group">
      <h3>Drilling fluid</h3>
      <div class="inline">
        <label>Base <select id="fluidBase">${options([
            { value: 'water', label: 'Water-based' },
            { value: 'oil', label: 'Oil-based' },
        ])}</select></label>
        <label>Mud system <select id="mudPreset"></select></label>
      </div>
      <label>Rheology <select id="rheology">${options([
          { value: 'newtonian', label: 'Newtonian' },
          { value: 'bingham', label: 'Bingham plastic' },
          { value: 'herschel-bulkley', label: 'Herschel–Bulkley' },
      ])}</select></label>
      ${numberRow('density', 'Mud weight')}
      ${numberRow('yield', 'Yield stress τ_y')}
      ${numberRow('k', 'Viscosity')}
      ${numberRow('n', 'Flow index n')}
      <div id="mudNote" class="note"></div>
    </div>

    <div class="group">
      <h3>Wellbore wall</h3>
      <label>Formation <select id="formation"></select></label>
      <label>Roughness ε/D <output id="roughOut"></output>
        <input id="rough" type="range" min="0" max="${LIMITS.roughnessPct.max}" step="0.1" /></label>
      <div id="formationNote" class="note"></div>
    </div>

    <div class="group">
      <h3>Layers</h3>
      <div class="layer">
        <div class="head">
          <label class="check"><input type="checkbox" id="showString" /><span class="swatch silver"></span>Drill string</label>
          <output id="opacityStringOut"></output>
        </div>
        <input type="range" id="opacityString" min="0.05" max="1" step="0.05" />
      </div>
      <div class="layer">
        <div class="head">
          <label class="check"><input type="checkbox" id="showWellbore" /><span class="swatch brown"></span>Wellbore wall</label>
          <output id="opacityWellboreOut"></output>
        </div>
        <input type="range" id="opacityWellbore" min="0.05" max="1" step="0.05" />
      </div>
    </div>

    <div class="group">
      <h3>Results</h3>
      <canvas id="legend" width="256" height="1"></canvas>
      <div class="range"><span id="minLabel">0</span><span id="legendTitle"></span><span id="maxLabel"></span></div>
      <div id="analysis"></div>
      <div id="regime"></div>
      <div id="friction"></div>
      <div id="status"></div>
      <p id="note"></p>
    </div>
  </div>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Builds the panel, wires all inputs to `state`, and returns `sync()` to refresh the inputs from the state. */
export function createPanel(state: AppState, hooks: PanelHooks): { sync(): void } {
    document.querySelector<HTMLDivElement>('#app')!.innerHTML = TEMPLATE;

    // static select options
    $('bitPreset').innerHTML = options([{ value: 'custom', label: 'Custom' }, ...BIT_PRESETS.map((p, i) => ({ value: String(i), label: p.label }))]);
    $('formation').innerHTML = options([{ value: 'custom', label: 'Custom' }, ...FORMATIONS.map((f, i) => ({ value: String(i), label: f.label }))]);

    // colour legend
    const lctx = $<HTMLCanvasElement>('legend').getContext('2d')!;
    for (let x = 0; x < 256; x++) {
        const [r, g, b] = turbo(x / 255);
        lctx.fillStyle = `rgb(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0})`;
        lctx.fillRect(x, 0, 1, 1);
    }

    const markCustomMud = () => { state.mudPreset = 'custom'; };
    const rheologyLabels: Record<RheologyModel, { label: string; unit: string }> = {
        newtonian: { label: 'Viscosity μ', unit: 'Pa·s' },
        bingham: { label: 'Plastic viscosity PV', unit: 'Pa·s' },
        'herschel-bulkley': { label: 'Consistency K', unit: 'Pa·sⁿ' },
    };

    const fields: NumberField[] = [
        { id: 'wellbore', quantity: 'diameter', min: 0, max: Infinity, get: () => state.wellboreDiameterM, set: (v) => (state.wellboreDiameterM = v) },
        { id: 'pipe', quantity: 'diameter', min: 0, max: Infinity, get: () => state.pipeDiameterM, set: (v) => (state.pipeDiameterM = v) },
        { id: 'flow', quantity: 'flow', ...LIMITS.flowRateM3S, get: () => state.flowRateM3S, set: (v) => (state.flowRateM3S = v) },
        { id: 'depth', quantity: 'depth', ...LIMITS.depthM, get: () => state.depthM, set: (v) => (state.depthM = v) },
        { id: 'density', quantity: 'density', ...LIMITS.densityKgM3, get: () => state.densityKgM3, set: (v) => (state.densityKgM3 = v), onEdit: markCustomMud },
        { id: 'yield', ...LIMITS.yieldStressPa, get: () => state.yieldStressPa, set: (v) => (state.yieldStressPa = v), onEdit: markCustomMud, unitText: () => 'Pa' },
        {
            id: 'k', ...LIMITS.consistencyPaSn, get: () => state.consistencyPaSn, set: (v) => (state.consistencyPaSn = v), onEdit: markCustomMud,
            unitText: () => rheologyLabels[state.rheology].unit, labelText: () => rheologyLabels[state.rheology].label,
        },
        { id: 'n', ...LIMITS.flowIndex, get: () => state.flowIndex, set: (v) => (state.flowIndex = v), onEdit: markCustomMud, unitText: () => '' },
    ];

    // ---- refresh inputs from state ----
    function sync(geometryAdjusted = false) {
        const units: UnitSystem = state.units;
        $<HTMLSelectElement>('units').value = units;
        $<HTMLSelectElement>('mode').value = state.mode;

        for (const f of fields) {
            const raw = f.get();
            $<HTMLInputElement>(f.id).value = plain(f.quantity ? toDisplay(f.quantity, units, raw) : raw);
            $(`${f.id}Unit`).textContent = f.unitText ? f.unitText() : f.quantity ? unitLabel(f.quantity, units) : '';
            if (f.labelText) $(`${f.id}Label`).textContent = f.labelText();
        }

        // geometry
        const bit = BIT_PRESETS.findIndex((p) => Math.abs(p.wellboreM - state.wellboreDiameterM) < 1e-6 && Math.abs(p.pipeM - state.pipeDiameterM) < 1e-6);
        $<HTMLSelectElement>('bitPreset').value = bit >= 0 ? String(bit) : 'custom';
        $('eccOut').textContent = state.eccentricity.toFixed(2);
        $<HTMLInputElement>('ecc').value = String(state.eccentricity);
        const dLabel = unitLabel('diameter', units);
        const d = (m: number) => plain(toDisplay('diameter', units, m));
        $('geoInfo').textContent =
            `d/D = ${(state.pipeDiameterM / state.wellboreDiameterM).toFixed(2)}   ·   gap = ${d((state.wellboreDiameterM - state.pipeDiameterM) / 2)} ${dLabel}\n` +
            `hydraulic Ø = ${d(state.wellboreDiameterM - state.pipeDiameterM)} ${dLabel}`;
        $('geoWarn').textContent = geometryAdjusted
            ? `Adjusted to the allowed range: wellbore Ø ${d(LIMITS.wellboreDiameterM.min)}–${d(LIMITS.wellboreDiameterM.max)} ${dLabel}, ` +
              `pipe OD ${LIMITS.diameterRatio.min * 100}–${LIMITS.diameterRatio.max * 100} % of wellbore Ø.`
            : '';

        // wall
        const formation = FORMATIONS.findIndex((f) => Math.abs(f.roughnessPct - state.roughnessPct) < 0.05);
        $<HTMLSelectElement>('formation').value = formation >= 0 ? String(formation) : 'custom';
        $<HTMLInputElement>('rough').value = String(state.roughnessPct);
        $('roughOut').textContent = `${state.roughnessPct.toFixed(1)} % ≈ ${d((state.wellboreDiameterM * state.roughnessPct) / 100)} ${dLabel}`;
        $('formationNote').textContent = formation >= 0 ? FORMATIONS[formation].note : 'Custom effective roughness.';

        // fluid
        $<HTMLSelectElement>('fluidBase').value = state.fluidBase;
        $('mudPreset').innerHTML = options([
            { value: 'custom', label: 'Custom' },
            ...MUD_PRESETS.flatMap((p, i) => (p.base === state.fluidBase ? [{ value: String(i), label: p.label }] : [])),
        ]);
        $<HTMLSelectElement>('mudPreset').value = state.mudPreset;
        $<HTMLSelectElement>('rheology').value = state.rheology;
        $('mudNote').textContent = state.mudPreset === 'custom' ? 'Custom fluid.' : MUD_PRESETS[Number(state.mudPreset)].note;
        const show = (id: string, on: boolean) => ($(`${id}Row`).style.display = on ? '' : 'none');
        show('yield', state.rheology !== 'newtonian');
        show('n', state.rheology === 'herschel-bulkley');

        // layers
        for (const [name, layer] of [['String', state.stringLayer], ['Wellbore', state.wellboreLayer]] as const) {
            $<HTMLInputElement>(`show${name}`).checked = layer.visible;
            $<HTMLInputElement>(`opacity${name}`).value = String(layer.opacity);
            $<HTMLInputElement>(`opacity${name}`).disabled = !layer.visible;
            $(`opacity${name}Out`).textContent = `${Math.round(layer.opacity * 100)}%`;
        }
    }

    /** Sync the inputs, then tell the app that the solver problem changed. */
    const commit = () => {
        const adjusted = constrainGeometry(state);
        sync(adjusted);
        hooks.onSolverChange();
    };

    // ---- number inputs ----
    for (const f of fields) {
        $<HTMLInputElement>(f.id).addEventListener('change', () => {
            const raw = parseFloat($<HTMLInputElement>(f.id).value);
            if (!Number.isFinite(raw)) return sync();
            const si = f.quantity ? fromDisplay(f.quantity, state.units, raw) : raw;
            f.set(clamp(si, f.min, f.max));
            f.onEdit?.();
            commit();
        });
    }

    // ---- selects and sliders ----
    $<HTMLSelectElement>('units').addEventListener('change', (e) => {
        state.units = (e.target as HTMLSelectElement).value as UnitSystem;
        sync();
        hooks.onUnitsChange();
    });
    $<HTMLSelectElement>('mode').addEventListener('change', (e) => {
        state.mode = (e.target as HTMLSelectElement).value as ViewMode;
        hooks.onModeChange();
    });

    $<HTMLSelectElement>('bitPreset').addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v === 'custom') return;
        state.wellboreDiameterM = BIT_PRESETS[Number(v)].wellboreM;
        state.pipeDiameterM = BIT_PRESETS[Number(v)].pipeM;
        commit();
    });
    $<HTMLInputElement>('ecc').addEventListener('input', (e) => {
        state.eccentricity = parseFloat((e.target as HTMLInputElement).value);
        commit();
    });

    $<HTMLSelectElement>('formation').addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v === 'custom') return;
        state.roughnessPct = FORMATIONS[Number(v)].roughnessPct;
        commit();
    });
    $<HTMLInputElement>('rough').addEventListener('input', (e) => {
        state.roughnessPct = parseFloat((e.target as HTMLInputElement).value);
        commit();
    });

    $<HTMLSelectElement>('fluidBase').addEventListener('change', (e) => {
        const base = (e.target as HTMLSelectElement).value as FluidBase;
        applyMudPreset(state, MUD_PRESETS.findIndex((p) => p.base === base));
        commit();
    });
    $<HTMLSelectElement>('mudPreset').addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v === 'custom') return;
        applyMudPreset(state, Number(v));
        commit();
    });
    $<HTMLSelectElement>('rheology').addEventListener('change', (e) => {
        state.rheology = (e.target as HTMLSelectElement).value as RheologyModel;
        markCustomMud();
        commit();
    });

    for (const [name, layer] of [['String', state.stringLayer], ['Wellbore', state.wellboreLayer]] as const) {
        const update = () => {
            layer.visible = $<HTMLInputElement>(`show${name}`).checked;
            layer.opacity = parseFloat($<HTMLInputElement>(`opacity${name}`).value);
            sync();
            hooks.onLayersChange();
        };
        $(`show${name}`).addEventListener('change', update);
        $(`opacity${name}`).addEventListener('input', update);
    }

    return { sync: () => sync() };
}
