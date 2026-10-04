import { LIMITS } from '../config';
import { MUD_PRESETS } from '../presets';
import { clamp } from '../util';
import type { UnitSystem } from '../units';
import type { Fluid, FluidBase, LayerStyle, RheologyModel, SolverInput, ViewMode } from '../types';

/** The single source of truth for the UI. Every physical value is stored in SI units. */
export interface AppState {
    units: UnitSystem;
    mode: ViewMode;

    wellboreDiameterM: number;
    pipeDiameterM: number;
    eccentricity: number;
    roughnessPct: number;

    flowRateM3S: number;
    depthM: number;

    fluidBase: FluidBase;
    /** Index into MUD_PRESETS, or 'custom'. */
    mudPreset: string;
    rheology: RheologyModel;
    densityKgM3: number;
    yieldStressPa: number;
    consistencyPaSn: number;
    flowIndex: number;

    stringLayer: LayerStyle;
    wellboreLayer: LayerStyle;
}

export function createState(): AppState {
    const state: AppState = {
        units: 'field',
        mode: 'velocity',
        wellboreDiameterM: 8.5 * 0.0254,
        pipeDiameterM: 5 * 0.0254,
        eccentricity: 0.5,
        roughnessPct: 0,
        flowRateM3S: 200 * (3.785411784e-3 / 60), // 200 gpm
        depthM: 3000,
        fluidBase: 'water',
        mudPreset: 'custom',
        rheology: 'bingham',
        densityKgM3: 0,
        yieldStressPa: 0,
        consistencyPaSn: 0,
        flowIndex: 1,
        stringLayer: { visible: true, opacity: 0.4 },
        wellboreLayer: { visible: true, opacity: 0.25 },
    };
    applyMudPreset(state, MUD_PRESETS.findIndex((m) => m.label === 'Bentonite WBM'));
    return state;
}

export function applyMudPreset(s: AppState, index: number) {
    const p = MUD_PRESETS[index];
    s.mudPreset = String(index);
    s.fluidBase = p.base;
    s.rheology = p.rheology;
    s.densityKgM3 = p.densityKgM3;
    s.yieldStressPa = p.yieldStressPa;
    s.consistencyPaSn = p.consistencyPaSn;
    s.flowIndex = p.flowIndex;
}

/** Keeps the diameters in their allowed ranges. Returns true when a value had to be changed. */
export function constrainGeometry(s: AppState): boolean {
    const w = clamp(s.wellboreDiameterM, LIMITS.wellboreDiameterM.min, LIMITS.wellboreDiameterM.max);
    const p = clamp(s.pipeDiameterM, w * LIMITS.diameterRatio.min, w * LIMITS.diameterRatio.max);
    const changed = Math.abs(w - s.wellboreDiameterM) > 1e-9 || Math.abs(p - s.pipeDiameterM) > 1e-9;
    s.wellboreDiameterM = w;
    s.pipeDiameterM = p;
    return changed;
}

/** The rheology model decides which of the stored parameters are used; the others are kept for switching back. */
export function toFluid(s: AppState): Fluid {
    return {
        densityKgM3: s.densityKgM3,
        yieldStressPa: s.rheology === 'newtonian' ? 0 : s.yieldStressPa,
        consistencyPaSn: s.consistencyPaSn,
        flowIndex: s.rheology === 'herschel-bulkley' ? s.flowIndex : 1,
    };
}

export function toSolverInput(s: AppState): SolverInput {
    return {
        geometry: {
            wellboreDiameterM: s.wellboreDiameterM,
            pipeDiameterM: s.pipeDiameterM,
            eccentricity: s.eccentricity,
            roughness: s.roughnessPct / 100,
        },
        fluid: toFluid(s),
        flowRateM3S: s.flowRateM3S,
    };
}
