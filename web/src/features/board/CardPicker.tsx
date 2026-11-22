import { useState } from 'react'
import { Code2, Layers2, Plus } from 'lucide-react'
import type { TargetInfo } from './targetsApi'

interface Props {
  targets: TargetInfo[]
  load: 'loading' | 'ready' | 'error'
  onPick: (target: TargetInfo) => void
  onDismiss: () => void
}

export function CardPicker({ targets, load, onPick, onDismiss }: Props) {
  const [query, setQuery] = useState('')
  const term = query.trim().toLocaleLowerCase()
  const matches = targets.filter((t) => (t.title + ' ' + t.detail).toLocaleLowerCase().includes(term))
  return (
    <section
      className="add-pop"
      aria-label="보드에 추가할 항목"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onDismiss()
        }
      }}
    >
      <label htmlFor="card-filter">보드에 추가할 항목</label>
      <input
        id="card-filter"
        type="search"
        autoFocus
        placeholder="기능·자료 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="picker-list">
        {matches.map((target) => (
          <button
            key={target.kind + target.target_id}
            onClick={() => onPick(target)}
            aria-label={target.title + ' 카드 추가'}
            title={target.detail}
          >
            <span className={'type-icon ' + target.kind}>
              {target.kind === 'feature' ? <Layers2 /> : <Code2 />}
            </span>
            <span className="pick-title">
              <strong>{target.title}</strong>
              <small>
                {target.badge} · {target.detail}
              </small>
            </span>
            <Plus size={14} />
          </button>
        ))}
        {!matches.length && (
          <p>
            {load === 'error'
              ? '목록을 불러오지 못했습니다. 라이브러리에서 다시 조회하세요.'
              : load === 'loading'
                ? '불러오는 중…'
                : term
                  ? '검색 결과가 없습니다.'
                  : '라이브러리에서 기능을 만들거나 Studio에서 자료를 보내세요.'}
          </p>
        )}
      </div>
    </section>
  )
}
