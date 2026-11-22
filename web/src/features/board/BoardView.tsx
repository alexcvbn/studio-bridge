import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  MarkerType,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import {
  Code2,
  Layers2,
  FolderOpen,
  Hand,
  MousePointer2,
  StickyNote,
  Plus,
  Trash2,
  Workflow,
  Link2,
  UserRound,
  X,
} from 'lucide-react'
import '@xyflow/react/dist/style.css'
import { addCard, getBoardSync, moveCard, removeCard, type SyncStatus } from './boardSync'
import { fetchDecisions, fetchLinkedMaterials } from '../features/featuresApi'
import { CardPicker } from './CardPicker'
import { CanvasNavigation } from './CanvasNavigation'
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
  libraryOpen: boolean
  onLibrary: () => void
}
type CardNode = Node<{ kind: CardKind; targetId: string }>
type Context = { links?: string[]; decision?: string }
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

export function BoardView({
  targets,
  load,
  revision,
  onOpen,
  onExplore,
  libraryOpen,
  onLibrary,
}: BoardViewProps) {
  const [nodes, setNodes] = useState<CardNode[]>(() => syncNodes([]))
  const [status, setStatus] = useState<SyncStatus>('connecting')
  const [access, setAccess] = useState<AccessState>({ phase: 'unknown' })
  const addTrigger = useRef<HTMLButtonElement>(null)
  const [adding, setAdding] = useState(false)
  const [tool, setTool] = useState<'select' | 'hand'>('select')
  const [memoOpen, setMemoOpen] = useState(false)
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
            links: links.status === 'fulfilled' ? links.value.map((m) => m.material_id) : undefined,
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
            <div className="card-foot" title={t?.detail}>
              {feature ? <UserRound /> : <Code2 />}
              <span>{t?.detail ?? n.data.targetId.slice(0, 8)}</span>
              {feature && contexts[n.data.targetId]?.links && (
                <span className="link-count" title="연결 자료 수">
                  <Link2 />
                  {contexts[n.data.targetId].links?.length}
                </span>
              )}
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
        .filter((m) => contexts[f.data.targetId]?.links?.includes(m.data.targetId))
        .map((m) => ({
          id: f.id + ':' + m.id,
          source: f.id,
          target: m.id,
          selectable: false,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#8c82ac', width: 14, height: 14 },
        })),
    )
  const selectedNodes = nodes.filter((n) => n.selected)
  const selected = selectedNodes.length === 1 ? selectedNodes[0] : undefined
  const sync = describeSync(status, access)
  function dismissPicker() {
    setAdding(false)
    addTrigger.current?.focus()
  }
  return (
    <section className="board-pane">
      <div className="canvas" data-tool={tool}>
        <ReactFlow
          nodes={display}
          edges={edges}
          onNodesChange={handleChanges}
          nodesConnectable={false}
          deleteKeyCode={null}
          minZoom={0.25}
          nodesDraggable={tool === 'select'}
          elementsSelectable={tool === 'select'}
          panOnDrag={tool === 'hand' ? true : [1, 2]}
          panOnScroll
          selectionOnDrag={tool === 'select'}
          onPaneClick={() => setAdding(false)}
          defaultViewport={{ x: 18, y: 28, zoom: 0.95 }}
          onNodeClick={(_, n) => {
            if (tool === 'select' && resolved(n)) onOpen(n.data.kind, n.data.targetId)
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.25} color="#ccc7d4" />
          <CanvasNavigation />
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
        {selected && tool === 'select' && (
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
      <div className="board-status">
        <span data-testid="card-count">
          <Layers2 />
          카드 {nodes.length}개
        </span>
        <span className={'sync-line ' + sync.tone} data-testid="sync-status">
          <i />
          {sync.text}
        </span>
      </div>
      <div className="dock-wrap">
        <div className="dock" role="toolbar" aria-label="보드 도구">
          <button
            aria-label="카드 라이브러리"
            title="카드 라이브러리"
            aria-pressed={libraryOpen}
            onClick={onLibrary}
          >
            <FolderOpen />
          </button>
          <span className="bar-divider" />
          <button
            aria-pressed={tool === 'select'}
            title="선택"
            aria-label="선택"
            onClick={() => setTool('select')}
          >
            <MousePointer2 />
          </button>
          <button
            aria-pressed={tool === 'hand'}
            title="손 도구 · 보드 이동"
            aria-label="손 도구"
            onClick={() => setTool('hand')}
          >
            <Hand />
          </button>
          <span className="bar-divider" />
          <button
            className="memo-toggle"
            aria-label="공동 메모 열기"
            title="공동 메모"
            aria-expanded={memoOpen}
            onClick={() => setMemoOpen(!memoOpen)}
          >
            <StickyNote />
          </button>
          <button
            ref={addTrigger}
            className="add-trigger"
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            <Plus /> 카드 추가
          </button>
        </div>
        {adding && (
          <CardPicker
            targets={targets}
            load={load}
            onDismiss={dismissPicker}
            onPick={(t) => {
              addCard(t.kind, t.target_id)
              dismissPicker()
            }}
          />
        )}
      </div>
      <div className="memo-note" hidden={!memoOpen}>
        <button
          className="note-close icon-btn"
          aria-label="공동 메모 닫기"
          onClick={() => setMemoOpen(false)}
        >
          <X />
        </button>
        <MemoPanel status={status} access={access} />
      </div>
    </section>
  )
}
