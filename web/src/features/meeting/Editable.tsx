import { useState, type KeyboardEvent } from 'react'

// 카드 안에서 바로 고치는 글자 칸. 다 쓰고 나가거나 Enter를 누를 때만 저장해서,
// 글자 하나마다 공유 문서를 덮어쓰지 않는다. 다른 사람이 바꾸면 그 값으로 다시 시작한다.
export function Editable({
  value,
  onCommit,
  placeholder,
  multiline,
  className,
  label,
  maxLength = 200,
}: {
  value: string
  onCommit: (next: string) => void
  placeholder?: string
  multiline?: boolean
  className?: string
  label: string
  maxLength?: number
}) {
  return (
    <EditableInner
      key={value}
      value={value}
      onCommit={onCommit}
      placeholder={placeholder}
      multiline={multiline}
      className={className}
      label={label}
      maxLength={maxLength}
    />
  )
}

function EditableInner({
  value,
  onCommit,
  placeholder,
  multiline,
  className,
  label,
  maxLength,
}: {
  value: string
  onCommit: (next: string) => void
  placeholder?: string
  multiline?: boolean
  className?: string
  label: string
  maxLength: number
}) {
  const [draft, setDraft] = useState(value)
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // 한글 조합 중의 Enter는 무시한다(마지막 글자가 잘리지 않게).
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && (!multiline || !e.shiftKey)) {
      e.preventDefault()
      ;(e.target as HTMLElement).blur()
    }
    if (e.key === 'Escape') {
      setDraft(value)
      ;(e.target as HTMLElement).blur()
    }
  }
  const common = {
    'aria-label': label,
    className: 'editable nodrag ' + (className ?? ''),
    placeholder,
    value: draft,
    maxLength,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown,
  }
  return multiline ? <textarea rows={2} {...common} /> : <input {...common} />
}
