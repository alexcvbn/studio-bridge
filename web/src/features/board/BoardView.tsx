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
import { fetchTargets, type TargetInfo } from './targetsApi'
import type { BoardCard, CardKind } from './types'

const STATUS_TEXT: Record<SyncStatus, string> = {
  connecting: '동기화 연결 중',
  connected: '동기화 연결됨',
  disconnected: '동기화 연결 끊김',
}

const KIND_TEXT: Record<CardKind, string> = { material: '자료', feature: '기능' }

// 새 카드는 카드 폭(200px)에 맞춘 격자에 놓아 서로 겹치지 않게 한다.
const GRID = { cols: 4, w: 240, h: 110, x: 40, y: 40 }

export interface BoardViewProps {
  onOpenFeature?: (featureId: string) => void
}

type TargetState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; targets: TargetInfo[] }

type CardNode = Node<{ kind: CardKind; targetId: string }>

const key = (kind: CardKind, id: string) => `${kind}:${id}`

function cardToNode(card: BoardCard): CardNode {
  return {
    id: card.card_id,
    position: card.position,
    data: { kind: card.kind, targetId: card.target_id },
  }
}

export function BoardView({ onOpenFeature }: BoardViewProps) {
  // 노드 상태는 React Flow가 잰 크기·선택 정보를 보존하도록 그대로 들고 있는다.
  const [nodes, setNodes] = useState<CardNode[]>([])
  const [status, setStatus] = useState<SyncStatus>('connecting')
  const [targetState, setTargetState] = useState<TargetState>({ phase: 'loading' })
  const [pick, setPick] = useState('')
  const sharedCards = useRef<BoardSync['cards'] | null>(null)

  useEffect(() => {
    const sync = connectBoardSync(setStatus)
    sharedCards.current = sync.cards
    // 공유 상태가 바뀌면(내 이동 포함) 기존 노드 객체는 유지하고 위치만 갱신한다.
    const apply = () => {
      const shared = [...sync.cards.values()]
      setNodes((prev) =>
        shared.map((card) => {
          const old = prev.find((n) => n.id === card.card_id)
          return old ? { ...old, position: card.position } : cardToNode(card)
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

  const loadTargets = useCallback(() => {
    fetchTargets().then(
      (targets) => setTargetState({ phase: 'ready', targets }),
      () => setTargetState({ phase: 'error' }),
    )
  }, [])

  // 처음 상태가 이미 'loading'이라 effect에서는 요청만 보낸다.
  useEffect(() => {
    loadTargets()
  }, [loadTargets])

  const retryTargets = () => {
    setTargetState({ phase: 'loading' })
    loadTargets()
  }

  const titles = new Map<string, string>()
  if (targetState.phase === 'ready') {
    for (const t of targetState.targets) titles.set(key(t.kind, t.target_id), t.title)
  }

  // 목록을 아직 못 읽었거나 읽기에 실패했으면 "없음"으로 단정하지 않는다.
  const resolve = (kind: CardKind, id: string) => {
    if (targetState.phase === 'loading') return { text: '불러오는 중', tone: 'wait' as const }
    if (targetState.phase === 'error') return { text: '확인 실패', tone: 'fail' as const }
    const title = titles.get(key(kind, id))
    return title === undefined
      ? { text: '찾을 수 없음', tone: 'missing' as const }
      : { text: title, tone: 'ok' as const }
  }

  const nodesWithLabels: CardNode[] = nodes.map((n) => {
    const { kind, targetId } = n.data
    const r = resolve(kind, targetId)
    return {
      ...n,
      className: `card-${r.tone}`,
      style: {
        width: 200,
        border: r.tone === 'missing' || r.tone === 'fail' ? '2px solid #d32f2f' : '1px solid #888',
        background: r.tone === 'ok' ? '#fff' : '#fdeceb',
      },
      data: {
        ...n.data,
        label: (
          <div>
            <strong>{r.text}</strong>
            <div style={{ fontSize: 11 }}>
              {KIND_TEXT[kind]} · {targetId.slice(0, 8)}
            </div>
          </div>
        ),
      },
    } as CardNode
  })

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
    if (targetState.phase !== 'ready' || !pick) return
    const target = targetState.targets.find((t) => key(t.kind, t.target_id) === pick)
    if (!target || !sharedCards.current) return
    const n = sharedCards.current.size
    const card: BoardCard = {
      card_id: crypto.randomUUID(),
      kind: target.kind,
      target_id: target.target_id,
      position: {
        x: GRID.x + (n % GRID.cols) * GRID.w,
        y: GRID.y + Math.floor(n / GRID.cols) * GRID.h,
      },
    }
    sharedCards.current.set(card.card_id, card)
  }

  const selectedNode = nodes.find((n) => n.selected)
  const selected = selectedNode && {
    card_id: selectedNode.id,
    ...selectedNode.data,
  }
  const canOpen =
    selected?.kind === 'feature' &&
    onOpenFeature &&
    resolve('feature', selected.targetId).tone === 'ok'

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          aria-label="추가할 자료 또는 기능"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          disabled={targetState.phase !== 'ready'}
        >
          <option value="">
            {targetState.phase === 'ready' ? '추가할 항목 선택' : '목록을 불러오지 못했습니다'}
          </option>
          {targetState.phase === 'ready' &&
            targetState.targets.map((t) => (
              <option key={key(t.kind, t.target_id)} value={key(t.kind, t.target_id)}>
                [{KIND_TEXT[t.kind]}] {t.title} ({t.target_id.slice(0, 8)})
              </option>
            ))}
        </select>
        <button type="button" onClick={handleAdd} disabled={!pick}>
          카드 추가
        </button>
        {targetState.phase === 'error' && (
          <>
            <span role="alert" style={{ color: '#d32f2f' }}>
              서버에서 자료·기능 목록을 읽지 못했습니다.
            </span>
            <button type="button" onClick={retryTargets}>
              다시 시도
            </button>
          </>
        )}
        <span data-testid="sync-status">{STATUS_TEXT[status]}</span>
        <span data-testid="card-count">카드 {nodes.length}개</span>
        <span data-testid="selected-card">
          선택:{' '}
          {selected
            ? `카드 ${selected.card_id.slice(0, 8)} → ${KIND_TEXT[selected.kind]} ${selected.targetId.slice(0, 8)}`
            : '없음'}
        </span>
        {canOpen && selected && (
          <button type="button" onClick={() => onOpenFeature(selected.targetId)}>
            기능 열기
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 400 }}>
        <ReactFlow
          nodes={nodesWithLabels}
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
