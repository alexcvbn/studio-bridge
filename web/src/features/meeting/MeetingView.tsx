import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react'
import {
  Hand,
  ImagePlus,
  Layers2,
  MessageSquarePlus,
  MousePointer2,
  Plus,
  Spline,
  StickyNote,
  Trash2,
  Workflow,
  X,
} from 'lucide-react'
import '@xyflow/react/dist/style.css'
import { CanvasNavigation } from '../board/CanvasNavigation'
import type { TargetInfo } from '../board/targetsApi'
import { fetchLinkedMaterials, type LinkedMaterial } from '../features/featuresApi'
import { ConnectionPanel } from '../../shared/ConnectionPanel'
import { FeatureTree } from './FeatureTree'
import { LiveLayer } from './LiveLayer'
import { MeetingContext, type MeetingContextValue } from './MeetingContext'
import {
  addEdge,
  addItem,
  getMeetingSync,
  readEdges,
  readItems,
  removeEdge,
  removeItem,
  shrinkImage,
  updateItem,
  type MeetingEdge,
  type MeetingItem,
} from './meetingSync'
import { ItemNodeView, type ItemNode } from './nodes'
import { PresenceBar } from './PresenceBar'
import { enterSpace, savedName, setMyName, setPresence, usePeers, useSelf } from './presence'
import { TeamChat } from './TeamChat'
import './meeting.css'

export interface MeetingViewProps {
  targets: TargetInfo[]
  load: 'loading' | 'ready' | 'error'
  revision: number
  onReloadTargets: () => void
  onExit: () => void
  onOpenInBoard: (kind: 'feature' | 'material', id: string) => void
}

type Tool = 'select' | 'hand' | 'note' | 'comment' | 'connect'
const nodeTypes: NodeTypes = { item: ItemNodeView }
const DEFAULT_SIZE: Record<MeetingItem['type'], { width: number; height?: number }> = {
  feature: { width: 360 },
  code: { width: 230 },
  note: { width: 200, height: 160 },
  comment: { width: 300 },
  image: { width: 340 },
}

function syncNodes(prev: ItemNode[]): ItemNode[] {
  const existing = new Map(prev.map((n) => [n.id, n]))
  return readItems()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((item) => ({
      ...existing.get(item.id),
      id: item.id,
      type: 'item' as const,
      position: item.position,
      width: item.size?.width ?? DEFAULT_SIZE[item.type].width,
      height: item.size?.height ?? DEFAULT_SIZE[item.type].height,
      data: { item },
    }))
}

export function MeetingView(props: MeetingViewProps) {
  return (
    <ReactFlowProvider>
      <MeetingInner {...props} />
    </ReactFlowProvider>
  )
}

