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
};

export const DEFAULT_RATIO = DEFAULTS.pipeMm / DEFAULTS.wellboreMm;
