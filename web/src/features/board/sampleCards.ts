import type { BoardCard, CardLabel } from './types'

export const SAMPLE_CARDS: BoardCard[] = [
  {
    card_id: 'card_sample_material',
    kind: 'material',
    target_id: 'material_sample_bossai',
    position: { x: 40, y: 80 },
  },
  {
    card_id: 'card_sample_feature',
    kind: 'feature',
    target_id: 'feature_sample_boss_phase2',
    position: { x: 320, y: 80 },
  },
]

// 02회차 이후에는 target_id로 DB에서 읽는다. 지금은 예시 데이터다.
export const SAMPLE_LABELS: Record<string, CardLabel> = {
  material_sample_bossai: { title: 'BossAI', subtitle: '자료 (예시)' },
  feature_sample_boss_phase2: { title: '보스 2페이즈', subtitle: '기능 (예시)' },
}

export function labelFor(card: BoardCard, order: number): CardLabel {
  return (
    SAMPLE_LABELS[card.target_id] ?? {
      title: `예시 자료 ${order}`,
      subtitle: '자료 (예시)',
    }
  )
}
