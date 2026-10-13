-- Seed data for local dev / first deploy.
-- Intervals, rates and prices are SAMPLE values from the simulator, not OEM data.
-- Replace with intervals extracted from the OEM manuals before going live; each
-- one still has to be confirmed by Admin.

insert into public.organizations (id, type, name, status, signup_source, city, state)
values ('00000000-0000-0000-0000-000000000001', 'platform', 'Northgate Fleet Systems', 'active', 'admin', 'Raleigh', 'NC');

insert into public.organizations (id, type, name, status, signup_source, city, state, labor_rate, parts_markup_pct,
                                  primary_contact_name, latitude, longitude)
values ('00000000-0000-0000-0000-000000000002', 'provider', 'PG Heavy Duty', 'active', 'admin', 'Raleigh', 'NC', 150, 0,
        'Paul Ndichu', 35.7796, -78.6382);

insert into public.platform_settings (id, revenue_model, plan_fee_per_truck, platform_fee_bps, default_labor_rate,
                                      default_payment_terms_days, sales_tax_rate, default_provider_org_id)
values (true, 'subscription', 75, 0, 150, 15, 0, '00000000-0000-0000-0000-000000000002');

insert into public.plan_tiers (name, applies_to, unit, price_per_unit) values
  ('Fleet · per truck', 'fleet', 'truck', 75),
  ('Provider · per seat', 'provider', 'seat', 0),
  ('Vendor · per location', 'vendor', 'location', 0);

-- SAMPLE templates (generic, any make). Real OEM templates should be per make/model with source links.
insert into public.interval_templates (make, component_category, task, every_miles, every_hours, every_days,
                                       book_hours, est_parts_cost, source_ref, is_sample) values
  (null, 'Engine',       'Engine PM – oil & filters', 15000, 750,  null, 2.5, 185, 'SAMPLE — replace with OEM manual', true),
  (null, 'Chassis',      'Chassis lube & inspection', 10000, 500,  null, 1.0,  25, 'SAMPLE — replace with OEM manual', true),
  (null, 'Brakes / Air', 'Air dryer cartridge',       60000, null, null, 1.2,  96, 'SAMPLE — replace with OEM manual', true),
  (null, 'Transmission', 'Transmission service',     100000, null, null, 2.0, 265, 'SAMPLE — replace with OEM manual', true),
  (null, 'Hoist',        'Hoist hydraulic filter',    25000, 1200, null, 0.8,  72, 'SAMPLE — replace with OEM manual', true),
  (null, 'Inspection',   'DOT annual inspection',      null, null,  365, 1.5,   0, '49 CFR 396.17', true),
  (null, 'Inspection',   'Monthly in-depth inspection', null, null,  30, 2.0,   0, 'Northgate shop standard', true);
update public.interval_templates set inspection_type_key = 'annual' where task = 'DOT annual inspection';
update public.interval_templates set inspection_type_key = 'monthly' where task = 'Monthly in-depth inspection';

-- Shells Trucking — customer account 001 (Door 1, admin-created)
insert into public.organizations (id, type, name, account_number, status, signup_source, address_line1, city, state,
                                  postal_code, phone, service_location, customer_since, latitude, longitude, approved_at)
values ('00000000-0000-0000-0000-000000000101', 'fleet', 'Shells Trucking', '001', 'active', 'admin',
        '5735 New Bern Avenue', 'Raleigh', 'NC', '27610-9305', '(919) 395-0050',
        'Customer yard — 5735 New Bern Ave', current_date, 35.7905, -78.5600, now());

insert into public.org_relationships (manager_org_id, fleet_org_id)
values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000101');

insert into public.vehicles (id, fleet_org_id, unit_number, vin, year, make, model, body_type, odometer_miles,
                             engine_hours, avg_miles_per_day) values
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000101', 'ST1', '1FVSG5FEXMHMA3141', 2021, 'Freightliner', null,   'Dump', 151000,  6864, 180),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000101', 'ST2', '1NKZXPTX0NJ470825', 2022, 'Kenworth',     'T880', 'Dump', 118000,  5364, 170),
  ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000101', 'ST3', '1NKZXPTX9PJ242454', 2023, 'Kenworth',     'T880', 'Dump',  86000,  5548, 170),
  ('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000101', 'ST4', '5KKSBPDV6RLVD6166', 2024, 'Western Star', null,   'Dump',  52000,  2364, 160),
  ('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000101', 'ST5', '1NKZXPTX1TJ196564', 2026, 'Kenworth',     'T880', 'Dump',   9800,   700, 150),
  ('00000000-0000-0000-0001-000000000006', '00000000-0000-0000-0000-000000000101', 'ST6', '1NKZXPTX8JJ199989', 2018, 'Kenworth',     'T880', 'Dump', 262000, 11909, 170);

