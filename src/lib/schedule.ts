// OEM schedule + repair-activity logic, ported from the owner simulator.
// Pure functions (no React / Supabase) so they are unit-tested in schedule.test.ts.
import type { RepairActivity, ServiceInterval, Vehicle } from './types.ts';

export const SOON_MI = 1500;
export const SOON_HRS = 75;
export const SOON_DAYS = 14;
export const RECENT_DAYS = 7; // "just got done" window; older closed work moves to repair history
const DAY_MS = 86_400_000;

export const OPEN_STATUSES = ['requested', 'estimate', 'scheduled', 'progress'] as const;
export const isOpen = (a: Pick<RepairActivity, 'status'>) => (OPEN_STATUSES as readonly string[]).includes(a.status);
export const isClosed = (a: Pick<RepairActivity, 'status'>) => a.status === 'done' || a.status === 'declined';

const fmtN = (n: number) => Math.round(n).toLocaleString('en-US');

export interface Due {
  mi: number;       // miles left (Infinity when the interval has no miles limit)
  hrs: number;      // engine hours left
  days: number;     // days left
  over: boolean;
  soon: boolean;
  by: 'miles' | 'hours' | 'days'; // which limit hits first
  lead: string;     // "in 640 mi" / "4,000 mi over"
  rank: number;     // comparable urgency in "miles" (lower = sooner)
}

