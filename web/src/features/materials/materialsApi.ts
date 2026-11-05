
const BASE = '/api/projects/studio-bridge/materials'

export type MaterialSummary = {
  material_id: string
  source_uid: string
  name: string
  source_path: string
  script_type: string
  received_at: string
}

export type Snapshot = {
  snapshot_id: string
  request_id: string
  name: string
  source_path: string
  script_type: string
  raw_code: string
  received_at: string
}

export type MaterialDetail = {
  material_id: string
  source_uid: string
  current_snapshot: Snapshot
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail?.message ?? `서버 오류 (${res.status})`)
  }
  return res.json() as Promise<T>
}

export async function fetchMaterials(): Promise<MaterialSummary[]> {
  const data = await getJson<{ items: MaterialSummary[] }>(BASE)
  return data.items
}

export function fetchMaterial(materialId: string): Promise<MaterialDetail> {
  return getJson<MaterialDetail>(`${BASE}/${materialId}`)
}