-- intervals per truck with "last done" points (sample), confirmed so the fleet is fully populated
with last(unit, task, miles) as (values
  ('ST1','Engine PM – oil & filters',140000),('ST1','Chassis lube & inspection',140700),('ST1','Air dryer cartridge',110000),('ST1','Transmission service',60000),('ST1','Hoist hydraulic filter',135000),
  ('ST2','Engine PM – oil & filters',103640),('ST2','Chassis lube & inspection',112000),('ST2','Air dryer cartridge',100000),('ST2','Transmission service',30000),('ST2','Hoist hydraulic filter',100000),
  ('ST3','Engine PM – oil & filters',75000),('ST3','Chassis lube & inspection',80000),('ST3','Air dryer cartridge',60000),('ST3','Transmission service',0),('ST3','Hoist hydraulic filter',70000),
  ('ST4','Engine PM – oil & filters',40000),('ST4','Chassis lube & inspection',45000),('ST4','Air dryer cartridge',0),('ST4','Transmission service',0),('ST4','Hoist hydraulic filter',27900),
  ('ST5','Engine PM – oil & filters',0),('ST5','Chassis lube & inspection',2000),('ST5','Air dryer cartridge',0),('ST5','Transmission service',0),('ST5','Hoist hydraulic filter',0),
  ('ST6','Engine PM – oil & filters',250000),('ST6','Chassis lube & inspection',255000),('ST6','Air dryer cartridge',201000),('ST6','Transmission service',180000),('ST6','Hoist hydraulic filter',250000)
)
insert into public.service_intervals (vehicle_id, component_category, task, every_miles, every_hours, book_hours,
  est_parts_cost, last_done_miles, last_done_hours, source_ref, status, confirmed_at)
select v.id, t.component_category, t.task, t.every_miles, t.every_hours, t.book_hours, t.est_parts_cost,
       l.miles, round(l.miles * v.engine_hours / nullif(v.odometer_miles, 0)), t.source_ref, 'confirmed', now()
from last l
join public.vehicles v on v.unit_number = l.unit and v.fleet_org_id = '00000000-0000-0000-0000-000000000101'
join public.interval_templates t on t.task = l.task;

-- inspection intervals per truck (time-based): annual done ~10 months ago, monthly ~3–5 weeks ago
insert into public.service_intervals (vehicle_id, component_category, task, every_days, book_hours, est_parts_cost,
  last_done_miles, last_done_hours, last_done_on, source_ref, inspection_type_key, status, confirmed_at)
select v.id, t.component_category, t.task, t.every_days, t.book_hours, t.est_parts_cost, v.odometer_miles, v.engine_hours,
       current_date - case t.inspection_type_key when 'annual' then 300 + (row_number() over (partition by t.task order by v.unit_number))::int * 9
                                                 else 20 + (row_number() over (partition by t.task order by v.unit_number))::int * 3 end,
       t.source_ref, t.inspection_type_key, 'confirmed', now()
from public.vehicles v cross join public.interval_templates t
where v.fleet_org_id = '00000000-0000-0000-0000-000000000101' and t.inspection_type_key is not null;

insert into public.meter_readings (vehicle_id, miles, hours, source, recorded_at)
select id, odometer_miles - avg_miles_per_day * 30, engine_hours - round(avg_miles_per_day * 30 / 22), 'manual', now() - interval '30 days'
from public.vehicles where fleet_org_id = '00000000-0000-0000-0000-000000000101'
union all
select id, odometer_miles, engine_hours, 'manual', now() from public.vehicles
where fleet_org_id = '00000000-0000-0000-0000-000000000101';

