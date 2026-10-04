import { GRID_SIZE, MAX_STEPS } from '../config';
import type { FromWorker, SolverInput, ToWorker } from '../types';
import { Solver } from './Solver';

/**
 * The worker owns the whole solve loop: CONFIGURE sets up the problem, then the worker keeps stepping and posting
 * a RESULT after each step until converged. Between steps it yields to the event loop, so a newer CONFIGURE is
 * picked up immediately and the main thread never has to ping-pong COMPUTE requests.
 *
 * With the "dom" lib `self` is typed as Window, whose postMessage has no (message, transfer[]) overload.
 */
const ctx = self as unknown as Worker;
const post = (msg: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer);

let solver: Solver | null = null;
let reference: Solver | null = null; // same problem with smooth walls; only exists while roughness > 0
let geometryKey = '';
let epoch = 0;
let steps = 0;
let running = false;
let referenceDone = true;
let mainDone = false;

function configure(newEpoch: number, input: SolverInput) {
    epoch = newEpoch;
    steps = 0;
    mainDone = false;
    solver ??= new Solver(GRID_SIZE);

    const key = JSON.stringify(input.geometry);
    if (key !== geometryKey) {
        geometryKey = key;
        solver.setGeometry(input.geometry);

        if (input.geometry.roughness > 0) {
            reference ??= new Solver(GRID_SIZE);
            reference.setGeometry({ ...input.geometry, roughness: 0 });
        } else {
            reference = null;
        }

        const mask = solver.mask.slice(); // copy, so it can be transferred
        post({
            type: 'GEOMETRY',
            mask,
            radiusOuter: solver.radiusOuter,
            radiusInner: solver.radiusInner,
            eccentricity: solver.eccentricity,
            cellSizeM: solver.cellSizeM,
        }, [mask.buffer]);
    }

    solver.setOperating(input.fluid, input.flowRateM3S);
    reference?.setOperating(input.fluid, input.flowRateM3S);
    referenceDone = reference === null;

    if (!running) {
        running = true;
        setTimeout(tick, 0);
    }
}

function tick() {
    if (!solver) return;

    mainDone = solver.step().converged;
    if (reference && !referenceDone) referenceDone = reference.step().converged;
    steps++;

    const converged = mainDone && referenceDone;
    const exhausted = !converged && steps >= MAX_STEPS;
    const velocity = new Float64Array(solver.velocity);

    post({
        type: 'RESULT',
        epoch,
        velocity,
        converged,
        exhausted,
        gradientPaM: solver.gradientPaM,
        areaM2: solver.areaM2,
        plugFraction: solver.plugFraction,
        referenceGradientPaM: reference ? reference.gradientPaM : null,
    }, [velocity.buffer]);

    if (converged || exhausted) running = false;
    else setTimeout(tick, 0);
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
    if (e.data.type === 'CONFIGURE') configure(e.data.epoch, e.data.input);
};
