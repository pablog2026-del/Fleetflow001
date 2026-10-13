-- Northgate Fleet Systems — core schema (stage one).
-- Backbone: an organization manages fleets. Organizations are typed
-- (platform | fleet | provider | vendor); users join organizations through
-- memberships; org_relationships records "manager org manages fleet org".
-- Provider / vendor / parts / technician tables exist as stubs so later
-- stages slot in without a rewrite.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type public.org_type as enum ('platform', 'fleet', 'provider', 'vendor');
create type public.org_status as enum ('pending', 'active', 'suspended');
create type public.signup_source as enum ('admin', 'self');
create type public.member_role as enum ('admin', 'owner', 'manager', 'viewer', 'technician');
create type public.interval_status as enum ('draft', 'confirmed', 'retired');
create type public.activity_kind as enum ('pm', 'request', 'breakdown');
create type public.activity_status as enum (
  'requested',  -- owner asked; waiting on an estimate
  'estimate',   -- estimate sent; waiting on owner approval
  'scheduled',  -- approved and booked
  'progress',   -- tech working on it
  'done',       -- completed, invoiced
  'declined',   -- owner declined the estimate
  'deferred'    -- owner deferred a recommendation (stays visible as a reminder)
);
create type public.activity_category as enum ('pm', 'repair', 'tires', 'breakdown', 'inspection');
create type public.estimate_line_kind as enum ('labor', 'part', 'fee', 'sublet');
create type public.invoice_kind as enum ('service', 'plan');
create type public.invoice_status as enum ('draft', 'open', 'processing', 'paid', 'void');
create type public.revenue_model as enum ('subscription', 'fee', 'both');

