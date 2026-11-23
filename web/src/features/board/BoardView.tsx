import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
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
  Spline,
  UserRound,
  X,
} from 'lucide-react'
import '@xyflow/react/dist/style.css'
import {
  CARD_COLORS,
  addCard,
  addConnection,
  getBoardSync,
  moveCard,
  removeCard,
  resizeCard,
  setCardColor,
  type SyncStatus,
} from './boardSync'
import { fetchDecisions, fetchLinkedMaterials } from '../features/featuresApi'
import { CardPicker } from './CardPicker'
import { CanvasNavigation } from './CanvasNavigation'
import { CardNode } from './CardNode'
import { HandleRepair } from './HandleRepair'
import { ConnectionTools } from './ConnectionTools'
import { RelationEdge } from './RelationEdge'
import { MemoPanel } from './MemoPanel'
import type { AccessState } from './syncAccess'
import type { TargetInfo } from './targetsApi'
import type { BoardConnection, CardColor, CardKind } from './types'

export interface BoardViewProps {
  targets: TargetInfo[]
  load: 'loading' | 'ready' | 'error'
  revision: number
  onOpen: (kind: CardKind, id: string) => void
  onExplore: () => void
  libraryOpen: boolean
  onLibrary: () => void
}
type CardNode = Node<{ kind: CardKind; targetId: string; color?: CardColor }>
type Context = { links?: string[]; decision?: string }
const key = (kind: CardKind, id: string) => kind + ':' + id
// 렌더마다 새로 만들면 React Flow가 경고하므로 밖에 둔다.
const edgeTypes: EdgeTypes = { relation: RelationEdge }
const nodeTypes: NodeTypes = { card: CardNode }
const readConnections = () => {
  const { connections, removedConnectionIds } = getBoardSync()
  return [...connections.values()].filter((c) => !removedConnectionIds.has(c.connection_id))
}

