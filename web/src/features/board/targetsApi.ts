import type { CardKind } from './types'

const BASE = '/api/projects/studio-bridge'

// 보드가 카드 제목을 찾을 때 쓰는 서버 목록. 카드에는 제목을 저장하지 않는다.
export interface TargetInfo {
  kind: CardKind
  target_id: string
  title: string
}

async function getItems<T>(path: string): Promise<T[]> {
  const res = await fetch(`${BASE}/${path}`)
  if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
  const data = (await res.json()) as { items: T[] }
  return data.items
}

export async function fetchTargets(): Promise<TargetInfo[]> {
  const [materials, features] = await Promise.all([
    getItems<{ material_id: string; name: string }>('materials'),
    getItems<{ feature_id: string; title: string }>('features'),
  ])
  return [
    ...materials.map((m) => ({
      kind: 'material' as const,
      target_id: m.material_id,
      title: m.name,
    })),
    ...features.map((f) => ({
      kind: 'feature' as const,
      target_id: f.feature_id,
      title: f.title,
    })),
  ]
}
