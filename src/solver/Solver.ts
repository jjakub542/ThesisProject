export class Solver {
    public size: number;
    public velocity: Float64Array;
    public geometryMask: Uint8Array; // 0 = płyn, 1 = skała, 2 = wiertło

    constructor(size: number) {
        this.size = size;
        const totalCells = size * size;
        
        // Płaskie tablice do szybkich obliczeń
        this.velocity = new Float64Array(totalCells);
        this.geometryMask = new Uint8Array(totalCells);
        
        this.initGeometry();
    }

    private initGeometry() {
        // TODO: Tutaj narysujesz okrąg otworu i okrąg wiertła (mimośrodowość)
        // Na start wypełniamy przykładową wartością
        for(let i=0; i<this.velocity.length; i++) {
            this.velocity[i] = Math.random(); // Zastąp solverem Gaussa-Seidla
        }
    }

    public computeStep() {
        // TODO: Główna pętla solvera (Gauss-Seidel) dla profilu prędkości
        // Symulacja obliczeń:
        for(let i=0; i<this.velocity.length; i++) {
            if (this.geometryMask[i] === 0) {
                // delikatna zmiana prędkości by symulować działanie
                this.velocity[i] *= 0.99; 
            }
        }
    }
}