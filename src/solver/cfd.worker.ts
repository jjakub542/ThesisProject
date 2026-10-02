import { Solver } from './Solver';
import { CONVERGENCE_TOL, OUTER_RADIUS_CELLS } from '../config';

interface GeometryPayload {
    /** pipe OD / wellbore diameter */
    diameterRatio: number;
    eccentricity: number;
    /** wall roughness eps / D (0 = smooth) */
    roughness: number;
}

/**
 * With the "dom" lib, `self` is typed as Window, whose postMessage has no (message, transfer[]) overload.
 * Inside a worker it is really the worker scope, so we use Worker's typing for postMessage.
 */
const ctx = self as unknown as Worker;

let solver: Solver;

/** Same geometry with smooth walls. Only exists while roughness > 0; used to quantify the friction impact. */
let reference: Solver | null = null;
let referenceDelta = 0;
let referenceFlow: number | null = null;

function fluidFlow(s: Solver): number {
    let sum = 0;
    for (let i = 0; i < s.geometryMask.length; i++) if (s.geometryMask[i] === 0) sum += s.velocity[i];
    return sum;
}

function applyGeometry(p: GeometryPayload) {
    const ri = OUTER_RADIUS_CELLS * p.diameterRatio;
    solver.initGeometry(OUTER_RADIUS_CELLS, ri, p.eccentricity, p.roughness);

    if (p.roughness > 0) {
        if (!reference) reference = new Solver(solver.size);
        reference.initGeometry(OUTER_RADIUS_CELLS, ri, p.eccentricity, 0);
        referenceDelta = Infinity;
        referenceFlow = null;
    } else {
        reference = null;
        referenceDelta = 0;
        referenceFlow = null;
    }
}

function sendGeometry(type: 'READY' | 'GEOMETRY') {
    const mask = solver.geometryMask.slice(); // copy so we can transfer it
    ctx.postMessage(
        {
            type,
            mask,
            radiusOuter: solver.radiusOuter,
            radiusInner: solver.radiusInner,
            eccentricity: solver.eccentricity,
        },
        [mask.buffer]
    );
}

self.onmessage = (e) => {
    const { type, payload } = e.data;

    if (type === 'INIT') {
        solver = new Solver(payload.size);
        applyGeometry(payload);
        sendGeometry('READY');
    }

    if (type === 'SET_GEOMETRY') {
        applyGeometry(payload);
        sendGeometry('GEOMETRY');
    }

    if (type === 'COMPUTE') {
        let delta = solver.computeStep();

        // Advance the smooth-wall reference until it has converged, then leave it alone.
        if (reference && referenceDelta > CONVERGENCE_TOL) {
            referenceDelta = reference.computeStep();
            referenceFlow = fluidFlow(reference);
        }
        delta = Math.max(delta, referenceDelta); // keep the loop running until both are converged

        const velocity = new Float64Array(solver.velocity);
        ctx.postMessage({ type: 'RESULT', velocity, delta, referenceFlow }, [velocity.buffer]);
    }
};
