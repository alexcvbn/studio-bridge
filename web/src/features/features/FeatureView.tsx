import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ApiError,
  createDecision,
  createFeature,
  fetchDecisions,
  fetchFeature,
  fetchFeatures,
  fetchLinkedMaterials,
} from './featuresApi'
import type {
  DecisionList,
  Feature,
  FeatureStatus,
  LinkedMaterial,
} from './featuresApi'

export type { Feature, FeatureStatus } from './featuresApi'

interface FeatureViewProps {
  /** 바깥(B의 보드 카드 등)에서 열 기능 ID. 넘기면 이 ID가 선택 기준이 된다. */
  openFeatureId?: string | null
  /** 목록에서 기능을 고르면 그 ID를 알려 준다. */
  onSelectFeature?: (featureId: string) => void
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

const MAX_TITLE = 100
const BODY_MAX = 2000
const AUTHOR_MAX = 30

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

const formatTime = (iso: string) => new Date(iso).toLocaleString('ko-KR')
const STATUS_LABEL: Record<FeatureStatus, string> = {
  todo: '대기',
  doing: '진행 중',
  done: '완료',
}

export function FeatureView({ openFeatureId, onSelectFeature }: FeatureViewProps) {
  const [features, setFeatures] = useState<Feature[]>([])
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listError, setListError] = useState('')
  const [listReload, setListReload] = useState(0)

  const [input, setInput] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const activeId = openFeatureId !== undefined ? openFeatureId : selectedId
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

