/** Protocol check for the worker with a mocked worker scope. Run with:  npx tsx scripts/check-worker.ts */
import type { FromWorker, SolverInput } from '../src/types';

const IN = 0.0254, GPM = 3.785411784e-3 / 60;
const messages: FromWorker[] = [];
const scope: any = { postMessage: (m: FromWorker) => messages.push(m), onmessage: null };
(globalThis as any).self = scope;

const input = (flowGpm: number, roughness = 0, mu = 0.03): SolverInput => ({
    geometry: { wellboreDiameterM: 8.5 * IN, pipeDiameterM: 5 * IN, eccentricity: 0.5, roughness },
    fluid: { densityKgM3: 1200, yieldStressPa: 0, consistencyPaSn: mu, flowIndex: 1 },
    flowRateM3S: flowGpm * GPM,
});
const send = (epoch: number, i: SolverInput) => scope.onmessage({ data: { type: 'CONFIGURE', epoch, input: i } });
const idle = () => new Promise((r) => setTimeout(r, 400));

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!ok) failures++; };
const results = (epoch: number) => messages.filter((m) => m.type === 'RESULT' && m.epoch === epoch) as Extract<FromWorker, { type: 'RESULT' }>[];

async function main() {
    await import('../src/solver/cfd.worker');
    // 1. first configure: GEOMETRY before any RESULT, loop runs to convergence and stops
    send(1, input(200));
    await idle();
    check('GEOMETRY comes first', messages[0].type === 'GEOMETRY');
    const r1 = results(1);
    check('converges and stops', r1.length > 0 && r1[r1.length - 1].converged, `${r1.length} results`);
    const g1 = r1[r1.length - 1].gradientPaM;

    // 2. fluid-only change: no new GEOMETRY, warm start, gradient doubles with viscosity
    const geometryCount = () => messages.filter((m) => m.type === 'GEOMETRY').length;
    const before = geometryCount();
    send(2, input(200, 0, 0.06));
    await idle();
    const r2 = results(2);
    check('fluid change keeps the grid', geometryCount() === before);
    check('Newtonian: 2x viscosity -> 2x gradient', Math.abs(r2[r2.length - 1].gradientPaM / g1 - 2) < 1e-3, `${(r2[r2.length - 1].gradientPaM / g1).toFixed(4)}`);

    // 3. reconfigure while a solve is running: the old epoch stops, the new one finishes
    send(3, input(200, 0.05));
    send(4, input(300, 0.05)); // supersedes epoch 3 before the worker yields
    await idle();
    const r3 = results(3), r4 = results(4);
    check('superseded epoch produces no results', r3.length === 0);
    const last = r4[r4.length - 1];
    check('latest epoch converges', last.converged && last.referenceGradientPaM !== null,
        `rough/smooth gradient ratio = ${(last.gradientPaM / last.referenceGradientPaM!).toFixed(2)}`);
    check('roughness raises the gradient', last.gradientPaM > last.referenceGradientPaM!);

    // 4. roughness back to zero: reference disappears
    send(5, input(300, 0));
    await idle();
    const r5 = results(5);
    check('no reference when smooth', r5[r5.length - 1].referenceGradientPaM === null);

    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
}

main();
