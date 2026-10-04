import {
    DEFAULT_RATIO,
    OUTER_RADIUS_CELLS,
    SOR_OMEGA,
    WALL_DRAG,
} from '../config';

export type RheologyModel = 'newtonian' | 'bingham' | 'herschel-bulkley';

export interface FluidModel {
    rheology: RheologyModel;
    densityKgM3: number;

    // Newtonian
    viscosityPaS: number;

    // Bingham
    yieldStressPa: number;
    plasticViscosityPaS: number;

    // Herschel–Bulkley
    consistencyPaSn: number;
    flowIndex: number;

    /**
     * Papanastasiou regularization parameter [s].
     * Larger values more closely approximate an ideal yield-stress model.
     */
    regularizationS: number;
}

const DEFAULT_FLUID: FluidModel = {
    rheology: 'newtonian',
    densityKgM3: 1200,
    viscosityPaS: 0.03,
    yieldStressPa: 5,
    plasticViscosityPaS: 0.03,
    consistencyPaSn: 0.5,
    flowIndex: 0.8,
    regularizationS: 100,
};

export interface SolverOptions {
    /** Positive frictional pressure gradient driving flow [Pa/m]. */
    frictionGradientPaM: number;
    /** Gravity component along the positive axial direction [m/s²]. */
    gravityAlongAxisMSS: number;
    fluid: FluidModel;
}

/**
 * Finite-difference solver for fully developed axial flow:
 *
 *   div(mu_app * grad(u)) = -G
 *
 * where G is the positive frictional pressure gradient [Pa/m].
 *
 * Velocity is in m/s, coordinates in meters, viscosity in Pa·s.
 */
export class Solver {
    public size: number;
    public velocity: Float64Array;
    public geometryMask: Uint8Array; // 0 = fluid, 1 = rock, 2 = drill pipe
    /** Effective wall resistance inherited from the original model. */
    public drag: Float64Array;

    public radiusOuter = OUTER_RADIUS_CELLS;
    public radiusInner = OUTER_RADIUS_CELLS * DEFAULT_RATIO;
    public eccentricity = 0.5;
    public roughness = 0;

    private dxM: number;
    private options: SolverOptions;
    private omega = SOR_OMEGA;

    constructor(
        size: number,
        dxM: number,
        options: SolverOptions = {
            frictionGradientPaM: 1000,
            gravityAlongAxisMSS: 0,
            fluid: DEFAULT_FLUID,
        }
    ) {
        this.size = size;
        this.dxM = dxM;
        this.options = options;
        this.velocity = new Float64Array(size * size);
        this.geometryMask = new Uint8Array(size * size);
        this.drag = new Float64Array(size * size);
        this.initGeometry();
    }

    public setOptions(options?: Partial<SolverOptions>) {
        if (!options?.fluid) return;

        this.options = {
            ...this.options,
            ...options,
            fluid: { ...this.options.fluid, ...options.fluid },
        };
        this.velocity.fill(0);
    }

