import { useCallback, useEffect, useRef, useState } from 'react'
import { addMaterialCard } from '../board'
import { MaterialActions } from './MaterialActions'
import { fetchMaterial, fetchMaterials, type MaterialDetail, type MaterialSummary } from './materialsApi'

interface MaterialLibraryProps {
  /** "보드에 추가"를 누르면 호출된다. App.tsx가 넘기지 않으면 B의 addMaterialCard를 바로 쓴다. */
  onAddMaterial?: (materialId: string) => void
}

export function MaterialLibrary({ onAddMaterial = addMaterialCard }: MaterialLibraryProps = {}) {
  // 목록 상태: 불러오는 중 / 실패 메시지 / 받은 목록
  const [items, setItems] = useState<MaterialSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  // 상세 상태: 고른 ID / 그 자료의 원문 / 불러오는 중 / 실패 메시지
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MaterialDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const latestRequest = useRef(0) // 빨리 바꿔 눌러도 마지막 선택의 응답만 쓰기 위한 번호

  const loadList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      setItems(await fetchMaterials())
    } catch (e) {
      setListError((e as Error).message) // 실패해도 이전 목록은 그대로 둔다
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    // 화면이 처음 열릴 때 한 번 목록을 불러온다 (listLoading은 true로 시작)
    fetchMaterials()
      .then(setItems)
      .catch((e: Error) => setListError(e.message))
      .finally(() => setListLoading(false))
  }, [])

  async function select(materialId: string) {
    const requestNo = ++latestRequest.current
    setSelectedId(materialId)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const data = await fetchMaterial(materialId)
      if (requestNo === latestRequest.current) setDetail(data)
    } catch (e) {
      if (requestNo === latestRequest.current) setDetailError((e as Error).message)
    } finally {
      if (requestNo === latestRequest.current) setDetailLoading(false)
    }
  }

  return (
    <section style={{ display: 'flex', gap: 16, textAlign: 'left' }}>
      <div style={{ width: 260 }}>
        <h2>받은 자료함</h2>
        <p style={{ color: '#15803d' }}>실제 서버 데이터 · 새로고침해도 유지됩니다</p>
        <button type="button" onClick={() => void loadList()} disabled={listLoading}>
          {listLoading ? '불러오는 중…' : '새로고침'}
        </button>

        {listError && (
          <p role="alert" style={{ color: '#b91c1c' }}>
            목록을 불러오지 못했습니다: {listError}
          </p>
        )}
        {!listLoading && !listError && items.length === 0 && (
          <p>아직 받은 자료가 없습니다. Studio에서 코드를 보내면 여기에 나타납니다.</p>
        )}

        <ul style={{ listStyle: 'none', padding: 0 }}>
          {items.map((m) => (
            <li key={m.material_id}>
              <button
                type="button"
                onClick={() => void select(m.material_id)}
                aria-pressed={m.material_id === selectedId}
                style={{ width: '100%', fontWeight: m.material_id === selectedId ? 700 : 400 }}
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ flex: 1 }}>
        {selectedId === null && <p>왼쪽에서 자료를 선택하면 원문이 보입니다.</p>}
        {detailLoading && <p>원문을 불러오는 중…</p>}
        {detailError && selectedId && (
          <p role="alert" style={{ color: '#b91c1c' }}>
            원문을 불러오지 못했습니다: {detailError}{' '}
            <button type="button" onClick={() => void select(selectedId)}>
              다시 시도
            </button>
          </p>
        )}
        {detail && (
          <>
            <h3>{detail.current_snapshot.name}</h3>
            <MaterialActions
              key={detail.material_id}
              materialId={detail.material_id}
              materialName={detail.current_snapshot.name}
              onAddMaterial={onAddMaterial}
            />
            <p>
              {detail.current_snapshot.source_path} · {detail.current_snapshot.script_type} · 받은 시각{' '}
              {new Date(detail.current_snapshot.received_at).toLocaleString()}
            </p>
            <p style={{ fontSize: 12, color: '#666' }}>
              material_id {detail.material_id} · request_id {detail.current_snapshot.request_id} · {detail.current_snapshot.raw_code.split('\n').length}줄 ·{' '}
              {detail.current_snapshot.raw_code.length}자
            </p>
            <pre style={{ background: '#111', color: '#eee', padding: 12, whiteSpace: 'pre', overflowX: 'auto' }}>
              <code>{detail.current_snapshot.raw_code}</code>
            </pre>
          </>
        )}
      </div>
    </section>
  )
}
