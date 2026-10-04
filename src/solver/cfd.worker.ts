import {
    CONVERGENCE_TOL,
    OUTER_RADIUS_CELLS,
} from '../config';
import {
    Solver,
    type FluidModel,
    type SolverOptions,
} from './Solver';

interface GeometryPayload {
    /** Pipe OD / wellbore diameter. */
    diameterRatio: number;
    eccentricity: number;
    /** Effective wall roughness eps / D. */
    roughness: number;
}

interface InitPayload extends GeometryPayload {
    size: number;
    wellboreDiameterM: number;
    frictionGradientPaM: number;
    gravityAlongAxisMSS: number;
    fluid: FluidModel;
}

interface UpdatePayload extends GeometryPayload {
    wellboreDiameterM: number;
    frictionGradientPaM: number;
    gravityAlongAxisMSS: number;
    fluid: FluidModel;
}

const ctx = self as unknown as Worker;

let solver: Solver;
let reference: Solver | null = null;
let referenceDelta = 0;
let referenceFlow: number | null = null;
let dxM = 0;

function makeOptions(p: UpdatePayload): SolverOptions {
    return {
        frictionGradientPaM: p.frictionGradientPaM,
        gravityAlongAxisMSS: p.gravityAlongAxisMSS,
        fluid: p.fluid,
    };
}

function fluidFlow(s: Solver): number {
    let sum = 0;
    for (let i = 0; i < s.geometryMask.length; i++) {
        if (s.geometryMask[i] === 0) sum += s.velocity[i];
    }
    return sum * dxM * dxM; // m³/s
}

let currentSettings: UpdatePayload | null = null;

function applyParameters(p: UpdatePayload) {
    currentSettings = p;

    const options = makeOptions(p);
    const radiusOuter = OUTER_RADIUS_CELLS;
    const radiusInner = radiusOuter * p.diameterRatio;

    dxM = (p.wellboreDiameterM / 2) / radiusOuter;

    solver.setOptions(options);
    solver.initGeometry(radiusOuter, radiusInner, p.eccentricity, p.roughness);

    if (p.roughness > 0) {
        if (!reference) {
            reference = new Solver(solver.size, dxM, options);
        } else {
            reference.setOptions(options);
        }

        reference.initGeometry(radiusOuter, radiusInner, p.eccentricity, 0);
        referenceDelta = Infinity;
        referenceFlow = null;
    } else {
        reference = null;
        referenceDelta = 0;
        referenceFlow = null;
    }
}

function sendGeometry(type: 'READY' | 'GEOMETRY') {
    const mask = solver.geometryMask.slice();

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

const DEFAULT_FLUID: FluidModel = {
    rheology: 'newtonian',
    densityKgM3: 1200,
    viscosityPaS: 0.03,
    yieldStressPa: 5,
    plasticViscosityPaS: 0.03,
    consistencyPaSn: 0.5,
    flowIndex: 0.8,
    regularizationS: 100,
};

const DEFAULT_WELLBORE_DIAMETER_M = 8.5 * 0.0254;
const DEFAULT_FRICTION_GRADIENT_PA_M = 1000;
const DEFAULT_GRAVITY_ALONG_AXIS_MSS = 0;

function normalizePayload(
    p: Partial<UpdatePayload> & { size?: number }
): UpdatePayload {
    return {
        diameterRatio: p.diameterRatio ?? 5 / 8.5,
        eccentricity: p.eccentricity ?? 0.5,
        roughness: p.roughness ?? 0,
        wellboreDiameterM:
            p.wellboreDiameterM ?? DEFAULT_WELLBORE_DIAMETER_M,
        frictionGradientPaM:
            p.frictionGradientPaM ?? DEFAULT_FRICTION_GRADIENT_PA_M,
        gravityAlongAxisMSS:
            p.gravityAlongAxisMSS ?? DEFAULT_GRAVITY_ALONG_AXIS_MSS,
        fluid: { ...DEFAULT_FLUID, ...p.fluid },
    };
}

self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data;

    if (type === 'INIT') {
        const raw = payload as Partial<InitPayload>;
        const p = normalizePayload(raw);

        dxM = (p.wellboreDiameterM / 2) / OUTER_RADIUS_CELLS;
        solver = new Solver(
            raw.size ?? 100,
            dxM,
            makeOptions(p)
        );

        applyParameters(p);
        sendGeometry('READY');
        return;
    }

    if (type === 'SET_GEOMETRY' || type === 'SET_PARAMETERS') {
        const p = normalizePayload(payload as Partial<UpdatePayload>);
        applyParameters(p);
        sendGeometry('GEOMETRY');
        return;
    }

if (type === 'COMPUTE') {
    if (!currentSettings) {
        throw new Error('COMPUTE received before fluid settings were initialized');
    }

    const delta = solver.computeStep();

    if (reference && referenceDelta > CONVERGENCE_TOL) {
        referenceDelta = reference.computeStep();
        referenceFlow = fluidFlow(reference);
    }

    const velocity = new Float64Array(solver.velocity);
    const { frictionGradientPaM, gravityAlongAxisMSS, fluid } = currentSettings;

    ctx.postMessage(
        {
            type: 'RESULT',
            velocity,
            delta: Math.max(delta, referenceDelta),
            flowRateM3S: fluidFlow(solver),
            referenceFlowM3S: referenceFlow,
            frictionGradientPaM,
            hydrostaticGradientPaM: fluid.densityKgM3 * gravityAlongAxisMSS,
        },
        [velocity.buffer]
    );
    return;
}
};
