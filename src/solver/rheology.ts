import { MIN_SHEAR_RATE } from '../config';
import type { Fluid } from '../types';

export const isNewtonian = (f: Fluid) => f.yieldStressPa === 0 && f.flowIndex === 1;

/**
 * Effective viscosity [Pa·s] of a Herschel–Bulkley fluid: mu = K·γ^(n-1) + tau_y/γ, with the shear rate γ
 * floored at MIN_SHEAR_RATE (see config.ts for why).
 */
export function apparentViscosity(f: Fluid, shearRate: number): number {
    const g = Math.max(shearRate, MIN_SHEAR_RATE);
    const power = f.flowIndex === 1 ? f.consistencyPaSn : f.consistencyPaSn * g ** (f.flowIndex - 1);
    return power + f.yieldStressPa / g;
}
