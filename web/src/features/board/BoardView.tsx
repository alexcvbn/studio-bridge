import { useCallback, useEffect, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import { Code2, Layers2, LayoutGrid, Plus, Trash2, Workflow } from 'lucide-react'
import '@xyflow/react/dist/style.css'
import { addCard, getBoardSync, moveCard, removeCard, type SyncStatus } from './boardSync'
import { fetchDecisions, fetchLinkedMaterials } from '../features/featuresApi'
import { MemoPanel } from './MemoPanel'
import { describeSync, type AccessState } from './syncAccess'
import type { TargetInfo } from './targetsApi'
import type { CardKind } from './types'

export interface BoardViewProps {
  targets: TargetInfo[]
  load: 'loading' | 'ready' | 'error'
  revision: number
  onOpen: (kind: CardKind, id: string) => void
  onExplore: () => void
}
type CardNode = Node<{ kind: CardKind; targetId: string }>
type Context = { links: string[]; decision?: string }
const key = (kind: CardKind, id: string) => kind + ':' + id

function syncNodes(prev: CardNode[]): CardNode[] {
  const { cards, removedCardIds } = getBoardSync()
  const existing = new Map(prev.map((n) => [n.id, n]))
  return [...cards.values()]
    .filter((card) => !removedCardIds.has(card.card_id))
    .map((card) => ({
      ...existing.get(card.card_id),
      id: card.card_id,
      position: card.position,
      data: { kind: card.kind, targetId: card.target_id },
    }))
}

export function BoardView({ targets, load, revision, onOpen, onExplore }: BoardViewProps) {
  const [nodes, setNodes] = useState<CardNode[]>(() => syncNodes([]))
  const [status, setStatus] = useState<SyncStatus>('connecting')
  const [access, setAccess] = useState<AccessState>({ phase: 'unknown' })
  const [pick, setPick] = useState('')
  const [adding, setAdding] = useState(false)
  const [contexts, setContexts] = useState<Record<string, Context>>({})
  useEffect(() => {
    const sync = getBoardSync()
    const apply = () => setNodes(syncNodes)
    sync.cards.observe(apply)
    sync.removedCardIds.observe(apply)
    const statusOff = sync.subscribeStatus(setStatus)
    const accessOff = sync.subscribeAccess(setAccess)
    return () => {
      sync.cards.unobserve(apply)
      sync.removedCardIds.unobserve(apply)
      statusOff()
      accessOff()
    }
  }, [])
  const featureIds = JSON.stringify(
    [...new Set(nodes.filter((n) => n.data.kind === 'feature').map((n) => n.data.targetId))].sort(),
  )
  useEffect(() => {
    let alive = true
    const ids: string[] = JSON.parse(featureIds)
    Promise.all(
      ids.map(async (id) => {
        const [links, decisions] = await Promise.allSettled([fetchLinkedMaterials(id), fetchDecisions(id)])
        return [
          id,
          {
            links: links.status === 'fulfilled' ? links.value.map((m) => m.material_id) : [],
            decision: decisions.status === 'fulfilled' ? decisions.value.current?.body : undefined,
          },
        ] as const
      }),
    ).then((entries) => {
      if (alive) setContexts(Object.fromEntries(entries))
    })
    return () => {
      alive = false
    }
  }, [featureIds, revision])

  const handleChanges = useCallback((changes: NodeChange<CardNode>[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev))
    for (const c of changes) if (c.type === 'position' && c.position) moveCard(c.id, c.position)
  }, [])
  const catalog = new Map(targets.map((t) => [key(t.kind, t.target_id), t]))
  const resolved = (n: CardNode) => catalog.get(key(n.data.kind, n.data.targetId))
  const display = nodes.map((n) => {
    const t = resolved(n)
    const feature = n.data.kind === 'feature'
    const decision = feature ? contexts[n.data.targetId]?.decision : undefined
    return {
      ...n,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      className: 'canvas-card ' + n.data.kind,
      data: {
        ...n.data,
        label: (
          <>
            <div className="card-top">
              <span className={'type-icon ' + n.data.kind}>{feature ? <Layers2 /> : <Code2 />}</span>
              <span>{feature ? '기능' : '코드 자료'}</span>
              <small>{t?.badge}</small>
            </div>
            <strong>
              {t?.title ??
                (load === 'ready' ? '찾을 수 없음' : load === 'error' ? '확인 실패' : '불러오는 중…')}
            </strong>
            {decision && (
              <div className="decision-preview">
                <span>현재 결정</span>
                <p>{decision}</p>
              </div>
            )}
            <div className="card-desc" title={t?.detail}>
              {feature && t?.detail !== '담당 미지정' && '담당 · '}
              {t?.detail ?? n.data.targetId.slice(0, 8)}
            </div>
          </>
        ),
      },
    }
  })
  const materials = nodes.filter((n) => n.data.kind === 'material')
  const edges = nodes
    .filter((n) => n.data.kind === 'feature')
    .flatMap((f) =>
      materials
        .filter((m) => contexts[f.data.targetId]?.links.includes(m.data.targetId))
        .map((m) => ({
          id: f.id + ':' + m.id,
          source: f.id,
          target: m.id,
          selectable: false,
        })),
    )
  const selected = nodes.find((n) => n.selected)
  const sync = describeSync(status, access)
  function add() {
    const t = catalog.get(pick)
    if (t) {
      addCard(t.kind, t.target_id)
      setAdding(false)
    }
  }
  return (
    <section className="board-pane">
      <div className="board-title">
        <div className="board-icon">
          <LayoutGrid />
        </div>
        <h1>협업 보드</h1>
        <span className="count" data-testid="card-count">
          카드 {nodes.length}개
        </span>
        <button className="primary" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          <Plus /> 카드 추가
        </button>
        {adding && (
          <div className="add-pop">
            <label htmlFor="target">보드에 추가할 항목</label>
            <select
              id="target"
              aria-label="추가할 자료 또는 기능"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">기능 또는 자료 선택</option>
              {targets.map((t) => (
                <option key={key(t.kind, t.target_id)} value={key(t.kind, t.target_id)}>
                  {t.kind === 'feature' ? '기능' : '자료'} · {t.title}
                </option>
              ))}
            </select>
            <button className="primary" disabled={!catalog.has(pick)} onClick={add}>
              추가
            </button>
          </div>
        )}
      </div>
      <div className="canvas">
        <ReactFlow
          nodes={display}
          edges={edges}
          onNodesChange={handleChanges}
          nodesConnectable={false}
          deleteKeyCode={null}
          defaultViewport={{ x: 18, y: 28, zoom: 0.95 }}
          onNodeClick={(_, n) => {
            if (resolved(n)) onOpen(n.data.kind, n.data.targetId)
          }}
        >
          <Background variant={BackgroundVariant.Lines} gap={22} size={1} color="#e3e8ee" />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
        {nodes.length === 0 && (
          <div className="canvas-empty">
            <span>
              <Workflow />
            </span>
            <h2>보드에 첫 카드를 놓아보세요</h2>
            <p>팀이 작업 중인 기능과 코드 자료를 한곳에서 연결해 보세요.</p>
            <button onClick={() => (targets.length ? setAdding(true) : onExplore())}>
              {targets.length ? '카드 선택' : '새 기능 만들기'}
            </button>
          </div>
        )}
        {selected && (
          <div className="selection-tools">
            {resolved(selected) && (
              <button onClick={() => onOpen(selected.data.kind, selected.data.targetId)}>상세 열기</button>
            )}
            <button
              title="보드에서 카드 제거"
              aria-label="보드에서 카드 제거"
              onClick={() => removeCard(selected.id)}
            >
              <Trash2 />
            </button>
          </div>
        )}
      </div>
      <MemoPanel status={status} access={access} />
      <div className={'sync-line ' + sync.tone} data-testid="sync-status">
        <i />
        {sync.text}
      </div>
    </section>
  )
}
