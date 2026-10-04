import {
    CONVERGENCE_TOL, MIN_SHEAR_RATE, OUTER_RADIUS_CELLS, SOR_OMEGA, SWEEPS_PER_STEP, WALL_DRAG,
} from '../config';
import type { Fluid, Geometry } from '../types';
import { apparentViscosity, isNewtonian } from './rheology';

/**
 * Fully developed, steady, laminar axial flow in an annulus:
 *
 *     ∇·(mu_eff ∇u) = −G        u = 0 on the wellbore wall and the pipe
 *
 * u [m/s] on a square grid, mu_eff [Pa·s] from the fluid model, G [Pa/m] the frictional pressure gradient.
 *
 * The solver is flow-rate controlled: G is not an input but is adjusted until the flow rate matches the target.
 * With a frozen viscosity field the problem is linear in G (u = G·w), so after every step u and G are scaled
 * by the same factor. This is exact for Newtonian fluids and a fixed-point (Picard) iteration otherwise.
 */
export class Solver {
    readonly size: number;
    readonly velocity: Float64Array;
    /** 0 = fluid, 1 = rock, 2 = drill pipe */
    readonly mask: Uint8Array;

    cellSizeM = 1;
    areaM2 = 0;
    radiusOuter = OUTER_RADIUS_CELLS;
    radiusInner = 0;
    eccentricity = 0;
    /** Frictional pressure gradient [Pa/m] that produces the target flow rate. */
    gradientPaM = 100;
    plugFraction = 0;

    private readonly drag: Float64Array; // extra wall resistance per cell (roughness layer)
    private readonly muX: Float64Array;  // effective viscosity on the face between cell i and i+1
    private readonly muY: Float64Array;  // effective viscosity on the face between cell i and i+size
    private readonly prev: Float64Array;
    private fluid: Fluid = { densityKgM3: 1000, yieldStressPa: 0, consistencyPaSn: 0.001, flowIndex: 1 };
    private targetFlowM3S = 0;

    constructor(size: number) {
        this.size = size;
        const cells = size * size;
        this.velocity = new Float64Array(cells);
        this.mask = new Uint8Array(cells);
        this.drag = new Float64Array(cells);
        this.muX = new Float64Array(cells);
        this.muY = new Float64Array(cells);
        this.prev = new Float64Array(cells);
    }

