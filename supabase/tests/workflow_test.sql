-- RLS + workflow assertions. Run via supabase/tests/run.sh.
\set ON_ERROR_STOP 1
\set admin   '''aaaaaaaa-0000-0000-0000-000000000001'''
\set owner   '''bbbbbbbb-0000-0000-0000-000000000001'''
\set selfy   '''cccccccc-0000-0000-0000-000000000001'''
\set outsider '''dddddddd-0000-0000-0000-000000000001'''
\set shells  '''00000000-0000-0000-0000-000000000101'''

-- users: admin bootstraps; the Shells owner arrives through an invitation (Door 1)
insert into auth.users (id, email) values (:admin, 'admin@northgate.test');
select public.bootstrap_platform_admin('admin@northgate.test');
insert into public.invitations (org_id, email, role) values (:shells, 'owner@shells.test', 'owner');
insert into auth.users (id, email, raw_user_meta_data) values (:owner, 'owner@shells.test', '{"full_name":"Shells Owner"}');
insert into auth.users (id, email) values (:selfy, 'new@fleet.test'), (:outsider, 'nobody@x.test');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false), set_config('role', 'authenticated', false);
$$;
create function pg_temp.reset() returns void language sql as $$
  select set_config('role', 'postgres', false), set_config('request.jwt.claim.sub', '', false);
$$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok - %', what; end $$;

-- ---------------------------------------------------------------- visibility
select pg_temp.as_user(:owner);
select pg_temp.check((select count(*) from vehicles) = 6, 'owner sees their 6 trucks');
select pg_temp.check((select count(*) from organizations where type = 'provider') = 1, 'owner sees their provider');
select pg_temp.check(not public.is_admin(), 'owner is not admin');
update repair_activities set status = 'done' where id = 1047;
select pg_temp.check((select status from repair_activities where id = 1047) = 'progress', 'owner cannot change activity status directly');
select pg_temp.reset();

select pg_temp.as_user(:outsider);
select pg_temp.check((select count(*) from vehicles) = 0, 'outsider sees no trucks');
select pg_temp.check((select count(*) from invoices) = 0, 'outsider sees no invoices');
select pg_temp.check((select count(*) from organizations) = 0, 'outsider sees no orgs');
select pg_temp.reset();

select pg_temp.as_user(:admin);
select pg_temp.check(public.is_admin(), 'admin is admin');
select pg_temp.check((select count(*) from organizations) >= 3, 'admin sees every org');
select pg_temp.reset();

-- ---------------------------------------------------------------- request -> estimate -> approve -> complete -> invoice
select pg_temp.as_user(:owner);
select set_config('t.ra', public.request_service('00000000-0000-0000-0001-000000000003', 'Brakes / air', 'This week', 'Air leak at rear axle')::text, false);
select pg_temp.check((select status from repair_activities where id = current_setting('t.ra')::bigint) = 'requested', 'request opens an RA');
do $$ begin
  perform public.send_estimate(current_setting('t.ra')::bigint, '[{"kind":"labor","description":"Labor","book_hours":2}]');
  raise exception 'owner was able to send an estimate';
exception when insufficient_privilege then raise notice 'ok - owner cannot send estimates';
end $$;
select pg_temp.reset();

select pg_temp.as_user(:admin);
select public.send_estimate(current_setting('t.ra')::bigint,
  '[{"kind":"labor","description":"Replace brake chamber","book_hours":2},{"kind":"part","description":"Brake chamber","part_number":"BC-3030","quantity":1,"unit_price":140}]');
select pg_temp.reset();

select pg_temp.as_user(:owner);
select pg_temp.check((select count(*) from notifications where activity_id = current_setting('t.ra')::bigint) >= 1, 'owner notified of estimate');
select public.approve_estimate(current_setting('t.ra')::bigint, current_date + 3);
select pg_temp.check((select status from repair_activities where id = current_setting('t.ra')::bigint) = 'scheduled', 'approve schedules it');
select pg_temp.reset();

