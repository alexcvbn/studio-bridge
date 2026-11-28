import { useEffect, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronRight, Code2, Folder, FolderOpen, Inbox, Plus, Search } from 'lucide-react'
import { createFeature, fetchLinkedMaterials, type LinkedMaterial } from '../features/featuresApi'
import type { TargetInfo } from '../board/targetsApi'

// 오른쪽 기능 트리. 기능(폴더) 아래에 서버에서 그 기능에 연결한 코드가 보인다.
// 항목을 누르면 회의 화면 가운데에 카드로 올라간다.
export function FeatureTree({
  targets,
  load,
  revision,
  onLinks,
  onPick,
  onCreated,
}: {
  targets: TargetInfo[]
  load: 'loading' | 'ready' | 'error'
  revision: number
  onLinks: (featureId: string, list: LinkedMaterial[]) => void
  onPick: (kind: 'feature' | 'material', id: string) => void
  onCreated: () => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [links, setLinks] = useState<Record<string, LinkedMaterial[]>>({})
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const features = targets.filter((t) => t.kind === 'feature')
  const materials = targets.filter((t) => t.kind === 'material')
  const q = query.trim().toLocaleLowerCase()
  const match = (s: string) => !q || s.toLocaleLowerCase().includes(q)

  const openIds = JSON.stringify(Object.keys(open).filter((k) => open[k] && k !== 'inbox').sort())
  useEffect(() => {
    let alive = true
    const ids: string[] = JSON.parse(openIds)
    ids.forEach((id) =>
      fetchLinkedMaterials(id).then(
        (list) => {
          if (!alive) return
          setLinks((cur) => ({ ...cur, [id]: list }))
          onLinks(id, list)
        },
        () => {},
      ),
    )
    return () => {
      alive = false
    }
  }, [openIds, revision, onLinks])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    try {
      const f = await createFeature(title.trim())
      setTitle('')
      setCreating(false)
      setError('')
      onCreated()
      onPick('feature', f.feature_id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <aside className="feature-tree" aria-label="기능 트리">
      <div className="tree-head">
        <h2>기능 트리</h2>
        <button className="icon square" aria-label="새 기능" onClick={() => setCreating(!creating)}>
          <Plus />
        </button>
      </div>
      <label className="tree-search">
        <Search />
        <input type="search" placeholder="기능 검색" aria-label="기능 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {creating && (
        <form className="tree-create" onSubmit={submit}>
          <input autoFocus aria-label="새 기능 제목" placeholder="새 기능 제목" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button disabled={!title.trim()}>만들기</button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      <div className="tree-scroll">
        {load === 'loading' && <p className="muted">불러오는 중…</p>}
        {load === 'error' && <p className="muted">목록을 불러오지 못했어요.</p>}
        {features
          .filter((f) => match(f.title) || links[f.target_id]?.some((m) => match(m.name)))
          .map((f) => {
            const expanded = !!open[f.target_id] || (!!q && !!links[f.target_id])
            return (
              <div className="tree-node" key={f.target_id}>
                <div className="tree-row folder">
                  <button
                    className="twisty"
                    aria-label={(expanded ? '접기 ' : '펼치기 ') + f.title}
                    onClick={() => setOpen((o) => ({ ...o, [f.target_id]: !o[f.target_id] }))}
                  >
                    {expanded ? <ChevronDown /> : <ChevronRight />}
                  </button>
                  <button className="row-main" title="회의 화면에 기능 카드 올리기" onClick={() => onPick('feature', f.target_id)}>
                    {expanded ? <FolderOpen /> : <Folder />}
                    <span>{f.title}</span>
                    <small>{f.badge}</small>
                  </button>
                </div>
                {expanded && (
                  <div className="tree-children">
                    {links[f.target_id] === undefined && <p className="muted">불러오는 중…</p>}
                    {links[f.target_id]?.length === 0 && <p className="muted">연결된 코드 없음</p>}
                    {links[f.target_id]?.map((m) => (
                      <button key={m.material_id} className="tree-row leaf" title={m.source_path} onClick={() => onPick('material', m.material_id)}>
                        <Code2 />
                        <span>{m.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        <div className="tree-node">
          <div className="tree-row folder">
            <button className="twisty" aria-label="받은 자료함 펼치기" onClick={() => setOpen((o) => ({ ...o, inbox: !o.inbox }))}>
              {open.inbox || q ? <ChevronDown /> : <ChevronRight />}
            </button>
            <span className="row-main static">
              <Inbox />
              <span>받은 자료함</span>
              <small>{materials.length}</small>
            </span>
          </div>
          {(open.inbox || q) && (
            <div className="tree-children">
              {materials
                .filter((m) => match(m.title))
                .map((m) => (
                  <button key={m.target_id} className="tree-row leaf" title={m.detail} onClick={() => onPick('material', m.target_id)}>
                    <Code2 />
                    <span>{m.title}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
      <div className="tree-foot">
        <span>기능별로 연결한 객체와 코드</span>
        <button onClick={() => setCreating(true)}>
          <Plus /> 기능 추가
        </button>
      </div>
    </aside>
  )
}
