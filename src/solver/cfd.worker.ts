import { Solver } from './Solver';
import { OUTER_RADIUS_CELLS } from '../config';

interface GeometryPayload {
    /** pipe OD / wellbore diameter */
    diameterRatio: number;
    eccentricity: number;
}

/**
 * With the "dom" lib, `self` is typed as Window, whose postMessage has no (message, transfer[]) overload.
 * Inside a worker it is really the worker scope, so we use Worker's typing for postMessage.
 */
const ctx = self as unknown as Worker;

let solver: Solver;

function applyGeometry(p: GeometryPayload) {
    solver.initGeometry(OUTER_RADIUS_CELLS, OUTER_RADIUS_CELLS * p.diameterRatio, p.eccentricity);
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
        const delta = solver.computeStep();
        const velocity = new Float64Array(solver.velocity);
        ctx.postMessage({ type: 'RESULT', velocity, delta }, [velocity.buffer]);
    }
};
