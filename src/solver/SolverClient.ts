import type { FromWorker, GeometryInfo, SolveResult, SolverInput, ToWorker } from '../types';

/**
 * Main-thread handle to the solver worker.
 *
 * `configure()` replaces the current problem; the worker then streams results until converged. Results carry
 * the epoch of the configuration they belong to, and stale ones are dropped. GEOMETRY messages are never
 * dropped: they arrive in order, and the latest one always describes the grid the worker is using.
 */
export class SolverClient {
    onGeometry: (g: GeometryInfo) => void = () => {};
    onResult: (r: SolveResult) => void = () => {};

    private readonly worker = new Worker(new URL('./cfd.worker.ts', import.meta.url), { type: 'module' });
    private epoch = 0;

    constructor() {
        this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
            const msg = e.data;
            if (msg.type === 'GEOMETRY') this.onGeometry(msg);
            else if (msg.epoch === this.epoch) this.onResult(msg);
        };
    }

    configure(input: SolverInput) {
        const msg: ToWorker = { type: 'CONFIGURE', epoch: ++this.epoch, input };
        this.worker.postMessage(msg);
    }
}
