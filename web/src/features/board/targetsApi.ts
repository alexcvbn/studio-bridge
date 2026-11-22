import { fetchFeatures, type FeatureStatus } from '../features/featuresApi'
import { fetchMaterials } from '../materials/materialsApi'
import type { CardKind } from './types'

export interface TargetInfo {
  kind: CardKind
  target_id: string
  title: string
  detail: string
  badge: string
}

export const statusLabel: Record<FeatureStatus, string> = { todo: '대기', doing: '진행 중', done: '완료' }

export async function fetchTargets(): Promise<TargetInfo[]> {
  const [features, materials] = await Promise.all([fetchFeatures(), fetchMaterials()])
  return [
    ...features.map((f) => ({
      kind: 'feature' as const,
      target_id: f.feature_id,
      title: f.title,
      detail: f.assignee ?? '담당 미지정',
      badge: statusLabel[f.status],
    })),
    ...materials.map((m) => ({
      kind: 'material' as const,
      target_id: m.material_id,
      title: m.name,
      detail: m.source_path,
      badge: m.script_type,
    })),
  ]
}
