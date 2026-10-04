import { computeHydraulics } from '../hydraulics';
import type { SolveResult, ViewMode } from '../types';
import { sig, toDisplay, unitLabel } from '../units';
import type { AppState } from './state';
import { toSolverInput } from './state';

const $ = (id: string) => document.getElementById(id)!;

const NOTES: Record<ViewMode, string> = {
    velocity: 'Height and colour = axial velocity. Flow follows the wide side; the narrow gap is nearly stagnant.',
    shear: 'Height and colour = shear rate |∇u|. Highest at the walls of the wide gap.',
};

/**
 * Renders the legend and the numeric results. It re-renders at most once per animation frame, because the
 * worker streams a result after every solver step.
 */
export class Hud {
    private readonly state: AppState;
    private result: SolveResult | null = null;
    private pending = true;
    private chartMax = 0;
    private scheduled = false;

    constructor(state: AppState) {
        this.state = state;
    }

    /** A parameter changed: keep showing the old numbers, but say that new ones are on the way. */
    setPending() {
        this.pending = true;
        this.schedule();
    }

    setResult(r: SolveResult) {
        this.result = r;
        this.pending = false;
        this.schedule();
    }

    setChartMax(max: number) {
        this.chartMax = max;
        this.schedule();
    }

    schedule() {
        if (this.scheduled) return;
        this.scheduled = true;
        requestAnimationFrame(() => {
            this.scheduled = false;
            this.render();
        });
    }

    private render() {
        const { state, result: r } = this;
        const u = state.units;

        // legend: velocity in display units, shear rate in 1/s
        $('minLabel').textContent = '0';
        if (state.mode === 'velocity') {
            $('legendTitle').textContent = 'axial velocity';
            $('maxLabel').textContent = `${sig(toDisplay('velocity', u, this.chartMax))} ${unitLabel('velocity', u)}`;
        } else {
            $('legendTitle').textContent = 'shear rate';
            $('maxLabel').textContent = `${sig(this.chartMax)} 1/s`;
        }
        $('note').textContent = NOTES[state.mode];

        if (!r) {
            $('status').textContent = 'Solving…';
            return;
        }
        $('status').textContent = r.exhausted
            ? 'Stopped at the iteration limit: result is approximate'
            : this.pending || !r.converged ? 'Solving…' : 'Converged ✓';

        const input = toSolverInput(state);
        const h = computeHydraulics({
            geometry: input.geometry, fluid: input.fluid, flowRateM3S: input.flowRateM3S,
            depthM: state.depthM, gradientPaM: r.gradientPaM, areaM2: r.areaM2,
        });
        const p = (pa: number) => `${sig(toDisplay('pressure', u, pa))} ${unitLabel('pressure', u)}`;
        const density = (v: number) => `${sig(toDisplay('density', u, v), u === 'field' ? 3 : 4)} ${unitLabel('density', u)}`;

        const lines = [
            `Mean velocity  ${sig(toDisplay('velocity', u, h.meanVelocityMS))} ${unitLabel('velocity', u)}`,
            `Pressure gradient  ${sig(toDisplay('gradient', u, r.gradientPaM))} ${unitLabel('gradient', u)}`,
            `Friction loss  ${p(h.frictionLossPa)}`,
            `Hydrostatic  ${p(h.hydrostaticPa)}`,
            `Circulating BHP  ${p(h.bottomHolePa)}`,
            `ECD  ${density(h.ecdKgM3)}  (MW ${density(state.densityKgM3)})`,
            `Apparent viscosity  ${sig(h.apparentViscosityPaS * 1000)} mPa·s`,
            `Wall shear stress  ${sig(h.wallShearPa)} Pa`,
        ];
        if (input.fluid.yieldStressPa > 0) lines.push(`Unyielded area  ${sig(r.plugFraction * 100, 2)} %`);
        $('analysis').textContent = lines.join('\n');

        $('regime').textContent = h.laminar
            ? `Re ≈ ${sig(h.reynolds, 3)}: laminar`
            : `Re ≈ ${sig(h.reynolds, 3)}: probably turbulent, the laminar result underestimates the pressure loss`;
        $('regime').classList.toggle('warn', !h.laminar);

        $('friction').textContent =
            input.geometry.roughness <= 0 ? 'Wall: smooth (reference)'
            : r.referenceGradientPaM && r.converged
                ? `Wall friction: pressure gradient ${((r.gradientPaM / r.referenceGradientPaM - 1) * 100).toFixed(1)} % vs smooth wall, same flow`
                : 'Wall friction: solving…';
    }
}