    /** Rebuild geometry and reset the velocity solution. */
    public initGeometry(
        radiusOuter: number = this.radiusOuter,
        radiusInner: number = this.radiusInner,
        eccentricity: number = this.eccentricity,
        roughness: number = this.roughness
    ) {
        radiusInner = Math.min(radiusInner, radiusOuter - 2);

        this.radiusOuter = radiusOuter;
        this.radiusInner = radiusInner;
        this.eccentricity = eccentricity;
        this.roughness = roughness;

        const thickness = roughness * 2 * radiusOuter;
        const e = eccentricity * (radiusOuter - radiusInner);
        const cx = this.size / 2;
        const cy = this.size / 2;
        const cxInner = cx + e;

        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const i = x + y * this.size;
                const distOuter = Math.hypot(x - cx, y - cy);
                const distInner = Math.hypot(x - cxInner, y - cy);

                if (distOuter >= radiusOuter) this.geometryMask[i] = 1;
                else if (distInner <= radiusInner) this.geometryMask[i] = 2;
                else this.geometryMask[i] = 0;

                let coverage = 0;
                if (this.geometryMask[i] === 0 && thickness > 0) {
                    const distanceFromWall = Math.max(radiusOuter - distOuter - 0.5, 0);
                    coverage = Math.min(1, Math.max(0, thickness - distanceFromWall));
                }

                this.drag[i] = WALL_DRAG * coverage;
                this.velocity[i] = 0;
            }
        }
    }

    private apparentViscosity(shearRate: number): number {
        const { fluid } = this.options;
        const gamma = Math.max(shearRate, 1e-8);

        if (fluid.rheology === 'newtonian') {
            return fluid.viscosityPaS;
        }

        const m = Math.max(fluid.regularizationS, 1e-6);
        const regularizedYield =
            fluid.yieldStressPa * (-Math.expm1(-m * gamma)) / gamma;

        if (fluid.rheology === 'bingham') {
            return fluid.plasticViscosityPaS + regularizedYield;
        }

        const n = Math.max(fluid.flowIndex, 0.05);
        const consistency = Math.max(fluid.consistencyPaSn, 1e-12);

        return consistency * gamma ** (n - 1) + regularizedYield;
    }

    private localShearRate(i: number): number {
        const n = this.size;
        const u = this.velocity;
        const duDx = (u[i + 1] - u[i - 1]) / (2 * this.dxM);
        const duDy = (u[i + n] - u[i - n]) / (2 * this.dxM);
        return Math.hypot(duDx, duDy);
    }

    private harmonicMean(a: number, b: number): number {
        const sum = a + b;
        return sum > 0 ? (2 * a * b) / sum : 0;
    }

    /**
     * Advances nonlinear Picard/SOR iterations.
     * Returns max velocity change from the final sweep [m/s].
     */
    public computeStep(iterations = 30): number {
        const n = this.size;
        const u = this.velocity;
        const mask = this.geometryMask;
        const dx2 = this.dxM * this.dxM;
        const G = Math.max(this.options.frictionGradientPaM, 0);

        let maxDelta = 0;

        for (let iter = 0; iter < iterations; iter++) {
            maxDelta = 0;

            for (let y = 1; y < n - 1; y++) {
                for (let x = 1; x < n - 1; x++) {
                    const i = x + y * n;
                    if (mask[i] !== 0) continue;

                    const mu = this.apparentViscosity(this.localShearRate(i));

                    const muW = mask[i - 1] === 0
                        ? this.harmonicMean(mu, this.apparentViscosity(this.localShearRate(i - 1)))
                        : mu;
                    const muE = mask[i + 1] === 0
                        ? this.harmonicMean(mu, this.apparentViscosity(this.localShearRate(i + 1)))
                        : mu;
                    const muS = mask[i - n] === 0
                        ? this.harmonicMean(mu, this.apparentViscosity(this.localShearRate(i - n)))
                        : mu;
                    const muN = mask[i + n] === 0
                        ? this.harmonicMean(mu, this.apparentViscosity(this.localShearRate(i + n)))
                        : mu;

                    // Face-flux discretization. Solid-neighbour velocities are zero
                    // (no-slip); their face coefficients remain in the diagonal.
                    const diagonal = muW + muE + muS + muN;
                    if (diagonal <= 0) continue;

                    const gs = (
                        muW * u[i - 1] +
                        muE * u[i + 1] +
                        muS * u[i - n] +
                        muN * u[i + n] +
                        G * dx2
                    ) / diagonal;

                    // Retain the original illustrative wall-resistance term.
                    const withWallDrag = gs / (1 + this.drag[i]);
                    const next = u[i] + this.omega * (withWallDrag - u[i]);

                    maxDelta = Math.max(maxDelta, Math.abs(next - u[i]));
                    u[i] = next;
                }
            }
        }

        return maxDelta;
    }
}
