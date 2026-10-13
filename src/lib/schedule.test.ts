/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aging, byCat, due, forecasts, invoiceState, truckStatus } from './schedule.ts';
import { holidays, nextWorkDay } from './calendar.ts';
import { vinProblem } from './vin.ts';
import type { RepairActivity, ServiceInterval, Vehicle } from './types.ts';

const today = new Date(2026, 9, 12);
const truck = (o: Partial<Vehicle> = {}): Vehicle => ({
  id: 'v1', fleet_org_id: 'f', unit_number: 'ST2', vin: '1NKZXPTX0NJ470825', year: 2022, make: 'Kenworth', model: 'T880',
  body_type: null, engine: null, transmission: null, gvwr: null, plate: null, plate_state: null, driver_name: null,
  in_service: true, odometer_miles: 118000, engine_hours: 5364, avg_miles_per_day: 170, vin_decoded: null, ...o,
});
const interval = (o: Partial<ServiceInterval> = {}): ServiceInterval => ({
  id: 'i1', vehicle_id: 'v1', component_category: 'Engine', task: 'Engine PM', every_miles: 15000, every_hours: 750,
  every_days: null, book_hours: 2.5, est_parts_cost: 185, last_done_miles: 103640, last_done_hours: 4711,
  last_done_on: null, source_ref: null, source_url: null, status: 'confirmed', confirmed_at: null, inspection_type_key: null,
  created_at: '2026-01-01T00:00:00Z', ...o,
});
const act = (o: Partial<RepairActivity> = {}): RepairActivity => ({
  id: 1047, fleet_org_id: 'f', provider_org_id: null, vehicle_id: 'v1', interval_id: null, kind: 'request',
  category: 'repair', status: 'requested', title: 'Air leak', component_category: 'Brakes', description: null,
  urgency: null, scheduled_for: null, approved_at: null, started_at: null, completed_at: null, completed_miles: null,
  declined_reason: null, deferred_reason: null, deferred_until: null, labor_rate: 150, inspection_type_key: null, created_at: '2026-10-10T00:00:00Z', ...o,
});

test('due: miles limit coming up first', () => {
  const d = due(truck(), interval(), today);
  assert.equal(d.mi, 640);
  assert.equal(d.soon, true);
  assert.equal(d.over, false);
  assert.equal(d.lead, 'in 640 mi');
});

test('due: engine hours can hit first', () => {
  const d = due(truck({ odometer_miles: 100000, engine_hours: 5500 }), interval({ last_done_miles: 95000, last_done_hours: 4700 }), today);
  assert.equal(d.by, 'hours');
  assert.equal(d.over, true);
  assert.match(d.lead, /hrs over/);
});

test('due: time-based interval (annual inspection)', () => {
  const d = due(truck(), interval({ every_miles: null, every_hours: null, every_days: 365, last_done_on: '2025-10-01' }), today);
  assert.equal(d.by, 'days');
  assert.equal(d.over, true);
  assert.equal(d.days, -11);
});

test('forecasts skip intervals with open work and drafts', () => {
  assert.equal(forecasts([truck()], [interval()], [], today).length, 1);
  assert.equal(forecasts([truck()], [interval()], [act({ interval_id: 'i1', status: 'scheduled' })], today).length, 0);
  assert.equal(forecasts([truck()], [interval({ status: 'draft' })], [], today).length, 0);
});

test('byCat groups activities and forecasts like the simulator', () => {
  const g = byCat([truck()], [interval()], [
    act({ id: 1, status: 'progress' }),
    act({ id: 2, status: 'done', completed_at: '2026-10-10T12:00:00Z' }),
    act({ id: 3, status: 'done', completed_at: '2026-09-01T12:00:00Z' }),
  ], today);
  assert.equal(g.Ongoing.length, 1);
  assert.equal(g.Upcoming.length, 1);
  assert.equal(g.Completed.length, 1);
  assert.equal(g.History.length, 1);
});

test('deferred recommendation stays visible as a forecast reminder', () => {
  const g = byCat([truck()], [interval()], [act({ id: 9, interval_id: 'i1', status: 'deferred', deferred_reason: 'cash flow' })], today);
  assert.equal(g.Upcoming.length, 1);
  const f = g.Upcoming[0];
  assert.equal(f.kind, 'forecast');
  assert.equal(f.kind === 'forecast' && f.deferred?.id, 9);
});

test('truckStatus prefers in-progress work', () => {
  const s = truckStatus(truck(), [interval()], [act({ status: 'progress', title: 'Air dryer' })], today);
  assert.equal(s.label, 'In repair');
});

test('invoice state and aging', () => {
  assert.equal(invoiceState({ status: 'open', due_on: '2026-10-01' }, today).label, '11 days late');
  const b = aging([{ status: 'open', due_on: '2026-10-20', total: 100 }, { status: 'open', due_on: '2026-08-01', total: 50 }], today);
  assert.equal(b.Current, 100);
  assert.equal(b['60+'], 50);
});

test('calendar: holidays and next work day', () => {
  assert.equal(holidays(2026)['2026-11-26'], 'Thanksgiving');
  assert.equal(holidays(2026)['2026-10-12'], 'Columbus Day');
  const r = nextWorkDay(new Date(2026, 9, 10), { '2026-10-13': 80 }); // Sat -> Sun -> Mon holiday -> Tue rain -> Wed
  assert.equal(r.day.getDate(), 14);
  assert.equal(r.skipped.length, 4);
});

test('VIN check digit', () => {
  assert.equal(vinProblem('1NKZXPTX0NJ470825'), null);
  assert.equal(vinProblem('1FVSG5FEXMHMA3141'), null);
  assert.match(vinProblem('1NKZXPTX1NJ470825') ?? '', /Check digit/);
  assert.match(vinProblem('123') ?? '', /17 characters/);
});