/** Due state for one interval: miles / engine hours / time — whichever comes first. */
export function due(v: Pick<Vehicle, 'odometer_miles' | 'engine_hours' | 'avg_miles_per_day'>,
                    it: Pick<ServiceInterval, 'every_miles' | 'every_hours' | 'every_days' | 'last_done_miles' | 'last_done_hours' | 'last_done_on' | 'created_at'>,
                    today: Date = new Date()): Due {
  const mi = it.every_miles != null ? Number(it.last_done_miles) + it.every_miles - Number(v.odometer_miles) : Infinity;
  const hrs = it.every_hours != null ? Number(it.last_done_hours) + it.every_hours - Number(v.engine_hours) : Infinity;
  let days = Infinity;
  if (it.every_days != null) {
    const base = new Date((it.last_done_on ?? it.created_at.slice(0, 10)) + 'T00:00:00');
    days = Math.floor((base.getTime() + it.every_days * DAY_MS - startOfDay(today).getTime()) / DAY_MS);
  }
  // compare limits on a common scale: miles, using the truck's miles per engine hour / per day
  const mph = Number(v.odometer_miles) > 0 && Number(v.engine_hours) > 0 ? Number(v.odometer_miles) / Number(v.engine_hours) : 22;
  const mpd = Number(v.avg_miles_per_day) || 150;
  const scaled = { miles: mi, hours: hrs * mph, days: days * mpd };
  const by = (Object.keys(scaled) as (keyof typeof scaled)[]).reduce((a, b) => (scaled[b] < scaled[a] ? b : a), 'miles');
  const over = mi < 0 || hrs < 0 || days < 0;
  const soon = !over && (mi <= SOON_MI || hrs <= SOON_HRS || days <= SOON_DAYS);
  const lead =
    by === 'hours' ? (hrs < 0 ? `${fmtN(-hrs)} hrs over` : `in ${fmtN(hrs)} engine hrs`)
    : by === 'days' ? (days < 0 ? `${fmtN(-days)} days over` : `in ${fmtN(days)} days`)
    : mi < 0 ? `${fmtN(-mi)} mi over` : `in ${fmtN(mi)} mi`;
  return { mi, hrs, days, over, soon, by, lead, rank: scaled[by] };
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Projected due date from the truck's average daily miles. */
export function projectedDate(v: Vehicle, it: ServiceInterval, today: Date = new Date()): Date {
  const d = due(v, it, today);
  if (d.over) return startOfDay(today);
  const mpd = Number(v.avg_miles_per_day) || 150;
  const mph = Number(v.odometer_miles) > 0 && Number(v.engine_hours) > 0 ? Number(v.odometer_miles) / Number(v.engine_hours) : 22;
  const daysLeft = Math.min(d.mi / mpd, d.hrs / (mpd / mph), d.days);
  return new Date(startOfDay(today).getTime() + Math.max(1, Math.ceil(daysLeft)) * DAY_MS);
}

export interface Forecast {
  kind: 'forecast';
  interval: ServiceInterval;
  vehicle: Vehicle;
  due: Due;
  deferred?: RepairActivity; // owner deferred this recommendation
}

/** Confirmed intervals that are coming due or overdue and have no open repair activity. */
export function forecasts(vehicles: Vehicle[], intervals: ServiceInterval[], acts: RepairActivity[], today = new Date()): Forecast[] {
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const out: Forecast[] = [];
  for (const it of intervals) {
    if (it.status !== 'confirmed') continue;
    const v = byId.get(it.vehicle_id);
    if (!v) continue;
    if (acts.some((a) => a.interval_id === it.id && isOpen(a))) continue;
    const d = due(v, it, today);
    const deferred = acts.find((a) => a.interval_id === it.id && a.status === 'deferred');
    if (d.over || d.soon || deferred) out.push({ kind: 'forecast', interval: it, vehicle: v, due: d, deferred });
  }
  return out.sort((a, b) => a.due.rank - b.due.rank);
}

export const CATS = ['Ongoing', 'Upcoming', 'Overdue', 'Completed'] as const;
export type Cat = (typeof CATS)[number] | 'History';
export type Item = { kind: 'activity'; activity: RepairActivity } | Forecast;

/** Ongoing/Completed/History = repair activities. Upcoming/Overdue = OEM forecasts + deferred items. */
export function byCat(vehicles: Vehicle[], intervals: ServiceInterval[], acts: RepairActivity[], today = new Date()) {
  const g: Record<Cat, Item[]> = { Ongoing: [], Upcoming: [], Overdue: [], Completed: [], History: [] };
  const fc = forecasts(vehicles, intervals, acts, today);
  for (const a of acts) {
    if (a.status === 'deferred') {
      if (a.interval_id && fc.some((f) => f.deferred?.id === a.id)) continue; // shown via its forecast
      g.Upcoming.push({ kind: 'activity', activity: a });
    } else if (isClosed(a)) {
      const closed = new Date(a.completed_at ?? a.created_at);
      const age = (startOfDay(today).getTime() - startOfDay(closed).getTime()) / DAY_MS;
      g[age <= RECENT_DAYS ? 'Completed' : 'History'].push({ kind: 'activity', activity: a });
    } else {
      g.Ongoing.push({ kind: 'activity', activity: a });
    }
  }
  for (const f of fc) g[f.due.over ? 'Overdue' : 'Upcoming'].push(f);
  const order: Record<string, number> = { estimate: 0, requested: 1, scheduled: 2, progress: 3 };
  g.Ongoing.sort((x, y) => order[(x as { activity: RepairActivity }).activity.status] - order[(y as { activity: RepairActivity }).activity.status]);
  const closedAt = (x: Item) => (x.kind === 'activity' ? x.activity.completed_at ?? x.activity.created_at : '');
  g.Completed.sort((x, y) => closedAt(y).localeCompare(closedAt(x)));
  g.History.sort((x, y) => closedAt(y).localeCompare(closedAt(x)));
  return g;
}

export const STATUS: Record<RepairActivity['status'], { label: string; tone: Tone }> = {
  requested: { label: 'Requested', tone: 'grey' },
  estimate: { label: 'Needs approval', tone: 'amb' },
  scheduled: { label: 'Scheduled', tone: 'grey' },
  progress: { label: 'In progress', tone: 'blue' },
  done: { label: 'Completed', tone: 'grn' },
  declined: { label: 'Declined', tone: 'red' },
  deferred: { label: 'Deferred', tone: 'amb' },
};
export type Tone = 'blue' | 'amb' | 'red' | 'grn' | 'grey';

/** One-line service status for a truck (dashboard card). */
export function truckStatus(v: Vehicle, intervals: ServiceInterval[], acts: RepairActivity[], today = new Date()) {
  const mine = acts.filter((a) => a.vehicle_id === v.id);
  const pick = (st: RepairActivity['status']) => mine.find((a) => a.status === st);
  const prog = pick('progress'), est = pick('estimate'), sch = pick('scheduled'), req = pick('requested');
  const its = intervals.filter((i) => i.vehicle_id === v.id && i.status === 'confirmed');
  const fc = forecasts([v], its, mine, today);
  const fOver = fc.find((f) => f.due.over && !f.deferred), fSoon = fc.find((f) => f.due.soon && !f.deferred);
  const open = mine.filter(isOpen).length;
  const more = open > 1 ? ` (+${open - 1} more)` : '';
  if (prog) return { label: 'In repair', tone: 'blue' as Tone, line: `RA #${prog.id} · ${prog.title}${more}`, rank: 0 };
  if (est) return { label: 'Needs approval', tone: 'amb' as Tone, line: `RA #${est.id} · ${est.title}${more}`, rank: 1 };
  if (req && req.kind === 'breakdown') return { label: 'Breakdown', tone: 'red' as Tone, line: `RA #${req.id} · waiting for provider`, rank: 1 };
  if (fOver) return { label: 'Overdue', tone: 'red' as Tone, line: `${fOver.interval.task} · ${fOver.due.lead}`, rank: 2 };
  if (sch) return { label: 'Scheduled', tone: 'grey' as Tone, line: `RA #${sch.id} · ${sch.title}${sch.scheduled_for ? ' · ' + shortDate(sch.scheduled_for) : ''}`, rank: 3 };
  if (req) return { label: 'Requested', tone: 'grey' as Tone, line: `RA #${req.id} · waiting for estimate`, rank: 3 };
  if (fSoon) return { label: 'Due soon', tone: 'amb' as Tone, line: `${fSoon.interval.task} ${fSoon.due.lead}`, rank: 4 };
  if (!its.length) return { label: 'No schedule', tone: 'grey' as Tone, line: 'OEM schedule pending review', rank: 5 };
  const next = its.map((i) => ({ i, d: due(v, i, today) })).sort((a, b) => a.d.rank - b.d.rank)[0];
  return { label: 'No open work', tone: 'grn' as Tone, line: `Next: ${next.i.task} ${next.d.lead}`, rank: 5 };
}

export function shortDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso) : iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function counts(vehicles: Vehicle[], intervals: ServiceInterval[], acts: RepairActivity[], today = new Date()) {
  const g = byCat(vehicles, intervals, acts, today);
  const out = vehicles.filter((v) => !v.in_service).length;
  return { total: vehicles.length, inSvc: vehicles.length - out, outSvc: out,
    ongoing: g.Ongoing.length, upcoming: g.Upcoming.length, overdue: g.Overdue.length };
}

