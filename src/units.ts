
export type UnitSystem = 'field' | 'si';
export type Quantity = 'diameter' | 'depth' | 'flow' | 'pressure' | 'density' | 'gradient' | 'velocity';

/** `factor` converts one display unit to SI: value_SI = value_display * factor. */
const TABLE: Record<Quantity, Record<UnitSystem, { label: string; factor: number }>> = {
    diameter: { field: { label: 'in', factor: 0.0254 }, si: { label: 'mm', factor: 0.001 } },
    depth: { field: { label: 'ft', factor: 0.3048 }, si: { label: 'm', factor: 1 } },
    flow: { field: { label: 'gpm', factor: 3.785411784e-3 / 60 }, si: { label: 'L/min', factor: 1e-3 / 60 } },
    pressure: { field: { label: 'psi', factor: 6894.757 }, si: { label: 'bar', factor: 1e5 } },
    density: { field: { label: 'ppg', factor: 119.8264 }, si: { label: 'kg/m³', factor: 1 } },
    gradient: { field: { label: 'psi/100ft', factor: 6894.757 / 30.48 }, si: { label: 'kPa/m', factor: 1000 } },
    velocity: { field: { label: 'ft/min', factor: 0.00508 }, si: { label: 'm/min', factor: 1 / 60 } },
};

export const unitLabel = (q: Quantity, s: UnitSystem) => TABLE[q][s].label;
export const toDisplay = (q: Quantity, s: UnitSystem, si: number) => si / TABLE[q][s].factor;
export const fromDisplay = (q: Quantity, s: UnitSystem, v: number) => v * TABLE[q][s].factor;

/** 3 significant digits, no exponent for everyday magnitudes. */
export const sig = (v: number, digits = 3) =>
    !Number.isFinite(v) ? '–' : Math.abs(v) >= 10 ** digits ? v.toFixed(0) : v.toPrecision(digits);

/** Value for an <input>: up to 4 significant digits, no trailing zeros. */
export const plain = (v: number) => String(Number(v.toPrecision(4)));
