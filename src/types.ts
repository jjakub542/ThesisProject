/** Types shared by the UI, the worker and the solver. Everything numeric here is in SI units. */

export type RheologyModel = 'newtonian' | 'bingham' | 'herschel-bulkley';
export type FluidBase = 'water' | 'oil';
export type ViewMode = 'velocity' | 'shear';
/** Solver grid density: cells across the wellbore radius (see RESOLUTION_RADIUS_CELLS in config.ts). */
export type Resolution = 'standard' | 'high' | 'fine';

/** Herschel–Bulkley fluid: tau = tau_y + K * shearRate^n. Newtonian and Bingham are special cases. */
export interface Fluid {
    densityKgM3: number;
    yieldStressPa: number;
    /** K [Pa·s^n]. For n = 1 this is the (plastic) viscosity [Pa·s]. */
    consistencyPaSn: number;
    flowIndex: number;
}

export interface Geometry {
    wellboreDiameterM: number;
    pipeDiameterM: number;
    /** 0 = concentric, 1 = pipe touching the wall. */
    eccentricity: number;
    /** Effective wall roughness eps / D as a fraction (0 = smooth). */
    roughness: number;
}

/** Everything the solver needs. The flow rate is the control variable; the pressure gradient is solved for. */
export interface SolverInput {
    geometry: Geometry;
    fluid: Fluid;
    flowRateM3S: number;
    resolution: Resolution;
}

/** What the visualiser needs to know about the grid. Radii are in cells. */
export interface GeometryInfo {
    /** Grid is gridSize x gridSize cells. */
    gridSize: number;
    mask: Uint8Array; // 0 = fluid, 1 = rock, 2 = drill pipe
    radiusOuter: number;
    radiusInner: number;
    eccentricity: number;
    cellSizeM: number;
}

export interface SolveResult {
    /** Echo of the CONFIGURE epoch this result belongs to. */
    epoch: number;
    /** Axial velocity per cell [m/s]. */
    velocity: Float64Array;
    converged: boolean;
    /** The iteration limit was hit before convergence. */
    exhausted: boolean;
    /** Frictional pressure gradient needed to push the target flow rate [Pa/m]. */
    gradientPaM: number;
    /** Flow area [m²]. */
    areaM2: number;
    /** Fraction of the flow area that is unyielded (0 for fluids without yield stress). */
    plugFraction: number;
    /** Gradient for the same flow rate with smooth walls; null when roughness = 0. */
    referenceGradientPaM: number | null;
}

export interface LayerStyle {
    visible: boolean;
    opacity: number; // 0..1
}

export type ToWorker = { type: 'CONFIGURE'; epoch: number; input: SolverInput };
export type FromWorker = ({ type: 'GEOMETRY' } & GeometryInfo) | ({ type: 'RESULT' } & SolveResult);