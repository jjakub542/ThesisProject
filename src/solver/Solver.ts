import { DEFAULT_RATIO, FORCING_TERM, OUTER_RADIUS_CELLS, SOR_OMEGA, WALL_DRAG } from '../config';

export class Solver {
    public size: number;
    public velocity: Float64Array;
    public geometryMask: Uint8Array; // 0 = fluid, 1 = rock, 2 = drill pipe
    /** Extra resistance per fluid cell (wall-roughness layer). 0 everywhere = smooth walls. */
    public drag: Float64Array;

    // Radii are in grid cells. The physical diameters only enter through their ratio.
    public radiusOuter = OUTER_RADIUS_CELLS;
    public radiusInner = OUTER_RADIUS_CELLS * DEFAULT_RATIO;
    public eccentricity = 0.5;
    /** Wellbore wall roughness as a fraction of the wellbore diameter (eps / D). */
    public roughness = 0;

    private forcingTerm = FORCING_TERM; // -(dp/dz) * dx^2 / mu, constant drive
    private omega = SOR_OMEGA;          // SOR relaxation factor (1 = plain Gauss-Seidel)

    constructor(size: number) {
        this.size = size;
        this.velocity = new Float64Array(size * size);
        this.geometryMask = new Uint8Array(size * size);
        this.drag = new Float64Array(size * size);
        this.initGeometry();
    }

    /** Rebuilds the mask and the roughness layer, and resets the velocity field. */
    public initGeometry(
        radiusOuter: number = this.radiusOuter,
        radiusInner: number = this.radiusInner,
        eccentricity: number = this.eccentricity,
        roughness: number = this.roughness
    ) {
        // Keep at least a 2-cell gap so the annulus is never degenerate.
        radiusInner = Math.min(radiusInner, radiusOuter - 2);

        this.radiusOuter = radiusOuter;
        this.radiusInner = radiusInner;
        this.eccentricity = eccentricity;
        this.roughness = roughness;

        // Thickness of the roughness layer in cells: eps = (eps/D) * D, D = 2 * radiusOuter cells.
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

                // Fraction of this cell inside the roughness layer next to the wellbore wall.
                let coverage = 0;
                if (this.geometryMask[i] === 0 && thickness > 0) {
                    const d = Math.max(radiusOuter - distOuter - 0.5, 0); // distance from wall to the cell's near edge
                    coverage = Math.min(1, Math.max(0, thickness - d));
                }
                this.drag[i] = WALL_DRAG * coverage;

                this.velocity[i] = 0;
            }
        }
    }

    /** Runs SOR iterations; returns the max change in the last sweep (convergence measure). */
    public computeStep(iterations: number = 30): number {
        const n = this.size;
        const u = this.velocity;
        const mask = this.geometryMask;
        const drag = this.drag;
        let maxDelta = 0;

        for (let iter = 0; iter < iterations; iter++) {
            const last = iter === iterations - 1;
            for (let y = 1; y < n - 1; y++) {
                for (let x = 1; x < n - 1; x++) {
                    const i = x + y * n;
                    if (mask[i] !== 0) continue;

                    // Poisson with a Darcy-Brinkman drag term: (sum(nb) + f) / (4 + drag). drag = 0 -> plain stencil.
                    const gs = (u[i - n] + u[i + n] + u[i - 1] + u[i + 1] + this.forcingTerm) / (4 + drag[i]);
                    const next = u[i] + this.omega * (gs - u[i]);
                    if (last) maxDelta = Math.max(maxDelta, Math.abs(next - u[i]));
                    u[i] = next;
                }
            }
        }
        return maxDelta;
    }
}
