import { useLayoutEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { LOCAL_MEMO_ORIGIN, applyMemoEdit, getBoardSync, type SyncStatus } from './boardSync'

// 남이 쓴 변경이 내 커서 앞쪽에 들어오거나 지워졌을 때 커서를 같은 글자 옆에 두도록 옮긴다.
function shiftIndex(index: number, delta: Y.YTextEvent['delta']): number {
  let cursor = 0
  let shift = 0
  for (const op of delta) {
    if (op.retain !== undefined) {
      cursor += op.retain
    } else if (op.insert !== undefined) {
      if (cursor <= index) shift += typeof op.insert === 'string' ? op.insert.length : 1
    } else if (op.delete !== undefined) {
      if (cursor < index) shift -= Math.min(op.delete, index - cursor)
      cursor += op.delete
    }
  }
  return index + shift
}

export function MemoPanel({ status }: { status: SyncStatus }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const pendingSelection = useRef<[number, number] | null>(null)
  const [value, setValue] = useState(() => getBoardSync().memo.toString())

  // 공유 메모가 바뀌면 입력창을 맞춘다. 내가 방금 입력한 변경은 이미 화면에 있어 건너뛴다.
  useLayoutEffect(() => {
    const { memo } = getBoardSync()
    const onChange = (event: Y.YTextEvent) => {
      if (event.transaction.origin === LOCAL_MEMO_ORIGIN) return
      const el = ref.current
      if (el) {
        pendingSelection.current = [
          shiftIndex(el.selectionStart, event.delta),
          shiftIndex(el.selectionEnd, event.delta),
        ]
      }
      setValue(memo.toString())
    }
    memo.observe(onChange)
    // 마운트 사이에 도착한 내용을 놓치지 않는다.
    return () => memo.unobserve(onChange)
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    const sel = pendingSelection.current
    if (el && sel && document.activeElement === el) el.setSelectionRange(sel[0], sel[1])
    pendingSelection.current = null
  }, [value])

  return (
    <aside style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label htmlFor="board-memo">
        <strong>공동 메모</strong>
      </label>
      <textarea
        id="board-memo"
        ref={ref}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          applyMemoEdit(e.target.value)
        }}
        placeholder="함께 보는 메모를 적어 보세요"
        style={{ flex: 1, minHeight: 200, resize: 'none' }}
      />
      {status !== 'connected' && (
        <span role="status" style={{ color: '#d32f2f', fontSize: 12 }}>
          {status === 'connecting'
            ? '서버에 연결하는 중입니다. 지금 쓴 내용은 연결되면 반영됩니다.'
            : '연결이 끊겼습니다. 쓴 내용은 이 화면에 남고 다시 연결되면 반영됩니다.'}
        </span>
      )}
    </aside>
  )
}
