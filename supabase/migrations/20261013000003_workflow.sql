-- Workflow RPCs. All state changes for repair activities, onboarding and billing
-- go through these security-definer functions so the rules hold no matter which
-- client calls them:
--   * Admin holds the gate: self-signups start pending; intervals start as drafts.
--   * The owner approves every repair (estimate -> approve / decline / defer).
--   * Completion produces the invoice (labor = book hrs x rate, parts at cost).

-- ---------------------------------------------------------------- internals
create or replace function public._require(p_ok boolean, p_msg text default 'not allowed')
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_msg using errcode = '42501'; end if;
end $$;

create or replace function public._settings()
returns public.platform_settings language sql stable security definer set search_path = public as $$
  select * from platform_settings where id;
$$;

create or replace function public._add_event(p_activity bigint, p_text text)
returns void language sql security definer set search_path = public as $$
  insert into activity_events (activity_id, actor_id, text) values (p_activity, auth.uid(), p_text);
$$;

-- notify every member of an org
create or replace function public._notify_org(
  p_org uuid, p_title text, p_body text default null, p_urgent boolean default false,
  p_activity bigint default null, p_interval uuid default null, p_invoice uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, org_id, title, body, urgent, activity_id, interval_id, invoice_id)
  select m.user_id, p_org, p_title, p_body, p_urgent, p_activity, p_interval, p_invoice
  from memberships m where m.org_id = p_org;
$$;

-- notify platform admins (in stage one Admin also runs PG Heavy Duty's work queue)
create or replace function public._notify_admins(
  p_title text, p_body text default null, p_urgent boolean default false,
  p_activity bigint default null, p_org uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, org_id, title, body, urgent, activity_id)
  select m.user_id, p_org, p_title, p_body, p_urgent, p_activity
  from memberships m join organizations o on o.id = m.org_id
  where o.type = 'platform' and m.role = 'admin';
$$;

-- provider side of an activity: provider org members + admins (deduplicated)
create or replace function public._notify_provider(
  p_activity bigint, p_title text, p_body text default null, p_urgent boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_provider uuid; v_fleet uuid;
begin
  select provider_org_id, fleet_org_id into v_provider, v_fleet from repair_activities where id = p_activity;
  insert into notifications (user_id, org_id, title, body, urgent, activity_id)
  select distinct m.user_id, v_fleet, p_title, p_body, p_urgent, p_activity
  from memberships m join organizations o on o.id = m.org_id
  where (m.org_id = v_provider) or (o.type = 'platform' and m.role = 'admin');
end $$;

create or replace function public._labor_rate(p_provider uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select labor_rate from organizations where id = p_provider), (select default_labor_rate from platform_settings where id));
$$;

create or replace function public._default_provider(p_fleet uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.manager_org_id from org_relationships r join organizations o on o.id = r.manager_org_id
     where r.fleet_org_id = p_fleet and o.type = 'provider' limit 1),
    (select default_provider_org_id from platform_settings where id));
$$;

-- next weekday that is not a US federal holiday observed by the shop (rain is checked client-side)
create or replace function public.next_work_day(p_from date)
returns date language plpgsql immutable as $$
declare d date := p_from;
begin
  while extract(isodow from d) in (6, 7)
     or to_char(d, 'MM-DD') in ('01-01', '07-04', '11-11', '12-24', '12-25', '12-31') loop
    d := d + 1;
  end loop;
  return d;
end $$;

