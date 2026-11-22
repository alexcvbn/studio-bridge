export type CardKind = 'material' | 'feature'

export interface BoardCard {
  card_id: string
  kind: CardKind
  target_id: string
  position: { x: number; y: number }
}

export interface CardLabel {
  title: string
  subtitle: string
}

// 카드끼리 잇는 관계. DB 테이블 관계처럼 양 끝의 개수(1 또는 여러 개)를 표시한다.
export type Relation = '1:1' | '1:N' | 'N:M'

export interface BoardConnection {
  connection_id: string
  // 연결을 시작한 카드와 끝나는 카드의 card_id
  source: string
  target: string
  relation: Relation
  // 관계 이름(예: "사용", "호출"). 비어 있을 수 있다.
  label: string
}
