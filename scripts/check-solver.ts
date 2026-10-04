/** Numerical sanity checks for the solver. Run with:  npx tsx scripts/check-solver.ts */
import { GRID_SIZE, MAX_STEPS } from '../src/config';
import { Solver } from '../src/solver/Solver';
import { MUD_PRESETS } from '../src/presets';
import type { Fluid, Geometry } from '../src/types';

const IN = 0.0254;
const GPM = 3.785411784e-3 / 60;
const D = 8.5 * IN, d = 5 * IN;

function solve(geometry: Geometry, fluid: Fluid, q: number) {
    const s = new Solver(GRID_SIZE);
    s.setGeometry(geometry);
    s.setOperating(fluid, q);
    let steps = 0, converged = false;
    const t0 = performance.now();
    while (!converged && steps < MAX_STEPS) { converged = s.step().converged; steps++; }
    return { s, steps, converged, ms: performance.now() - t0 };
}

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
    if (!ok) failures++;
}

const geo = (ecc = 0, rough = 0): Geometry => ({ wellboreDiameterM: D, pipeDiameterM: d, eccentricity: ecc, roughness: rough });
const newt = (mu: number): Fluid => ({ densityKgM3: 1200, yieldStressPa: 0, consistencyPaSn: mu, flowIndex: 1 });

// 1. Newtonian concentric annulus vs the exact solution  Q = pi G/(8 mu) [b^4 - a^4 - (b^2-a^2)^2 / ln(b/a)]
{
    const mu = 0.03, q = 200 * GPM, a = d / 2, b = D / 2;
    const exactG = (q * 8 * mu) / (Math.PI * (b ** 4 - a ** 4 - (b * b - a * a) ** 2 / Math.log(b / a)));
    const r = solve(geo(), newt(mu), q);
    const err = (r.s.gradientPaM / exactG - 1) * 100;
    check('Newtonian concentric vs analytic', Math.abs(err) < 5, `G=${r.s.gradientPaM.toFixed(1)} Pa/m exact=${exactG.toFixed(1)} err=${err.toFixed(2)}% steps=${r.steps}`);
}

// 2. Newtonian: G scales linearly with Q and with mu
{
    const g1 = solve(geo(0.5), newt(0.03), 100 * GPM).s.gradientPaM;
    const g2 = solve(geo(0.5), newt(0.03), 200 * GPM).s.gradientPaM;
    const g3 = solve(geo(0.5), newt(0.06), 100 * GPM).s.gradientPaM;
    check('Linear in Q', Math.abs(g2 / g1 - 2) < 1e-3, `ratio=${(g2 / g1).toFixed(4)}`);
    check('Linear in mu', Math.abs(g3 / g1 - 2) < 1e-3, `ratio=${(g3 / g1).toFixed(4)}`);
}

// 3. Eccentricity lowers the pressure gradient needed for the same Q
{
    const c = solve(geo(0), newt(0.03), 200 * GPM).s.gradientPaM;
    const e = solve(geo(0.8), newt(0.03), 200 * GPM).s.gradientPaM;
    check('Eccentric needs less pressure', e < c, `concentric=${c.toFixed(1)} ecc0.8=${e.toFixed(1)} Pa/m`);
}

// 4. Every mud preset converges; report time and plug fraction
for (const p of MUD_PRESETS) {
    const fluid: Fluid = { densityKgM3: p.densityKgM3, yieldStressPa: p.yieldStressPa, consistencyPaSn: p.consistencyPaSn, flowIndex: p.flowIndex };
    const r = solve(geo(0.5), fluid, 200 * GPM);
    check(`Preset "${p.label}"`, r.converged && Number.isFinite(r.s.gradientPaM),
        `G=${(r.s.gradientPaM / 226.206).toFixed(2)} psi/100ft steps=${r.steps} ${r.ms.toFixed(0)}ms plug=${(r.s.plugFraction * 100).toFixed(0)}%`);
}

// 5. Bingham vs the narrow-slot formula (d/D = 0.8: slot approximation within ~10 %)
{
    const pv = 0.02, ty = 6, thin = { wellboreDiameterM: D, pipeDiameterM: 0.8 * D, eccentricity: 0, roughness: 0 };
    const fluid: Fluid = { densityKgM3: 1200, yieldStressPa: ty, consistencyPaSn: pv, flowIndex: 1 };
    const h = (D - 0.8 * D) / 2, w = Math.PI * (D + 0.8 * D) / 2;
    const q = 0.3 * h * w; // mean velocity 0.3 m/s
    const r = solve(thin, fluid, q);
    // slot Q(G) = G h^3 w /(12 pv) * (1 - 1.5 a + 0.5 a^3), a = 2 ty/(G h): find G by bisection
    const slotQ = (G: number) => { const a = Math.min(1, (2 * ty) / (G * h)); return (G * h ** 3 * w) / (12 * pv) * (1 - 1.5 * a + 0.5 * a ** 3); };
    let lo = 2 * ty / h, hi = 1e5;
    for (let k = 0; k < 100; k++) { const m = (lo + hi) / 2; if (slotQ(m) < q) lo = m; else hi = m; }
    const err = (r.s.gradientPaM / lo - 1) * 100;
    check('Bingham thin-gap vs slot formula', Math.abs(err) < 20, `G=${r.s.gradientPaM.toFixed(0)} slot=${lo.toFixed(0)} err=${err.toFixed(1)}% steps=${r.steps} plug=${(r.s.plugFraction * 100).toFixed(0)}%`);
}

// 6. Roughness raises the pressure gradient; changing fluid keeps working from a warm start
{
    const smooth = solve(geo(0.5, 0), newt(0.03), 200 * GPM).s.gradientPaM;
    const rough = solve(geo(0.5, 0.05), newt(0.03), 200 * GPM).s.gradientPaM;
    check('Roughness raises G', rough > smooth, `smooth=${smooth.toFixed(1)} rough=${rough.toFixed(1)} (+${((rough / smooth - 1) * 100).toFixed(0)}%)`);

    const s = new Solver(GRID_SIZE);
    s.setGeometry(geo(0.5));
    const p = MUD_PRESETS.find((m) => m.label === 'Bentonite WBM')!;
    const fl = (k: number): Fluid => ({ densityKgM3: p.densityKgM3, yieldStressPa: p.yieldStressPa, consistencyPaSn: k, flowIndex: 1 });
    s.setOperating(fl(0.015), 200 * GPM);
    let n = 0; while (!s.step().converged && n < MAX_STEPS) n++;
    s.setOperating(fl(0.030), 200 * GPM);
    let m = 0; while (!s.step().converged && m < MAX_STEPS) m++;
    check('Warm start after fluid change', m < n, `cold=${n} steps, warm=${m} steps`);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