create or replace function public._out_of_service(p_vehicle uuid, p_activity bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update vehicles set in_service = false where id = p_vehicle;
  if not exists (select 1 from vehicle_downtime where vehicle_id = p_vehicle and ended_at is null) then
    insert into vehicle_downtime (vehicle_id, activity_id) values (p_vehicle, p_activity);
  end if;
end $$;

create or replace function public._back_in_service(p_vehicle uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- stay down while any other work keeps the truck in the shop
  if exists (select 1 from repair_activities a
             where a.vehicle_id = p_vehicle and a.status = 'progress') then return; end if;
  if exists (select 1 from repair_activities a
             where a.vehicle_id = p_vehicle and a.kind = 'breakdown' and a.status in ('requested', 'estimate', 'scheduled')) then return; end if;
  update vehicles set in_service = true where id = p_vehicle;
  update vehicle_downtime set ended_at = now() where vehicle_id = p_vehicle and ended_at is null;
end $$;

-- ---------------------------------------------------------------- onboarding
-- Door 1: Admin creates the company shell (white-glove).
create or replace function public.admin_create_customer(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_provider uuid := (select default_provider_org_id from platform_settings where id);
begin
  perform _require(is_admin(), 'admin only');
  insert into organizations (type, name, account_number, status, signup_source, address_line1, city, state,
                             postal_code, phone, email, usdot_number, primary_contact_name, primary_contact_title,
                             billing_contact, service_location, customer_since, approved_at, approved_by)
  values ('fleet', p->>'name', nullif(p->>'account_number', ''), 'active', 'admin', p->>'address_line1', p->>'city',
          coalesce(nullif(p->>'state', ''), 'NC'), p->>'postal_code', p->>'phone', p->>'email', p->>'usdot_number',
          p->>'primary_contact_name', p->>'primary_contact_title', p->>'billing_contact', p->>'service_location',
          current_date, now(), auth.uid())
  returning id into v_id;
  if v_provider is not null then
    insert into org_relationships (manager_org_id, fleet_org_id) values (v_provider, v_id);
  end if;
  return v_id;
end $$;

-- Door 2: a fleet owner signs up and creates their own (pending/trial) company.
create or replace function public.self_signup_create_fleet(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_provider uuid := (select default_provider_org_id from platform_settings where id);
begin
  perform _require(auth.uid() is not null, 'sign in first');
  perform _require(not exists (
    select 1 from memberships m join organizations o on o.id = m.org_id
    where m.user_id = auth.uid() and o.type = 'fleet'), 'you already have a fleet account');
  insert into organizations (type, name, status, signup_source, address_line1, city, state, postal_code, phone,
                             email, usdot_number, primary_contact_name, trial_ends_at, customer_since)
  values ('fleet', p->>'name', 'pending', 'self', p->>'address_line1', p->>'city', coalesce(nullif(p->>'state', ''), 'NC'),
          p->>'postal_code', p->>'phone', coalesce(p->>'email', auth.jwt()->>'email'), p->>'usdot_number',
          p->>'primary_contact_name', current_date + (select trial_days from platform_settings where id), current_date)
  returning id into v_id;
  insert into memberships (user_id, org_id, role) values (auth.uid(), v_id, 'owner');
  if v_provider is not null then
    insert into org_relationships (manager_org_id, fleet_org_id) values (v_provider, v_id);
  end if;
  perform _notify_admins('New fleet signup awaiting approval', (p->>'name') || ' signed up and is in trial.', false, null, v_id);
  return v_id;
end $$;

create or replace function public.admin_set_org_status(p_org uuid, p_status public.org_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require(is_admin(), 'admin only');
  update organizations set status = p_status,
    approved_at = case when p_status = 'active' then now() else approved_at end,
    approved_by = case when p_status = 'active' then auth.uid() else approved_by end,
    account_number = coalesce(account_number, case when p_status = 'active'
      then lpad((select coalesce(max(nullif(regexp_replace(account_number, '\D', '', 'g'), '')::int), 0) + 1
                 from organizations where type = 'fleet')::text, 3, '0') end)
  where id = p_org;
  if p_status = 'active' then
    perform _notify_org(p_org, 'Your account is approved', 'Northgate Fleet Systems approved your fleet account.');
  end if;
end $$;

-- Owner edits their company's contact details (not status, billing or approvals).
create or replace function public.update_my_company(p_org uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require(is_fleet_owner(p_org) or is_admin());
  update organizations set
    name = coalesce(nullif(p->>'name', ''), name),
    address_line1 = coalesce(p->>'address_line1', address_line1),
    city = coalesce(p->>'city', city),
    state = coalesce(p->>'state', state),
    postal_code = coalesce(p->>'postal_code', postal_code),
    phone = coalesce(p->>'phone', phone),
    email = coalesce(p->>'email', email),
    usdot_number = coalesce(p->>'usdot_number', usdot_number),
    primary_contact_name = coalesce(p->>'primary_contact_name', primary_contact_name),
    primary_contact_title = coalesce(p->>'primary_contact_title', primary_contact_title),
    billing_contact = coalesce(p->>'billing_contact', billing_contact),
    service_location = coalesce(p->>'service_location', service_location)
  where id = p_org;
end $$;

-- ---------------------------------------------------------------- OEM schedules
-- Build draft intervals for a truck from the template library (matched by make/model).
create or replace function public.apply_interval_templates(p_vehicle uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v vehicles; n int;
begin
  select * into v from vehicles where id = p_vehicle;
  perform _require(v.id is not null and (can_work_fleet(v.fleet_org_id) or is_fleet_owner(v.fleet_org_id)));
  insert into service_intervals (vehicle_id, component_category, task, every_miles, every_hours, every_days,
                                 book_hours, est_parts_cost, last_done_miles, last_done_hours, source_ref, source_url, status)
  select v.id, t.component_category, t.task, t.every_miles, t.every_hours, t.every_days, t.book_hours,
         t.est_parts_cost, v.odometer_miles, v.engine_hours, t.source_ref, t.source_url, 'draft'
  from interval_templates t
  where (t.make is null or lower(t.make) = lower(v.make))
    and (t.model is null or lower(t.model) = lower(v.model))
    and not exists (select 1 from service_intervals s where s.vehicle_id = v.id and lower(s.task) = lower(t.task)
                    and s.status <> 'retired')
    -- a make-specific template wins over the generic one for the same task
    and not (t.make is null and exists (select 1 from interval_templates t2
             where lower(t2.make) = lower(v.make) and lower(t2.task) = lower(t.task)));
  get diagnostics n = row_count;
  return n;
end $$;

-- Admin reviews/confirms each interval before it goes live.
create or replace function public.confirm_intervals(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int; v_fleet uuid;
begin
  perform _require(bool_and(can_work_fleet(vehicle_fleet(s.vehicle_id))), 'admin only')
    from service_intervals s where s.id = any(p_ids);
  update service_intervals set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
  where id = any(p_ids) and status = 'draft';
  get diagnostics n = row_count;
  for v_fleet in select distinct vehicle_fleet(vehicle_id) from service_intervals where id = any(p_ids) loop
    perform _notify_org(v_fleet, 'OEM schedule confirmed', n || ' service interval(s) reviewed and now live.');
  end loop;
  return n;
end $$;

-- Meter reading (manual / service visit now; telematics later) + schedule check.
create or replace function public.record_meter(p_vehicle uuid, p_miles numeric, p_hours numeric, p_source text default 'manual')
returns void language plpgsql security definer set search_path = public as $$
declare v vehicles;
begin
  select * into v from vehicles where id = p_vehicle;
  perform _require(v.id is not null and (can_work_fleet(v.fleet_org_id) or is_fleet_owner(v.fleet_org_id)));
  insert into meter_readings (vehicle_id, miles, hours, source, recorded_by)
  values (p_vehicle, p_miles, p_hours, p_source, auth.uid());
  update vehicles set
    odometer_miles = greatest(odometer_miles, coalesce(p_miles, odometer_miles)),
    engine_hours = greatest(engine_hours, coalesce(p_hours, engine_hours))
  where id = p_vehicle;
  perform check_intervals(p_vehicle);
end $$;

-- Flag confirmed intervals that are coming due / overdue (miles, engine hours or time;
-- whichever comes first) and notify once per state change. Runs daily via pg_cron too.
create or replace function public.check_intervals(p_vehicle uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_state text; n int := 0;
begin
  perform _require(auth.uid() is null or is_admin()
                   or (p_vehicle is not null and can_see_fleet(vehicle_fleet(p_vehicle))));
  for r in
    select s.*, v.unit_number, v.fleet_org_id,
      case when s.every_miles is not null then s.last_done_miles + s.every_miles - v.odometer_miles end as mi_left,
      case when s.every_hours is not null then s.last_done_hours + s.every_hours - v.engine_hours end as hrs_left,
      case when s.every_days is not null then (coalesce(s.last_done_on, s.created_at::date) + s.every_days) - current_date end as days_left
    from service_intervals s join vehicles v on v.id = s.vehicle_id
    where s.status = 'confirmed' and (p_vehicle is null or s.vehicle_id = p_vehicle)
      and not exists (select 1 from repair_activities a where a.interval_id = s.id
                      and a.status in ('requested', 'estimate', 'scheduled', 'progress'))
  loop
    v_state := case
      when r.mi_left < 0 or r.hrs_left < 0 or r.days_left < 0 then 'over'
      when r.mi_left <= 1500 or r.hrs_left <= 75 or r.days_left <= 14 then 'soon'
      else null end;
    if v_state is distinct from r.notified_state then
      update service_intervals set notified_state = v_state where id = r.id;
      if v_state is not null then
        perform _notify_org(r.fleet_org_id,
          (case v_state when 'over' then 'Overdue: ' else 'Coming due: ' end) || 'Unit ' || r.unit_number || ' · ' || r.task,
          'Tap to schedule it.', false, null, r.id);
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- repair activities
create or replace function public._new_activity(
  p_vehicle uuid, p_kind public.activity_kind, p_category public.activity_category, p_status public.activity_status,
  p_title text, p_component text, p_description text, p_urgency text, p_interval uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v vehicles; v_provider uuid; v_id bigint;
begin
  select * into v from vehicles where id = p_vehicle;
  v_provider := _default_provider(v.fleet_org_id);
  insert into repair_activities (fleet_org_id, provider_org_id, vehicle_id, interval_id, kind, category, status,
                                 title, component_category, description, urgency, labor_rate, created_by)
  values (v.fleet_org_id, v_provider, v.id, p_interval, p_kind, p_category, p_status, p_title,
          coalesce(p_component, 'General'), p_description, p_urgency, _labor_rate(v_provider), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- estimate lines for an OEM interval: labor = book hrs x rate; parts at cost
create or replace function public._lines_from_interval(p_activity bigint, p_interval uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s service_intervals; a repair_activities;
begin
  select * into s from service_intervals where id = p_interval;
  select * into a from repair_activities where id = p_activity;
  delete from estimate_lines where activity_id = p_activity;
  insert into estimate_lines (activity_id, kind, description, book_hours, quantity, unit_price, position) values
    (p_activity, 'labor', 'Labor · ' || s.task || ' (OEM book time)', s.book_hours, s.book_hours, a.labor_rate, 0),
    (p_activity, 'part', 'Parts at cost · ' || s.component_category, null, 1, s.est_parts_cost, 1);
end $$;

-- Owner (or admin) asks for service.
create or replace function public.request_service(p_vehicle uuid, p_issue text, p_urgency text, p_description text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v vehicles; v_id bigint; v_cat public.activity_category; v_kind public.activity_kind := 'request';
begin
  select * into v from vehicles where id = p_vehicle;
  perform _require(v.id is not null and (is_fleet_owner(v.fleet_org_id) or can_work_fleet(v.fleet_org_id)));
  v_cat := case p_issue when 'Scheduled PM' then 'pm' when 'Tires' then 'tires' when 'DOT inspection' then 'inspection'
                        when 'Breakdown' then 'breakdown' else 'repair' end;
  if p_urgency = 'Truck down' then v_kind := 'breakdown'; v_cat := 'breakdown'; end if;
  v_id := _new_activity(p_vehicle, v_kind, v_cat, 'requested', p_issue, p_issue, p_description, p_urgency);
  perform _add_event(v_id, 'Service requested (' || lower(coalesce(p_urgency, 'no rush')) || ')');
  if p_urgency = 'Truck down' then perform _out_of_service(p_vehicle, v_id); end if;
  perform _notify_provider(v_id, 'Service request: Unit ' || v.unit_number || ' · ' || p_issue,
                           coalesce(p_description, ''), p_urgency = 'Truck down');
  return v_id;
end $$;

-- Roadside / emergency: urgent activity that skips the scheduler and pages the provider (push + SMS).
create or replace function public.report_breakdown(
  p_vehicle uuid, p_symptoms text, p_driveable boolean, p_needs_tow boolean,
  p_latitude double precision default null, p_longitude double precision default null, p_location_text text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v vehicles; v_id bigint;
begin
  select * into v from vehicles where id = p_vehicle;
  perform _require(v.id is not null and (is_fleet_owner(v.fleet_org_id) or can_work_fleet(v.fleet_org_id)));
  v_id := _new_activity(p_vehicle, 'breakdown', 'breakdown', 'requested', 'Breakdown · ' || left(p_symptoms, 60),
                        'General', p_symptoms, 'Truck down');
  insert into breakdowns (activity_id, latitude, longitude, location_text, symptoms, driveable, needs_tow, tow_called_at)
  values (v_id, p_latitude, p_longitude, p_location_text, p_symptoms, p_driveable, p_needs_tow,
          case when p_needs_tow then now() end);
  perform _add_event(v_id, 'Breakdown reported' || case when p_needs_tow then ' · tow requested'
                                                        when p_driveable then ' · driveable' else ' · not driveable' end);
  if not p_driveable or p_needs_tow then perform _out_of_service(p_vehicle, v_id); end if;
  perform _notify_provider(v_id, 'BREAKDOWN · Unit ' || v.unit_number,
    p_symptoms || coalesce(' · ' || p_location_text, '') ||
    case when p_needs_tow then ' · needs tow' when p_driveable then ' · driveable' else ' · not driveable' end, true);
  return v_id;
end $$;

-- Owner schedules a coming-due / overdue OEM item: scheduling = approving the OEM estimate.
create or replace function public.schedule_interval(p_interval uuid, p_date date default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare s service_intervals; v vehicles; v_id bigint; v_date date := coalesce(p_date, next_work_day(current_date + 1));
begin
  select * into s from service_intervals where id = p_interval;
  select * into v from vehicles where id = s.vehicle_id;
  perform _require(s.status = 'confirmed', 'this interval has not been confirmed yet');
  perform _require(is_fleet_owner(v.fleet_org_id) or can_work_fleet(v.fleet_org_id));
  perform _require(not exists (select 1 from repair_activities where interval_id = s.id
                   and status in ('requested', 'estimate', 'scheduled', 'progress')), 'already has an open repair activity');
  v_id := _new_activity(v.id, 'pm', 'pm', 'scheduled', s.task, s.component_category, null, null, s.id);
  update repair_activities set scheduled_for = v_date, approved_by = auth.uid(), approved_at = now(),
    due_at_miles = case when s.every_miles is not null then s.last_done_miles + s.every_miles end,
    due_at_hours = case when s.every_hours is not null then s.last_done_hours + s.every_hours end
  where id = v_id;
  -- a previously deferred recommendation for this interval is now superseded
  update repair_activities set status = 'declined', declined_reason = 'Superseded by RA #' || v_id
  where interval_id = s.id and status = 'deferred';
  perform _lines_from_interval(v_id, s.id);
  perform _add_event(v_id, 'Scheduled from the OEM schedule for ' || to_char(v_date, 'Mon DD'));
  perform _notify_provider(v_id, 'Scheduled: Unit ' || v.unit_number || ' · ' || s.task, to_char(v_date, 'Mon DD'));
  return v_id;
end $$;

-- Owner defers a recommended OEM item with a reason (stays visible; appears in the DOT file).
create or replace function public.defer_interval(p_interval uuid, p_reason text, p_until date default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare s service_intervals; v vehicles; v_id bigint;
begin
  select * into s from service_intervals where id = p_interval;
  select * into v from vehicles where id = s.vehicle_id;
  perform _require(is_fleet_owner(v.fleet_org_id) or is_admin());
  perform _require(coalesce(trim(p_reason), '') <> '', 'a reason is required to defer');
  v_id := _new_activity(v.id, 'pm', 'pm', 'deferred', s.task, s.component_category, null, null, s.id);
  update repair_activities set deferred_reason = p_reason, deferred_at = now(), deferred_until = p_until,
    due_at_miles = case when s.every_miles is not null then s.last_done_miles + s.every_miles end,
    due_at_hours = case when s.every_hours is not null then s.last_done_hours + s.every_hours end
  where id = v_id;
  perform _lines_from_interval(v_id, s.id);
  perform _add_event(v_id, 'Deferred by owner: ' || p_reason);
  return v_id;
end $$;

-- Provider (Admin in stage one) sends or revises an estimate.
-- p_lines: [{kind, description, part_number?, book_hours?, quantity, unit_price}]
create or replace function public.send_estimate(p_activity bigint, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a repair_activities; v vehicles;
begin
  select * into a from repair_activities where id = p_activity;
  perform _require(can_work_fleet(a.fleet_org_id), 'provider only');
  perform _require(a.status in ('requested', 'estimate', 'deferred'), 'estimate cannot be changed at this stage');
  perform _require(jsonb_array_length(p_lines) > 0, 'add at least one line');
  select * into v from vehicles where id = a.vehicle_id;
  delete from estimate_lines where activity_id = p_activity;
  insert into estimate_lines (activity_id, kind, description, part_number, book_hours, quantity, unit_price, position)
  select p_activity, (l->>'kind')::estimate_line_kind, l->>'description', l->>'part_number',
         (l->>'book_hours')::numeric,
         coalesce((l->>'quantity')::numeric, (l->>'book_hours')::numeric, 1),
         coalesce((l->>'unit_price')::numeric, case when l->>'kind' = 'labor' then a.labor_rate else 0 end),
         ord::int
  from jsonb_array_elements(p_lines) with ordinality as x(l, ord);
  update repair_activities set status = 'estimate' where id = p_activity;
  if a.kind = 'breakdown' then
    update breakdowns set responded_at = coalesce(responded_at, now()) where activity_id = p_activity;
  end if;
  perform _add_event(p_activity, case when a.status = 'estimate' then 'Estimate revised' else 'Estimate sent' end);
  perform _notify_org(a.fleet_org_id, 'Estimate ready: Unit ' || v.unit_number || ' · ' || a.title,
    'Approve to schedule.', a.kind = 'breakdown', p_activity);
end $$;

-- Owner approves. Breakdowns dispatch immediately; everything else gets a date.
create or replace function public.approve_estimate(p_activity bigint, p_date date default null)
returns void language plpgsql security definer set search_path = public as $$
declare a repair_activities; v vehicles;
begin
  select * into a from repair_activities where id = p_activity;
  perform _require(is_fleet_owner(a.fleet_org_id) or is_admin(), 'only the fleet owner approves repairs');
  perform _require(a.status in ('estimate', 'deferred'), 'nothing to approve');
  perform _require(exists (select 1 from estimate_lines where activity_id = p_activity), 'no estimate yet');
  select * into v from vehicles where id = a.vehicle_id;
  update repair_activities set approved_by = auth.uid(), approved_at = now(),
    status = case when a.kind = 'breakdown' then 'progress'::activity_status else 'scheduled'::activity_status end,
    scheduled_for = case when a.kind = 'breakdown' then current_date else coalesce(p_date, next_work_day(current_date + 1)) end,
    started_at = case when a.kind = 'breakdown' then now() end
  where id = p_activity;
  perform _add_event(p_activity, 'Estimate approved by owner');
  if a.kind = 'breakdown' then
    perform _out_of_service(a.vehicle_id, p_activity);
    perform _add_event(p_activity, 'Tech dispatched');
  else
    perform _add_event(p_activity, 'Scheduled ' || to_char(coalesce(p_date, next_work_day(current_date + 1)), 'Mon DD'));
  end if;
  perform _notify_provider(p_activity, 'Approved: Unit ' || v.unit_number || ' · RA #' || p_activity, a.title, a.kind = 'breakdown');
end $$;

create or replace function public.decline_estimate(p_activity bigint, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a repair_activities;
begin
  select * into a from repair_activities where id = p_activity;
  perform _require(is_fleet_owner(a.fleet_org_id) or is_admin(), 'only the fleet owner declines repairs');
  perform _require(a.status in ('requested', 'estimate', 'deferred'), 'cannot decline at this stage');
  update repair_activities set status = 'declined', declined_reason = p_reason, completed_at = now() where id = p_activity;
  perform _add_event(p_activity, 'Declined by owner' || coalesce(': ' || p_reason, ''));
  if a.kind = 'breakdown' then perform _add_event(p_activity, 'Truck remains out of service'); end if;
  perform _notify_provider(p_activity, 'Declined: RA #' || p_activity, p_reason);
end $$;

create or replace function public.defer_activity(p_activity bigint, p_reason text, p_until date default null)
returns void language plpgsql security definer set search_path = public as $$
declare a repair_activities;
begin
  select * into a from repair_activities where id = p_activity;
  perform _require(is_fleet_owner(a.fleet_org_id) or is_admin(), 'only the fleet owner defers repairs');
  perform _require(a.status = 'estimate', 'only an estimate can be deferred');
  perform _require(coalesce(trim(p_reason), '') <> '', 'a reason is required to defer');
  update repair_activities set status = 'deferred', deferred_reason = p_reason, deferred_at = now(),
    deferred_until = p_until where id = p_activity;
  perform _add_event(p_activity, 'Deferred by owner: ' || p_reason);
  perform _notify_provider(p_activity, 'Deferred: RA #' || p_activity, p_reason);
end $$;

create or replace function public.start_work(p_activity bigint)
returns void language plpgsql security definer set search_path = public as $$
declare a repair_activities;
begin
  select * into a from repair_activities where id = p_activity;
  perform _require(can_work_fleet(a.fleet_org_id), 'provider only');
  perform _require(a.status = 'scheduled', 'only scheduled work can start');
  update repair_activities set status = 'progress', started_at = now() where id = p_activity;
  perform _out_of_service(a.vehicle_id, p_activity);
  update breakdowns set tech_arrived_at = coalesce(tech_arrived_at, now()) where activity_id = p_activity;
  perform _add_event(p_activity, 'Tech on site, work started');
  perform _notify_org(a.fleet_org_id, 'Work started · RA #' || p_activity, a.title, false, p_activity);
end $$;

create or replace function public.update_breakdown(p_activity bigint, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require(can_work_fleet(activity_fleet(p_activity)), 'provider only');
  update breakdowns set
    responded_at = coalesce(responded_at, case when (p->>'responded')::boolean then now() end),
    tow_called_at = coalesce(tow_called_at, case when (p->>'tow_called')::boolean then now() end),
    tow_arrived_at = coalesce(tow_arrived_at, case when (p->>'tow_arrived')::boolean then now() end),
    tech_arrived_at = coalesce(tech_arrived_at, case when (p->>'tech_arrived')::boolean then now() end)
  where activity_id = p_activity;
  if (p->>'tow_arrived')::boolean then perform _add_event(p_activity, 'Tow arrived'); end if;
  if (p->>'tech_arrived')::boolean then perform _add_event(p_activity, 'Tech on site'); end if;
  if (p->>'responded')::boolean then perform _add_event(p_activity, 'Provider responded'); end if;
end $$;

-- Invoice on repair-activity completion: labor = book hrs x rate, parts at cost.
create or replace function public._invoice_activity(p_activity bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare a repair_activities; v vehicles; st platform_settings; o organizations; v_inv uuid; v_sub numeric;
begin
  select * into a from repair_activities where id = p_activity;
  select * into v from vehicles where id = a.vehicle_id;
  select * into o from organizations where id = a.fleet_org_id;
  st := _settings();
  if exists (select 1 from invoices where activity_id = p_activity and kind = 'service' and status <> 'void') then
    return null;
  end if;
  insert into invoices (kind, fleet_org_id, issuer_org_id, activity_id, vehicle_id, status, issued_on, due_on, memo)
  values ('service', a.fleet_org_id, coalesce(a.provider_org_id, st.default_provider_org_id), a.id, a.vehicle_id, 'open',
          current_date, current_date + o.payment_terms_days, 'RA #' || a.id || ' · Unit ' || v.unit_number || ' · ' || a.title)
  returning id into v_inv;
  insert into invoice_lines (invoice_id, line_type, description, vehicle_id, quantity, unit_price, position)
  select v_inv, e.kind,
         case when e.kind = 'labor' then e.description || ' · ' || coalesce(e.book_hours, e.quantity) || ' hrs book × $' || e.unit_price
              else e.description end,
         a.vehicle_id, e.quantity, e.unit_price, e.position
  from estimate_lines e where e.activity_id = a.id order by e.position;
  select coalesce(sum(amount), 0) into v_sub from invoice_lines where invoice_id = v_inv;
  update invoices set subtotal = v_sub, tax = round(v_sub * st.sales_tax_rate, 2),
    total = v_sub + round(v_sub * st.sales_tax_rate, 2),
    platform_fee_amount = case when st.revenue_model in ('fee', 'both')
                               then round((v_sub + round(v_sub * st.sales_tax_rate, 2)) * st.platform_fee_bps / 10000.0, 2) else 0 end
  where id = v_inv;
  return v_inv;
end $$;

create or replace function public.complete_activity(p_activity bigint, p_miles numeric default null,
                                                    p_hours numeric default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a repair_activities; v vehicles; v_inv uuid; v_miles numeric; v_hours numeric;
begin
  select * into a from repair_activities where id = p_activity;
  perform _require(can_work_fleet(a.fleet_org_id), 'provider only');
  perform _require(a.status in ('scheduled', 'progress'), 'only approved work can be completed');
  select * into v from vehicles where id = a.vehicle_id;
  v_miles := greatest(coalesce(p_miles, v.odometer_miles), v.odometer_miles);
  v_hours := greatest(coalesce(p_hours, v.engine_hours), v.engine_hours);
  if p_miles is not null or p_hours is not null then
    insert into meter_readings (vehicle_id, miles, hours, source, recorded_by)
    values (v.id, v_miles, v_hours, 'service_visit', auth.uid());
    update vehicles set odometer_miles = v_miles, engine_hours = v_hours where id = v.id;
  end if;
  update repair_activities set status = 'done', completed_at = now(), started_at = coalesce(started_at, now()),
    completed_miles = v_miles, completed_hours = v_hours where id = p_activity;
  if a.interval_id is not null then
    update service_intervals set last_done_miles = v_miles, last_done_hours = v_hours,
      last_done_on = current_date, notified_state = null where id = a.interval_id;
  end if;
  update breakdowns set resolved_at = now() where activity_id = p_activity;
  perform _back_in_service(a.vehicle_id);
  perform _add_event(p_activity, 'Completed · service report sent' || coalesce(' · ' || p_notes, ''));
  v_inv := _invoice_activity(p_activity);
  perform _notify_org(a.fleet_org_id, 'Completed: Unit ' || v.unit_number || ' · ' || a.title,
    'Invoice ready.', false, p_activity, null, v_inv);
  return v_inv;
end $$;

-- ---------------------------------------------------------------- billing
-- Monthly plan invoice on the 1st: trucks x fee (per fleet; falls back to platform fee).
create or replace function public.generate_plan_invoices(p_period date default date_trunc('month', current_date)::date)
returns int language plpgsql security definer set search_path = public as $$
declare st platform_settings := _settings(); f organizations; v_trucks int; v_fee numeric; v_inv uuid; n int := 0;
begin
  perform _require(auth.uid() is null or is_admin(), 'admin only');
  if st.revenue_model = 'fee' then return 0; end if;
  for f in select * from organizations where type = 'fleet' and status = 'active' loop
    select count(*) into v_trucks from vehicles where fleet_org_id = f.id;
    continue when v_trucks = 0;
    continue when exists (select 1 from invoices where fleet_org_id = f.id and kind = 'plan'
                          and period_start = p_period and status <> 'void');
    v_fee := coalesce(f.plan_fee_per_truck, st.plan_fee_per_truck);
    insert into invoices (kind, fleet_org_id, issuer_org_id, status, issued_on, due_on, period_start, memo,
                          subtotal, total)
    values ('plan', f.id, coalesce(_default_provider(f.id), st.default_provider_org_id), 'open', p_period,
            p_period + f.payment_terms_days, p_period, 'Monthly plan · ' || to_char(p_period, 'FMMonth YYYY'),
            v_trucks * v_fee, v_trucks * v_fee)
    returning id into v_inv;
    insert into invoice_lines (invoice_id, line_type, description, quantity, unit_price)
    values (v_inv, 'fee', 'Fleet maintenance management · ' || v_trucks || ' trucks', v_trucks, v_fee);
    perform _notify_org(f.id, 'New invoice · Monthly plan', to_char(p_period, 'FMMonth YYYY'), false, null, null, v_inv);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Admin records an offline payment (check / ACH outside Stripe).
create or replace function public.record_payment(p_invoice uuid, p_method text default 'manual')
returns void language plpgsql security definer set search_path = public as $$
declare i invoices;
begin
  perform _require(is_admin(), 'admin only');
  select * into i from invoices where id = p_invoice;
  perform _require(i.status in ('open', 'processing'), 'invoice is not open');
  insert into payments (invoice_id, amount, method, recorded_by) values (i.id, i.total, p_method, auth.uid());
  update invoices set status = 'paid', paid_at = now(), payment_method = p_method where id = i.id;
end $$;

create or replace function public.void_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require(is_admin(), 'admin only');
  update invoices set status = 'void' where id = p_invoice and status in ('draft', 'open');
end $$;

-- ---------------------------------------------------------------- notifications
create or replace function public.mark_notifications_read()
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

-- ---------------------------------------------------------------- bootstrap
-- Run once from the SQL editor after Paul signs up:  select bootstrap_platform_admin('paul@example.com');
create or replace function public.bootstrap_platform_admin(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_platform uuid;
begin
  perform _require(auth.uid() is null, 'run from the SQL editor');
  select id into v_user from auth.users where lower(email) = lower(p_email);
  perform _require(v_user is not null, 'sign up with that email first');
  select id into v_platform from organizations where type = 'platform' limit 1;
  insert into memberships (user_id, org_id, role) values (v_user, v_platform, 'admin') on conflict do nothing;
  -- Paul also runs PG Heavy Duty (provider) — a separate membership, never blurred with admin
  insert into memberships (user_id, org_id, role)
  select v_user, default_provider_org_id, 'owner' from platform_settings where id and default_provider_org_id is not null
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.bootstrap_platform_admin(text) from authenticated;
-- internal helpers are not part of the API
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like '\_%' loop
    execute format('revoke execute on function %s from authenticated', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------- schedules (Supabase pg_cron)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('northgate-plan-invoices', '5 6 1 * *', 'select public.generate_plan_invoices()');
    perform cron.schedule('northgate-interval-check', '15 10 * * *', 'select public.check_intervals()');
  end if;
end $$;
