import { Solver } from './Solver';

let solver: Solver;

function sendGeometry(type: 'READY' | 'GEOMETRY') {
    const mask = solver.geometryMask.slice(); // copy so we can transfer it
    self.postMessage(
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
        sendGeometry('READY');
    }

    if (type === 'SET_GEOMETRY') {
        solver.initGeometry(solver.radiusOuter, solver.radiusInner, payload.eccentricity);
        sendGeometry('GEOMETRY');
    }

    if (type === 'COMPUTE') {
        const delta = solver.computeStep();
        const velocity = new Float64Array(solver.velocity);
        self.postMessage({ type: 'RESULT', velocity, delta }, [velocity.buffer]);
    }
};