/** Days overdue / label for an invoice. */
export function invoiceState(inv: { status: string; due_on: string }, today = new Date()) {
  if (inv.status === 'paid') return { label: 'Paid', tone: 'grn' as Tone, late: false, daysLate: 0 };
  if (inv.status === 'processing') return { label: 'Processing', tone: 'blue' as Tone, late: false, daysLate: 0 };
  if (inv.status === 'void') return { label: 'Void', tone: 'grey' as Tone, late: false, daysLate: 0 };
  const daysLate = Math.floor((startOfDay(today).getTime() - new Date(inv.due_on + 'T00:00:00').getTime()) / DAY_MS);
  if (daysLate > 0) return { label: `${daysLate} days late`, tone: 'red' as Tone, late: true, daysLate };
  return { label: `Due ${shortDate(inv.due_on)}`, tone: 'amb' as Tone, late: false, daysLate };
}

/** Receivables aging buckets for open invoices. */
export function aging(invs: { status: string; due_on: string; total: number }[], today = new Date()) {
  const b: Record<'Current' | '1–30' | '31–60' | '60+', number> = { Current: 0, '1–30': 0, '31–60': 0, '60+': 0 };
  for (const i of invs) {
    if (i.status !== 'open') continue;
    const late = invoiceState(i, today).daysLate;
    const k = late <= 0 ? 'Current' : late <= 30 ? '1–30' : late <= 60 ? '31–60' : '60+';
    b[k] += Number(i.total);
  }
  return b;
}
