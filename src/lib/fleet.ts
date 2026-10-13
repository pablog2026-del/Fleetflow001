import { must, supabase } from './supabase';
import type { DocumentRow, Organization, RepairActivity, ServiceInterval, Vehicle } from './types';

export interface FleetData {
  org: Organization;
  vehicles: Vehicle[];
  intervals: ServiceInterval[];
  acts: RepairActivity[];
}

/** Everything the owner dashboard / activities / unit screens need for one fleet. */
export async function loadFleet(fleetId: string): Promise<FleetData> {
  const [org, vehicles, acts] = await Promise.all([
    supabase.from('organizations').select('*').eq('id', fleetId).single().then(must),
    supabase.from('vehicles').select('*').eq('fleet_org_id', fleetId).order('unit_number').then(must),
    supabase.from('repair_activities').select('*').eq('fleet_org_id', fleetId).order('id', { ascending: false }).then(must),
  ]);
  const ids = (vehicles as Vehicle[]).map((v) => v.id);
  const intervals = ids.length
    ? must(await supabase.from('service_intervals').select('*').in('vehicle_id', ids).neq('status', 'retired'))
    : [];
  return { org: org as Organization, vehicles: vehicles as Vehicle[], intervals: intervals as ServiceInterval[], acts: acts as RepairActivity[] };
}

export async function signedUrls(docs: DocumentRow[]): Promise<Record<string, string>> {
  const paths = docs.map((d) => d.storage_path).filter(Boolean) as string[];
  if (!paths.length) return {};
  const { data } = await supabase.storage.from('documents').createSignedUrls(paths, 3600);
  return Object.fromEntries((data ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
}

/** Upload a local image/file uri to <org>/<vehicle>/<name> and record it in documents. */
export async function uploadDocument(opts: { orgId: string; vehicleId?: string; activityId?: number; uri: string;
  kind: string; title: string; contentType?: string; userId: string }) {
  const blob = await (await fetch(opts.uri)).blob();
  const ext = (opts.contentType ?? blob.type ?? 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  const path = `${opts.orgId}/${opts.vehicleId ?? 'general'}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('documents').upload(path, blob, { contentType: opts.contentType ?? blob.type });
  if (error) throw new Error(error.message);
  must(await supabase.from('documents').insert({ org_id: opts.orgId, vehicle_id: opts.vehicleId ?? null,
    activity_id: opts.activityId ?? null, kind: opts.kind, title: opts.title, storage_path: path, created_by: opts.userId }));
}
