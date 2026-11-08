import { useEffect, useState } from 'react'
import { fetchFeatures } from './featuresApi'
import type { Feature } from './featuresApi'

interface FeaturePickerProps {
  /** 지금 선택된 기능 ID */
  selectedId?: string | null
  /** 기능을 고르면 실제 feature_id를 넘겨준다 (D의 "기능에 연결" 화면용) */
  onSelect: (featureId: string, feature: Feature) => void
}

export function FeaturePicker({ selectedId = null, onSelect }: FeaturePickerProps) {
  const [features, setFeatures] = useState<Feature[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchFeatures()
      .then((items) => {
        if (cancelled) return
        setFeatures(items)
        setState('ready')
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [reload])

  function retry() {
    setState('loading')
    setReload((k) => k + 1)
  }

  if (state === 'loading') return <p>기능 목록을 불러오는 중...</p>
  if (state === 'error') {
    return (
      <div role="alert">
        <p style={{ color: '#c0392b' }}>{error}</p>
        <button type="button" onClick={retry}>
          다시 시도
        </button>
      </div>
    )
  }
  if (features.length === 0) return <p>연결할 기능이 없습니다. 먼저 기능을 만드세요.</p>

  return (
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {features.map((f, i) => (
        <li key={f.feature_id}>
          <button
            type="button"
            onClick={() => onSelect(f.feature_id, f)}
            aria-pressed={f.feature_id === selectedId}
            style={{
              width: '100%',
              textAlign: 'left',
              marginBottom: 6,
              fontWeight: f.feature_id === selectedId ? 700 : 400,
            }}
          >
            F-{i + 1} {f.title} <small>({f.feature_id.slice(0, 8)})</small>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default FeaturePicker
