import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { BoardCard } from './types'

export type SyncStatus = 'connecting' | 'connected' | 'disconnected'

const SYNC_URL = import.meta.env.VITE_SYNC_URL ?? 'ws://localhost:1234'
const ROOM = 'studio-bridge/main'

export interface BoardSync {
  // card_id -> 카드. 이동은 해당 카드 항목만 덮어쓴다.
  cards: Y.Map<BoardCard>
  destroy: () => void
}

export function connectBoardSync(
  onStatus: (status: SyncStatus) => void,
): BoardSync {
  const doc = new Y.Doc()
  const cards = doc.getMap<BoardCard>('cards')
  const provider = new WebsocketProvider(SYNC_URL, ROOM, doc)

  provider.on('status', ({ status }: { status: SyncStatus }) => onStatus(status))

  return {
    cards,
    destroy: () => {
      provider.destroy()
      doc.destroy()
    },
  }
}