-- ---------------------------------------------------------------- accounts & access
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  type public.org_type not null,
  name text not null,
  account_number text unique,
  status public.org_status not null default 'pending',
  signup_source public.signup_source not null default 'admin',
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  phone text,
  email text,
  usdot_number text,
  primary_contact_name text,
  primary_contact_title text,
  billing_contact text,
  service_location text,
  -- provider pricing policy (PG Heavy Duty: parts at cost, labor from book time)
  labor_rate numeric(10,2),
  parts_markup_pct numeric(5,2) not null default 0,
  -- fleet billing terms
  payment_terms_days int not null default 15,
  plan_fee_per_truck numeric(10,2),
  customer_since date,
  trial_ends_at date,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  stripe_customer_id text,
  stripe_account_id text,          -- Stripe Connect account (providers/vendors)
  insurance_verified_at timestamptz, -- provider vetting (later)
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  expo_push_token text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,  -- profiles cascade from auth.users
  org_id uuid not null references public.organizations(id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
create index on public.memberships (org_id);

-- "manager org manages fleet org": provider -> its customers (platform sees all anyway)
create table public.org_relationships (
  manager_org_id uuid not null references public.organizations(id) on delete cascade,
  fleet_org_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (manager_org_id, fleet_org_id)
);
create index on public.org_relationships (fleet_org_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.member_role not null default 'owner',
  full_name text,
  invited_by uuid references auth.users(id),
  sent_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index on public.invitations (lower(email));

create table public.platform_settings (
  id boolean primary key default true check (id),
  revenue_model public.revenue_model not null default 'subscription',
  plan_fee_per_truck numeric(10,2) not null default 75,
  platform_fee_bps int not null default 0,          -- basis points on payments (option B/C)
  default_labor_rate numeric(10,2) not null default 150,
  default_payment_terms_days int not null default 15,
  sales_tax_rate numeric(6,4) not null default 0,    -- NC taxability TBD by CPA
  default_provider_org_id uuid references public.organizations(id),
  trial_days int not null default 30,
  updated_at timestamptz not null default now()
);

create table public.plan_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  applies_to public.org_type not null,
  unit text not null default 'truck',                -- truck | seat | location
  price_per_unit numeric(10,2) not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- truck record
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  fleet_org_id uuid not null references public.organizations(id) on delete cascade,
  unit_number text not null,
  vin text not null check (length(vin) = 17),
  year int,
  make text,
  model text,
  body_type text,
  engine text,
  transmission text,
  gvwr text,
  plate text,
  plate_state text,
  driver_name text,
  in_service boolean not null default true,
  odometer_miles numeric(12,1) not null default 0,
  engine_hours numeric(12,1) not null default 0,
  avg_miles_per_day numeric(8,1) not null default 150,
  vin_decoded jsonb,
  created_at timestamptz not null default now(),
  unique (fleet_org_id, unit_number),
  unique (fleet_org_id, vin)
);
create index on public.vehicles (fleet_org_id);

-- catalogue of component makes/models (engine, transmission, axles, hoist ...)
create table public.component_models (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  make text not null,
  model text not null,
  unique (category, make, model)
);

create table public.components (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  component_model_id uuid references public.component_models(id),
  category text not null,
  serial_number text,
  created_at timestamptz not null default now()
);
create index on public.components (vehicle_id);

-- Interval templates extracted from OEM manuals (store intervals + source links,
-- never redistributed PDFs). Matched to a vehicle by make (and optionally model).
create table public.interval_templates (
  id uuid primary key default gen_random_uuid(),
  make text,                 -- null = applies to any make
  model text,
  component_category text not null,
  task text not null,
  every_miles int,
  every_hours int,
  every_days int,
  book_hours numeric(6,2) not null default 1,
  est_parts_cost numeric(10,2) not null default 0,
  source_ref text,
  source_url text,
  is_sample boolean not null default false
);

create table public.service_intervals (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  component_id uuid references public.components(id) on delete set null,
  component_category text not null,
  task text not null,
  every_miles int,
  every_hours int,
  every_days int,
  book_hours numeric(6,2) not null default 1,
  est_parts_cost numeric(10,2) not null default 0,
  last_done_miles numeric(12,1) not null default 0,
  last_done_hours numeric(12,1) not null default 0,
  last_done_on date,
  source_ref text,
  source_url text,
  -- Admin confirms each interval before it goes live (protects the OEM-spec promise)
  status public.interval_status not null default 'draft',
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  notified_state text,       -- 'soon' | 'over' — last reminder sent
  created_at timestamptz not null default now(),
  check (every_miles is not null or every_hours is not null or every_days is not null)
);
create index on public.service_intervals (vehicle_id);

create table public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  miles numeric(12,1),
  hours numeric(12,1),
  source text not null default 'manual',   -- manual | service_visit | telematics
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now()
);
create index on public.meter_readings (vehicle_id, recorded_at desc);

