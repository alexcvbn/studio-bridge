import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './FeatureView.css'
import {
  ApiError,
  createDecision,
  fetchDecisions,
  fetchFeature,
  fetchLinkedMaterials,
  updateFeature,
} from './featuresApi'
import type { DecisionList, Feature, FeatureStatus, LinkedMaterial } from './featuresApi'

export type { Feature, FeatureStatus } from './featuresApi'

interface FeatureViewProps {
  openFeatureId: string | null
  revision: number
  onChanged: () => void
  onOpenMaterial: (id: string) => void
}

interface DetailResult {
  id: string
  feature: Feature | null
  message: string
  status: number | null
}

interface LinkedResult {
  id: string
  items: LinkedMaterial[]
  message: string
  failed: boolean
}

interface DecisionsResult {
  id: string
  data: DecisionList | null
  message: string
}

interface Draft {
  body: string
  author: string
}

interface SubmitState {
  id: string
  error: string
  notice: string
}

// 서버(features.py)와 같은 한도. 서버가 최종 검사를 하고, 화면은 먼저 안내만 한다.
const BODY_MAX = 2000
const AUTHOR_MAX = 30
const PREV_SHOWN = 5 // 이전 결정은 처음에 최근 5개만 보여 준다

// 담당자로 고를 수 있는 팀원 (서버에는 이름 문자열로 저장)
const TEAM_MEMBERS = ['황재민', '정승호', '이하영', '이성수']

const STATUS_LABEL: Record<FeatureStatus, string> = {
  todo: '대기',
  doing: '진행 중',
  done: '완료',
}

const formatTime = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR')
}

// 줄바꿈·탭 같은 제어문자가 한 줄 입력(제목·표시명)에 섞였는지 본다
const hasControlChar = (v: string) => [...v].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)

function Counter({ value, max }: { value: string; max: number }) {
  const n = value.trim().length
  return (
    <span className={n > max ? 'fv-count fv-over' : 'fv-count'}>
      {n}/{max}
    </span>
  )
}

