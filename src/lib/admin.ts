import { must, supabase } from './supabase';
import type { Invoice, Organization, RepairActivity, ServiceInterval, Vehicle } from './types';

export interface PlatformData {
  fleets: Organization[];
  vehicles: Vehicle[];
  intervals: ServiceInterval[];
  acts: RepairActivity[];
  invoices: Invoice[];
}

/** Admin sees every org (RLS: is_admin). Fine at stage-one scale; paginate later. */
export async function loadPlatform(): Promise<PlatformData> {
  const [fleets, vehicles, intervals, acts, invoices] = await Promise.all([
    supabase.from('organizations').select('*').eq('type', 'fleet').order('name').then(must),
    supabase.from('vehicles').select('*').order('unit_number').then(must),
    supabase.from('service_intervals').select('*').neq('status', 'retired').then(must),
    supabase.from('repair_activities').select('*').order('id', { ascending: false }).then(must),
    supabase.from('invoices').select('*').neq('status', 'void').order('issued_on', { ascending: false }).then(must),
  ]);
  return { fleets: fleets as Organization[], vehicles: vehicles as Vehicle[], intervals: intervals as ServiceInterval[],
    acts: acts as RepairActivity[], invoices: invoices as Invoice[] };
}
