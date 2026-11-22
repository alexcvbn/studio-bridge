import { useState } from 'react'
import { ArrowLeftRight, Trash2 } from 'lucide-react'
import { RELATIONS, removeConnection, reverseConnection, updateConnection } from './boardSync'
import type { BoardConnection } from './types'

interface Props {
  connection: BoardConnection
  fromTitle: string
  toTitle: string
}

// 선택한 관계선을 고친다. 바꾼 값은 바로 공유 보드에 저장된다.
// 부모가 connection_id를 key로 넘겨, 다른 선을 고르면 입력창이 새로 시작한다.
export function ConnectionTools({ connection, fromTitle, toTitle }: Props) {
  const [label, setLabel] = useState(connection.label)
  const commit = () => updateConnection(connection.connection_id, { label: label.trim() })
  return (
    <div className="selection-tools connection-tools" role="group" aria-label="선택한 연결">
      <span className="connection-ends" title={fromTitle + ' → ' + toTitle}>
        {fromTitle} → {toTitle}
      </span>
      <span className="relation-picker" role="radiogroup" aria-label="관계 종류">
        {RELATIONS.map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={connection.relation === r}
            onClick={() => updateConnection(connection.connection_id, { relation: r })}
          >
            {r}
          </button>
        ))}
      </span>
      <input
        aria-label="관계 이름"
        placeholder="관계 이름 (예: 사용)"
        value={label}
        maxLength={40}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // 한글 조합 중의 Enter는 무시한다(글자가 잘려 저장되지 않게). 조합이 끝나면 blur에서도 저장된다.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit()
          if (e.key === 'Escape') setLabel(connection.label)
        }}
      />
      <button
        title="방향 바꾸기"
        aria-label="방향 바꾸기"
        onClick={() => reverseConnection(connection.connection_id)}
      >
        <ArrowLeftRight />
      </button>
      <button
        title="연결 지우기"
        aria-label="연결 지우기"
        onClick={() => removeConnection(connection.connection_id)}
      >
        <Trash2 />
      </button>
    </div>
  )
}
