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

/**
     * Inicjalizuje maskę geometrii dla przepływu w przestrzeni pierścieniowej.
     * 
     * @param radiusOuter Promień otworu wiertniczego (w pikselach/komórkach siatki)
     * @param radiusInner Promień zewnętrzny przewodu wiertniczego
     * @param eccentricity Współczynnik mimośrodowości (0.0 = idealnie na środku, 1.0 = dotyka ściany)
     */
    public initGeometry(
        radiusOuter: number = 40, 
        radiusInner: number = 25, 
        eccentricity: number = 1.0 
    ) {
        // 1. Obliczenie fizycznego przesunięcia wiertła
        // Maksymalne możliwe przesunięcie (gdy wiertło dotyka ściany otworu)
        const maxOffset = radiusOuter - radiusInner; 
        
        // Rzeczywiste przesunięcie osi wiertła na osi X
        const e = eccentricity * maxOffset; 

        // 2. Współrzędne środków (w jednostkach siatki)
        const cxOuter = this.size / 2;
        const cyOuter = this.size / 2;

        // Środek wiertła jest przesunięty w prawo o wartość 'e'
        const cxInner = cxOuter + e;
        const cyInner = cyOuter;

        // 3. Wypełnianie płaskich tablic na podstawie geometrii
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                // Konwersja współrzędnych 2D (x, y) na indeks 1D
                const index = x + y * this.size;

                // Odległość punktu (x,y) od środka otworu (twierdzenie Pitagorasa)
                const distOuter = Math.sqrt(Math.pow(x - cxOuter, 2) + Math.pow(y - cyOuter, 2));
                
                // Odległość punktu (x,y) od przesuniętego środka wiertła
                const distInner = Math.sqrt(Math.pow(x - cxInner, 2) + Math.pow(y - cyInner, 2));

                if (distOuter >= radiusOuter) {
                    // Poza otworem -> Skała (granica zewnętrzna)
                    this.geometryMask[index] = 1;
                    this.velocity[index] = 0; 
                } 
                else if (distInner <= radiusInner) {
                    // Wewnątrz wiertła -> Stal (granica wewnętrzna)
                    this.geometryMask[index] = 2;
                    this.velocity[index] = 0; 
                } 
                else {
                    // Przestrzeń pomiędzy -> Płyn (płuczka)
                    this.geometryMask[index] = 0;
                    this.velocity[index] = 0; // Prędkość początkowa (ciecz stoi)
                }
            }
        }
    }

/**
     * Rozwiązuje równanie Poissona dla prędkości na przekroju 2D.
     * @param iterations Liczba iteracji solvera na jeden krok wizualizacji
     */
    public computeStep(iterations: number = 20) {
        // Forcing term reprezentuje człon: -(dp/dz) * (dx^2 / mu).
        // Dla modelu MVP to stała wartość wymuszająca ruch płynu (napęd).
        const forcingTerm = 0.05; 
        
        // Pętla iteracyjna - im więcej iteracji, tym bliżej stanu ustalonego
        for (let iter = 0; iter < iterations; iter++) {
            
            // Iterujemy po siatce. Pomijamy skrajne krawędzie (x=0, y=0, itd.),
            // aby przy sprawdzaniu sąsiadów nie odwołać się poza tablicę.
            for (let y = 1; y < this.size - 1; y++) {
                for (let x = 1; x < this.size - 1; x++) {
                    const i = x + y * this.size;

                    // Obliczenia wykonujemy TYLKO dla komórek z płynem
                    if (this.geometryMask[i] === 0) {
                        
                        // Indeksy 1D dla czterech sąsiadów (Północ, Południe, Wschód, Zachód)
                        const iNorth = x + (y - 1) * this.size;
                        const iSouth = x + (y + 1) * this.size;
                        const iWest = (x - 1) + y * this.size;
                        const iEast = (x + 1) + y * this.size;

                        // Pobranie prędkości sąsiadów
                        const uN = this.velocity[iNorth];
                        const uS = this.velocity[iSouth];
                        const uW = this.velocity[iWest];
                        const uE = this.velocity[iEast];

                        // Wzór iteracyjny Gaussa-Seidla: 
                        // Nowa prędkość to średnia z 4 sąsiadów plus wpływ ciśnienia (napęd)
                        this.velocity[i] = 0.25 * (uN + uS + uW + uE + forcingTerm);
                    }
                }
            }
        }
    }
}