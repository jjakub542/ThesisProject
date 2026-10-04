import { GRAVITY, RE_LIMIT } from './config';
import type { Fluid, Geometry } from './types';

export interface HydraulicsInput {
    geometry: Geometry;
    fluid: Fluid;
    flowRateM3S: number;
    /** True vertical depth [m]. */
    depthM: number;
    /** Frictional pressure gradient from the solver [Pa/m]. */
    gradientPaM: number;
    /** Flow area [m²]. */
    areaM2: number;
}

export interface Hydraulics {
    meanVelocityMS: number;
    /** Mud column pressure at depth [Pa]. */
    hydrostaticPa: number;
    /** Annular friction loss over the whole depth [Pa]. */
    frictionLossPa: number;
    /** Circulating bottom-hole pressure, with zero surface back-pressure [Pa]. */
    bottomHolePa: number;
    /** Equivalent circulating density [kg/m³]. */
    ecdKgM3: number;
    /** Viscosity that a Newtonian fluid would need for the same pressure loss [Pa·s]. */
    apparentViscosityPaS: number;
    reynolds: number;
    laminar: boolean;
    /** Mean wall shear stress [Pa]. */
    wallShearPa: number;
}

/**
 * Vertical well, mud pumped down the pipe and up the annulus, TVD = depth, no surface back-pressure.
 *
 *   hydrostatic = rho·g·L          friction = G·L          BHP = hydrostatic + friction
 *   ECD = rho + G/g                (the friction gradient expressed as extra mud density)
 *
 * The flow only feels G: the hydrostatic part is balanced by gravity and does not drive the flow.
 *
 * Reynolds number uses the narrow-slot relation for the apparent viscosity: for a Newtonian fluid
 * G = 12·mu·v/h² (h = gap width), so mu_app = G·h²/(12·v) and Re = rho·v·(2h)/mu_app. This is a screening
 * criterion for "is the laminar solution still plausible", not a turbulence model.
 */
export function computeHydraulics(i: HydraulicsInput): Hydraulics {
    const { geometry: g, fluid, gradientPaM: G } = i;
    const v = i.areaM2 > 0 ? i.flowRateM3S / i.areaM2 : 0;
    const gap = (g.wellboreDiameterM - g.pipeDiameterM) / 2;
    const hydrostaticPa = fluid.densityKgM3 * GRAVITY * i.depthM;
    const frictionLossPa = G * i.depthM;

    const apparentViscosityPaS = v > 0 ? (G * gap * gap) / (12 * v) : 0;
    const reynolds = apparentViscosityPaS > 0 ? (fluid.densityKgM3 * v * 2 * gap) / apparentViscosityPaS : 0;
    const wetted = Math.PI * (g.wellboreDiameterM + g.pipeDiameterM);

    return {
        meanVelocityMS: v,
        hydrostaticPa,
        frictionLossPa,
        bottomHolePa: hydrostaticPa + frictionLossPa,
        ecdKgM3: fluid.densityKgM3 + G / GRAVITY,
        apparentViscosityPaS,
        reynolds,
        laminar: reynolds <= RE_LIMIT,
        wallShearPa: wetted > 0 ? (G * i.areaM2) / wetted : 0,
    };
}
