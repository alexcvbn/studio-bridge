import { useState, type FormEvent } from 'react'
import { findBySourceUid } from './materialsApi'

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'found'; name: string }
  | { kind: 'none'; sourceUid: string }
  | { kind: 'error'; message: string }

interface SourceUidSearchProps {
  /** 찾으면 그 자료의 material_id를 넘겨 상세를 연다 */
  onFound: (materialId: string) => void
}

/**
 * D 담당 (05회차 #20): Studio 스크립트의 source_uid로 자료함의 자료를 찾는다.
 * 이름이 아니라 source_uid로 찾으므로, 이름이 같은 다른 스크립트와 헷갈리지 않는다.
 */
export function SourceUidSearch({ onFound }: SourceUidSearchProps) {
  const [sourceUid, setSourceUid] = useState('')
  const [state, setState] = useState<SearchState>({ kind: 'idle' })

  async function search(e?: FormEvent) {
    e?.preventDefault()
    const uid = sourceUid.trim()
    if (uid === '' || state.kind === 'searching') return
    setState({ kind: 'searching' })
    try {
      const res = await findBySourceUid(uid)
      if (res.material === null) {
        setState({ kind: 'none', sourceUid: uid })
        return
      }
      setState({ kind: 'found', name: res.material.current_snapshot.name })
      onFound(res.material.material_id)
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message })
    }
  }

  return (
    <form onSubmit={(e) => void search(e)} style={{ margin: '12px 0' }}>
      <label style={{ display: 'block', fontSize: 13 }}>
        Studio source_uid로 찾기
        <input
          value={sourceUid}
          onChange={(e) => setSourceUid(e.target.value)}
          placeholder="예: 3f2a…"
          style={{ display: 'block', width: '100%', boxSizing: 'border-box' }}
        />
      </label>
      <button type="submit" disabled={sourceUid.trim() === '' || state.kind === 'searching'}>
        {state.kind === 'searching' ? '찾는 중…' : '찾기'}
      </button>

      {state.kind === 'found' && <p style={{ color: '#15803d' }}>찾았습니다: {state.name}</p>}
      {state.kind === 'none' && (
        <p>이 source_uid로 받은 자료가 없습니다. Studio에서 먼저 코드를 보내 주세요.</p>
      )}
      {state.kind === 'error' && (
        <p role="alert" style={{ color: '#b91c1c' }}>
          찾지 못했습니다: {state.message}{' '}
          <button type="button" onClick={() => void search()}>
            다시 시도
          </button>
        </p>
      )}
    </form>
  )
}