select pg_temp.as_user(:admin);
select public.start_work(current_setting('t.ra')::bigint);
select pg_temp.check(not (select in_service from vehicles where unit_number = 'ST3'), 'truck out of service while in repair');
select set_config('t.inv', public.complete_activity(current_setting('t.ra')::bigint, 86500, 5580)::text, false);
select pg_temp.check((select in_service from vehicles where unit_number = 'ST3'), 'truck back in service');
select pg_temp.check((select total from invoices where id = current_setting('t.inv')::uuid) = 440, 'invoice = 2 hrs x 150 + 140 parts at cost');
select pg_temp.check((select count(*) from invoice_lines where invoice_id = current_setting('t.inv')::uuid) = 2, 'invoice has labor + parts lines');
select pg_temp.reset();

-- ---------------------------------------------------------------- OEM schedule: schedule + defer
select pg_temp.as_user(:owner);
select set_config('t.pm', public.schedule_interval(
  (select s.id from service_intervals s join vehicles v on v.id = s.vehicle_id where v.unit_number = 'ST2' and s.task like 'Engine PM%'))::text, false);
select pg_temp.check((select count(*) from estimate_lines where activity_id = current_setting('t.pm')::bigint) = 2, 'scheduled PM carries the OEM estimate');
select pg_temp.check((select status from repair_activities where id = current_setting('t.pm')::bigint) = 'scheduled', 'owner scheduling = approval');
select set_config('t.def', public.defer_interval(
  (select s.id from service_intervals s join vehicles v on v.id = s.vehicle_id where v.unit_number = 'ST1' and s.task like 'Transmission%'),
  'Waiting for slow season', current_date + 30)::text, false);
select pg_temp.check((select deferred_reason from repair_activities where id = current_setting('t.def')::bigint) = 'Waiting for slow season', 'deferral keeps the reason');
select pg_temp.check(jsonb_array_length(public.dot_file('00000000-0000-0000-0001-000000000001')->'deferred') = 1, 'deferral appears in the DOT file');
select pg_temp.reset();

-- ---------------------------------------------------------------- breakdown path
select pg_temp.as_user(:owner);
select set_config('t.bd', public.report_breakdown('00000000-0000-0000-0001-000000000004', 'Coolant leak, temp climbing',
  false, true, 35.8, -78.6, 'I-440 exit 14')::text, false);
select pg_temp.check(not (select in_service from vehicles where unit_number = 'ST4'), 'breakdown takes truck out of service');
select pg_temp.reset();
select pg_temp.as_user(:admin);
select pg_temp.check((select count(*) from notifications where activity_id = current_setting('t.bd')::bigint and urgent) >= 1, 'admin/provider paged urgently');
select public.send_estimate(current_setting('t.bd')::bigint, '[{"kind":"labor","description":"Replace hose","book_hours":1.5},{"kind":"part","description":"Hose","unit_price":65}]');
select pg_temp.check((select responded_at is not null from breakdowns where activity_id = current_setting('t.bd')::bigint), 'response time tracked');
select pg_temp.reset();
select pg_temp.as_user(:owner);
select public.approve_estimate(current_setting('t.bd')::bigint);
select pg_temp.check((select status from repair_activities where id = current_setting('t.bd')::bigint) = 'progress', 'approved breakdown dispatches immediately');
select pg_temp.reset();

-- ---------------------------------------------------------------- intervals gate
select pg_temp.as_user(:owner);
do $$ begin
  insert into service_intervals (vehicle_id, component_category, task, every_miles, status)
  values ('00000000-0000-0000-0001-000000000005', 'Engine', 'Sneaky confirmed', 1000, 'confirmed');
  raise exception 'owner inserted a confirmed interval';
exception when insufficient_privilege then raise notice 'ok - owner cannot self-confirm intervals';
end $$;
insert into service_intervals (vehicle_id, component_category, task, every_miles)
values ('00000000-0000-0000-0001-000000000005', 'Engine', 'Owner proposed check', 5000);
select pg_temp.check((select status from service_intervals where task = 'Owner proposed check') = 'draft', 'owner proposals start as drafts');
do $$ begin
  perform public.schedule_interval((select id from service_intervals where task = 'Owner proposed check'));
  raise exception 'scheduled an unconfirmed interval';
