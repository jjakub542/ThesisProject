/** Shared constants - imported by the main thread, the worker and the solver. */

export const MM_PER_INCH = 25.4;

// ---- numerical grid ----
export const GRID_SIZE = 100;
/** The wellbore always spans this many cells in radius, whatever its physical size. */
export const OUTER_RADIUS_CELLS = 40;
/** -(dp/dz) * dx^2 / mu in cell units. Constant drive of the Poisson equation. */
export const FORCING_TERM = 0.05;
/** SOR relaxation factor (1 = plain Gauss-Seidel). */
export const SOR_OMEGA = 1.8;
export const CONVERGENCE_TOL = 1e-6;

// ---- allowed parameter ranges ----
export const WELLBORE_MIN_MM = 3 * MM_PER_INCH;
export const WELLBORE_MAX_MM = 26 * MM_PER_INCH;
/** Pipe OD / wellbore diameter must stay inside this band so both stay resolvable on the grid. */
export const MIN_DIAMETER_RATIO = 0.1;
export const MAX_DIAMETER_RATIO = 0.9;
export const MAX_ECCENTRICITY = 0.95;

/** Common bit / drill-pipe combinations (inches). */
export const PRESETS = [
    { label: '6 × 3½ in', wellboreIn: 6, pipeIn: 3.5 },
    { label: '8½ × 5 in', wellboreIn: 8.5, pipeIn: 5 },
    { label: '12¼ × 5½ in', wellboreIn: 12.25, pipeIn: 5.5 },
    { label: '17½ × 6⅝ in', wellboreIn: 17.5, pipeIn: 6.625 },
];

/** Initial UI state. Diameters are stored in mm internally. */
export const DEFAULTS = {
    wellboreMm: 8.5 * MM_PER_INCH,
    pipeMm: 5 * MM_PER_INCH,
    eccentricity: 0.5,
    showString: true,
    stringOpacity: 0.4,
    showWellbore: true,
    wellboreOpacity: 0.25,
    /** Effective wall roughness as % of wellbore diameter (0 = smooth reference). */
    roughnessPct: 0,
};

export const DEFAULT_RATIO = DEFAULTS.pipeMm / DEFAULTS.wellboreMm;

// ---- wellbore wall friction ----
/**
 * Resistance of the wall-roughness layer in cell units: u = (sum(neighbours) + f) / (4 + drag).
 * A modelling constant: it sets how strongly a fully covered cell is slowed down.
 */
export const WALL_DRAG = 2;
export const MAX_ROUGHNESS_PCT = 15;

/**
 * Formation presets. `roughnessPct` is an EFFECTIVE roughness (micro-roughness plus hole irregularity)
 * as % of the wellbore diameter. These are illustrative; calibrate them against caliper logs or
 * measured pressure losses for your field.
 */
export const FORMATIONS = [
    { label: 'Smooth / gauge hole', roughnessPct: 0, note: 'Reference: cased or perfectly gauged hole, no roughness layer.' },
    { label: 'Salt', roughnessPct: 0.5, note: 'Plastic and self-healing; usually near-gauge and smooth.' },
    { label: 'Limestone / dolomite', roughnessPct: 1, note: 'Hard and competent; mild irregularity.' },
    { label: 'Shale', roughnessPct: 2, note: 'Fissile; sloughing makes the hole slightly irregular.' },
    { label: 'Sandstone', roughnessPct: 3, note: 'Granular surface with patchy filter cake.' },
    { label: 'Unconsolidated sand', roughnessPct: 5, note: 'Grains erode; rough, enlarged hole.' },
    { label: 'Fractured / vuggy carbonate', roughnessPct: 7, note: 'Fractures and vugs add strong wall drag.' },
    { label: 'Washout / caved zone', roughnessPct: 10, note: 'Severely enlarged, irregular hole.' },
];
