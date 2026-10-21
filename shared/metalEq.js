// Metal equivalent grades (CuEq, AuEq, ...): pure helpers for the 3D studio, the property results table and the unit tests.
// Each metal's in-situ value per tonne, at its price and recovery, expressed as base-metal grade:
//   EqBase = Base + sum(factor_m * grade_m),  factor_m = (value per grade unit_m * rec_m) / (value per grade unit_base * rec_base)
// Unit conversions: 1% = 22.0462 lb/t; 1 g/t = 1 / 31.1035 oz/t; ppm = g/t; ppb = g/t / 1000.

export const LB_PER_T_PER_PCT = 22.0462, G_PER_OZ = 31.1035;
// Illustrative default prices, US$ per lb or per troy ounce.
export const METAL_DEFAULTS = { Cu: 4.5, Au: 3000, Ag: 35, Mo: 20, Zn: 1.3 };
const OZ_METALS = new Set(['Au', 'Ag', 'Pt', 'Pd']);
export const priceUnit = (metal) => (OZ_METALS.has(metal) ? 'oz' : 'lb');
const GPT = { '%': 10000, 'g/t': 1, ppm: 1, ppb: 0.001 };

// The usual grade unit when a column name does not say: % for base metals, g/t for precious metals.
export const defaultUnit = (metal) => (OZ_METALS.has(metal) ? 'g/t' : '%');

// US$ per tonne for one unit of grade.
export function unitValue(metal, unit, price) {
  const gpt = GPT[unit || defaultUnit(metal)];
  if (gpt === undefined) throw new Error(`Unknown grade unit "${unit}" for ${metal}. Use %, g/t, ppm or ppb.`);
  return priceUnit(metal) === 'oz' ? (gpt / G_PER_OZ) * price : (gpt / 10000) * LB_PER_T_PER_PCT * price;
}

// base: { metal, unit, price, recovery }; metals: [{ metal, unit, price, recovery }] (recoveries in %).
// Returns the factor for each metal, in base-grade units per unit of that metal's grade.
export function eqFactors(base, metals) {
  const bv = unitValue(base.metal, base.unit, base.price) * base.recovery;
  if (!(bv > 0)) throw new Error('The base metal needs a price and a recovery above zero.');
  return metals.map((m) => ({ ...m, factor: (unitValue(m.metal, m.unit, m.price) * m.recovery) / bv }));
}

// Factor shown to three significant figures, as in a news-release footnote.
export const fmtFactor = (f) => String(Number(f.toPrecision(3)));
export const eqFormula = (base, factors) => `${base}Eq = ${[base, ...factors.map((m) => `${fmtFactor(m.factor)} × ${m.metal}`)].join(' + ')}`;

// One interval's equivalent grade. Any missing component gives no value: never read as zero.
export function eqValue(baseGrade, grades, factors) {
  if (!Number.isFinite(baseGrade)) return NaN;
  let v = baseGrade;
  for (let i = 0; i < factors.length; i++) { if (!Number.isFinite(grades[i])) return NaN; v += factors[i].factor * grades[i]; }
  return v;
}