exception when insufficient_privilege then raise notice 'ok - drafts cannot be scheduled';
end $$;
select pg_temp.reset();
select pg_temp.as_user(:admin);
select pg_temp.check(public.confirm_intervals(array(select id from service_intervals where task = 'Owner proposed check')) = 1, 'admin confirms intervals');
select pg_temp.reset();

-- ---------------------------------------------------------------- Door 2: self-signup
select pg_temp.as_user(:selfy);
select set_config('t.org', public.self_signup_create_fleet('{"name":"Fresh Haulers LLC","city":"Durham"}')::text, false);
select pg_temp.check((select status from organizations where id = current_setting('t.org')::uuid) = 'pending', 'self-signup starts pending');
insert into vehicles (fleet_org_id, unit_number, vin, make) values (current_setting('t.org')::uuid, 'FH1', '1NKZXPTX0NJ470826', 'Kenworth');
select pg_temp.check(public.apply_interval_templates((select id from vehicles where unit_number = 'FH1')) = 7, 'templates build draft schedule');
select pg_temp.check((select count(*) from vehicles) = 1, 'new owner sees only their own truck');
select pg_temp.reset();
select pg_temp.as_user(:admin);
select public.admin_set_org_status(current_setting('t.org')::uuid, 'active');
select pg_temp.check((select account_number from organizations where id = current_setting('t.org')::uuid) = '002', 'approval assigns next account number');
select pg_temp.reset();

-- ---------------------------------------------------------------- billing + reporting
select pg_temp.as_user(:admin);
select pg_temp.check(public.generate_plan_invoices(date_trunc('month', current_date)::date) = 2, 'plan invoices for active fleets');
select pg_temp.check(public.generate_plan_invoices(date_trunc('month', current_date)::date) = 0, 'plan invoices are idempotent');
select pg_temp.check((select total from invoices where kind = 'plan' and fleet_org_id = :shells) = 450, 'plan = 6 trucks x $75');
select pg_temp.reset();
select pg_temp.as_user(:owner);
select pg_temp.check((public.fleet_report(:shells, current_date - 60, current_date)->'totals'->>'spend')::numeric > 0, 'fleet report totals spend');
select pg_temp.check(jsonb_array_length(public.fleet_report(:shells, current_date - 60, current_date)->'trucks') = 6, 'fleet report per truck');
select pg_temp.reset();
select pg_temp.as_user(:outsider);
do $$ begin
  perform public.fleet_report('00000000-0000-0000-0000-000000000101', current_date - 60, current_date);
  raise exception 'outsider read a fleet report';
exception when insufficient_privilege then raise notice 'ok - outsider cannot read reports';
end $$;
select pg_temp.reset();
select pg_temp.check((select count(*) from audit_log where table_name = 'repair_activities') > 0, 'audit log records changes');

-- ---------------------------------------------------------------- inspections
select pg_temp.check((select count(*) from inspection_items where type_key = 'annual') >= 40, 'vehicle inspection checklist loaded');
select pg_temp.check((select count(*) from inspection_items where type_key = 'monthly') >= 50, 'monthly in-depth checklist loaded');

select pg_temp.as_user(:owner);
select set_config('t.mi', public.schedule_interval(
  (select s.id from service_intervals s join vehicles v on v.id = s.vehicle_id where v.unit_number = 'ST5' and s.inspection_type_key = 'monthly'),
  current_date + 1)::text, false);
select pg_temp.check((select inspection_type_key = 'monthly' and category = 'inspection' from repair_activities where id = current_setting('t.mi')::bigint),
  'scheduled monthly inspection carries its type');
do $$ begin
  perform public.start_inspection(current_setting('t.mi')::bigint);
  raise exception 'owner started an inspection';
