import { useState } from 'react'
import { FeaturePicker } from '../features/FeaturePicker'
import { linkMaterial } from '../features/featuresApi'

type LinkState =
  | { kind: 'idle' }
  | { kind: 'linking'; featureTitle: string }
  | { kind: 'done'; featureTitle: string; already: boolean }
  | { kind: 'error'; featureId: string; featureTitle: string; message: string }

interface MaterialActionsProps {
  /** 지금 자료함에서 고른 자료 */
  materialId: string
  materialName: string
  /** 보드에 자료 카드를 추가한다 (B의 addMaterialCard) */
  onAddMaterial: (materialId: string) => void
}

/**
 * D 담당 (04회차 #16): 고른 자료를 기능에 연결하거나 보드에 올리는 버튼 모음.
 * 자료가 바뀌면 MaterialLibrary가 key로 이 컴포넌트를 새로 만들어 상태가 초기화된다.
 */
export function MaterialActions({ materialId, materialName, onAddMaterial }: MaterialActionsProps) {
  const [showPicker, setShowPicker] = useState(false)
  const [link, setLink] = useState<LinkState>({ kind: 'idle' })
  const [addedCount, setAddedCount] = useState(0)

  async function connect(featureId: string, featureTitle: string) {
    if (link.kind === 'linking') return // 요청 중에는 다시 누르지 않게
    setLink({ kind: 'linking', featureTitle })
    try {
      const res = await linkMaterial(featureId, materialId)
      setLink({ kind: 'done', featureTitle, already: res.already_linked })
      setShowPicker(false)
    } catch (e) {
      setLink({ kind: 'error', featureId, featureTitle, message: (e as Error).message })
    }
  }

  function addToBoard() {
    onAddMaterial(materialId)
    setAddedCount((n) => n + 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '8px 0' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setShowPicker((v) => !v)} disabled={link.kind === 'linking'}>
          {showPicker ? '연결 취소' : '기능에 연결'}
        </button>
        <button type="button" onClick={addToBoard}>
          보드에 추가
        </button>
      </div>

      {showPicker && (
        <div style={{ border: '1px solid #ccc', padding: 8, maxWidth: 420 }}>
          <p style={{ margin: '0 0 8px' }}>{materialName}을(를) 연결할 기능을 고르세요.</p>
          <FeaturePicker onSelect={(id, f) => void connect(id, f.title)} />
        </div>
      )}

      {link.kind === 'linking' && <p>"{link.featureTitle}"에 연결하는 중…</p>}
      {link.kind === 'done' && (
        <p style={{ color: '#15803d' }}>
          {link.already
            ? `이미 "${link.featureTitle}"에 연결되어 있습니다.`
            : `"${link.featureTitle}"에 연결했습니다.`}{' '}
          기능 화면의 연결 자료 목록에서 확인할 수 있습니다.
        </p>
      )}
      {link.kind === 'error' && (
        <p role="alert" style={{ color: '#b91c1c' }}>
          "{link.featureTitle}"에 연결하지 못했습니다: {link.message}{' '}
          <button type="button" onClick={() => void connect(link.featureId, link.featureTitle)}>
            다시 시도
          </button>
        </p>
      )}
      {addedCount > 0 && (
        <p style={{ color: '#15803d' }}>
          보드에 자료 카드를 추가했습니다{addedCount > 1 ? ` (${addedCount}장)` : ''}. 보드 메뉴에서 확인하세요.
        </p>
      )}
    </div>
  )
}
