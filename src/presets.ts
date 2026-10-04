import type { FluidBase, RheologyModel } from './types';

const IN = 0.0254;
const ppg = (v: number) => v * 119.8264;
const cP = (v: number) => v / 1000;
const lb100 = (v: number) => v * 0.4788026; // lb/100ft² -> Pa

export interface BitPreset { label: string; wellboreM: number; pipeM: number }

/** Common bit / drill-pipe combinations. */
export const BIT_PRESETS: BitPreset[] = [
    { label: '6 × 3½ in', wellboreM: 6 * IN, pipeM: 3.5 * IN },
    { label: '8½ × 5 in', wellboreM: 8.5 * IN, pipeM: 5 * IN },
    { label: '12¼ × 5½ in', wellboreM: 12.25 * IN, pipeM: 5.5 * IN },
    { label: '17½ × 6⅝ in', wellboreM: 17.5 * IN, pipeM: 6.625 * IN },
];

export interface Formation { label: string; roughnessPct: number; note: string }

/**
 * `roughnessPct` is an EFFECTIVE roughness (micro-roughness plus hole irregularity) as % of the wellbore
 * diameter. Illustrative: calibrate against caliper logs or measured pressure losses.
 */
export const FORMATIONS: Formation[] = [
    { label: 'Smooth / gauge hole', roughnessPct: 0, note: 'Reference: cased or perfectly gauged hole.' },
    { label: 'Salt', roughnessPct: 0.5, note: 'Plastic and self-healing; usually near-gauge and smooth.' },
    { label: 'Limestone / dolomite', roughnessPct: 1, note: 'Hard and competent; mild irregularity.' },
    { label: 'Shale', roughnessPct: 2, note: 'Fissile; sloughing makes the hole slightly irregular.' },
    { label: 'Sandstone', roughnessPct: 3, note: 'Granular surface with patchy filter cake.' },
    { label: 'Unconsolidated sand', roughnessPct: 5, note: 'Grains erode; rough, enlarged hole.' },
    { label: 'Fractured / vuggy carbonate', roughnessPct: 7, note: 'Fractures and vugs add strong wall drag.' },
    { label: 'Washout / caved zone', roughnessPct: 10, note: 'Severely enlarged, irregular hole.' },
];

export interface MudPreset {
    label: string;
    base: FluidBase;
    rheology: RheologyModel;
    densityKgM3: number;
    yieldStressPa: number;
    consistencyPaSn: number;
    flowIndex: number;
    note: string;
}

const mud = (
    label: string, base: FluidBase, rheology: RheologyModel,
    density: number, yieldStressPa: number, consistencyPaSn: number, flowIndex: number, note: string
): MudPreset => ({ label, base, rheology, densityKgM3: density, yieldStressPa, consistencyPaSn, flowIndex, note });

/** Typical values per mud family. Illustrative: use your mud report for real work. */
export const MUD_PRESETS: MudPreset[] = [
    mud('Fresh water', 'water', 'newtonian', ppg(8.34), 0, cP(1), 1, '1 cP, 8.34 ppg. Almost always turbulent in an annulus.'),
    mud('Spud mud', 'water', 'bingham', ppg(8.8), lb100(8), cP(8), 1, 'PV 8 cP, YP 8 lb/100ft². Low-solids bentonite.'),
    mud('Bentonite WBM', 'water', 'bingham', ppg(10), lb100(12), cP(15), 1, 'PV 15 cP, YP 12 lb/100ft². General-purpose.'),
    mud('KCl-polymer WBM', 'water', 'herschel-bulkley', ppg(10.5), 3, 0.5, 0.6, 'Shear-thinning with a small yield stress.'),
    mud('Xanthan brine', 'water', 'herschel-bulkley', ppg(9), 0, 0.6, 0.5, 'Strongly shear-thinning, no yield stress (power law).'),
    mud('Weighted WBM', 'water', 'bingham', ppg(14), lb100(15), cP(35), 1, 'PV 35 cP, YP 15 lb/100ft². Barite-weighted.'),
    mud('Base oil (diesel)', 'oil', 'newtonian', ppg(7), 0, cP(3), 1, '3 cP, 7 ppg. Newtonian base fluid.'),
    mud('Diesel OBM', 'oil', 'bingham', ppg(11), lb100(10), cP(20), 1, 'PV 20 cP, YP 10 lb/100ft². Conventional invert emulsion.'),
    mud('Synthetic OBM', 'oil', 'herschel-bulkley', ppg(12), 4, 0.1, 0.8, 'Mildly shear-thinning with yield stress.'),
    mud('Weighted OBM', 'oil', 'bingham', ppg(14), lb100(14), cP(35), 1, 'PV 35 cP, YP 14 lb/100ft².'),
    mud('Heavy OBM', 'oil', 'bingham', ppg(17), lb100(18), cP(55), 1, 'PV 55 cP, YP 18 lb/100ft². HPHT-style heavy mud.'),
];
