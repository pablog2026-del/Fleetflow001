// VIN validation (ISO 3779 check digit) and NHTSA vPIC decoding (free API).

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeVin(vin: string): string {
  return vin.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** null when valid, otherwise a human-readable problem. */
export function vinProblem(raw: string): string | null {
  const vin = normalizeVin(raw);
  if (vin.length !== 17) return `A VIN has 17 characters (this has ${vin.length}).`;
  if (/[IOQ]/.test(vin)) return 'VINs never contain the letters I, O or Q.';
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const v = /\d/.test(c) ? Number(c) : TRANSLIT[c];
    sum += v * WEIGHTS[i];
  }
  const check = sum % 11 === 10 ? 'X' : String(sum % 11);
  if (vin[8] !== check) return `Check digit doesn’t match (expected ${check}). Re-check the data plate.`;
  return null;
}

export interface DecodedVin {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  body_type: string | null;
  engine: string | null;
  transmission: string | null;
  gvwr: string | null;
  raw: Record<string, string>;
  warning: string | null;
}

const titleCase = (s: string | null) =>
  s ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;

export async function decodeVin(raw: string): Promise<DecodedVin> {
  const vin = normalizeVin(raw);
  const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`);
  if (!res.ok) throw new Error(`NHTSA lookup failed (${res.status})`);
  const body = await res.json();
  const r: Record<string, string> = body?.Results?.[0] ?? {};
  const pick = (k: string) => (r[k] && r[k] !== 'Not Applicable' ? r[k] : null);
  const engine = [pick('EngineManufacturer'), pick('EngineModel'), pick('DisplacementL') && `${Number(r.DisplacementL).toFixed(1)}L`]
    .filter(Boolean).join(' ') || null;
  return {
    vin,
    year: pick('ModelYear') ? Number(r.ModelYear) : null,
    make: titleCase(pick('Make')),
    model: pick('Model'),
    body_type: pick('BodyClass'),
    engine,
    transmission: [pick('TransmissionStyle'), pick('TransmissionSpeeds') && `${r.TransmissionSpeeds}-speed`].filter(Boolean).join(' ') || null,
    gvwr: pick('GVWR'),
    raw: Object.fromEntries(Object.entries(r).filter(([, v]) => v && v !== 'Not Applicable')),
    warning: r.ErrorCode && r.ErrorCode !== '0' ? r.ErrorText ?? null : null,
  };
}
