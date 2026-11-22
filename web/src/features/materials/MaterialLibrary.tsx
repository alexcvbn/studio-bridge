import { useEffect, useState } from 'react'
import { Code2, History } from 'lucide-react'
import { addMaterialCard } from '../board'
import { MaterialActions } from './MaterialActions'
import { SnapshotHistory } from './SnapshotHistory'
import { fetchMaterial, type MaterialDetail, type Snapshot } from './materialsApi'

interface Props {
  materialId: string
  revision: number
  onLinked: () => void
}

export function MaterialLibrary({ materialId, revision, onLinked }: Props) {
  const [detail, setDetail] = useState<MaterialDetail | null>(null)
  const [older, setOlder] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    fetchMaterial(materialId).then(
      (data) => {
        if (alive) {
          setDetail(data)
          setError('')
        }
      },
      (err: Error) => {
        if (alive) setError(err.message)
      },
    )
    return () => {
      alive = false
    }
  }, [materialId, revision, retry])
  const shown = older ?? detail?.current_snapshot
  return (
    <section className="material-detail">
      {error && (
        <p role="alert">
          {error} <button onClick={() => setRetry((n) => n + 1)}>다시 시도</button>
        </p>
      )}
      {!detail && !error && <p>원문을 불러오는 중…</p>}
      {detail && shown && (
        <>
          <div className="detail-heading">
            <span className="type-icon material">
              <Code2 />
            </span>
            <div>
              <h2>{shown.name}</h2>
              <small>{shown.source_path}</small>
            </div>
          </div>
          <div className="code-head">
            <strong>코드 원문</strong>
            <span>
              {shown.script_type} · {shown.raw_code.split('\n').length}줄
            </span>
          </div>
          {older && (
            <div className="older">
              이전 수집본 <button onClick={() => setOlder(null)}>현재 원문 보기</button>
            </div>
          )}
          <div className="source-reader">
            <pre aria-hidden="true">
              {shown.raw_code
                .split('\n')
                .map((_, i) => i + 1)
                .join('\n')}
            </pre>
            <pre>
              <code>{shown.raw_code}</code>
            </pre>
          </div>
          <div className="detail-section">
            <MaterialActions
              materialId={materialId}
              materialName={detail.current_snapshot.name}
              onAddMaterial={addMaterialCard}
              onLinked={onLinked}
            />
          </div>
          <div className="detail-section history">
            <History size={16} />
            <SnapshotHistory
              key={detail.current_snapshot.snapshot_id}
              materialId={materialId}
              viewingId={shown.snapshot_id}
              onView={(s) => setOlder(s.snapshot_id === detail.current_snapshot.snapshot_id ? null : s)}
            />
          </div>
          <details className="identifiers">
            <summary>수집 정보</summary>
            <p>
              {new Date(shown.received_at).toLocaleString()} · {shown.raw_code.length}자
            </p>
            <p>
              source_uid {detail.source_uid}
              <br />
              material_id {materialId}
              <br />
              snapshot_id {shown.snapshot_id}
              <br />
              request_id {shown.request_id}
            </p>
          </details>
        </>
      )}
    </section>
  )
}
