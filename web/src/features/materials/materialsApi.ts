
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
  snapshot_count: number // 이 자료에 쌓인 수집본 수 (다시 보내도 이전 원문은 남는다)
  current_snapshot: Snapshot
}

export type SourceLookup = {
  source_uid: string
  material: MaterialDetail | null // 받은 적 없는 source_uid면 null
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

/** Studio 스크립트의 source_uid로 자료를 찾는다 (05회차 #20). 없으면 material: null */
export function findBySourceUid(sourceUid: string): Promise<SourceLookup> {
  return getJson<SourceLookup>(`${BASE}/by-source?source_uid=${encodeURIComponent(sourceUid)}`)
}
