// Calendar interruptions: US holidays (computed, any year), weekends, and rain
// risk from the National Weather Service (free; next ~7 days).

export const RAIN_HIGH = 60;

export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const nthWeekday = (y: number, m: number, weekday: number, n: number) => {
  const first = new Date(y, m, 1);
  return new Date(y, m, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7);
};
const lastWeekday = (y: number, m: number, weekday: number) => {
  const last = new Date(y, m + 1, 0);
  return new Date(y, m, last.getDate() - ((last.getDay() - weekday + 7) % 7));
};

/** Holidays that interrupt service work (federal + the shop's common closures). */
export function holidays(year: number): Record<string, string> {
  const h: [Date, string][] = [
    [new Date(year, 0, 1), 'New Year’s Day'],
    [nthWeekday(year, 0, 1, 3), 'Martin Luther King Jr. Day'],
    [nthWeekday(year, 1, 1, 3), 'Presidents’ Day'],
    [lastWeekday(year, 4, 1), 'Memorial Day'],
    [new Date(year, 5, 19), 'Juneteenth'],
    [new Date(year, 6, 4), 'Independence Day'],
    [nthWeekday(year, 8, 1, 1), 'Labor Day'],
    [nthWeekday(year, 9, 1, 2), 'Columbus Day'],
    [new Date(year, 10, 11), 'Veterans Day'],
    [nthWeekday(year, 10, 4, 4), 'Thanksgiving'],
    [new Date(nthWeekday(year, 10, 4, 4).getTime() + 86_400_000), 'Day after Thanksgiving'],
    [new Date(year, 11, 24), 'Christmas Eve'],
    [new Date(year, 11, 25), 'Christmas Day'],
    [new Date(year, 11, 31), 'New Year’s Eve'],
  ];
  return Object.fromEntries(h.map(([d, n]) => [iso(d), n]));
}

export function holidayOn(d: Date): string | undefined {
  return holidays(d.getFullYear())[iso(d)];
}

export type RainMap = Record<string, number>; // ISO date -> % chance of precipitation

export interface Interruption { hol?: string; weekend: boolean; rain: number | null; rainy: boolean; blocked: boolean }

export function interruption(d: Date, rain: RainMap): Interruption {
  const hol = holidayOn(d);
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const r = rain[iso(d)] ?? null;
  const rainy = r != null && r >= RAIN_HIGH;
  return { hol, weekend, rain: r, rainy, blocked: !!hol || weekend || rainy };
}

/** First workable day on/after `from`, and the blocked days it skipped. */
export function nextWorkDay(from: Date, rain: RainMap): { day: Date; skipped: string[] } {
  let d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const skipped: string[] = [];
  for (let i = 0; i < 30; i++) {
    const it = interruption(d, rain);
    if (!it.blocked) break;
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    skipped.push(`${label}: ${it.hol ?? (it.weekend ? 'weekend' : `${it.rain}% rain`)}`);
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return { day: d, skipped };
}

const RALEIGH = { lat: 35.7796, lon: -78.6382 };
let rainCache: { key: string; at: number; data: RainMap } | null = null;

/** NWS forecast → max daytime precipitation chance per date. Empty map on any failure. */
export async function fetchRain(lat = RALEIGH.lat, lon = RALEIGH.lon): Promise<RainMap> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (rainCache && rainCache.key === key && Date.now() - rainCache.at < 3_600_000) return rainCache.data;
  try {
    const headers = { Accept: 'application/geo+json' };
    const p = await fetch(`https://api.weather.gov/points/${key}`, { headers }).then((r) => r.json());
    const url: string | undefined = p?.properties?.forecast;
    if (!url) return {};
    const f = await fetch(url, { headers }).then((r) => r.json());
    const out: RainMap = {};
    for (const period of f?.properties?.periods ?? []) {
      const day = String(period.startTime).slice(0, 10);
      const pct = period.probabilityOfPrecipitation?.value ?? 0;
      out[day] = Math.max(out[day] ?? 0, pct);
    }
    rainCache = { key, at: Date.now(), data: out };
    return out;
  } catch {
    return {};
  }
}
