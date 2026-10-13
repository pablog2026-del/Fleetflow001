// Row types mirroring supabase/migrations. Kept by hand for stage one; switch to
// `supabase gen types typescript` once the project is linked.

export type OrgType = 'platform' | 'fleet' | 'provider' | 'vendor';
export type OrgStatus = 'pending' | 'active' | 'suspended';
export type MemberRole = 'admin' | 'owner' | 'manager' | 'viewer' | 'technician';
export type IntervalStatus = 'draft' | 'confirmed' | 'retired';
export type ActivityKind = 'pm' | 'request' | 'breakdown';
export type ActivityStatus = 'requested' | 'estimate' | 'scheduled' | 'progress' | 'done' | 'declined' | 'deferred';
export type ActivityCategory = 'pm' | 'repair' | 'tires' | 'breakdown' | 'inspection';
export type LineKind = 'labor' | 'part' | 'fee' | 'sublet';
export type InvoiceStatus = 'draft' | 'open' | 'processing' | 'paid' | 'void';

export interface Organization {
  id: string;
  type: OrgType;
  name: string;
  account_number: string | null;
  status: OrgStatus;
  signup_source: 'admin' | 'self';
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  usdot_number: string | null;
  primary_contact_name: string | null;
  primary_contact_title: string | null;
  billing_contact: string | null;
  service_location: string | null;
  labor_rate: number | null;
  parts_markup_pct: number;
  payment_terms_days: number;
  plan_fee_per_truck: number | null;
  customer_since: string | null;
  trial_ends_at: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface Membership {
  user_id: string;
  org_id: string;
  role: MemberRole;
  organizations?: Organization;
}

export interface Vehicle {
  id: string;
  fleet_org_id: string;
  unit_number: string;
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  body_type: string | null;
  engine: string | null;
  transmission: string | null;
  gvwr: string | null;
  plate: string | null;
  plate_state: string | null;
  driver_name: string | null;
  in_service: boolean;
  odometer_miles: number;
  engine_hours: number;
  avg_miles_per_day: number;
  vin_decoded: Record<string, string> | null;
}

export interface ServiceInterval {
  id: string;
  vehicle_id: string;
  component_category: string;
  task: string;
  every_miles: number | null;
  every_hours: number | null;
  every_days: number | null;
  book_hours: number;
  est_parts_cost: number;
  last_done_miles: number;
  last_done_hours: number;
  last_done_on: string | null;
  source_ref: string | null;
  source_url: string | null;
  status: IntervalStatus;
  inspection_type_key: string | null;
  confirmed_at: string | null;
  created_at: string;
}

export interface RepairActivity {
  id: number;
  fleet_org_id: string;
  provider_org_id: string | null;
  vehicle_id: string;
  interval_id: string | null;
  kind: ActivityKind;
  category: ActivityCategory;
  status: ActivityStatus;
  title: string;
  component_category: string;
  description: string | null;
  urgency: string | null;
  scheduled_for: string | null;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  completed_miles: number | null;
  declined_reason: string | null;
  deferred_reason: string | null;
  deferred_until: string | null;
  labor_rate: number | null;
  inspection_type_key: string | null;
  created_at: string;
}

export interface Breakdown {
  activity_id: number;
  latitude: number | null;
  longitude: number | null;
  location_text: string | null;
  symptoms: string;
  driveable: boolean;
  needs_tow: boolean;
  tow_called_at: string | null;
  tow_arrived_at: string | null;
  reported_at: string;
  responded_at: string | null;
  tech_arrived_at: string | null;
  resolved_at: string | null;
}

export interface ActivityEvent {
  id: number;
  activity_id: number;
  text: string;
  created_at: string;
}

export interface EstimateLine {
  id: string;
  activity_id: number;
  kind: LineKind;
  description: string;
  part_number: string | null;
  book_hours: number | null;
  quantity: number;
  unit_price: number;
  amount: number;
  position: number;
}

export interface Invoice {
  id: string;
  number: string;
  kind: 'service' | 'plan';
  fleet_org_id: string;
  issuer_org_id: string;
  activity_id: number | null;
  vehicle_id: string | null;
  status: InvoiceStatus;
  issued_on: string;
  due_on: string;
  period_start: string | null;
  memo: string | null;
  subtotal: number;
  tax: number;
  total: number;
  platform_fee_amount: number;
  paid_at: string | null;
  payment_method: string | null;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  line_type: LineKind;
  description: string;
  vehicle_id: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  position: number;
}

export interface DocumentRow {
  id: string;
  org_id: string;
  vehicle_id: string | null;
  activity_id: number | null;
  kind: string;
  title: string;
  storage_path: string | null;
  url: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  urgent: boolean;
  activity_id: number | null;
  interval_id: string | null;
  invoice_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface PlatformSettings {
  revenue_model: 'subscription' | 'fee' | 'both';
  plan_fee_per_truck: number;
  platform_fee_bps: number;
  default_labor_rate: number;
  default_payment_terms_days: number;
  sales_tax_rate: number;
  default_provider_org_id: string | null;
  trial_days: number;
}

export interface PlanTier {
  id: string;
  name: string;
  applies_to: OrgType;
  unit: string;
  price_per_unit: number;
  active: boolean;
}

export interface FleetReport {
  from: string;
  to: string;
  trucks: {
    vehicle_id: string;
    unit: string;
    make: string | null;
    model: string | null;
    year: number | null;
    miles: number;
    hours: number;
    spend: number;
    cost_per_mile: number | null;
    cost_per_hour: number | null;
    downtime_days: number;
    pm_done: number;
    pm_on_time: number;
    pm_overdue_now: number;
  }[];
  by_category: Record<string, number>;
  totals: { spend: number; downtime_days: number; pm_done: number; pm_on_time: number; pm_overdue_now: number };
}

export interface DotFile {
  generated_at: string;
  carrier: { name: string; usdot: string | null; address: string };
  vehicle: { unit: string; vin: string; year: number | null; make: string | null; model: string | null; plate: string | null; plate_state: string | null; odometer: number; engine_hours: number };
  annual_inspection: { id: number; date: string; miles: number | null; next_due: string; passed?: boolean; inspector?: string | null } | null;
  inspections: { id: number; type: string; date: string; miles: number | null; passed: boolean; inspector: string | null;
    defects_activity_id: number | null; failed: number; repaired: number }[];
  repair_history: { id: number; date: string; title: string; category: string; component: string; miles: number | null; total: number }[];
  defects_closed: { id: number; reported: string; closed: string; title: string; description: string | null }[];
  deferred: { id: number; date: string; title: string; reason: string; until: string | null }[];
  open_items: { id: number; title: string; status: string; opened: string }[];
}

export type InspectionResultValue = 'pass' | 'fail' | 'repaired' | 'na';

export interface InspectionType {
  key: string;
  name: string;
  description: string | null;
  every_days: number | null;
  regulation: string | null;
  position: number;
}

export interface InspectionItem {
  id: string;
  type_key: string;
  section: string;
  section_position: number;
  position: number;
  label: string;
  guidance: string | null;
  reference: string | null;
  measure_unit: string | null;
  critical: boolean;
  active: boolean;
}

export interface Inspection {
  id: number;
  type_key: string;
  fleet_org_id: string;
  vehicle_id: string;
  activity_id: number | null;
  status: 'in_progress' | 'completed';
  passed: boolean | null;
  odometer_miles: number | null;
  engine_hours: number | null;
  inspector_name: string | null;
  notes: string | null;
  defects_activity_id: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface InspectionResult {
  inspection_id: number;
  item_id: string;
  result: InspectionResultValue;
  measurement: string | null;
  note: string | null;
}
