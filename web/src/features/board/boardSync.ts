import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { syncParams, syncUrl } from '../../shared/connection'
import { probeAccess, type AccessState } from './syncAccess'
import type { BoardCard, CardKind } from './types'

export type SyncStatus = 'connecting' | 'connected' | 'disconnected'

const ROOM = 'studio-bridge/main'

// 연결되지 않은 채 이만큼 지나면 /access로 이유를 묻고, 그래도 안 되면 간격을 두고 다시 묻는다.
const PROBE_DELAY_MS = 2000
const PROBE_RETRY_MS = 5000

// 새 카드만 배치한다. 이전 보드에 저장된 위치는 그대로 사용한다.
const GRID = { cols: 2, w: 274, h: 216, x: 36, y: 36 }

export interface BoardSync {
  // card_id -> 카드. 이동은 해당 카드 항목만 덮어쓴다.
  cards: Y.Map<BoardCard>
  // 제거된 card_id. 제거 뒤 늦게 도착한 이동이 카드를 되살리지 못하게 한다.
  removedCardIds: Y.Map<boolean>
  // 공동 메모. 카드와 같은 문서에 있어 같은 서버에 함께 저장된다.
  memo: Y.Text
  subscribeStatus: (listener: (status: SyncStatus) => void) => () => void
  // 연결되지 않은 이유(접속 거절인지 서버에 닿지 않는지). 연결되면 ok.
  subscribeAccess: (listener: (access: AccessState) => void) => () => void
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
  const memo = doc.getText('memo')
  const provider = new WebsocketProvider(syncUrl(), ROOM, doc, { params: syncParams() })

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
  let access: AccessState = { phase: 'unknown' }
  const accessListeners = new Set<(a: AccessState) => void>()
  const setAccess = (next: AccessState) => {
    access = next
    accessListeners.forEach((l) => l(next))
  }

  // 브라우저는 WebSocket이 거절돼도 이유를 알 수 없어 서버에 따로 묻는다.
  let destroyed = false
  let probing = false
  let probeTimer: ReturnType<typeof setTimeout> | undefined
  const probe = async () => {
    probeTimer = undefined
    probing = true
    const result = await probeAccess(ROOM)
    probing = false
    if (destroyed) return
    if (status === 'connected') {
      setAccess({ phase: 'ok' })
      return
    }
    setAccess(result)
    probeTimer = setTimeout(probe, PROBE_RETRY_MS)
  }
  const scheduleProbe = () => {
    if (!probeTimer && !probing && !destroyed) probeTimer = setTimeout(probe, PROBE_DELAY_MS)
  }

  provider.on('status', ({ status: next }: { status: SyncStatus }) => {
    status = next
    listeners.forEach((l) => l(next))
    if (next === 'connected') {
      clearTimeout(probeTimer)
      probeTimer = undefined
      setAccess({ phase: 'ok' })
    } else {
      scheduleProbe()
    }
  })
  scheduleProbe()

  return {
    cards,
    removedCardIds,
    memo,
    subscribeStatus: (listener) => {
      listeners.add(listener)
      listener(status)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribeAccess: (listener) => {
      accessListeners.add(listener)
      listener(access)
      return () => {
        accessListeners.delete(listener)
      }
    },
    destroy: () => {
      destroyed = true
      clearTimeout(probeTimer)
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

// 로컬·HTTPS와 공유 모드의 HTTP LAN 접속에서 모두 쓸 수 있는 카드 식별자.
function newCardId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

// 항상 새 card_id를 만든다. 같은 자료를 다시 추가하면 같은 target_id의 새 카드가 생긴다.
export function addCard(kind: CardKind, targetId: string): BoardCard {
  const { cards, removedCardIds } = getBoardSync()
  const n = cards.size
  let cardId = newCardId()
  while (cards.has(cardId) || removedCardIds.has(cardId)) cardId = newCardId()
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

// 이 브라우저에서 직접 입력한 변경의 출처 표시. 메모 화면이 내 입력과 남의 입력을 구분한다.
export const LOCAL_MEMO_ORIGIN = 'local-memo-edit'

// 입력창의 새 내용을 메모에 반영한다. 통째로 바꾸지 않고 앞뒤가 같은 부분을 빼고 바뀐 부분만
// 지우고 넣어서, 동시에 쓴 다른 사람의 글이 덮어써지지 않게 한다.
export function applyMemoEdit(next: string): void {
  const { memo } = getBoardSync()
  const prev = memo.toString()
  if (next === prev) return
  let start = 0
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--
    endNext--
  }
  const apply = () => {
    if (endPrev > start) memo.delete(start, endPrev - start)
    if (endNext > start) memo.insert(start, next.slice(start, endNext))
  }
  if (memo.doc) memo.doc.transact(apply, LOCAL_MEMO_ORIGIN)
  else apply()
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
