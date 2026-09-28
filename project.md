# Podsumowanie Architektury i Stanu Projektu: Numeryczna Analiza Przepływu Płuczki Wiertniczej

## 1. Cel i Zakres Projektu

Celem projektu inżynierskiego jest stworzenie przeglądarkowego symulatora przepływu płuczki wiertniczej w przestrzeni pierścieniowej (otwór wiertniczy – przewód wiertniczy) z uwzględnieniem mimośrodowości (niecentrycznego ułożenia wiertła). Projekt łączy zaawansowaną metodę numeryczną (FDM - Metoda Różnic Skończonych) z nowoczesną, wydajną wizualizacją 3D (Three.js) przy użyciu TypeScript i Web Workerów.

---

## 2. Architektura Systemu

Projekt opiera się na **architekturze rozproszonej client-side (Multi-threaded Web App)**, co gwarantuje, że ciężkie obliczenia matematyczne nie blokują renderowania grafiki 3D (stałe 60 FPS).

```text
src/
├── main.ts                 # Punkt wejścia aplikacji, inicjalizacja UI i widoku
├── style.css               # Podstawowe style interfejsu
├── view/
│   └── Visualizer.ts       # Warstwa prezentacji 3D (Three.js, InstancedMesh, cząsteczki)
└── solver/
    ├── Solver.ts           # Logika matematyczna, maska geometrii, solver numeryczny
    └── cfd.worker.ts       # Web Worker (silnik obliczeniowy w osobnym wątku)

```

* **Struktura Danych (SoA - Structure of Arrays):** Zamiast kosztownych obiektów, dane siatki 2D przechowywane są w płaskich tablicach typowanych (`Float64Array` dla prędkości, `Uint8Array` dla maski geometrii), co maksymalizuje wydajność silnika V8.
* **Komunikacja Asynchroniczna:** Wymiana danych między wątkiem głównym a Web Workerem odbywa się za pomocą *Transferable Objects* (zero-copy), eliminując opóźnienia przy przesyłaniu tablic prędkości.

---

## 3. Co Zostało Zrobione (MVP)

* **Infrastruktura techniczna:** Skonfigurowano środowisko oparte na Vite i TypeScript z pełną obsługą Web Workerów oraz Three.js.
* **Geometria i Mimośrodowość:** Zaimplementowano funkcję generującą maskę 2D przekroju poprzecznego rury, pozwalającą na dowolne przesuwanie środka wiertła względem otworu (współczynnik ekscentryczności $\bar{e}$).
* **Solver Numeryczny (FDM):** Napisano iteracyjny solver oparty na metodzie Gaussa-Seidla dla równania Poissona, modelujący spadek ciśnienia i narastanie profilu prędkości.
* **Wizualizacja 3D (Channeling):** Stworzony w Three.js system cząsteczek oparty na `THREE.InstancedMesh` dynamicznie odczytuje prędkości z siatki 2D, wizualizując zjawisko nierównomiernego przepływu (szybki przepływ w szerokiej szczelinie, wolny w wąskiej).

---

## 4. Jak to Działa (Pipeline Przepływu Danych)

1. **Inicjalizacja:** Wątek główny uruchamia Web Workera i przekazuje parametry geometrii (promienie, ekscentryczność).
2. **Maskowanie:** `Solver.ts` wyznacza współrzędne komórek stałych (skała, wiertło) oraz komórek płynu na siatce kartezjańskiej.
3. **Pętla Obliczeniowa (Worker):** Web Worker wykonuje iteracje algorytmu Gaussa-Seidla, rozwiązując równanie pędu dla komórek płynu.
4. **Transfer:** Po obliczeniu kroku, tablica `Float64Array` z prędkościami jest przesyłana bezkopijnie do wątku głównego.
5. **Renderowanie (Three.js):** Klasa `Visualizer.ts` aktualizuje pozycję tysięcy cząsteczek wzdłuż osi Z w oparciu o lokalne prędkości z siatki 2D, po czym renderuje scenę na ekranie.

---

## 5. Kolejne Kroki (Rozwój Projektu)

Aby przekształcić obecne MVP w pełnoprawną, zaawansowaną pracę inżynierską, należy wdrożyć następujące rozszerzenia:

1. **Model Reologiczny Herschela-Bulkleya:**
* Zastąpienie uproszczonego stałego wymuszenia (`forcingTerm`) dynamiczną lepkością efektywną zależną od lokalnego gradientu prędkości ($\dot{\gamma}$) oraz granicy płynięcia ($\tau_y$).


2. **Interfejs Użytkownika (UI):**
* Dodanie suwaków sterujących ekscentrycznością ($e$), gradientem ciśnienia ($\frac{dp}{dz}$) oraz parametrami reologicznymi płuczki w czasie rzeczywistym.


3. **Walidacja Analityczna:**
* Porozumienie wyników symulacji numerycznej z klasycznymi wzorami analitycznymi dla koncentrycznego przepływu szczelinowego.


4. **Rozszerzenia Fizyczne (Opcjonalnie na ocenę celującą):**
* Wprowadzenie macierzy temperatury (wpływ ciepła na lepkość płuczki) lub dodanie warunku chropowactwości ścianek jako modyfikacji współczynnika tarcia przy brzegach siatki.