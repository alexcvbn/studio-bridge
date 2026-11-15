import { useCallback, useEffect, useRef, useState } from 'react'
import { addMaterialCard } from '../board'
import { MaterialActions } from './MaterialActions'
import { SnapshotHistory } from './SnapshotHistory'
import { SourceUidSearch } from './SourceUidSearch'
import {
  fetchMaterial,
  fetchMaterials,
  type MaterialDetail,
  type MaterialSummary,
  type Snapshot,
} from './materialsApi'

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
  // 이전 수집본을 골라 보는 중이면 그 수집본, 아니면 null(현재 원문을 본다)
  const [olderView, setOlderView] = useState<Snapshot | null>(null)
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

  // 새로고침: 목록과 함께, 열어 둔 자료도 다시 불러와 다시 보낸 코드가 바로 보이게 한다 (06회차 #24)
  function refresh() {
    void loadList()
    if (selectedId) void select(selectedId, true)
  }

  useEffect(() => {
    // 화면이 처음 열릴 때 한 번 목록을 불러온다 (listLoading은 true로 시작)
    fetchMaterials()
      .then(setItems)
      .catch((e: Error) => setListError(e.message))
      .finally(() => setListLoading(false))
  }, [])

  async function select(materialId: string, keepShowing = false) {
    const requestNo = ++latestRequest.current
    setSelectedId(materialId)
    if (!keepShowing) setDetail(null) // 새로고침일 때는 불러오는 동안 이전 내용을 그대로 둔다
    setOlderView(null)
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

  // 원문 칸에 보여 줄 수집본: 이전 것을 골랐으면 그것, 아니면 현재 수집본
  const shown = detail ? (olderView ?? detail.current_snapshot) : null

  return (
    <section style={{ display: 'flex', gap: 16, textAlign: 'left' }}>
      <div style={{ width: 260 }}>
        <h2>받은 자료함</h2>
        <p style={{ color: '#15803d' }}>실제 서버 데이터 · 새로고침해도 유지됩니다</p>
        <button type="button" onClick={refresh} disabled={listLoading}>
          {listLoading ? '불러오는 중…' : '새로고침'}
        </button>

        {listError && (
          <p role="alert" style={{ color: '#b91c1c' }}>
            목록을 불러오지 못했습니다: {listError}
          </p>
        )}
        <SourceUidSearch onFound={(materialId) => void select(materialId)} />

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
        {detail && shown && (
          <>
            <h3>{shown.name}</h3>
            <MaterialActions
              key={detail.material_id}
              materialId={detail.material_id}
              materialName={detail.current_snapshot.name}
              onAddMaterial={onAddMaterial}
            />
            {olderView && (
              <p role="status" style={{ background: '#fef3c7', color: '#92400e', padding: 8 }}>
                이전 수집본을 보고 있습니다. 현재 원문이 아닙니다.{' '}
                <button type="button" onClick={() => setOlderView(null)}>
                  현재 원문 보기
                </button>
              </p>
            )}
            <p>
              {shown.source_path} · {shown.script_type} · 받은 시각{' '}
              {new Date(shown.received_at).toLocaleString()}
            </p>
            <p style={{ fontSize: 12, color: '#666' }}>
              source_uid {detail.source_uid} · 수집본 {detail.snapshot_count}개
              <br />
              material_id {detail.material_id} · snapshot_id {shown.snapshot_id}
              <br />
              request_id {shown.request_id} · {shown.raw_code.split('\n').length}줄 · {shown.raw_code.length}자
            </p>
            <pre style={{ background: '#111', color: '#eee', padding: 12, whiteSpace: 'pre', overflowX: 'auto' }}>
              <code>{shown.raw_code}</code>
            </pre>
            <SnapshotHistory
              key={`${detail.material_id}:${detail.current_snapshot.snapshot_id}`}
              materialId={detail.material_id}
              viewingId={shown.snapshot_id}
              onView={(s) => setOlderView(s.snapshot_id === detail.current_snapshot.snapshot_id ? null : s)}
            />
          </>
        )}
      </div>
    </section>
  )
}
