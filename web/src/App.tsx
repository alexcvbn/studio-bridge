import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  X,
  Code2,
  FileStack,
  FolderTree,
  Inbox,
  Layers2,
  PanelRight,
  Plus,
  RefreshCw,
  Search,
  Users,
  Workflow,
} from 'lucide-react'
import { BoardView } from './features/board'
import { fetchTargets, type TargetInfo } from './features/board/targetsApi'
import type { CardKind } from './features/board/types'
import { FeatureView } from './features/features/FeatureView'
import { createFeature } from './features/features/featuresApi'
import { MaterialLibrary } from './features/materials/MaterialLibrary'
import { MeetingView } from './features/meeting/MeetingView'
import { SourceUidSearch } from './features/materials/SourceUidSearch'
import { ConnectionPanel } from './shared/ConnectionPanel'
import './App.css'
import './theme-flat.css'
import './features/meeting/meeting.css'

type Selection = { kind: CardKind; id: string }
type Pane = 'explorer' | 'board' | 'inspector'
type Space = 'board' | 'meeting'
// 주소 끝이 #meeting이면 회의 공간으로 연다(초대 주소·새로고침에서도 같은 공간).
const spaceFromHash = (): Space => (location.hash === '#meeting' ? 'meeting' : 'board')

export default function App() {
  const [targets, setTargets] = useState<TargetInfo[]>([])
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading')
  const [revision, setRevision] = useState(0)
  // 목록만 조용히 다시 읽는 신호(10회차 #38). revision과 달리 상세 화면은 다시 읽지 않는다.
  const [targetsReload, setTargetsReload] = useState(0)
  const reloadTargets = useCallback(() => setTargetsReload((n) => n + 1), [])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [query, setQuery] = useState('')
  const [pane, setPane] = useState<Pane>('board')
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const refresh = () => setRevision((n) => n + 1)
  const [space, setSpace] = useState<Space>(spaceFromHash)
  useEffect(() => {
    const onHash = () => setSpace(spaceFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  function goSpace(next: Space) {
    setSpace(next)
    history.replaceState(null, '', next === 'meeting' ? '#meeting' : location.pathname + location.search)
  }

  useEffect(() => {
    let alive = true
    fetchTargets().then(
      (items) => {
        if (!alive) return
        setTargets(items)
        setLoad('ready')
      },
      () => {
        if (alive) setLoad('error')
      },
    )
    return () => {
      alive = false
    }
  }, [revision])

  // 조용히 다시 읽다 실패하면(서버가 잠깐 꺼짐) 읽어 둔 목록과 표시를 그대로 둔다.
  useEffect(() => {
    if (targetsReload === 0) return
    let alive = true
    fetchTargets().then(
      (items) => {
        if (!alive) return
        setTargets(items)
        setLoad('ready')
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [targetsReload])

  // 보드를 연 뒤에 팀원이 보낸 자료·만든 기능은 처음 읽은 목록에 없다. 창으로 돌아오면 다시 읽는다.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reloadTargets()
    }
    window.addEventListener('focus', reloadTargets)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', reloadTargets)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reloadTargets])

  function open(kind: CardKind, id: string) {
    setSelection({ kind, id })
    setInspectorOpen(true)
    setPane('inspector')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const feature = await createFeature(title.trim())
      open('feature', feature.feature_id)
      setCreating(false)
      setTitle('')
      setQuery('')
      setError('')
      refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function group(kind: CardKind) {
    const items = targets.filter((t) => t.kind === kind)
    const list = items.filter((t) =>
      (t.title + ' ' + t.detail).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    return (
      <section className="explorer-group" aria-label={kind === 'feature' ? '기능 목록' : '받은 자료함'}>
        <div className="group-heading">
          {kind === 'feature' ? <Layers2 /> : <Inbox />}
          <h3>{kind === 'feature' ? '기능 목록' : '받은 자료함'}</h3>
          <span>{items.length}</span>
          {kind === 'feature' && (
            <button
              className="icon-btn"
              aria-label="새 기능"
              aria-expanded={creating}
              onClick={() => setCreating(!creating)}
            >
              <Plus />
            </button>
          )}
        </div>
        {kind === 'feature' && creating && (
          <form className="create-form" onSubmit={submit}>
            <input
              autoFocus
              aria-label="기능 제목"
              placeholder="기능 제목"
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button className="primary" disabled={saving || !title.trim()}>
              기능 만들기
            </button>
            {error && <p role="alert">{error}</p>}
          </form>
        )}
        {list.map((t) => (
          <button
            key={t.target_id}
            className="item-row"
            aria-pressed={selection?.kind === kind && selection.id === t.target_id}
            onClick={() => open(kind, t.target_id)}
          >
            {kind === 'feature' ? <Layers2 className="blue" /> : <Code2 className="violet" />}
            <span>{t.title}</span>
            {kind === 'feature' && <small>{t.badge}</small>}
          </button>
        ))}
        {list.length === 0 && load !== 'error' && (
          <p className="list-empty">
            {load === 'loading'
              ? '불러오는 중…'
              : query
                ? '검색 결과가 없습니다.'
                : kind === 'feature'
                  ? '＋ 버튼으로 첫 기능을 만드세요.'
                  : 'Studio에서 보낸 코드가 여기에 표시됩니다.'}
          </p>
        )}
        {kind === 'material' && (
          <details className="uid-search">
            <summary>Studio ID로 찾기</summary>
            <SourceUidSearch onFound={(id) => open('material', id)} />
          </details>
        )}
      </section>
    )
  }

  if (space === 'meeting')
    return (
      <MeetingView
        targets={targets}
        load={load}
        revision={revision}
        onReloadTargets={reloadTargets}
        onExit={() => goSpace('board')}
        onOpenInBoard={(kind, id) => {
          goSpace('board')
          open(kind, id)
        }}
      />
    )

  return (
    <div className="shell" data-pane={pane} data-library={libraryOpen} data-inspector={inspectorOpen}>
      <header className="topbar">
        <div className="board-bar">
          <div className="brand">
            <span className="brand-mark">
              <Workflow />
            </span>
            Studio Bridge
          </div>
          <span className="bar-divider" />
          <h1>협업 보드</h1>
          <button className="meeting-entry" onClick={() => goSpace('meeting')} title="실시간 회의 공간으로 가기">
            <Users /> 회의 공간
          </button>
        </div>
        <ConnectionPanel />
      </header>
      <nav className="mobile-nav" aria-label="작업 영역">
        {(
          [
            ['explorer', '탐색기'],
            ['board', '협업 보드'],
            ['inspector', '상세 보기'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} aria-pressed={pane === id} onClick={() => setPane(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main className="workspace">
        <aside className="explorer panel" aria-label="카드 라이브러리">
          <div className="pane-title">
            <FolderTree />
            <h2>카드 라이브러리</h2>
            <button className="icon-btn" aria-label="작업공간 새로고침" onClick={refresh}>
              <RefreshCw />
            </button>
            <button
              className="icon-btn close-panel"
              aria-label="라이브러리 닫기"
              onClick={() => {
                setLibraryOpen(false)
                setPane('board')
              }}
            >
              <X />
            </button>
          </div>
          <div className="search-box">
            <Search />
            <input
              type="search"
              aria-label="기능·자료 검색"
              placeholder="기능·자료 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {load === 'error' && (
            <p role="alert" className="list-empty">
              목록을 불러오지 못했습니다. <button onClick={refresh}>다시 시도</button>
            </p>
          )}
          {group('feature')}
          {group('material')}
        </aside>
        <BoardView
          targets={targets}
          load={load}
          revision={revision}
          onReloadTargets={reloadTargets}
          onOpen={open}
          libraryOpen={libraryOpen}
          onLibrary={() => {
            setLibraryOpen(!libraryOpen)
            setPane('explorer')
          }}
          onExplore={() => {
            setLibraryOpen(true)
            setPane('explorer')
            setCreating(true)
          }}
        />
        <aside className="inspector panel">
          <div className="pane-title">
            <PanelRight />
            <h2>상세 보기</h2>
            <span className="detail-type">
              {selection?.kind === 'feature' ? '기능' : selection ? '코드 자료' : ''}
            </span>
            <button
              className="icon-btn close-panel"
              aria-label="상세 닫기"
              onClick={() => {
                setInspectorOpen(false)
                setPane('board')
              }}
            >
              <X />
            </button>
          </div>
          <div className="inspector-scroll">
            <div hidden={selection?.kind !== 'feature'}>
              <FeatureView
                openFeatureId={selection?.kind === 'feature' ? selection.id : null}
                revision={revision}
                onChanged={refresh}
                onOpenMaterial={(id) => open('material', id)}
              />
            </div>
            {selection?.kind === 'material' && (
              <MaterialLibrary
                key={selection.id}
                materialId={selection.id}
                revision={revision}
                onLinked={refresh}
              />
            )}
            {!selection && (
              <div className="empty-inspector">
                <FileStack />
                <h3>선택한 항목이 없습니다</h3>
                <p>기능이나 자료를 선택하면 상세 내용을 볼 수 있어요.</p>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  )
}