-- ---------------------------------------------------------------- work
create table public.repair_activities (
  id bigint generated by default as identity (start with 1047) primary key,
  fleet_org_id uuid not null references public.organizations(id) on delete cascade,
  provider_org_id uuid references public.organizations(id),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  interval_id uuid references public.service_intervals(id) on delete set null,
  kind public.activity_kind not null,
  category public.activity_category not null default 'repair',
  status public.activity_status not null,
  title text not null,
  component_category text not null default 'General',
  description text,
  urgency text,                              -- 'Truck down' | 'This week' | 'Next PM'
  due_at_miles numeric(12,1),                -- for PM compliance
  due_at_hours numeric(12,1),
  scheduled_for date,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  completed_miles numeric(12,1),
  completed_hours numeric(12,1),
  declined_reason text,
  deferred_reason text,
  deferred_at timestamptz,
  deferred_until date,
  labor_rate numeric(10,2),                  -- snapshot of the provider rate
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on public.repair_activities (fleet_org_id, status);
create index on public.repair_activities (vehicle_id);

-- Roadside / emergency detail for kind = 'breakdown'
create table public.breakdowns (
  activity_id bigint primary key references public.repair_activities(id) on delete cascade,
  latitude double precision,
  longitude double precision,
  location_text text,
  symptoms text not null,
  driveable boolean not null default false,
  needs_tow boolean not null default false,
  tow_called_at timestamptz,
  tow_arrived_at timestamptz,
  reported_at timestamptz not null default now(),
  responded_at timestamptz,                  -- provider acknowledged
  tech_arrived_at timestamptz,
  resolved_at timestamptz
);

-- Every period a truck is out of service (downtime reporting)
create table public.vehicle_downtime (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  activity_id bigint references public.repair_activities(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index on public.vehicle_downtime (vehicle_id);

create table public.activity_events (
  id bigint generated always as identity primary key,
  activity_id bigint not null references public.repair_activities(id) on delete cascade,
  actor_id uuid references auth.users(id),
  text text not null,
  created_at timestamptz not null default now()
);
create index on public.activity_events (activity_id, created_at);

create table public.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  activity_id bigint not null references public.repair_activities(id) on delete cascade,
  kind public.estimate_line_kind not null,
  description text not null,
  part_number text,
  book_hours numeric(6,2),                   -- labor: hours from the book-time guide
  quantity numeric(10,2) not null default 1,
  unit_price numeric(10,2) not null default 0,
  amount numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored,
  position int not null default 0
);
create index on public.estimate_lines (activity_id);

-- stub: parts orders to vendors (vendor role is a later stage)
create table public.parts_orders (
  id bigint generated by default as identity (start with 5001) primary key,
  activity_id bigint not null references public.repair_activities(id) on delete cascade,
  vendor_org_id uuid references public.organizations(id),
  description text not null,
  amount numeric(12,2) not null default 0,
  status text not null default 'ordered',    -- ordered | confirmed | delivered
  need_by date,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- money
create sequence public.invoice_number_seq start 1001;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('INV-' || nextval('public.invoice_number_seq')),
  kind public.invoice_kind not null,
  fleet_org_id uuid not null references public.organizations(id) on delete cascade,
  issuer_org_id uuid not null references public.organizations(id),
  activity_id bigint references public.repair_activities(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  status public.invoice_status not null default 'open',
  issued_on date not null default current_date,
  due_on date not null,
  period_start date,                         -- plan invoices: the month billed
  memo text,
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  platform_fee_amount numeric(12,2) not null default 0,
  paid_at timestamptz,
  payment_method text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
);
create index on public.invoices (fleet_org_id, status);
create unique index invoices_one_per_activity on public.invoices (activity_id) where kind = 'service' and status <> 'void';
create unique index invoices_one_plan_per_month on public.invoices (fleet_org_id, period_start) where kind = 'plan' and status <> 'void';

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  line_type public.estimate_line_kind not null,
  description text not null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(10,2) not null default 0,
  amount numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored,
  position int not null default 0
);
create index on public.invoice_lines (invoice_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(12,2) not null,
  method text not null,                      -- ach | card | check | manual
  status text not null default 'succeeded',  -- processing | succeeded | failed
  stripe_payment_intent_id text,
  received_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id)
);
create index on public.payments (invoice_id);

-- stub: vendor bills (vendor role is a later stage)
create table public.vendor_bills (
  id uuid primary key default gen_random_uuid(),
  vendor_org_id uuid not null references public.organizations(id),
  payer_org_id uuid not null references public.organizations(id),
  parts_order_id bigint references public.parts_orders(id),
  amount numeric(12,2) not null,
  status text not null default 'open',
  issued_on date not null default current_date,
  due_on date not null,
  paid_at timestamptz
);

-- ---------------------------------------------------------------- supporting
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  activity_id bigint references public.repair_activities(id) on delete cascade,
  kind text not null default 'other',        -- photo | manual | report | dot | data_plate | other
  title text not null,
  storage_path text,                         -- object in the 'documents' bucket
  url text,                                  -- external link (e.g. OEM source page)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on public.documents (vehicle_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  title text not null,
  body text,
  urgent boolean not null default false,     -- urgent => push + SMS
  activity_id bigint references public.repair_activities(id) on delete cascade,
  interval_id uuid references public.service_intervals(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  table_name text not null,
  row_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  at timestamptz not null default now()
);
create index on public.audit_log (table_name, row_id);
