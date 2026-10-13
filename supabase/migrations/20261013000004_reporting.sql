-- Fleet reporting (§12): cost per mile / engine hour by truck, spend by category,
-- downtime days, PM compliance, and the DOT-ready file per truck.
-- Both functions check visibility themselves (security definer).

create or replace function public.fleet_report(p_fleet uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := p_from::timestamptz; v_to timestamptz := (p_to + 1)::timestamptz; result jsonb;
begin
  perform _require(can_see_fleet(p_fleet));

  with vehicles_f as (
    select * from vehicles where fleet_org_id = p_fleet
  ),
  usage as (
    select v.id,
      greatest(coalesce(max(m.miles) - min(m.miles), 0), 0) as miles,
      greatest(coalesce(max(m.hours) - min(m.hours), 0), 0) as hours
    from vehicles_f v left join meter_readings m on m.vehicle_id = v.id and m.recorded_at >= v_from and m.recorded_at < v_to
    group by v.id
  ),
  spend as (
    select l.vehicle_id, sum(l.amount) as total
    from invoices i join invoice_lines l on l.invoice_id = i.id
    where i.fleet_org_id = p_fleet and i.kind = 'service' and i.status <> 'void'
      and i.issued_on between p_from and p_to
    group by l.vehicle_id
  ),
  down as (
    select d.vehicle_id,
      sum(extract(epoch from (least(coalesce(d.ended_at, now()), v_to) - greatest(d.started_at, v_from))) / 86400.0) as days
    from vehicle_downtime d join vehicles_f v on v.id = d.vehicle_id
    where d.started_at < v_to and coalesce(d.ended_at, now()) > v_from
    group by d.vehicle_id
  ),
  pm as (
    select a.vehicle_id,
      count(*) filter (where a.status = 'done' and
        (a.due_at_miles is null or a.completed_miles <= a.due_at_miles) and
        (a.due_at_hours is null or a.completed_hours <= a.due_at_hours)) as on_time,
      count(*) filter (where a.status = 'done') as done
    from repair_activities a
    where a.fleet_org_id = p_fleet and a.kind = 'pm' and a.completed_at >= v_from and a.completed_at < v_to
    group by a.vehicle_id
  ),
  overdue as (
    select s.vehicle_id, count(*) as n
    from service_intervals s join vehicles_f v on v.id = s.vehicle_id
    where s.status = 'confirmed' and (
      (s.every_miles is not null and s.last_done_miles + s.every_miles < v.odometer_miles) or
      (s.every_hours is not null and s.last_done_hours + s.every_hours < v.engine_hours) or
      (s.every_days is not null and coalesce(s.last_done_on, s.created_at::date) + s.every_days < current_date))
    group by s.vehicle_id
  ),
  per_truck as (
    select jsonb_build_object(
      'vehicle_id', v.id, 'unit', v.unit_number, 'make', v.make, 'model', v.model, 'year', v.year,
      'miles', u.miles, 'hours', u.hours,
      'spend', coalesce(sp.total, 0),
      'cost_per_mile', case when u.miles > 0 then round(coalesce(sp.total, 0) / u.miles, 3) end,
      'cost_per_hour', case when u.hours > 0 then round(coalesce(sp.total, 0) / u.hours, 2) end,
      'downtime_days', round(coalesce(dn.days, 0)::numeric, 1),
      'pm_done', coalesce(pm.done, 0), 'pm_on_time', coalesce(pm.on_time, 0),
      'pm_overdue_now', coalesce(od.n, 0)
    ) as j, v.unit_number
    from vehicles_f v
    join usage u on u.id = v.id
    left join spend sp on sp.vehicle_id = v.id
    left join down dn on dn.vehicle_id = v.id
    left join pm on pm.vehicle_id = v.id
    left join overdue od on od.vehicle_id = v.id
  ),
  by_category as (
    select coalesce(a.category::text, case when i.kind = 'plan' then 'plan' else 'repair' end) as category,
           sum(i.total) as total
    from invoices i left join repair_activities a on a.id = i.activity_id
    where i.fleet_org_id = p_fleet and i.status <> 'void' and i.issued_on between p_from and p_to
    group by 1
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'trucks', coalesce((select jsonb_agg(j order by unit_number) from per_truck), '[]'::jsonb),
    'by_category', coalesce((select jsonb_object_agg(category, total) from by_category), '{}'::jsonb),
    'totals', jsonb_build_object(
      'spend', coalesce((select sum(total) from invoices where fleet_org_id = p_fleet and status <> 'void'
                         and issued_on between p_from and p_to), 0),
      'downtime_days', coalesce((select round(sum(days)::numeric, 1) from down), 0),
      'pm_done', coalesce((select sum(done) from pm), 0),
      'pm_on_time', coalesce((select sum(on_time) from pm), 0),
      'pm_overdue_now', coalesce((select sum(n) from overdue), 0)
    )
  ) into result;
  return result;
end $$;

-- DOT-ready file for one truck: annual inspection, repair history, defects closed, deferred items.
create or replace function public.dot_file(p_vehicle uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v vehicles; o organizations; result jsonb;
begin
  select * into v from vehicles where id = p_vehicle;
  perform _require(v.id is not null and can_see_fleet(v.fleet_org_id));
  select * into o from organizations where id = v.fleet_org_id;
  select jsonb_build_object(
    'generated_at', now(),
    'carrier', jsonb_build_object('name', o.name, 'usdot', o.usdot_number, 'address',
      concat_ws(', ', o.address_line1, o.city, o.state || ' ' || o.postal_code)),
    'vehicle', jsonb_build_object('unit', v.unit_number, 'vin', v.vin, 'year', v.year, 'make', v.make,
      'model', v.model, 'plate', v.plate, 'plate_state', v.plate_state, 'odometer', v.odometer_miles,
      'engine_hours', v.engine_hours),
    'annual_inspection', (
      select jsonb_build_object('id', a.id, 'date', a.completed_at::date, 'miles', a.completed_miles,
                                'next_due', (a.completed_at + interval '1 year')::date)
      from repair_activities a where a.vehicle_id = v.id and a.category = 'inspection' and a.status = 'done'
      order by a.completed_at desc limit 1),
    'repair_history', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'date', a.completed_at::date, 'title', a.title,
        'category', a.category, 'component', a.component_category, 'miles', a.completed_miles,
        'total', (select coalesce(sum(amount), 0) from estimate_lines e where e.activity_id = a.id))
        order by a.completed_at desc)
      from repair_activities a where a.vehicle_id = v.id and a.status = 'done'), '[]'::jsonb),
    'defects_closed', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'reported', a.created_at::date, 'closed', a.completed_at::date,
        'title', a.title, 'description', a.description) order by a.completed_at desc)
      from repair_activities a where a.vehicle_id = v.id and a.status = 'done' and a.kind in ('request', 'breakdown')), '[]'::jsonb),
    'deferred', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'date', a.deferred_at::date, 'title', a.title,
        'reason', a.deferred_reason, 'until', a.deferred_until) order by a.deferred_at desc)
      from repair_activities a where a.vehicle_id = v.id and a.status = 'deferred'), '[]'::jsonb),
    'open_items', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'status', a.status, 'opened', a.created_at::date))
      from repair_activities a where a.vehicle_id = v.id and a.status in ('requested', 'estimate', 'scheduled', 'progress')), '[]'::jsonb)
  ) into result;
  return result;
end $$;

grant execute on function public.fleet_report(uuid, date, date) to authenticated;
grant execute on function public.dot_file(uuid) to authenticated;
