import { useCallback, useRef, useState } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { SAMPLE_CARDS, labelFor } from './sampleCards'
import type { BoardCard } from './types'

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
  const [nodes, setNodes] = useState<CardNode[]>(() =>
    SAMPLE_CARDS.map((c, i) => cardToNode(c, i + 1)),
  )
  const nextId = useRef(1)

  // 보드 데이터 모델: 이동은 해당 카드의 position만 바뀐다.
  const cards: BoardCard[] = nodes.map((n) => ({
    card_id: n.id,
    kind: n.type === 'feature' ? 'feature' : 'material',
    target_id: n.data.targetId,
    position: n.position,
  }))

  const handleNodesChange = useCallback((changes: NodeChange<CardNode>[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev))
  }, [])

  const handleAdd = () => {
    const n = nextId.current++
    const card: BoardCard = {
      card_id: `card_added_${n}`,
      kind: 'material',
      target_id: `material_sample_added_${n}`,
      position: { x: 40 + n * 30, y: 220 + n * 30 },
    }
    setNodes((prev) => [...prev, cardToNode(card, prev.length + 1)])
  }

  const selectedNode = nodes.find((n) => n.selected)
  const selected = cards.find((c) => c.card_id === selectedNode?.id)

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div role="note" style={{ padding: 8, background: '#fff7d6', color: '#5c4a00' }}>
        예시 데이터입니다. 새로고침하면 초기화됩니다. (서버·다른 사람과 동기화되지 않음)
      </div>
      <div style={{ padding: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button type="button" onClick={handleAdd}>
          카드 추가
        </button>
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
          fitView
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  )
}
