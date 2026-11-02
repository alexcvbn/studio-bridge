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
