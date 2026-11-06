import { sb, q } from './supabase';

export type Sub = { id?: string; name: string; amount: number; is_patent: boolean; sort?: number };
export type Project = {
  id: string; company_id: string; name: string; client: string | null; prime_contractor: string | null; prime_amount: number;
  start_date: string | null; end_date: string | null; patent_method: string | null; status: string; memo: string | null;
  project_subcontracts: Sub[]; summary?: { progress_pct: number; done_amount: number; design_amount: number; sub_amount: number };
};

export async function listProjects(company: string): Promise<Project[]> {
  let qy = sb.from('projects').select('*, project_subcontracts(*)').order('start_date', { ascending: false, nullsFirst: false });
  if (company !== 'all') qy = qy.eq('company_id', company);
  const [ps, sums] = await Promise.all([q<Project[]>(qy), q<any[]>(sb.from('v_project_summary').select('*'))]);
  const m = new Map(sums.map((s) => [s.project_id, s]));
  return ps.map((p) => ({ ...p, project_subcontracts: (p.project_subcontracts || []).sort((a, b) => (a.sort || 0) - (b.sort || 0)), summary: m.get(p.id) }));
}

export async function getProject(id: string): Promise<Project> {
  const p = await q<Project>(sb.from('projects').select('*, project_subcontracts(*)').eq('id', id).single());
  const s = await q<any>(sb.from('v_project_summary').select('*').eq('project_id', id).maybeSingle());
  p.project_subcontracts.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  return { ...p, summary: s || undefined };
}

export type Loc = { id: string; facility_id: string; name: string; sort: number };
export type Fac = { id: string; project_id: string; name: string; kind: string | null; sort: number; locations: Loc[] };
export type Work = { id: string; project_id: string; name: string; spec: string | null; unit: string; unit_price: number; sort: number };
export type Structure = { facilities: Fac[]; works: Work[]; lw: { location_id: string; work_item_id: string; design_qty: number }[] };

export async function loadStructure(pid: string): Promise<Structure> {
  const [facilities, works] = await Promise.all([
    q<Fac[]>(sb.from('facilities').select('*, locations(*)').eq('project_id', pid).order('sort')),
    q<Work[]>(sb.from('work_items').select('*').eq('project_id', pid).order('sort')),
  ]);
  facilities.forEach((f) => f.locations.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
  const locIds = facilities.flatMap((f) => f.locations.map((l) => l.id));
  const lw = locIds.length ? await q<any[]>(sb.from('location_work').select('*').in('location_id', locIds)) : [];
  return { facilities, works, lw };
}

export async function myProjects(): Promise<{ id: string; name: string }[]> {
  return q(sb.from('projects').select('id, name').eq('status', 'active').order('name'));
}

export async function logAction(project_id: string | null, action: string, target?: string, reason?: string) {
  const { data } = await sb.auth.getUser();
  await sb.from('activity_log').insert({ project_id, user_id: data.user?.id, action, target, reason });
}