  // 목록: 서버 기준으로 불러온다. 생성 뒤에도 같은 방식으로 다시 불러온다.
  useEffect(() => {
    let cancelled = false
    fetchFeatures()
      .then((items) => {
        if (cancelled) return
        setFeatures(items)
        setListState('ready')
        setListError('')
      })
      .catch((e: Error) => {
        if (cancelled) return
        setListError(e.message)
        setListState((prev) => (prev === 'ready' ? 'ready' : 'error'))
      })
    return () => {
      cancelled = true
    }
  }, [listReload])

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
  }, [activeId, detailReload])

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
  }, [activeId, linkedReload])

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
  }, [activeId, decisionsReload])

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

  const detailState =
    activeId === null
      ? 'idle'
      : detailResult === null || detailResult.id !== activeId
        ? 'loading'
        : detailResult.feature
          ? 'ready'
          : 'error'

  function selectFeature(featureId: string) {
    setSelectedId(featureId)
    onSelectFeature?.(featureId)
  }

  function retryList() {
    setListState((prev) => (prev === 'error' ? 'loading' : prev))
    setListError('')
    setListReload((k) => k + 1)
  }

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
    if (author.length === 0 || author.length > AUTHOR_MAX) {
      setSubmitState({
        id: featureId,
        error: author.length === 0 ? '작성자 표시명을 입력하세요.' : `작성자 표시명은 ${AUTHOR_MAX}자 이하로 입력하세요.`,
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
        notice: `결정 #${created.decision_no}을 저장했습니다.`,
      })
      setDecisionsReload((k) => k + 1) // 서버 기준으로 다시 조회
    } catch (err) {
      // 저장에 실패하면 입력한 내용을 그대로 남긴다
      setSubmitState({
        id: featureId,
        error: err instanceof Error ? err.message : '저장에 실패했습니다.',
        notice: '',
      })
    } finally {
      setSavingId(null)
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (creating) return
    const title = input.trim()
    if (title.length === 0) {
      setFormError('기능 제목을 입력하세요.')
      return
    }
    if (title.length > MAX_TITLE) {
      setFormError(`제목은 ${MAX_TITLE}자 이하로 입력하세요.`)
      return
    }
    setCreating(true)
    setFormError('')
    setNotice('')
    try {
      const created = await createFeature(title)
      setFeatures((prev) => [...prev, created]) // 곧바로 보이게
      setInput('')
      setNotice(`“${created.title}” 기능을 저장했습니다.`)
      setListReload((k) => k + 1) // 서버 기준으로 목록 다시 조회
      selectFeature(created.feature_id) // 상세도 서버에서 다시 조회
    } catch (err) {
      // 저장에 실패하면 입력한 제목을 그대로 남긴다
      setFormError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      setCreating(false)
    }
  }

  const activeIndex = features.findIndex((f) => f.feature_id === activeId)

  return (
    <section aria-label="기능 목록과 상세">
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <h2>기능 목록 ({features.length})</h2>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="기능 제목 (예: 보스 2페이즈)"
              aria-label="기능 제목"
              disabled={creating}
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={creating}>
              {creating ? '저장 중...' : '기능 만들기'}
            </button>
          </form>
          <div role="alert" style={{ color: '#c0392b', minHeight: 20 }}>
            {formError}
          </div>
          <div style={{ color: '#17653a', minHeight: 20 }}>{notice}</div>

          {listState === 'loading' && <p>목록을 불러오는 중...</p>}
          {listState === 'error' && (
            <div role="alert">
              <p style={{ color: '#c0392b' }}>{listError}</p>
              <button type="button" onClick={retryList}>
                다시 시도
              </button>
            </div>
          )}
          {listState === 'ready' && listError !== '' && (
            <div role="alert">
              <p style={{ color: '#c0392b' }}>목록을 새로 고치지 못했습니다. {listError}</p>
              <button type="button" onClick={retryList}>
                다시 시도
              </button>
            </div>
          )}
          {listState === 'ready' && features.length === 0 && (
            <p>아직 기능이 없습니다. 제목을 입력해 첫 기능을 만드세요.</p>
          )}
          {listState === 'ready' && features.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {features.map((f, i) => (
                <li key={f.feature_id}>
                  <button
                    type="button"
                    onClick={() => selectFeature(f.feature_id)}
                    aria-pressed={f.feature_id === activeId}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      marginBottom: 6,
                      fontWeight: f.feature_id === activeId ? 700 : 400,
                    }}
                  >
                    F-{i + 1} {f.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ minWidth: 260, flex: 1 }}>
          <h2>기능 상세</h2>
          {detailState === 'idle' && <p>목록에서 기능을 선택하세요.</p>}
          {detailState === 'loading' && <p>불러오는 중...</p>}
          {detailState === 'error' && detailResult !== null && detailResult.status === 404 && (
            <div role="alert">
              <p style={{ color: '#c0392b' }}>기능을 찾을 수 없습니다.</p>
              <p>
                삭제되었거나 잘못된 ID입니다. <code>{activeId}</code>
              </p>
              <p>목록에서 다른 기능을 선택하세요.</p>
            </div>
          )}
          {detailState === 'error' && detailResult !== null && detailResult.status !== 404 && (
            <div role="alert">
              <p style={{ color: '#c0392b' }}>{detailResult.message}</p>
              <button type="button" onClick={retryDetail}>
                다시 시도
              </button>
            </div>
          )}
          {detailState === 'ready' && detailResult?.feature && (
            <dl>
              <dt>제목</dt>
              <dd>
                {activeIndex >= 0 ? `F-${activeIndex + 1} ` : ''}
                {detailResult.feature.title}
              </dd>
              <dt>기능 ID</dt>
              <dd>
                <code>{detailResult.feature.feature_id}</code>
              </dd>
              <dt>상태</dt>
              <dd>{STATUS_LABEL[detailResult.feature.status]}</dd>
              <dt>담당자</dt>
              <dd>{detailResult.feature.assignee ?? '미지정'}</dd>
              <dt>연결 자료</dt>
              <dd>
                {linkedState === 'loading' && <p>연결 자료를 불러오는 중...</p>}
                {linkedState === 'error' && linkedResult !== null && (
                  <div role="alert">
                    <p style={{ color: '#c0392b' }}>
                      연결 자료를 불러오지 못했습니다. {linkedResult.message}
                    </p>
                    <button type="button" onClick={reloadLinked}>
                      다시 시도
                    </button>
                  </div>
                )}
                {linkedState === 'ready' && linkedResult !== null && (
                  <>
                    {linkedResult.items.length === 0 ? (
                      <p>아직 연결된 자료가 없습니다.</p>
                    ) : (
                      <ul style={{ listStyle: 'none', padding: 0 }}>
                        {linkedResult.items.map((m) => (
                          <li key={m.material_id}>
                            <b>{m.name}</b>{' '}
                            <small>
                              {m.source_path} · {m.script_type} · {m.material_id.slice(0, 8)}
                            </small>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button type="button" onClick={reloadLinked}>
                      연결 목록 새로고침
                    </button>
                  </>
                )}
              </dd>
              <dt>현재 결정</dt>
              <dd>
                {decisionsState === 'loading' && <p>결정을 불러오는 중...</p>}
                {decisionsState === 'error' && decisionsResult !== null && (
                  <div role="alert">
                    <p style={{ color: '#c0392b' }}>
                      결정을 불러오지 못했습니다. {decisionsResult.message}
                    </p>
                    <button type="button" onClick={reloadDecisions}>
                      다시 시도
                    </button>
                  </div>
                )}
                {decisionsState === 'ready' && decisionsResult?.data && (
                  <>
                    {decisionsResult.data.current === null ? (
                      <p>아직 결정이 없습니다.</p>
                    ) : (
                      <div>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{decisionsResult.data.current.body}</p>
                        <small>
                          #{decisionsResult.data.current.decision_no} · 표시명:{' '}
                          {decisionsResult.data.current.author_display_name} (직접 입력한 이름이며
                          로그인 계정이 아닙니다) · {formatTime(decisionsResult.data.current.created_at)}
                        </small>
                      </div>
                    )}
                  </>
                )}
              </dd>
              <dt>이전 결정</dt>
              <dd>
                {decisionsState === 'ready' && decisionsResult?.data && (
                  <>
                    {decisionsResult.data.items.length <= 1 ? (
                      <p>이전 결정이 없습니다.</p>
                    ) : (
                      <ul style={{ listStyle: 'none', padding: 0 }}>
                        {decisionsResult.data.items.slice(1).map((d) => (
                          <li key={d.decision_id}>
                            <span style={{ whiteSpace: 'pre-wrap' }}>{d.body}</span>{' '}
                            <small>
                              #{d.decision_no} · {d.author_display_name} · {formatTime(d.created_at)}
                            </small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </dd>
              <dt>결정 기록하기</dt>
              <dd>
                <form onSubmit={handleDecisionSubmit}>
                  <p>
                    <small>저장하면 새 결정으로 기록되고, 이전 결정은 지워지지 않습니다.</small>
                  </p>
                  <textarea
                    aria-label="결정 내용"
                    placeholder="결정 내용과 이유 (예: 체력 5000. 이유: 첫 테스트의 전투 시간을 맞추기 위해서.)"
                    value={draft.body}
                    onChange={(e) => updateDraft({ body: e.target.value })}
                    disabled={saving}
                    rows={4}
                    style={{ width: '100%' }}
                  />
                  <input
                    aria-label="작성자 표시명"
                    placeholder="작성자 표시명 (직접 입력, 로그인 계정 아님)"
                    value={draft.author}
                    onChange={(e) => updateDraft({ author: e.target.value })}
                    disabled={saving}
                    style={{ width: '100%' }}
                  />
                  <button type="submit" disabled={saving}>
                    {saving ? '저장 중...' : '결정 저장'}
                  </button>
                  <div role="alert" style={{ color: '#c0392b' }}>
                    {activeSubmit?.error}
                  </div>
                  <div style={{ color: '#17653a' }}>{activeSubmit?.notice}</div>
                </form>
              </dd>
            </dl>
          )}
        </div>
      </div>
    </section>
  )
}

export default FeatureView