exception when insufficient_privilege then raise notice 'ok - owner cannot perform inspections';
end $$;
select pg_temp.reset();

select pg_temp.as_user(:admin);
do $$ begin
  perform public.complete_activity(current_setting('t.mi')::bigint);
  raise exception 'completed an inspection without its checklist';
exception when insufficient_privilege then raise notice 'ok - inspection activity needs a completed checklist';
end $$;
select set_config('t.insp', public.start_inspection(current_setting('t.mi')::bigint)::text, false);
select pg_temp.check(public.start_inspection(current_setting('t.mi')::bigint) = current_setting('t.insp')::bigint, 'start_inspection resumes the open checklist');
select pg_temp.check((select status from repair_activities where id = current_setting('t.mi')::bigint) = 'progress', 'starting the checklist starts the work');
-- answer everything as pass (with readings), then fail one critical item
select public.record_inspection_item(current_setting('t.insp')::bigint, id, 'pass', case when measure_unit is not null then '1' end)
from inspection_items where type_key = 'monthly' and label not like 'Hoist cylinder%';
do $$ begin
  perform public.complete_inspection(current_setting('t.insp')::bigint);
  raise exception 'completed with an item missing';
exception when insufficient_privilege then raise notice 'ok - every checklist item needs a result';
end $$;
do $$ begin
  perform public.record_inspection_item(current_setting('t.insp')::bigint,
    (select id from inspection_items where type_key = 'monthly' and label like 'Hoist cylinder%'), 'fail');
  raise exception 'failed an item without a note';
exception when insufficient_privilege then raise notice 'ok - a failed item needs a defect description';
end $$;
select public.record_inspection_item(current_setting('t.insp')::bigint,
  (select id from inspection_items where type_key = 'monthly' and label like 'Hoist cylinder%'), 'fail', null, 'Rod seal leaking, pin worn');
select set_config('t.res', public.complete_inspection(current_setting('t.insp')::bigint, 9900, 710, 'Paul Ndichu')::text, false);
select pg_temp.check(not (current_setting('t.res')::jsonb->>'passed')::boolean, 'failed item fails the inspection');
select pg_temp.check((select status from repair_activities where id = current_setting('t.mi')::bigint) = 'done', 'inspection activity completed');
select pg_temp.check(exists (select 1 from invoices where activity_id = current_setting('t.mi')::bigint), 'inspection invoiced');
select pg_temp.check((select last_done_on from service_intervals s join vehicles v on v.id = s.vehicle_id
                      where v.unit_number = 'ST5' and s.inspection_type_key = 'monthly') = current_date, 'monthly interval reset');
select pg_temp.check((select status = 'requested' and urgency = 'Out of service' and description like '%Rod seal%'
                      from repair_activities where id = (current_setting('t.res')::jsonb->>'defects_activity_id')::bigint),
  'critical failure opens an out-of-service defects activity');
select pg_temp.check(not (select in_service from vehicles where unit_number = 'ST5'), 'critical defect keeps the truck out of service');
select pg_temp.reset();

select pg_temp.as_user(:owner);
select pg_temp.check((select count(*) from inspection_results where inspection_id = current_setting('t.insp')::bigint) > 50, 'owner can read inspection results');
select pg_temp.check(jsonb_array_length(public.dot_file('00000000-0000-0000-0001-000000000005')->'inspections') = 1, 'inspection appears in the DOT file');
do $$ begin
  perform public.record_inspection_item(current_setting('t.insp')::bigint, (select id from inspection_items limit 1), 'pass');
  raise exception 'owner edited results';
exception when insufficient_privilege then raise notice 'ok - owner cannot edit results';
end $$;
select set_config('t.req', public.request_service('00000000-0000-0000-0001-000000000002', 'DOT inspection', 'This week', null)::text, false);
select pg_temp.check((select inspection_type_key from repair_activities where id = current_setting('t.req')::bigint) = 'annual', 'requested DOT inspection becomes a vehicle inspection');
select pg_temp.reset();
