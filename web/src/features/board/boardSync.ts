import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { BoardCard, CardKind } from './types'

export type SyncStatus = 'connecting' | 'connected' | 'disconnected'

const SYNC_URL = import.meta.env.VITE_SYNC_URL ?? 'ws://localhost:1234'
const ROOM = 'studio-bridge/main'

// 새 카드는 카드 폭(200px)에 맞춘 격자에 놓아 서로 겹치지 않게 한다.
const GRID = { cols: 4, w: 240, h: 110, x: 40, y: 40 }

export interface BoardSync {
  // card_id -> 카드. 이동은 해당 카드 항목만 덮어쓴다.
  cards: Y.Map<BoardCard>
  // 제거된 card_id. 제거 뒤 늦게 도착한 이동이 카드를 되살리지 못하게 한다.
  removedCardIds: Y.Map<boolean>
  subscribeStatus: (listener: (status: SyncStatus) => void) => () => void
}

interface Shared extends BoardSync {
  destroy: () => void
}

// 보드 화면이 숨겨져 있어도 자료함이 카드를 추가할 수 있도록 앱 전체에서 하나만 연결한다.
let shared: Shared | null = null

function connect(): Shared {
  const doc = new Y.Doc()
  const cards = doc.getMap<BoardCard>('cards')
  const removedCardIds = doc.getMap<boolean>('removedCardIds')
  const provider = new WebsocketProvider(SYNC_URL, ROOM, doc)

  // 제거된 카드에 늦게 도착한 이동이 문서에 카드를 다시 넣어도 바로 지운다.
  // 이미 지운 항목을 다시 지우는 것은 변화가 없어 다른 클라이언트와 무한히 주고받지 않는다.
  const purgeRemoved = () => {
    const stale = [...cards.keys()].filter((id) => removedCardIds.has(id))
    if (stale.length > 0) doc.transact(() => stale.forEach((id) => cards.delete(id)))
  }
  cards.observe(purgeRemoved)
  removedCardIds.observe(purgeRemoved)

  let status: SyncStatus = 'connecting'
  const listeners = new Set<(s: SyncStatus) => void>()
  provider.on('status', ({ status: next }: { status: SyncStatus }) => {
    status = next
    listeners.forEach((l) => l(next))
  })

  return {
    cards,
    removedCardIds,
    subscribeStatus: (listener) => {
      listeners.add(listener)
      listener(status)
      return () => {
        listeners.delete(listener)
      }
    },
    destroy: () => {
      provider.destroy()
      doc.destroy()
    },
  }
}

export function getBoardSync(): BoardSync {
  shared ??= connect()
  return shared
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    shared?.destroy()
    shared = null
  })
}

// 항상 새 card_id를 만든다. 같은 자료를 다시 추가하면 같은 target_id의 새 카드가 생긴다.
export function addCard(kind: CardKind, targetId: string): BoardCard {
  const { cards, removedCardIds } = getBoardSync()
  const n = cards.size
  let cardId = crypto.randomUUID()
  while (removedCardIds.has(cardId)) cardId = crypto.randomUUID()
  const card: BoardCard = {
    card_id: cardId,
    kind,
    target_id: targetId,
    position: {
      x: GRID.x + (n % GRID.cols) * GRID.w,
      y: GRID.y + Math.floor(n / GRID.cols) * GRID.h,
    },
  }
  cards.set(card.card_id, card)
  return card
}

// 해당 카드의 position만 갱신한다. 없는·제거된 카드이거나 위치가 그대로면 아무것도 쓰지 않는다.
export function moveCard(cardId: string, position: { x: number; y: number }): void {
  const { cards, removedCardIds } = getBoardSync()
  const card = cards.get(cardId)
  if (!card || removedCardIds.has(cardId)) return
  if (card.position.x === position.x && card.position.y === position.y) return
  cards.set(cardId, { ...card, position })
}

// 보드 상태에서만 제거한다. 자료·기능·결정 등 서버 데이터는 건드리지 않는다.
export function removeCard(cardId: string): void {
  const { cards, removedCardIds } = getBoardSync()
  const remove = () => {
    cards.delete(cardId)
    removedCardIds.set(cardId, true)
  }
  if (cards.doc) cards.doc.transact(remove)
  else remove()
}

// 자료함의 onAddMaterial(materialId)에 그대로 연결할 수 있다.
export function addMaterialCard(materialId: string): BoardCard {
  return addCard('material', materialId)
}
