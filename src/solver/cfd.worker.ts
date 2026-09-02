import { Solver } from './Solver';

let solver: Solver;

// Nasłuchiwanie komend z głównego wątku
self.onmessage = (e) => {
    const { type, payload } = e.data;

    if (type === 'INIT') {
        solver = new Solver(payload.size);
        self.postMessage({ type: 'READY' });
    }

    if (type === 'COMPUTE') {
        solver.computeStep();
        
        // Zwracamy tablicę bez kopiowania pamięci (Transferable Object)
        // Klonujemy tablicę, aby wysłać jej bufor bez utraty referencji w workerze
        const result = new Float64Array(solver.velocity);
        self.postMessage(
            { type: 'RESULT', velocity: result }, 
            [result.buffer] 
        );
    }
};