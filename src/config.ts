import type { Resolution } from './types';

/** Numerical and physical constants shared by the solver, worker and UI. */

export const GRAVITY = 9.80665; // m/s²

// ---- grid & iteration ----
/** Cells across the wellbore radius for each resolution; the wellbore always fills the grid the same way. */
export const RESOLUTION_RADIUS_CELLS: Record<Resolution, number> = { standard: 40, high: 64, fine: 96 };
/** The square grid leaves a margin of rock around the wellbore. */
export const gridSizeFor = (radiusCells: number) => Math.round(radiusCells * 2.5);
export const SWEEPS_PER_STEP = 30;
/** Relative change of the velocity field over one step below which the solution counts as converged. */
export const CONVERGENCE_TOL = 1e-5;
/** Safety stop, in steps of SWEEPS_PER_STEP sweeps. */
export const MAX_STEPS = 800;

// ---- rheology regularisation ----
/**
 * Shear rates below this are treated as this value when evaluating the effective viscosity. For fluids with a
 * yield stress this turns the unyielded plug into a very viscous fluid (bi-viscous model); for shear-thinning
 * fluids it gives a Newtonian plateau instead of an infinite viscosity.
 */
export const MIN_SHEAR_RATE = 1; // 1/s. Lowering it to 0.1 changes the pressure gradient by < 0.5 % but converges ~4x slower.

// ---- wall roughness ----
/** Resistance of a fully covered roughness cell, in units of the local viscosity. */
export const WALL_DRAG = 2;

// ---- hydraulics ----
/** Above this Reynolds number the laminar solution is no longer trustworthy. */
export const RE_LIMIT = 2100;

// ---- allowed ranges (SI) ----
export const LIMITS = {
    wellboreDiameterM: { min: 3 * 0.0254, max: 26 * 0.0254 },
    /** pipe OD / wellbore diameter */
    diameterRatio: { min: 0.1, max: 0.9 },
    eccentricity: { max: 0.95 },
    roughnessPct: { max: 15 },
    flowRateM3S: { min: 0.0005, max: 0.2 },
    depthM: { min: 100, max: 10000 },
    densityKgM3: { min: 600, max: 3000 },
    yieldStressPa: { min: 0, max: 60 },
    consistencyPaSn: { min: 1e-4, max: 20 },
    flowIndex: { min: 0.2, max: 1 },
};