function MeetingInner({ targets, load, revision, onReloadTargets, onExit, onOpenInBoard }: MeetingViewProps) {
  const self = useSelf()
  const peers = usePeers('meeting')
  const { screenToFlowPosition } = useReactFlow()
  const canvasRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [nodes, setNodes] = useState<ItemNode[]>(() => syncNodes([]))
  const [edges, setEdges] = useState<MeetingEdge[]>(readEdges)
  const [tool, setTool] = useState<Tool>('select')
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(true)
  const [picking, setPicking] = useState(false)
  const [pickQuery, setPickQuery] = useState('')
  const [links, setLinks] = useState<Record<string, LinkedMaterial[] | undefined>>({})
  const [following, setFollowing] = useState<number | null>(null)
  const [dismissedPresenter, setDismissedPresenter] = useState<number | null>(null)
  const [presenting, setPresenting] = useState(false)
  const [askName, setAskName] = useState(() => !savedName())
  const [nameDraft, setNameDraft] = useState('')
  const [notice, setNotice] = useState('')

  // 이 공간에 들어왔다고 알리고, 나갈 때 커서·발표를 지운다.
  useEffect(() => {
    enterSpace('meeting')
    return () => setPresence({ space: 'board', cursor: null, view: null, spotlight: false, selected: [] })
  }, [])

  useEffect(() => {
    const m = getMeetingSync()
    const apply = () => setNodes(syncNodes)
    const applyEdges = () => setEdges(readEdges())
    m.items.observe(apply)
    m.removedItems.observe(apply)
    m.items.observe(applyEdges)
    m.edges.observe(applyEdges)
    m.removedEdges.observe(applyEdges)
    return () => {
      m.items.unobserve(apply)
      m.removedItems.unobserve(apply)
      m.items.unobserve(applyEdges)
      m.edges.unobserve(applyEdges)
      m.removedEdges.unobserve(applyEdges)
    }
  }, [])

  // 기능 카드의 "연결된 구현"은 서버의 기능-자료 연결을 그대로 보여 준다.
  const featureIds = JSON.stringify(
    [...new Set(nodes.filter((n) => n.data.item.type === 'feature').map((n) => n.data.item.target_id ?? ''))].sort(),
  )
  useEffect(() => {
    let alive = true
    const ids: string[] = JSON.parse(featureIds)
    ids.filter(Boolean).forEach((id) =>
      fetchLinkedMaterials(id).then(
        (list) => alive && setLinks((cur) => ({ ...cur, [id]: list })),
        () => alive && setLinks((cur) => ({ ...cur, [id]: [] })),
      ),
    )
    return () => {
      alive = false
    }
  }, [featureIds, revision])
  const onTreeLinks = useCallback((id: string, list: LinkedMaterial[]) => setLinks((cur) => ({ ...cur, [id]: list })), [])

  // 내가 고른 항목을 알린다.
  const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id)
  const selectedKey = selectedIds.join(',')
  useEffect(() => {
    setPresence({ selected: selectedKey ? selectedKey.split(',') : [] })
  }, [selectedKey])

  // 따라가기: 내가 고른 사람이 우선이고, 없으면 발표 중인 사람(내가 "그만 보기"를 누르지 않았다면)
  const presenter = peers.find((p) => p.spotlight)
  const manual = peers.find((p) => p.clientId === following) ?? null
  const followTarget = presenting
    ? null
    : manual ?? (presenter && presenter.clientId !== dismissedPresenter ? presenter : null)
  const stopFollowing = () => {
    if (manual) setFollowing(null)
    else if (presenter) setDismissedPresenter(presenter.clientId)
  }
  // 발표가 끝나면 "그만 보기"를 잊어서 다음 발표 때 다시 따라가게 한다.
  const presenterId = presenter?.clientId ?? null
  if (dismissedPresenter !== null && presenterId !== dismissedPresenter) setDismissedPresenter(null)

  const togglePresent = () => {
    const next = !presenting
    setPresenting(next)
    setPresence({ spotlight: next })
    if (next) setFollowing(null)
  }

  const catalog = useMemo(() => new Map(targets.map((t) => [t.kind + ':' + t.target_id, t])), [targets])
  const peerSelections = useMemo(() => {
    const out: MeetingContextValue['peerSelections'] = {}
    for (const p of peers) for (const id of p.selected) (out[id] ??= []).push({ name: p.user.name, color: p.user.color })
    return out
  }, [peers])
  const ctx: MeetingContextValue = { catalog, load, links, peerSelections, onOpenInBoard }

  // 지금 화면 가운데(조금씩 비켜서)에 새 항목을 놓는다.
  const placeCount = useRef(0)
  const centerPoint = () => {
    const box = canvasRef.current?.getBoundingClientRect()
    const n = placeCount.current++ % 6
    const p = screenToFlowPosition({
      x: (box ? box.left + box.width / 2 : 400) - 160 + n * 28,
      y: (box ? box.top + box.height / 2.6 : 300) - 120 + n * 28,
    })
    return { x: Math.round(p.x), y: Math.round(p.y) }
  }
  const pendingFocus = useRef<string | null>(null)
  useEffect(() => {
    const id = pendingFocus.current
    if (!id || !nodes.some((n) => n.id === id)) return
    const el = document.querySelector<HTMLTextAreaElement>(`.react-flow__node[data-id="${id}"] textarea`)
    if (!el) return
    pendingFocus.current = null
    el.focus()
  }, [nodes])
  const selectOnly = (id: string) =>
    setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })))
  const pick = (kind: 'feature' | 'material', id: string) => {
    const item = addItem({
      type: kind === 'feature' ? 'feature' : 'code',
      target_id: id,
      position: centerPoint(),
      author: self,
    })
    setPicking(false)
    requestAnimationFrame(() => selectOnly(item.id))
  }

  const addImage = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setNotice('이미지 파일만 올릴 수 있어요.')
      return
    }
    try {
      const image = await shrinkImage(file)
      const item = addItem({ type: 'image', image, text: file.name.replace(/\.[^.]+$/, ''), position: centerPoint(), author: self })
      requestAnimationFrame(() => selectOnly(item.id))
    } catch (e) {
      setNotice((e as Error).message)
    }
  }
  // 보드에 이미지를 붙여 넣어도(Ctrl/⌘+V) 올라간다.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) void addImage(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 2600)
    return () => clearTimeout(t)
  }, [notice])

  // 단축키: V 선택, H 손, N 메모, C 의견, L 선 잇기, Esc 취소
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      const map: Record<string, Tool> = { v: 'select', h: 'hand', n: 'note', c: 'comment', l: 'connect' }
      const t = map[e.key.toLowerCase()]
      if (t) setTool(t)
      if (e.key === 'Escape') {
        setTool('select')
        setConnectFrom(null)
        setPicking(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleChanges = useCallback((changes: NodeChange<ItemNode>[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev))
    for (const c of changes) {
      if (c.type === 'position' && c.position) updateItem(c.id, { position: { x: Math.round(c.position.x), y: Math.round(c.position.y) } })
      if (c.type === 'dimensions' && c.setAttributes && c.dimensions)
        updateItem(c.id, { size: { width: Math.round(c.dimensions.width), height: Math.round(c.dimensions.height) } })
    }
  }, [])

  const flowEdges: Edge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'default',
    selected: e.id === selectedEdge,
    className: 'm-edge',
  }))

  const connect = (a: string, b: string) => {
    if (addEdge(a, b)) setNotice('선을 이었어요')
  }

  const selected = nodes.filter((n) => n.selected)
  const toolBtn = (t: Tool, label: string, Icon: typeof Hand, key: string) => (
    <button
      aria-pressed={tool === t}
      aria-label={label}
      title={`${label} (${key})`}
      onClick={() => {
        setTool(t)
        setConnectFrom(null)
      }}
    >
      <Icon />
    </button>
  )
  const featureChoices = targets
    .filter((t) => t.kind === 'feature')
    .filter((t) => t.title.toLocaleLowerCase().includes(pickQuery.trim().toLocaleLowerCase()))

  return (
    <MeetingContext.Provider value={ctx}>
      <div className="meeting-shell">
        <header className="m-top">
          <div className="m-brand">
            <span className="mark">
              <Workflow />
            </span>
            Studio Bridge
          </div>
          <nav className="m-crumbs" aria-label="위치">
            <span>우리 팀 프로젝트</span>
            <span>/</span>
            <strong>회의 공간</strong>
          </nav>
          <div className="space-switch" role="tablist" aria-label="공간">
            <button role="tab" aria-selected={false} onClick={onExit}>
              협업 보드
            </button>
            <button role="tab" aria-selected>
              회의 공간
            </button>
          </div>
          <PresenceBar
            self={self}
            peers={peers}
            following={followTarget?.clientId ?? null}
            presenting={presenting}
            onFollow={(id) => {
              setFollowing(id)
              if (id !== null && presenting) togglePresent()
            }}
            onPresent={togglePresent}
          />
          <ConnectionPanel />
        </header>
        <div className="m-body">
          <div className="m-main">
            <div
              className="m-canvas"
              ref={canvasRef}
              data-tool={tool}
              style={followTarget ? { ['--follow' as string]: followTarget.user.color } : undefined}
              data-following={followTarget ? 'true' : undefined}
            >
              <ReactFlow
                nodes={nodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                onNodesChange={handleChanges}
                onEdgesChange={(changes) => {
                  for (const c of changes) if (c.type === 'select') setSelectedEdge(c.selected ? c.id : null)
                }}
                onNodesDelete={(ns) => ns.forEach((n) => removeItem(n.id))}
                onEdgesDelete={(es) => es.forEach((e) => removeEdge(e.id))}
                deleteKeyCode={['Delete', 'Backspace']}
                nodesConnectable={tool === 'select' || tool === 'connect'}
                connectionMode={ConnectionMode.Loose}
                connectionLineType={ConnectionLineType.Bezier}
                connectionRadius={40}
                onConnect={(c) => connect(c.source, c.target)}
                nodesDraggable={tool === 'select'}
                elementsSelectable={tool === 'select' || tool === 'connect'}
                panOnDrag={tool === 'hand' ? true : [1, 2]}
                panOnScroll
                selectionOnDrag={tool === 'select'}
                minZoom={0.2}
                maxZoom={2}
                defaultViewport={{ x: 40, y: 40, zoom: 0.9 }}
                onMoveStart={(e) => {
                  // 내가 직접 화면을 움직이면 따라가기를 멈춘다(프로그램이 옮긴 것은 e가 없다).
                  if (e && followTarget) stopFollowing()
                }}
                onNodeClick={(_, n) => {
                  if (tool !== 'connect') return
                  if (!connectFrom) setConnectFrom(n.id)
                  else {
                    if (connectFrom !== n.id) connect(connectFrom, n.id)
                    setConnectFrom(null)
                  }
                }}
                onPaneClick={(e) => {
                  setPicking(false)
                  setSelectedEdge(null)
                  if (tool === 'note' || tool === 'comment') {
                    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
                    const item = addItem({
                      type: tool,
                      text: '',
                      position: { x: Math.round(p.x), y: Math.round(p.y) },
                      author: self,
                    })
                    setTool('select')
                    // 새로 놓은 메모·의견에 바로 쓸 수 있게, 화면에 그려지면 입력칸으로 간다.
                    pendingFocus.current = item.id
                  }
                  if (tool === 'connect') setConnectFrom(null)
                }}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="#d5d9e0" />
                <LiveLayer peers={peers} followTarget={followTarget} />
                <CanvasNavigation />
              </ReactFlow>

              <div className="m-toolbar-wrap">
                <h1>협업 공간</h1>
                <div className="m-toolbar" role="toolbar" aria-label="회의 도구">
                  {toolBtn('select', '선택', MousePointer2, 'V')}
                  {toolBtn('hand', '손 도구', Hand, 'H')}
                  {toolBtn('note', '메모', StickyNote, 'N')}
                  {toolBtn('comment', '의견', MessageSquarePlus, 'C')}
                  <button aria-label="이미지" title="이미지 올리기 (붙여넣기도 됨)" onClick={() => fileRef.current?.click()}>
                    <ImagePlus />
                  </button>
                  {toolBtn('connect', '선 잇기', Spline, 'L')}
                  <span className="sep" />
                  <button className="primary" aria-expanded={picking} onClick={() => setPicking(!picking)}>
                    <Plus /> 기능 카드
                  </button>
                </div>
                {picking && (
                  <div className="feature-pick" role="dialog" aria-label="기능 카드 고르기">
                    <input
                      autoFocus
                      placeholder="기능 검색"
                      aria-label="기능 카드 검색"
                      value={pickQuery}
                      onChange={(e) => setPickQuery(e.target.value)}
                    />
                    <div className="pick-list">
                      {featureChoices.length === 0 && <p className="muted">기능이 없어요. 오른쪽 기능 트리에서 만들 수 있어요.</p>}
                      {featureChoices.map((f) => (
                        <button key={f.target_id} onClick={() => pick('feature', f.target_id)} aria-label={f.title + ' 기능 카드 올리기'}>
                          <Layers2 />
                          <span>{f.title}</span>
                          <small>{f.badge}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    void addImage(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </div>

              {(tool === 'note' || tool === 'comment') && (
                <p className="m-hint">빈 곳을 누르면 {tool === 'note' ? '메모' : '의견'}가 생겨요 · Esc 취소</p>
              )}
              {tool === 'connect' && (
                <p className="m-hint">
                  {connectFrom ? '이을 다른 카드를 누르세요' : '잇기 시작할 카드를 누르세요'} · 동그라미를 끌어도 돼요 · Esc 취소
                </p>
              )}
              {followTarget && (
                <div className="follow-banner" style={{ background: followTarget.user.color }}>
                  {followTarget.spotlight && !manual ? `${followTarget.user.name} 님이 발표 중` : `${followTarget.user.name} 님 화면을 따라가는 중`}
                  <button onClick={stopFollowing}>{followTarget.spotlight && !manual ? '그만 보기' : '그만 따라가기'}</button>
                </div>
              )}
              {presenting && (
                <div className="follow-banner self" style={{ background: self.color }}>
                  발표 중 · 참여자 {peers.length}명이 내 화면을 따라와요
                  <button onClick={togglePresent}>발표 끝내기</button>
                </div>
              )}
              {selected.length > 0 && tool === 'select' && (
                <div className="m-selection">
                  <span>{selected.length}개 선택</span>
                  {selected.length === 1 && (
                    <button
                      onClick={() => {
                        setTool('connect')
                        setConnectFrom(selected[0].id)
                      }}
                    >
                      <Spline /> 선 잇기
                    </button>
                  )}
                  <button aria-label="선택한 항목 지우기" title="지우기 (Delete)" onClick={() => selected.forEach((n) => removeItem(n.id))}>
                    <Trash2 />
                  </button>
                </div>
              )}
              {selectedEdge && selected.length === 0 && (
                <div className="m-selection">
                  <span>선 선택됨</span>
                  <button
                    aria-label="선 지우기"
                    onClick={() => {
                      removeEdge(selectedEdge)
                      setSelectedEdge(null)
                    }}
                  >
                    <Trash2 /> 선 지우기
                  </button>
                </div>
              )}
              {nodes.length === 0 && (
                <div className="m-empty">
                  <h2>회의를 시작해 보세요</h2>
                  <p>위쪽 "기능 카드"나 오른쪽 기능 트리에서 이야기할 기능을 올리고, 메모·의견·이미지로 같이 정리해요.</p>
                </div>
              )}
              {notice && (
                <p className="m-toast" role="status">
                  {notice}
                </p>
              )}
            </div>
            <TeamChat
              people={peers.length + 1}
              open={chatOpen}
              onToggle={() => setChatOpen(!chatOpen)}
              onAttach={() => fileRef.current?.click()}
            />
          </div>
          <FeatureTree
            targets={targets}
            load={load}
            revision={revision}
            onLinks={onTreeLinks}
            onPick={pick}
            onCreated={onReloadTargets}
          />
        </div>
        {askName && (
          <div className="name-modal" role="dialog" aria-label="이름 정하기">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (nameDraft.trim()) setMyName(nameDraft)
                setAskName(false)
              }}
            >
              <button type="button" className="close" aria-label="나중에 정하기" onClick={() => setAskName(false)}>
                <X />
              </button>
              <h2>회의에서 보일 이름</h2>
              <p>커서와 채팅에 이 이름이 보여요. 로그인 계정이 아니라 이 브라우저에만 저장돼요.</p>
              <input autoFocus aria-label="내 이름" maxLength={20} placeholder="예: 성수" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              <button className="primary" disabled={!nameDraft.trim()}>
                들어가기
              </button>
            </form>
          </div>
        )}
      </div>
    </MeetingContext.Provider>
  )
}
