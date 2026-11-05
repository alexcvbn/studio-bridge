import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

export type FeatureStatus = 'todo' | 'doing' | 'done'

// 서버(GET/POST /features) 응답과 같은 형태
export interface Feature {
  feature_id: string
  project_id: string
  title: string
  status: FeatureStatus
  assignee: string | null
  created_at: string
}

interface FeatureViewProps {
  /** B의 보드 카드 등이 기능을 열 때 쓰는 연결 지점 */
  onSelectFeature?: (featureId: string) => void
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000'
const FEATURES_URL = `${API_BASE}/api/projects/studio-bridge/features`
const MAX_TITLE = 100
const STATUS_LABEL: Record<FeatureStatus, string> = {
  todo: '대기',
  doing: '진행 중',
  done: '완료',
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new Error('서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.')
  }
  if (!res.ok) {
    let message = `요청에 실패했습니다. (${res.status})`
    try {
      const body = await res.json()
      const detail = body?.detail
      if (Array.isArray(detail)) {
        message = '입력 형식이 올바르지 않습니다.'
      } else if (detail && typeof detail.message === 'string') {
        message = detail.message
      }
    } catch {
      // 응답 본문이 없으면 기본 메시지를 쓴다
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export function FeatureView({ onSelectFeature }: FeatureViewProps) {
  const [features, setFeatures] = useState<Feature[]>([])
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listError, setListError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [input, setInput] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Feature | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [detailError, setDetailError] = useState('')
  const detailReq = useRef(0)

  useEffect(() => {
    let cancelled = false
    request<{ items: Feature[] }>(FEATURES_URL)
      .then((data) => {
        if (cancelled) return
        setFeatures(data.items)
        setListState('ready')
      })
      .catch((e: Error) => {
        if (cancelled) return
        setListError(e.message)
        setListState('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  function retryList() {
    setListState('loading')
    setReloadKey((k) => k + 1)
  }

  function selectFeature(featureId: string) {
    // 빠르게 다른 기능을 눌러도 이전 요청의 응답이 현재 선택을 덮어쓰지 않게 한다
    const reqId = ++detailReq.current
    setSelectedId(featureId)
    setDetailState('loading')
    setDetailError('')
    onSelectFeature?.(featureId)
    request<Feature>(`${FEATURES_URL}/${featureId}`)
      .then((f) => {
        if (detailReq.current !== reqId) return
        setDetail(f)
        setDetailState('idle')
      })
      .catch((e: Error) => {
        if (detailReq.current !== reqId) return
        setDetailError(e.message)
        setDetailState('error')
      })
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
      const created = await request<Feature>(FEATURES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      setFeatures((prev) => [...prev, created])
      setInput('')
      setNotice(`“${created.title}” 기능을 저장했습니다.`)
      selectFeature(created.feature_id)
    } catch (err) {
      // 저장에 실패하면 입력한 제목을 그대로 남긴다
      setFormError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      setCreating(false)
    }
  }

  const selectedIndex = features.findIndex((f) => f.feature_id === selectedId)

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
                    aria-pressed={f.feature_id === selectedId}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      marginBottom: 6,
                      fontWeight: f.feature_id === selectedId ? 700 : 400,
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
          {selectedId === null && <p>목록에서 기능을 선택하세요.</p>}
          {selectedId !== null && detailState === 'loading' && <p>불러오는 중...</p>}
          {selectedId !== null && detailState === 'error' && (
            <div role="alert">
              <p style={{ color: '#c0392b' }}>{detailError}</p>
              <button type="button" onClick={() => selectFeature(selectedId)}>
                다시 시도
              </button>
            </div>
          )}
          {detail !== null && selectedId !== null && detailState === 'idle' && (
            <dl>
              <dt>제목</dt>
              <dd>
                {selectedIndex >= 0 ? `F-${selectedIndex + 1} ` : ''}
                {detail.title}
              </dd>
              <dt>기능 ID</dt>
              <dd>
                <code>{detail.feature_id}</code>
              </dd>
              <dt>상태</dt>
              <dd>{STATUS_LABEL[detail.status]}</dd>
              <dt>담당자</dt>
              <dd>{detail.assignee ?? '미지정'}</dd>
              <dt>연결 자료 / 결정</dt>
              <dd>아직 연결되지 않았습니다. (이번 회차 범위 아님)</dd>
            </dl>
          )}
        </div>
      </div>
    </section>
  )
}

export default FeatureView
