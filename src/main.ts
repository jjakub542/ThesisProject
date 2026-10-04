import './style.css';
import './panel.css';
import { SolverClient } from './solver/SolverClient';
import { Hud } from './ui/hud';
import { createPanel } from './ui/panel';
import { createState, toSolverInput } from './ui/state';
import { Visualizer } from './view/Visualizer';

/*
 * Data flow:   panel ──edits──▶ state ──toSolverInput──▶ SolverClient ──CONFIGURE──▶ worker (Solver)
 *                                                                                      │
 *              Visualizer ◀── velocity ── onResult ◀──────────── RESULT (streamed) ◀───┘
 *              Hud        ◀── hydraulics (state + gradient from the result)
 */

const state = createState();

/** Pushes every view-only setting into the visualiser. */
function applyViewSettings() {
    visualizer.setStringStyle(state.stringLayer);
    visualizer.setWellboreStyle(state.wellboreLayer);
    visualizer.setTubeLength(state.tubeLength);
    visualizer.setSmoothing(state.smoothing);
}

const panel = createPanel(state, {
    onSolverChange: () => {
        hud.setPending();
        solver.configure(toSolverInput(state));
    },
    onModeChange: () => {
        visualizer.setMode(state.mode);
        hud.schedule();
    },
    onViewChange: applyViewSettings,
    onUnitsChange: () => hud.schedule(),
});

const visualizer = new Visualizer(document.getElementById('canvas3d') as HTMLCanvasElement);
const hud = new Hud(state);
const solver = new SolverClient();

visualizer.onChartMax = (max) => hud.setChartMax(max);
solver.onGeometry = (g) => visualizer.setGeometry(g);
solver.onResult = (r) => {
    visualizer.updateData(r.velocity);
    hud.setResult(r);
};

// initial push of the state into the view and the solver
panel.sync();
visualizer.setMode(state.mode);
applyViewSettings();
hud.setPending();
solver.configure(toSolverInput(state));