    /** Rebuilds mask, roughness layer and cell size, and restarts the solution from rest. */
    setGeometry(g: Geometry) {
        const n = this.size;
        const Ro = OUTER_RADIUS_CELLS;
        const Ri = Math.min((Ro * g.pipeDiameterM) / g.wellboreDiameterM, Ro - 3); // keep a >= 3-cell gap
        const thickness = g.roughness * 2 * Ro; // roughness layer thickness in cells
        const cx = n / 2;
        const cxInner = cx + g.eccentricity * (Ro - Ri);

        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const i = x + y * n;
                const distOuter = Math.hypot(x - cx, y - cx);
                const distInner = Math.hypot(x - cxInner, y - cx);

                // The no-slip nodes are the first non-fluid cells, about half a cell beyond the fluid edge. Shifting the
                // fluid edge inwards by 0.5 cell puts the effective walls at the nominal radii.
                let coverage = 0;
                if (distOuter >= Ro - 0.5) this.mask[i] = 1;
                else if (distInner <= Ri + 0.5) this.mask[i] = 2;
                else {
                    this.mask[i] = 0;
                    // fraction of this cell inside the roughness layer next to the wellbore wall
                    if (thickness > 0) coverage = Math.min(1, Math.max(0, thickness - Math.max(Ro - distOuter - 0.5, 0)));
                }
                this.drag[i] = WALL_DRAG * coverage;
            }
        }

        this.radiusOuter = Ro;
        this.radiusInner = Ri;
        this.eccentricity = g.eccentricity;
        this.cellSizeM = g.wellboreDiameterM / 2 / Ro;
        this.areaM2 = (Math.PI / 4) * (g.wellboreDiameterM ** 2 - g.pipeDiameterM ** 2);
        this.velocity.fill(0);
        this.gradientPaM = 100;
        this.resetViscosity();
    }

    /** Changes fluid and target flow rate. The velocity field is kept as a warm start. */
    setOperating(fluid: Fluid, flowRateM3S: number) {
        this.fluid = fluid;
        this.targetFlowM3S = flowRateM3S;
        if (isNewtonian(fluid)) {
            this.muX.fill(fluid.consistencyPaSn);
            this.muY.fill(fluid.consistencyPaSn);
            this.plugFraction = 0;
        }
    }

    private resetViscosity() {
        const mu0 = apparentViscosity(this.fluid, 0); // highest viscosity: start from the stiff, slow state
        this.muX.fill(mu0);
        this.muY.fill(mu0);
        this.plugFraction = 0;
    }

    /** One viscosity update, SWEEPS_PER_STEP SOR sweeps with it frozen, then a flow-rate correction. */
    step(): { converged: boolean } {
        const u = this.velocity;
        this.prev.set(u);

        if (!isNewtonian(this.fluid)) this.updateViscosity();
        for (let s = 0; s < SWEEPS_PER_STEP; s++) this.sweep();

        // flow-rate control: scale u and G together so that Q = target
        const q = this.flowRateM3S();
        if (q > 1e-30 && this.targetFlowM3S > 0) {
            const r = this.targetFlowM3S / q;
            for (let i = 0; i < u.length; i++) u[i] *= r;
            this.gradientPaM *= r;
        }

        let maxU = 1e-30, maxChange = 0;
        for (let i = 0; i < u.length; i++) {
            maxU = Math.max(maxU, Math.abs(u[i]));
            maxChange = Math.max(maxChange, Math.abs(u[i] - this.prev[i]));
        }
        return { converged: maxChange / maxU < CONVERGENCE_TOL };
    }

    flowRateM3S(): number {
        let sum = 0;
        for (let i = 0; i < this.velocity.length; i++) sum += this.velocity[i];
        return sum * this.cellSizeM ** 2;
    }

    /** One SOR sweep of the face-flux discretisation, with the current face viscosities and gradient. */
    private sweep() {
        const { size: n, velocity: u, mask, muX, muY, drag } = this;
        const source = this.gradientPaM * this.cellSizeM ** 2;

        for (let y = 1; y < n - 1; y++) {
            for (let x = 1; x < n - 1; x++) {
                const i = x + y * n;
                if (mask[i] !== 0) continue;

                const w = muX[i - 1], e = muX[i], s = muY[i - n], nn = muY[i];
                const sumMu = w + e + s + nn;
                // u = 0 in wall cells (no-slip); the roughness layer adds drag * (mean viscosity) to the diagonal
                const gs = (w * u[i - 1] + e * u[i + 1] + s * u[i - n] + nn * u[i + n] + source) / (sumMu * (1 + drag[i] / 4));
                u[i] += SOR_OMEGA * (gs - u[i]);
            }
        }
    }

    /**
     * Picard update of the viscosity on every cell face next to fluid. The shear rate on a face combines
     * the normal difference across it with the transverse gradient averaged over the two cells, so the stress
     * mu·du/dn used in the flux is consistent with mu(|∇u|).
     */
    private updateViscosity() {
        const { size: n, velocity: u, mask, muX, muY } = this;
        const inv = 1 / this.cellSizeM;
        const gradX = (k: number) => (u[k + 1] - u[k - 1]) * 0.5 * inv;
        const gradY = (k: number) => (u[k + n] - u[k - n]) * 0.5 * inv;
        let cells = 0, plug = 0;

        for (let y = 1; y < n - 1; y++) {
            for (let x = 1; x < n - 1; x++) {
                const i = x + y * n;
                const fluid = mask[i] === 0;

                if (fluid || mask[i + 1] === 0) {
                    const shear = Math.hypot((u[i + 1] - u[i]) * inv, 0.5 * (gradY(i) + gradY(i + 1)));
                    muX[i] = apparentViscosity(this.fluid, shear);
                }
                if (fluid || mask[i + n] === 0) {
                    const shear = Math.hypot((u[i + n] - u[i]) * inv, 0.5 * (gradX(i) + gradX(i + n)));
                    muY[i] = apparentViscosity(this.fluid, shear);
                }
                if (fluid) {
                    cells++;
                    if (Math.hypot(gradX(i), gradY(i)) < MIN_SHEAR_RATE) plug++;
                }
            }
        }
        this.plugFraction = this.fluid.yieldStressPa > 0 && cells > 0 ? plug / cells : 0;
    }
}