function syncNodes(prev: CardNode[]): CardNode[] {
  const { cards, removedCardIds } = getBoardSync()
  const existing = new Map(prev.map((n) => [n.id, n]))
  return [...cards.values()]
    .filter((card) => !removedCardIds.has(card.card_id))
    .map((card) => ({
      ...existing.get(card.card_id),
      id: card.card_id,
      position: card.position,
      width: card.size?.width,
      height: card.size?.height,
      data: { kind: card.kind, targetId: card.target_id, color: card.color },
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
  const [connections, setConnections] = useState<BoardConnection[]>(readConnections)
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null)
  // '선 잇기'를 누른 카드. 이 상태에서 다른 카드를 누르면 두 카드를 잇는다.
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  useEffect(() => {
    if (!linkFrom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLinkFrom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [linkFrom])
  useEffect(() => {
    const sync = getBoardSync()
    const apply = () => setNodes(syncNodes)
    const applyConnections = () => setConnections(readConnections())
    sync.cards.observe(apply)
    sync.removedCardIds.observe(apply)
    sync.connections.observe(applyConnections)
    sync.removedConnectionIds.observe(applyConnections)
    const statusOff = sync.subscribeStatus(setStatus)
    const accessOff = sync.subscribeAccess(setAccess)
    return () => {
      sync.cards.unobserve(apply)
      sync.removedCardIds.unobserve(apply)
      sync.connections.unobserve(applyConnections)
      sync.removedConnectionIds.unobserve(applyConnections)
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
    for (const c of changes) {
      if (c.type === 'position' && c.position) moveCard(c.id, c.position)
      // 크기 조절 손잡이로 바꾼 크기만 저장한다(화면이 잰 크기는 저장하지 않는다).
      if (c.type === 'dimensions' && c.setAttributes && c.dimensions) resizeCard(c.id, c.dimensions)
    }
  }, [])
  // 관계선 선택만 화면 상태로 둔다. 선 자체는 공유 보드의 connections에서 그린다.
  const handleEdgeChanges = useCallback((changes: EdgeChange[]) => {
    for (const c of changes)
      if (c.type === 'select')
        setSelectedConnection((cur) => (c.selected ? c.id : cur === c.id ? null : cur))
  }, [])
  const catalog = new Map(targets.map((t) => [key(t.kind, t.target_id), t]))
  const resolved = (n: CardNode) => catalog.get(key(n.data.kind, n.data.targetId))
  const display = nodes.map((n) => {
    const t = resolved(n)
    const feature = n.data.kind === 'feature'
    const decision = feature ? contexts[n.data.targetId]?.decision : undefined
    return {
      ...n,
      type: 'card',
      className:
        'canvas-card ' +
        n.data.kind +
        (n.data.color ? ' color-' + n.data.color : '') +
        (n.width ? ' sized' : ''),
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
  const nodeIds = new Set(nodes.map((n) => n.id))
  // 사용자가 직접 이은 관계선. 양 끝 카드가 모두 보드에 있을 때만 그린다.
  const visibleConnections = connections.filter((c) => nodeIds.has(c.source) && nodeIds.has(c.target))
  const relationEdges: Edge[] = visibleConnections.map((c) => ({
    id: c.connection_id,
    type: 'relation',
    source: c.source,
    target: c.target,
    selected: c.connection_id === selectedConnection,
    data: { relation: c.relation, label: c.label },
  }))
  // 서버에서 읽은 기능-자료 연결은 점선으로 따로 그린다(고를 수 없음).
  const linkEdges: Edge[] = nodes
    .filter((n) => n.data.kind === 'feature')
    .flatMap((f) =>
      materials
        .filter((m) => contexts[f.data.targetId]?.links?.includes(m.data.targetId))
        .map((m) => ({
          id: f.id + ':' + m.id,
          source: f.id,
          target: m.id,
          selectable: false,
          className: 'auto-link',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#8c82ac', width: 14, height: 14 },
        })),
    )
  const edges = [...linkEdges, ...relationEdges]
  const activeConnection = visibleConnections.find((c) => c.connection_id === selectedConnection)
  const titleOf = (cardId: string) => {
    const n = nodes.find((node) => node.id === cardId)
    return (n && resolved(n)?.title) ?? '카드'
  }
  // 이은 뒤에는 카드 선택을 풀고 새 선을 골라, 바로 관계 종류·이름을 고칠 수 있게 한다.
  function connect(source: string, target: string) {
    const made = addConnection(source, target)
    if (!made) return
    setNodes((prev) => prev.map((n) => (n.selected ? { ...n, selected: false } : n)))
    setSelectedConnection(made.connection_id)
  }
  const linking = tool === 'select' && linkFrom !== null && nodes.some((n) => n.id === linkFrom)
  const selectedNodes = nodes.filter((n) => n.selected)
  const selected = selectedNodes.length === 1 ? selectedNodes[0] : undefined
  function dismissPicker() {
    setAdding(false)
    addTrigger.current?.focus()
  }
  return (
    <section className="board-pane">
      <div className="canvas" data-tool={tool} data-linking={linking || undefined}>
        <ReactFlow
          nodes={display}
          edges={edges}
          onNodesChange={handleChanges}
          onEdgesChange={handleEdgeChanges}
          edgeTypes={edgeTypes}
          nodeTypes={nodeTypes}
          nodesConnectable={tool === 'select'}
          connectOnClick
          connectionMode={ConnectionMode.Loose}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionRadius={36}
          isValidConnection={(c) => c.source !== c.target}
          onConnect={(c) => connect(c.source, c.target)}
          onConnectEnd={(event, state) => {
            // 연결점이 아니라 카드 아무 곳에나 놓아도 잇는다.
            if (state.isValid || !state.fromNode) return
            const point = 'changedTouches' in event ? event.changedTouches[0] : event
            const card = document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node')
            const id = card?.getAttribute('data-id')
            if (id) connect(state.fromNode.id, id)
          }}
          deleteKeyCode={null}
          minZoom={0.25}
          nodesDraggable={tool === 'select'}
          elementsSelectable={tool === 'select'}
          panOnDrag={tool === 'hand' ? true : [1, 2]}
          panOnScroll
          selectionOnDrag={tool === 'select'}
          onPaneClick={() => {
            setAdding(false)
            setSelectedConnection(null)
            setLinkFrom(null)
          }}
          defaultViewport={{ x: 18, y: 28, zoom: 0.95 }}
          onNodeClick={(event, n) => {
            if (tool !== 'select') return
            // 연결점(동그라미)을 누른 것은 클릭 연결이므로 상세 보기를 열지 않는다.
            if ((event.target as Element).closest('.react-flow__handle')) return
            if (linking && linkFrom) {
              if (n.id !== linkFrom) connect(linkFrom, n.id)
              setLinkFrom(null)
              return
            }
            if (resolved(n)) onOpen(n.data.kind, n.data.targetId)
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.25} color="#ccc7d4" />
          <CanvasNavigation />
          <HandleRepair />
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
        {activeConnection && tool === 'select' && selectedNodes.length === 0 && (
          <ConnectionTools
            key={activeConnection.connection_id}
            connection={activeConnection}
            fromTitle={titleOf(activeConnection.source)}
            toTitle={titleOf(activeConnection.target)}
          />
        )}
        {linking ? (
          <p className="connect-hint active" role="status">
            <Spline /> 이을 카드를 누르세요 · 빈 곳을 누르거나 Esc로 취소
          </p>
        ) : (
          nodes.length >= 2 &&
          visibleConnections.length === 0 &&
          tool === 'select' &&
          selectedNodes.length === 0 && (
            <p className="connect-hint">
              <Spline /> 카드를 누르고 ‘선 잇기’ → 이을 카드 누르기 (동그라미를 끌어도 됩니다)
            </p>
          )
        )}
        {selected && tool === 'select' && (
          <div className="selection-tools">
            {resolved(selected) && (
              <button onClick={() => onOpen(selected.data.kind, selected.data.targetId)}>상세 열기</button>
            )}
            {nodes.length >= 2 && (
              <button
                className="link-start"
                aria-pressed={linkFrom === selected.id}
                title="이 카드에서 다른 카드로 선 잇기"
                onClick={() => setLinkFrom(linkFrom === selected.id ? null : selected.id)}
              >
                <Spline /> 선 잇기
              </button>
            )}
            <span className="color-picker" role="radiogroup" aria-label="카드 색">
              <button
                role="radio"
                className="swatch swatch-default"
                title="기본색"
                aria-label="기본색"
                aria-checked={!selected.data.color}
                onClick={() => setCardColor(selected.id, null)}
              />
              {CARD_COLORS.map((c) => (
                <button
                  key={c.id}
                  role="radio"
                  className={'swatch color-' + c.id}
                  title={c.name}
                  aria-label={c.name}
                  aria-checked={selected.data.color === c.id}
                  onClick={() => setCardColor(selected.id, c.id)}
                />
              ))}
            </span>
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
        <span data-testid="connection-count">
          <Spline />
          연결 {visibleConnections.length}개
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
