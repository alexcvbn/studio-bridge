import { useState } from 'react'
import type { FormEvent } from 'react'

export type FeatureStatus = 'todo' | 'doing' | 'done'

export interface Feature {
  featureId: string // 01회차: 예시 ID. 02회차부터 서버가 만든 UUID 사용
  displayNo: string // 화면 표시용 별칭 (F-1, F-2 ...)
  title: string
  status: FeatureStatus
  assignee: string | null
  createdAt: string
}

interface FeatureViewProps {
  /** B의 보드 카드 등이 기능을 열 때 쓰는 연결 지점 (onOpenFeature와 같은 역할) */
  onSelectFeature?: (featureId: string) => void
}

const MAX_TITLE = 100
const STATUS_LABEL: Record<FeatureStatus, string> = {
  todo: '대기',
  doing: '진행 중',
  done: '완료',
}

export function FeatureView({ onSelectFeature }: FeatureViewProps) {
  const [features, setFeatures] = useState<Feature[]>([])
  const [input, setInput] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const selected = features.find((f) => f.featureId === selectedId) ?? null

  function select(featureId: string) {
    setSelectedId(featureId)
    onSelectFeature?.(featureId)
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const title = input.trim()
    if (title.length === 0) {
      setError('기능 제목을 입력하세요.')
      return
    }
    if (title.length > MAX_TITLE) {
      setError(`제목은 ${MAX_TITLE}자 이하로 입력하세요.`)
      return
    }
    const feature: Feature = {
      featureId: crypto.randomUUID(),
      displayNo: `F-${features.length + 1}`,
      title,
      status: 'todo',
      assignee: null,
      createdAt: new Date().toISOString(),
    }
    setFeatures((prev) => [...prev, feature])
    setInput('')
    setError('')
    select(feature.featureId)
  }

  return (
    <section aria-label="기능 목록과 상세">
      <p style={{ color: '#8a5a00' }}>
        예시 데이터 · 서버에 저장되지 않아 새로고침하면 초기화됩니다.
      </p>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <h2>기능 목록 ({features.length})</h2>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="기능 제목 (예: 보스 2페이즈)"
              aria-label="기능 제목"
              style={{ flex: 1 }}
            />
            <button type="submit">기능 만들기</button>
          </form>
          <div role="alert" style={{ color: '#c0392b', minHeight: 20 }}>
            {error}
          </div>
          {features.length === 0 ? (
            <p>아직 기능이 없습니다. 제목을 입력해 첫 기능을 만드세요.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {features.map((f) => (
                <li key={f.featureId}>
                  <button
                    type="button"
                    onClick={() => select(f.featureId)}
                    aria-pressed={f.featureId === selectedId}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      marginBottom: 6,
                      fontWeight: f.featureId === selectedId ? 700 : 400,
                    }}
                  >
                    {f.displayNo} {f.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ minWidth: 260, flex: 1 }}>
          <h2>기능 상세</h2>
          {selected === null ? (
            <p>목록에서 기능을 선택하세요.</p>
          ) : (
            <dl>
              <dt>제목</dt>
              <dd>
                {selected.displayNo} {selected.title}
              </dd>
              <dt>상태</dt>
              <dd>{STATUS_LABEL[selected.status]}</dd>
              <dt>담당자</dt>
              <dd>{selected.assignee ?? '미지정'}</dd>
              <dt>연결 자료</dt>
              <dd>아직 연결된 자료가 없습니다. (02회차 구현)</dd>
              <dt>현재 결정 / 이전 결정</dt>
              <dd>아직 결정이 없습니다. (02~03회차 구현)</dd>
            </dl>
          )}
        </div>
      </div>
    </section>
  )
}

export default FeatureView