-- RA #1047: air dryer on ST6, overdue, approved and in progress
insert into public.repair_activities (id, fleet_org_id, provider_org_id, vehicle_id, interval_id, kind, category, status,
  title, component_category, labor_rate, scheduled_for, approved_at, started_at, due_at_miles)
select 1047, v.fleet_org_id, '00000000-0000-0000-0000-000000000002', v.id, s.id, 'pm', 'pm', 'progress',
       s.task, s.component_category, 150, current_date, now(), now(), s.last_done_miles + s.every_miles
from public.vehicles v join public.service_intervals s on s.vehicle_id = v.id
where v.unit_number = 'ST6' and s.task = 'Air dryer cartridge';

insert into public.estimate_lines (activity_id, kind, description, book_hours, quantity, unit_price, position) values
  (1047, 'labor', 'Labor · Air dryer cartridge (OEM book time)', 1.2, 1.2, 150, 0),
  (1047, 'part', 'Parts at cost · Brakes / Air', null, 1, 96, 1);
insert into public.activity_events (activity_id, text, created_at) values
  (1047, 'Flagged overdue by OEM schedule', now() - interval '2 hours'),
  (1047, 'Estimate approved by owner', now() - interval '90 minutes'),
  (1047, 'Tech on site, work started', now() - interval '1 hour');
update public.vehicles set in_service = false where unit_number = 'ST6';
insert into public.vehicle_downtime (vehicle_id, activity_id, started_at)
select id, 1047, now() - interval '1 hour' from public.vehicles where unit_number = 'ST6';

-- history example: chassis lube on ST6 completed 20 days ago, invoiced and paid
insert into public.repair_activities (id, fleet_org_id, provider_org_id, vehicle_id, interval_id, kind, category, status,
  title, component_category, labor_rate, scheduled_for, approved_at, started_at, completed_at, completed_miles,
  completed_hours, due_at_miles, created_at)
select 1046, v.fleet_org_id, '00000000-0000-0000-0000-000000000002', v.id, s.id, 'pm', 'pm', 'done',
       s.task, s.component_category, 150, current_date - 20, now() - interval '21 days', now() - interval '20 days',
       now() - interval '20 days', 255000, 11590, 265000, now() - interval '21 days'
from public.vehicles v join public.service_intervals s on s.vehicle_id = v.id
where v.unit_number = 'ST6' and s.task = 'Chassis lube & inspection';
insert into public.estimate_lines (activity_id, kind, description, book_hours, quantity, unit_price, position) values
  (1046, 'labor', 'Labor · Chassis lube & inspection (OEM book time)', 1.0, 1.0, 150, 0),
  (1046, 'part', 'Parts at cost · Chassis', null, 1, 25, 1);
insert into public.activity_events (activity_id, text, created_at) values
  (1046, 'Scheduled from the OEM schedule', now() - interval '21 days'),
  (1046, 'Completed · service report sent', now() - interval '20 days');

insert into public.invoices (id, kind, fleet_org_id, issuer_org_id, activity_id, vehicle_id, status, issued_on, due_on,
  memo, subtotal, total, paid_at, payment_method)
select '00000000-0000-0000-0002-000000000001', 'service', v.fleet_org_id, '00000000-0000-0000-0000-000000000002', 1046,
       v.id, 'paid', current_date - 20, current_date - 5, 'RA #1046 · Unit ST6 · Chassis lube & inspection', 175, 175,
       now() - interval '12 days', 'ach'
from public.vehicles v where v.unit_number = 'ST6';
insert into public.invoice_lines (invoice_id, line_type, description, vehicle_id, quantity, unit_price, position)
select '00000000-0000-0000-0002-000000000001'::uuid, 'labor'::public.estimate_line_kind, 'Labor · Chassis lube & inspection · 1.0 hrs book × $150', id, 1, 150, 0
from public.vehicles where unit_number = 'ST6'
union all
select '00000000-0000-0000-0002-000000000001'::uuid, 'part'::public.estimate_line_kind, 'Parts at cost · Chassis', id, 1, 25, 1
from public.vehicles where unit_number = 'ST6';
insert into public.payments (invoice_id, amount, method, received_at)
values ('00000000-0000-0000-0002-000000000001', 175, 'ach', now() - interval '12 days');

select setval(pg_get_serial_sequence('public.repair_activities', 'id'), 1047);
