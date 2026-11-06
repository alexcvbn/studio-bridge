import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { connectBoardSync, type BoardSync, type SyncStatus } from './boardSync'
import { labelFor } from './sampleCards'
import type { BoardCard } from './types'

const STATUS_TEXT: Record<SyncStatus, string> = {
  connecting: '동기화 연결 중',
  connected: '동기화 연결됨',
  disconnected: '동기화 연결 끊김',
}

export interface BoardViewProps {
  onOpenFeature?: (featureId: string) => void
}

type CardNode = Node<{ label: string; targetId: string }>

function cardToNode(card: BoardCard, order: number): CardNode {
  const label = labelFor(card, order)
  return {
    id: card.card_id,
    type: card.kind,
    position: card.position,
    data: {
      label: `${label.title} · ${label.subtitle}`,
      targetId: card.target_id,
    },
  }
}

export function BoardView({ onOpenFeature }: BoardViewProps) {
  // 노드 상태는 React Flow가 잰 크기·선택 정보를 보존하도록 그대로 들고 있는다.
  // (매 렌더마다 노드를 새로 만들면 크기 정보가 사라져 드래그 중 카드가 숨겨진다.)
  const [nodes, setNodes] = useState<CardNode[]>([])
  const [status, setStatus] = useState<SyncStatus>('connecting')
  const sharedCards = useRef<BoardSync['cards'] | null>(null)

  useEffect(() => {
    const sync = connectBoardSync(setStatus)
    sharedCards.current = sync.cards
    // 공유 상태가 바뀌면(내 이동 포함) 기존 노드 객체는 유지하고 위치만 갱신한다.
    const apply = () => {
      const shared = [...sync.cards.values()]
      setNodes((prev) =>
        shared.map((card, i) => {
          const old = prev.find((n) => n.id === card.card_id)
          return old
            ? { ...old, position: card.position }
            : cardToNode(card, i + 1)
        }),
      )
    }
    sync.cards.observe(apply)
    return () => {
      sync.cards.unobserve(apply)
      sharedCards.current = null
      sync.destroy()
    }
  }, [])

  // 보드 데이터 모델: 이동은 해당 카드의 position만 바뀐다.
  const cards: BoardCard[] = nodes.map((n) => ({
    card_id: n.id,
    kind: n.type === 'feature' ? 'feature' : 'material',
    target_id: n.data.targetId,
    position: n.position,
  }))

  const handleNodesChange = useCallback((changes: NodeChange<CardNode>[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev))
    // 이동한 카드의 위치만 공유 상태에 반영한다.
    for (const change of changes) {
      if (change.type !== 'position' || !change.position) continue
      const card = sharedCards.current?.get(change.id)
      if (card) sharedCards.current?.set(change.id, { ...card, position: change.position })
    }
  }, [])

  const handleAdd = () => {
    const n = (sharedCards.current?.size ?? 0) + 1
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const card: BoardCard = {
      card_id: `card_added_${id}`,
      kind: 'material',
      target_id: `material_sample_added_${id}`,
      position: { x: 40 + n * 30, y: 220 + n * 30 },
    }
    sharedCards.current?.set(card.card_id, card)
  }

  const selectedNode = nodes.find((n) => n.selected)
  const selected = cards.find((c) => c.card_id === selectedNode?.id)

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div role="note" style={{ padding: 8, background: '#fff7d6', color: '#5c4a00' }}>
        예시 데이터입니다. 카드 이동은 같은 동기화 서버에 접속한 브라우저와 공유되며, 서버를 끄면 초기화됩니다.
      </div>
      <div style={{ padding: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button type="button" onClick={handleAdd}>
          카드 추가
        </button>
        <span data-testid="sync-status">{STATUS_TEXT[status]}</span>
        <span data-testid="card-count">카드 {cards.length}개</span>
        <span data-testid="selected-card">
          선택: {selected ? selected.card_id : '없음'}
        </span>
        {selected?.kind === 'feature' && onOpenFeature && (
          <button type="button" onClick={() => onOpenFeature(selected.target_id)}>
            기능 열기
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 400 }}>
        <ReactFlow
          nodes={nodes}
          edges={[]}
          onNodesChange={handleNodesChange}
          defaultViewport={{ x: 20, y: 20, zoom: 1 }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  )
}