export function FeatureView({
  openFeatureId: activeId,
  revision,
  onChanged,
  onOpenMaterial,
}: FeatureViewProps) {
  const [detailResult, setDetailResult] = useState<DetailResult | null>(null)
  const [detailReload, setDetailReload] = useState(0)
  const [linkedResult, setLinkedResult] = useState<LinkedResult | null>(null)
  const [linkedReload, setLinkedReload] = useState(0)
  const [decisionsResult, setDecisionsResult] = useState<DecisionsResult | null>(null)
  const [decisionsReload, setDecisionsReload] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}) // 기능마다 따로 보관
  const [lastAuthor, setLastAuthor] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [submitState, setSubmitState] = useState<SubmitState | null>(null)
  const [metaSavingId, setMetaSavingId] = useState<string | null>(null)
  const [metaState, setMetaState] = useState<SubmitState | null>(null)
  const [showAllPrevFor, setShowAllPrevFor] = useState<string | null>(null)

  // 상세: 선택한 ID가 바뀌면 이전 요청의 응답은 버린다 (빠른 전환 대비)
  useEffect(() => {
    if (activeId === null) return
    let cancelled = false
    fetchFeature(activeId)
      .then((feature) => {
        if (cancelled) return
        setDetailResult({ id: activeId, feature, message: '', status: 200 })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setDetailResult({
          id: activeId,
          feature: null,
          message: e instanceof Error ? e.message : '불러오지 못했습니다.',
          status: e instanceof ApiError ? e.status : null,
        })
      })
    return () => {
      cancelled = true
    }
  }, [activeId, detailReload, revision])

  // 연결 자료: 선택한 기능이 바뀌면 이전 요청의 응답은 버린다
  useEffect(() => {
    if (activeId === null) return
    let cancelled = false
    fetchLinkedMaterials(activeId)
      .then((items) => {
        if (cancelled) return
        setLinkedResult({ id: activeId, items, message: '', failed: false })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setLinkedResult({
          id: activeId,
          items: [],
          message: e instanceof Error ? e.message : '불러오지 못했습니다.',
          failed: true,
        })
      })
    return () => {
      cancelled = true
    }
  }, [activeId, linkedReload, revision])

  const linkedState =
    activeId === null
      ? 'idle'
      : linkedResult === null || linkedResult.id !== activeId
        ? 'loading'
        : linkedResult.failed
          ? 'error'
          : 'ready'

  // 결정: 선택한 기능이 바뀌면 이전 요청의 응답은 버린다
  useEffect(() => {
    if (activeId === null) return
    let cancelled = false
    fetchDecisions(activeId)
      .then((data) => {
        if (cancelled) return
        setDecisionsResult({ id: activeId, data, message: '' })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setDecisionsResult({
          id: activeId,
          data: null,
          message: e instanceof Error ? e.message : '불러오지 못했습니다.',
        })
      })
    return () => {
      cancelled = true
    }
  }, [activeId, decisionsReload, revision])

  const decisionsState =
    activeId === null
      ? 'idle'
      : decisionsResult === null || decisionsResult.id !== activeId
        ? 'loading'
        : decisionsResult.data
          ? 'ready'
          : 'error'
  const draft: Draft = (activeId !== null ? drafts[activeId] : undefined) ?? {
    body: '',
    author: lastAuthor,
  }
  const saving = savingId !== null
  const activeSubmit = submitState !== null && submitState.id === activeId ? submitState : null
  const activeMeta = metaState !== null && metaState.id === activeId ? metaState : null

  const detailState =
    activeId === null
      ? 'idle'
      : detailResult === null || detailResult.id !== activeId
        ? 'loading'
        : detailResult.feature
          ? 'ready'
          : 'error'

  function retryDetail() {
    setDetailResult(null)
    setDetailReload((k) => k + 1)
  }

  function reloadLinked() {
    setLinkedResult(null)
    setLinkedReload((k) => k + 1)
  }

  function reloadDecisions() {
    setDecisionsResult(null)
    setDecisionsReload((k) => k + 1)
  }

  function updateDraft(patch: Partial<Draft>) {
    if (activeId === null) return
    const id = activeId
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { body: '', author: lastAuthor }), ...patch },
    }))
  }

  // 상태·담당자 변경: 성공하면 서버 기준으로 상세·목록을 다시 조회한다.
  // 실패하면 화면 값은 바뀌지 않고(서버 값 그대로) 오류만 보여 준다.
  async function changeMeta(patch: { status?: FeatureStatus; assignee?: string | null }) {
    if (activeId === null || metaSavingId !== null) return
    const featureId = activeId
    setMetaSavingId(featureId)
    setMetaState({ id: featureId, error: '', notice: '' })
    try {
      await updateFeature(featureId, patch)
      setMetaState({ id: featureId, error: '', notice: '상태·담당자를 저장했습니다.' })
      onChanged()
    } catch (err) {
      setMetaState({
        id: featureId,
        error: err instanceof Error ? err.message : '저장에 실패했습니다.',
        notice: '',
      })
    } finally {
      setMetaSavingId(null)
    }
  }

  async function handleDecisionSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (activeId === null || saving) return
    const featureId = activeId
    const body = draft.body.trim()
    const author = draft.author.trim()
    if (body.length === 0 || body.length > BODY_MAX) {
      setSubmitState({
        id: featureId,
        error: body.length === 0 ? '결정 내용을 입력하세요.' : `결정 내용은 ${BODY_MAX}자 이하로 입력하세요.`,
        notice: '',
      })
      return
    }
    if (author.length === 0 || author.length > AUTHOR_MAX || hasControlChar(author)) {
      setSubmitState({
        id: featureId,
        error:
          author.length === 0
            ? '작성자 표시명을 입력하세요.'
            : `작성자 표시명은 줄바꿈 없이 ${AUTHOR_MAX}자 이하로 입력하세요.`,
        notice: '',
      })
      return
    }
    setSavingId(featureId)
    setSubmitState({ id: featureId, error: '', notice: '' })
    try {
      const created = await createDecision(featureId, body, author)
      setDrafts((prev) => ({ ...prev, [featureId]: { body: '', author } }))
      setLastAuthor(author)
      setSubmitState({
        id: featureId,
        error: '',
        notice: `결정 #${created.decision_no}을 저장했습니다. 이전 결정은 기록으로 남아 있습니다.`,
      })
      onChanged()
    } catch (err) {
      // 저장에 실패하면 입력한 내용을 그대로 남기고, 다시 눌러 재시도할 수 있게 한다
      setSubmitState({
        id: featureId,
        error: `${err instanceof Error ? err.message : '저장에 실패했습니다.'} 입력한 내용은 그대로 두었으니 다시 저장해 보세요.`,
        notice: '',
      })
    } finally {
      setSavingId(null)
    }
  }

  const decisions = decisionsState === 'ready' && decisionsResult?.data ? decisionsResult.data : null
  const previous = decisions ? decisions.items.slice(1) : []
  const showAllPrev = showAllPrevFor === activeId
  const shownPrevious = showAllPrev ? previous : previous.slice(0, PREV_SHOWN)

  return (
    <section className="fv-root" aria-label="기능 상세">
      {detailState === 'idle' && (
        <div className="fv-card">
          <h2 className="fv-h2">기능 상세</h2>
          <p className="fv-empty">목록에서 기능을 선택하세요.</p>
        </div>
      )}
      {detailState === 'loading' && (
        <div className="fv-card">
          <h2 className="fv-h2">기능 상세</h2>
          <div className="fv-skeleton" />
          <div className="fv-skeleton" />
          <p className="fv-sub">불러오는 중...</p>
        </div>
      )}
      {detailState === 'error' && detailResult !== null && detailResult.status === 404 && (
        <div className="fv-card" role="alert">
          <h2 className="fv-h2">기능 상세</h2>
          <p className="fv-msg fv-err">기능을 찾을 수 없습니다.</p>
          <p>
            삭제되었거나 잘못된 ID입니다. <code>{activeId}</code>
          </p>
          <p>목록에서 다른 기능을 선택하세요.</p>
        </div>
      )}
      {detailState === 'error' && detailResult !== null && detailResult.status !== 404 && (
        <div className="fv-card" role="alert">
          <h2 className="fv-h2">기능 상세</h2>
          <p className="fv-msg fv-err">{detailResult.message}</p>
          <button type="button" className="fv-btn fv-ghost" onClick={retryDetail}>
            다시 시도
          </button>
        </div>
      )}

      {detailState === 'ready' && detailResult?.feature && (
        <>
          <div className="fv-card">
            <div className="fv-detail-head">
              <h2 className="fv-detail-title">{detailResult.feature.title}</h2>
              <details className="fv-id">
                <summary>기능 ID</summary>
                {detailResult.feature.feature_id}
              </details>
            </div>
            <div className="fv-meta-grid">
              <div>
                <label htmlFor="fv-status">상태</label>
                <select
                  id="fv-status"
                  aria-label="상태"
                  value={detailResult.feature.status}
                  disabled={metaSavingId !== null}
                  onChange={(e) => changeMeta({ status: e.target.value as FeatureStatus })}
                >
                  {(Object.keys(STATUS_LABEL) as FeatureStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="fv-assignee">담당자</label>
                <select
                  id="fv-assignee"
                  aria-label="담당자"
                  value={detailResult.feature.assignee ?? ''}
                  disabled={metaSavingId !== null}
                  onChange={(e) => changeMeta({ assignee: e.target.value === '' ? null : e.target.value })}
                >
                  <option value="">미지정</option>
                  {detailResult.feature.assignee !== null &&
                    !TEAM_MEMBERS.includes(detailResult.feature.assignee) && (
                      <option value={detailResult.feature.assignee}>{detailResult.feature.assignee}</option>
                    )}
                  {TEAM_MEMBERS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {metaSavingId !== null && metaSavingId === activeId && (
              <p className="fv-sub" style={{ margin: '8px 0 0' }}>
                저장 중...
              </p>
            )}
            <div role="alert" className="fv-msg fv-err">
              {activeMeta?.error}
            </div>
            <div role="status" className="fv-msg fv-ok">
              {activeMeta?.notice}
            </div>
            <p className="fv-sub" style={{ margin: '8px 0 0' }}>
              담당자는 직접 고른 팀원 이름이며 로그인 계정이 아닙니다.
            </p>
          </div>

          <div className="fv-card">
            <h3 className="fv-h3">연결 자료</h3>
            {linkedState === 'loading' && <p className="fv-sub">연결 자료를 불러오는 중...</p>}
            {linkedState === 'error' && linkedResult !== null && (
              <div role="alert" className="fv-msg fv-err">
                <p style={{ margin: '0 0 8px' }}>연결 자료를 불러오지 못했습니다. {linkedResult.message}</p>
                <button type="button" className="fv-btn fv-ghost fv-small" onClick={reloadLinked}>
                  다시 시도
                </button>
              </div>
            )}
            {linkedState === 'ready' && linkedResult !== null && (
              <>
                {linkedResult.items.length === 0 ? (
                  <p className="fv-empty">아직 연결된 자료가 없습니다.</p>
                ) : (
                  <ul className="fv-chips">
                    {linkedResult.items.map((m) => (
                      <li key={m.material_id} className="fv-chip">
                        <button onClick={() => onOpenMaterial(m.material_id)}>{m.name}</button>
                        <small>
                          {m.source_path} · {m.script_type} · {m.material_id.slice(0, 8)}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="fv-btn fv-ghost fv-small" onClick={reloadLinked}>
                  연결 목록 새로고침
                </button>
              </>
            )}
          </div>

          <div className="fv-card">
            <h3 className="fv-h3">현재 결정</h3>
            {decisionsState === 'loading' && <p className="fv-sub">결정을 불러오는 중...</p>}
            {decisionsState === 'error' && decisionsResult !== null && (
              <div role="alert" className="fv-msg fv-err">
                <p style={{ margin: '0 0 8px' }}>결정을 불러오지 못했습니다. {decisionsResult.message}</p>
                <button type="button" className="fv-btn fv-ghost fv-small" onClick={reloadDecisions}>
                  다시 시도
                </button>
              </div>
            )}
            {decisions &&
              (decisions.current === null ? (
                <p className="fv-empty">아직 결정이 없습니다.</p>
              ) : (
                <div className="fv-current">
                  <p className="fv-current-body">{decisions.current.body}</p>
                  <span className="fv-sub">
                    <span className="fv-tag">현재 #{decisions.current.decision_no}</span>
                    표시명: {decisions.current.author_display_name} (직접 입력한 이름이며 로그인 계정이
                    아닙니다) · {formatTime(decisions.current.created_at)}
                  </span>
                </div>
              ))}
          </div>

          <div className="fv-card">
            <h3 className="fv-h3">이전 결정{decisions ? ` (${previous.length})` : ''}</h3>
            {decisionsState === 'loading' && <p className="fv-sub">이전 결정을 불러오는 중...</p>}
            {decisionsState === 'error' && (
              <p className="fv-empty">결정을 불러오지 못해 이전 결정도 표시할 수 없습니다.</p>
            )}
            {decisions &&
              (previous.length === 0 ? (
                <p className="fv-empty">이전 결정이 없습니다.</p>
              ) : (
                <>
                  <p className="fv-sub" style={{ marginTop: 0 }}>
                    결정을 새로 저장해도 이전 결정은 지워지지 않고 아래에 기록으로 남습니다.
                  </p>
                  <ul className="fv-history">
                    {shownPrevious.map((d) => (
                      <li key={d.decision_id}>
                        <div className="fv-history-body">{d.body}</div>
                        <span className="fv-sub">
                          #{d.decision_no} · {d.author_display_name} · {formatTime(d.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {previous.length > PREV_SHOWN && (
                    <p style={{ marginBottom: 0 }}>
                      <button
                        type="button"
                        className="fv-btn fv-ghost fv-small"
                        onClick={() => setShowAllPrevFor(showAllPrev ? null : activeId)}
                      >
                        {showAllPrev ? '최근 것만 보기' : `이전 결정 ${previous.length}개 모두 보기`}
                      </button>
                    </p>
                  )}
                </>
              ))}
          </div>

          <div className="fv-card">
            <h3 className="fv-h3">결정 기록하기</h3>
            <form onSubmit={handleDecisionSubmit}>
              <p className="fv-sub" style={{ marginTop: 0 }}>
                저장하면 새 결정으로 기록되고, 이전 결정은 지워지지 않습니다.
              </p>
              <textarea
                aria-label="결정 내용"
                placeholder="결정 내용과 이유 (예: 체력 5000. 이유: 첫 테스트의 전투 시간을 맞추기 위해서.)"
                value={draft.body}
                onChange={(e) => updateDraft({ body: e.target.value })}
                disabled={saving}
                rows={4}
              />
              <div className="fv-row fv-between">
                <span className="fv-sub">줄바꿈 가능</span>
                <Counter value={draft.body} max={BODY_MAX} />
              </div>
              <div className="fv-row" style={{ marginTop: 8 }}>
                <input
                  className="fv-field"
                  aria-label="작성자 표시명"
                  placeholder="작성자 표시명 (직접 입력, 로그인 계정 아님)"
                  value={draft.author}
                  onChange={(e) => updateDraft({ author: e.target.value })}
                  disabled={saving}
                />
                <Counter value={draft.author} max={AUTHOR_MAX} />
                <button type="submit" className="fv-btn" disabled={saving}>
                  {saving ? '저장 중...' : '결정 저장'}
                </button>
              </div>
              <div role="alert" className="fv-msg fv-err">
                {activeSubmit?.error}
              </div>
              <div role="status" className="fv-msg fv-ok">
                {activeSubmit?.notice}
              </div>
            </form>
          </div>
        </>
      )}
    </section>
  )
}

export default FeatureView
