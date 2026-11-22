import { useEffect, useState } from 'react'
import { fetchSnapshots, type Snapshot, type SnapshotRecord } from './materialsApi'

interface SnapshotHistoryProps {
  materialId: string
  /** 지금 원문 칸에 보이는 수집본 */
  viewingId: string
  /** 수집본을 고르면 그 원문을 보여 달라고 알린다 */
  onView: (snapshot: Snapshot) => void
}

/**
 * D 담당 (06회차 #24): 한 자료의 수집본 기록. 코드를 다시 보내도 이전 원문이 남아 있어 다시 열 수 있다.
 * 자료나 현재 수집본이 바뀌면 MaterialLibrary가 key로 이 컴포넌트를 새로 만들어 다시 불러온다.
 */
export function SnapshotHistory({ materialId, viewingId, onView }: SnapshotHistoryProps) {
  const [records, setRecords] = useState<SnapshotRecord[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchSnapshots(materialId)
      .then((items) => {
        if (cancelled) return
        setRecords(items)
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
  }, [materialId, reload])

  function retry() {
    setState('loading')
    setReload((n) => n + 1)
  }

  return (
    <div style={{ margin: '8px 0' }}>
      <h4 style={{ margin: '8px 0 4px' }}>수집본 기록{state === 'ready' ? ` (${records.length}개)` : ''}</h4>
      {state === 'loading' && <p>수집본 기록을 불러오는 중…</p>}
      {state === 'error' && (
        <p role="alert" style={{ color: '#b91c1c' }}>
          수집본 기록을 불러오지 못했습니다: {error}{' '}
          <button type="button" onClick={retry}>
            다시 시도
          </button>
        </p>
      )}
      {state === 'ready' && records.length === 1 && (
        <p style={{ fontSize: 13, color: '#666' }}>
          아직 한 번만 받았습니다. Studio에서 다시 보내면 이전 원문이 여기에 남습니다.
        </p>
      )}
      {state === 'ready' && (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {records.map((r, i) => (
            <li key={r.snapshot_id}>
              <button
                type="button"
                onClick={() => onView(r)}
                aria-pressed={r.snapshot_id === viewingId}
                className="snapshot-row"
                title={`request_id ${r.request_id}`}
              >
                <span className="revision">R{records.length - i}</span>
                <span className="snapshot-date">
                  <strong>{r.is_current ? '현재 수집본' : `이전 ${records.length - i}번째 수집본`}</strong>
                  <time dateTime={r.received_at}>{new Date(r.received_at).toLocaleString('ko-KR')}</time>
                </span>
                <small>{r.raw_code.split('\n').length}줄</small>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
