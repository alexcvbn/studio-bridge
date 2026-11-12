import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ApiError,
  createFeature,
  fetchFeature,
  fetchFeatures,
  fetchLinkedMaterials,
} from './featuresApi'
import type { Feature, FeatureStatus, LinkedMaterial } from './featuresApi'

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
              <dt>결정</dt>
              <dd>아직 없습니다. (이번 회차 범위 아님)</dd>
            </dl>
          )}
        </div>
      </div>
    </section>
  )
}

export default FeatureView
