-- Row-level security: Admin sees everything; every other role sees only what it owns.
--   fleet owner  -> its own fleet's rows
--   provider     -> fleets it manages (org_relationships) — later stage, already wired
--   vendor       -> its own orders/bills — later stage
-- Owners never change workflow state directly; they go through the RPCs in
-- 20261013000003_workflow.sql, which enforce the approval rules.

-- ---------------------------------------------------------------- helpers
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join organizations o on o.id = m.org_id
    where m.user_id = auth.uid() and o.type = 'platform' and m.role = 'admin'
  );
$$;

create or replace function public.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = auth.uid() and org_id = p_org);
$$;

-- member of an org that manages this fleet (provider workspace)
create or replace function public.manages_fleet(p_fleet uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_relationships r join memberships m on m.org_id = r.manager_org_id
    where r.fleet_org_id = p_fleet and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_see_fleet(p_fleet uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_member(p_fleet) or public.manages_fleet(p_fleet);
$$;

create or replace function public.can_work_fleet(p_fleet uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.manages_fleet(p_fleet);
$$;

create or replace function public.is_fleet_owner(p_fleet uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join organizations o on o.id = m.org_id
    where m.user_id = auth.uid() and m.org_id = p_fleet and o.type = 'fleet' and m.role in ('owner', 'manager')
  );
$$;

create or replace function public.vehicle_fleet(p_vehicle uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select fleet_org_id from vehicles where id = p_vehicle;
$$;

create or replace function public.activity_fleet(p_activity bigint)
returns uuid language sql stable security definer set search_path = public as $$
  select fleet_org_id from repair_activities where id = p_activity;
$$;

create or replace function public.invoice_fleet(p_invoice uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select fleet_org_id from invoices where id = p_invoice;
$$;

-- ---------------------------------------------------------------- new users
-- Every auth user gets a profile; pending invitations for their email become memberships.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email)
  on conflict (id) do nothing;

  insert into memberships (user_id, org_id, role)
  select new.id, i.org_id, i.role from invitations i
  where lower(i.email) = lower(new.email) and i.accepted_at is null
  on conflict do nothing;

  update invitations set accepted_at = now()
  where lower(email) = lower(new.email) and accepted_at is null;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- audit log
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_log (actor_id, table_name, row_id, action, old_data, new_data)
  values (
    auth.uid(), tg_table_name, v_row->>'id', tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'memberships', 'org_relationships', 'platform_settings', 'plan_tiers',
    'vehicles', 'service_intervals', 'repair_activities', 'estimate_lines',
    'invoices', 'invoice_lines', 'payments'
  ] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- enable RLS everywhere
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- organizations
create policy org_select on public.organizations for select to authenticated using (
  public.is_admin() or public.is_member(id) or public.manages_fleet(id)
  -- a fleet can see the provider(s) that manage it
  or exists (select 1 from org_relationships r where r.manager_org_id = organizations.id and public.is_member(r.fleet_org_id))
);
create policy org_admin_all on public.organizations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- profiles
create policy profile_select on public.profiles for select to authenticated using (
  id = auth.uid() or public.is_admin()
  or exists (select 1 from memberships a join memberships b on a.org_id = b.org_id
             where a.user_id = auth.uid() and b.user_id = profiles.id)
);
create policy profile_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profile_admin on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- memberships
create policy membership_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.is_member(org_id));
create policy membership_admin on public.memberships for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- org_relationships
create policy rel_select on public.org_relationships for select to authenticated
  using (public.is_admin() or public.is_member(manager_org_id) or public.is_member(fleet_org_id));
create policy rel_admin on public.org_relationships for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- invitations
create policy inv_admin on public.invitations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- platform settings & plan tiers: readable by any signed-in user, admin writes
create policy settings_read on public.platform_settings for select to authenticated using (true);
create policy settings_admin on public.platform_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy tiers_read on public.plan_tiers for select to authenticated using (true);
create policy tiers_admin on public.plan_tiers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- vehicles: owners add/edit their own trucks (self-signup door), admin everything
create policy vehicle_select on public.vehicles for select to authenticated
  using (public.can_see_fleet(fleet_org_id));
create policy vehicle_insert on public.vehicles for insert to authenticated
  with check (public.can_work_fleet(fleet_org_id) or public.is_fleet_owner(fleet_org_id));
create policy vehicle_update on public.vehicles for update to authenticated
  using (public.can_work_fleet(fleet_org_id) or public.is_fleet_owner(fleet_org_id))
  with check (public.can_work_fleet(fleet_org_id) or public.is_fleet_owner(fleet_org_id));
create policy vehicle_delete on public.vehicles for delete to authenticated
  using (public.is_admin());

-- components
create policy comp_select on public.components for select to authenticated
  using (public.can_see_fleet(public.vehicle_fleet(vehicle_id)));
create policy comp_write on public.components for all to authenticated
  using (public.can_work_fleet(public.vehicle_fleet(vehicle_id)) or public.is_fleet_owner(public.vehicle_fleet(vehicle_id)))
  with check (public.can_work_fleet(public.vehicle_fleet(vehicle_id)) or public.is_fleet_owner(public.vehicle_fleet(vehicle_id)));

-- catalogue tables
create policy cm_read on public.component_models for select to authenticated using (true);
create policy cm_admin on public.component_models for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy tpl_read on public.interval_templates for select to authenticated using (true);
create policy tpl_admin on public.interval_templates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- service intervals: owners may propose drafts; only admin/provider confirms
create policy si_select on public.service_intervals for select to authenticated
  using (public.can_see_fleet(public.vehicle_fleet(vehicle_id)));
create policy si_worker on public.service_intervals for all to authenticated
  using (public.can_work_fleet(public.vehicle_fleet(vehicle_id)))
  with check (public.can_work_fleet(public.vehicle_fleet(vehicle_id)));
create policy si_owner_insert on public.service_intervals for insert to authenticated
  with check (status = 'draft' and confirmed_at is null and public.is_fleet_owner(public.vehicle_fleet(vehicle_id)));
create policy si_owner_update on public.service_intervals for update to authenticated
  using (status = 'draft' and public.is_fleet_owner(public.vehicle_fleet(vehicle_id)))
  with check (status = 'draft' and confirmed_at is null and public.is_fleet_owner(public.vehicle_fleet(vehicle_id)));
create policy si_owner_delete on public.service_intervals for delete to authenticated
  using (status = 'draft' and public.is_fleet_owner(public.vehicle_fleet(vehicle_id)));

-- meter readings
create policy mr_select on public.meter_readings for select to authenticated
  using (public.can_see_fleet(public.vehicle_fleet(vehicle_id)));
create policy mr_insert on public.meter_readings for insert to authenticated
  with check (public.can_work_fleet(public.vehicle_fleet(vehicle_id)) or public.is_fleet_owner(public.vehicle_fleet(vehicle_id)));

-- work: everyone who can see the fleet reads; only admin/provider writes directly
create policy ra_select on public.repair_activities for select to authenticated
  using (public.can_see_fleet(fleet_org_id));
create policy ra_worker on public.repair_activities for all to authenticated
  using (public.can_work_fleet(fleet_org_id)) with check (public.can_work_fleet(fleet_org_id));

create policy bd_select on public.breakdowns for select to authenticated
  using (public.can_see_fleet(public.activity_fleet(activity_id)));
create policy bd_worker on public.breakdowns for all to authenticated
  using (public.can_work_fleet(public.activity_fleet(activity_id)))
  with check (public.can_work_fleet(public.activity_fleet(activity_id)));

create policy dt_select on public.vehicle_downtime for select to authenticated
  using (public.can_see_fleet(public.vehicle_fleet(vehicle_id)));
create policy dt_worker on public.vehicle_downtime for all to authenticated
  using (public.can_work_fleet(public.vehicle_fleet(vehicle_id)))
  with check (public.can_work_fleet(public.vehicle_fleet(vehicle_id)));

create policy ev_select on public.activity_events for select to authenticated
  using (public.can_see_fleet(public.activity_fleet(activity_id)));
create policy ev_worker on public.activity_events for all to authenticated
  using (public.can_work_fleet(public.activity_fleet(activity_id)))
  with check (public.can_work_fleet(public.activity_fleet(activity_id)));

create policy el_select on public.estimate_lines for select to authenticated
  using (public.can_see_fleet(public.activity_fleet(activity_id)));
create policy el_worker on public.estimate_lines for all to authenticated
  using (public.can_work_fleet(public.activity_fleet(activity_id)))
  with check (public.can_work_fleet(public.activity_fleet(activity_id)));

create policy po_select on public.parts_orders for select to authenticated
  using (public.can_see_fleet(public.activity_fleet(activity_id)) or public.is_member(vendor_org_id));
create policy po_worker on public.parts_orders for all to authenticated
  using (public.can_work_fleet(public.activity_fleet(activity_id)))
  with check (public.can_work_fleet(public.activity_fleet(activity_id)));

-- money
create policy invoice_select on public.invoices for select to authenticated
  using (public.can_see_fleet(fleet_org_id) or public.is_member(issuer_org_id));
create policy invoice_admin on public.invoices for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy il_select on public.invoice_lines for select to authenticated
  using (public.can_see_fleet(public.invoice_fleet(invoice_id)));
create policy il_admin on public.invoice_lines for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy pay_select on public.payments for select to authenticated
  using (public.can_see_fleet(public.invoice_fleet(invoice_id)));
create policy pay_admin on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy vb_select on public.vendor_bills for select to authenticated
  using (public.is_admin() or public.is_member(vendor_org_id) or public.is_member(payer_org_id));
create policy vb_admin on public.vendor_bills for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- documents & photos
create policy doc_select on public.documents for select to authenticated
  using (public.can_see_fleet(org_id));
create policy doc_insert on public.documents for insert to authenticated
  with check (public.can_see_fleet(org_id) and created_by = auth.uid());
create policy doc_delete on public.documents for delete to authenticated
  using (public.is_admin() or created_by = auth.uid());

-- notifications: your own only (rows are created by security-definer functions)
create policy notif_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit log: admin only
create policy audit_admin on public.audit_log for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- storage
-- Private bucket; first path segment is the org id: <org_id>/<vehicle_id>/<file>
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
    on conflict (id) do nothing;

    execute $p$create policy docs_read on storage.objects for select to authenticated
      using (bucket_id = 'documents' and public.can_see_fleet(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy docs_write on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and public.can_see_fleet(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end $$;
