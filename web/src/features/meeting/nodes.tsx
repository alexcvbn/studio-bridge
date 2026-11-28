import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'
import {
  Box,
  Check,
  ChevronRight,
  Code2,
  ImageIcon,
  Plus,
  Sparkles,
  StickyNote,
  X,
} from 'lucide-react'
import { Editable } from './Editable'
import { useMeeting } from './MeetingContext'
import { rowId, updateItem, type DiscussStatus, type MeetingItem } from './meetingSync'
import { initials } from './presence'
import { timeLabel } from './format'

export type ItemNode = Node<{ item: MeetingItem }, 'item'>

const STATUS: Record<DiscussStatus, { label: string; next: DiscussStatus }> = {
  discussing: { label: '논의 중', next: 'agreed' },
  agreed: { label: '합의됨', next: 'hold' },
  hold: { label: '보류', next: 'discussing' },
}

// 스크립트 이름·종류로 아이콘을 고른다 (모델·효과·코드).
function materialIcon(name: string) {
  if (/model|mesh|part/i.test(name)) return <Box />
  if (/effect|fx|particle|vfx/i.test(name)) return <Sparkles />
  return <Code2 />
}

function PeerTags({ id }: { id: string }) {
  const { peerSelections } = useMeeting()
  const who = peerSelections[id]
  if (!who?.length) return null
  return (
    <div className="peer-tags">
      {who.map((p) => (
        <span key={p.name + p.color} style={{ background: p.color }}>
          {p.name}
        </span>
      ))}
    </div>
  )
}

function Handles({ connectable }: { connectable: boolean }) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={connectable} />
      <Handle type="source" position={Position.Right} isConnectable={connectable} />
    </>
  )
}

function FeatureCard({ item }: { item: MeetingItem }) {
  const { catalog, load, links, onOpenInBoard } = useMeeting()
  const target = catalog.get('feature:' + item.target_id)
  const status = STATUS[item.status ?? 'discussing']
  const changes = item.changes ?? []
  const checks = item.checks ?? []
  const linked = item.target_id ? links[item.target_id] : undefined
  return (
    <div className="m-card feature">
      <div className="m-card-head">
        <h3>{target?.title ?? (load === 'loading' ? '불러오는 중…' : '찾을 수 없는 기능')}</h3>
        <button
          className={'status-badge nodrag ' + (item.status ?? 'discussing')}
          title="눌러서 상태 바꾸기"
          onClick={() => updateItem(item.id, { status: status.next })}
        >
          <i />
          {status.label}
        </button>
      </div>
      <Editable
        className="m-summary"
        label="한 줄 설명"
        placeholder="한 줄 설명 (예: 예고 후 전방으로 돌진하는 공격)"
        value={item.summary ?? ''}
        onCommit={(summary) => updateItem(item.id, { summary })}
      />
      <section>
        <h4>변경점</h4>
        {changes.length > 0 && (
          <div className="change-box">
            <span className="tag">변경 제안</span>
            {changes.map((c) => (
              <div className="change-row" key={c.id}>
                <Editable
                  className="c-label"
                  label="변경 항목"
                  placeholder="항목"
                  value={c.label}
                  onCommit={(label) =>
                    updateItem(item.id, { changes: changes.map((x) => (x.id === c.id ? { ...x, label } : x)) })
                  }
                />
                <Editable
                  className="c-val"
                  label="이전 값"
                  placeholder="이전"
                  value={c.before}
                  onCommit={(before) =>
                    updateItem(item.id, { changes: changes.map((x) => (x.id === c.id ? { ...x, before } : x)) })
                  }
                />
                <span className="arrow">→</span>
                <Editable
                  className="c-val after"
                  label="바꿀 값"
                  placeholder="제안"
                  value={c.after}
                  onCommit={(after) =>
                    updateItem(item.id, { changes: changes.map((x) => (x.id === c.id ? { ...x, after } : x)) })
                  }
                />
                <button
                  className="row-x nodrag"
                  aria-label="변경점 지우기"
                  onClick={() => updateItem(item.id, { changes: changes.filter((x) => x.id !== c.id) })}
                >
                  <X />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          className="add-row nodrag"
          onClick={() =>
            updateItem(item.id, { changes: [...changes, { id: rowId(), label: '', before: '', after: '' }] })
          }
        >
          <Plus /> 변경점 추가
        </button>
      </section>
      <section>
        <h4>협의점</h4>
        {checks.map((c) => (
          <div className="check-row" key={c.id}>
            <button
              role="checkbox"
              aria-checked={c.done}
              aria-label={(c.text || '협의점') + (c.done ? ' 합의함' : ' 아직')}
              className="check nodrag"
              onClick={() =>
                updateItem(item.id, { checks: checks.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })
              }
            >
              {c.done && <Check />}
            </button>
            <Editable
              className={'check-text' + (c.done ? ' done' : '')}
              label="협의점 내용"
              placeholder="함께 정할 것"
              value={c.text}
              onCommit={(text) =>
                updateItem(item.id, { checks: checks.map((x) => (x.id === c.id ? { ...x, text } : x)) })
              }
            />
            <button
              className="row-x nodrag"
              aria-label="협의점 지우기"
              onClick={() => updateItem(item.id, { checks: checks.filter((x) => x.id !== c.id) })}
            >
              <X />
            </button>
          </div>
        ))}
        <button
          className="add-row nodrag"
          onClick={() => updateItem(item.id, { checks: [...checks, { id: rowId(), text: '', done: false }] })}
        >
          <Plus /> 협의점 추가
        </button>
      </section>
      <section>
        <h4>연결된 구현</h4>
        <div className="chips">
          {linked === undefined && <span className="muted">불러오는 중…</span>}
          {linked?.length === 0 && <span className="muted">아직 연결된 코드가 없어요</span>}
          {linked?.map((m) => (
            <button
              key={m.material_id}
              className="chip nodrag"
              title={m.source_path}
              onClick={() => onOpenInBoard('material', m.material_id)}
            >
              {materialIcon(m.name)}
              {m.name}
            </button>
          ))}
        </div>
      </section>
      <footer>
        <span>
          {item.author.name} · {timeLabel(item.created_at)}
        </span>
        {target && (
          <button className="link nodrag" onClick={() => onOpenInBoard('feature', target.target_id)}>
            상세·결정 <ChevronRight />
          </button>
        )}
      </footer>
    </div>
  )
}

function CodeCard({ item }: { item: MeetingItem }) {
  const { catalog } = useMeeting()
  const t = catalog.get('material:' + item.target_id)
  return (
    <div className="m-card code">
      <span className="code-icon">{materialIcon(t?.title ?? '')}</span>
      <div>
        <strong>{t?.title ?? '찾을 수 없는 자료'}</strong>
        <small>{t?.detail}</small>
      </div>
      {t?.badge && <em>{t.badge}</em>}
    </div>
  )
}

function NoteCard({ item }: { item: MeetingItem }) {
  return (
    <div className="m-card note">
      <Editable
        multiline
        className="note-text"
        label="메모"
        placeholder="메모를 쓰세요"
        maxLength={600}
        value={item.text ?? ''}
        onCommit={(text) => updateItem(item.id, { text })}
      />
      <footer>
        <StickyNote /> {item.author.name}
      </footer>
    </div>
  )
}

function CommentCard({ item }: { item: MeetingItem }) {
  return (
    <div className="m-card comment">
      <span className="avatar" style={{ background: item.author.color }}>
        {initials(item.author.name)}
      </span>
      <div className="comment-body">
        <strong>{item.author.name}</strong>
        <Editable
          multiline
          className="comment-text"
          label="의견"
          placeholder="의견을 쓰세요"
          maxLength={600}
          value={item.text ?? ''}
          onCommit={(text) => updateItem(item.id, { text })}
        />
        <small>{timeLabel(item.created_at)}</small>
      </div>
    </div>
  )
}

function ImageCard({ item }: { item: MeetingItem }) {
  return (
    <div className="m-card image">
      {item.image ? <img src={item.image} alt={item.text || '참고 이미지'} draggable={false} /> : <div className="img-empty" />}
      <div className="caption">
        <ImageIcon />
        <Editable
          label="이미지 설명"
          placeholder="이미지 설명"
          value={item.text ?? ''}
          onCommit={(text) => updateItem(item.id, { text })}
        />
      </div>
    </div>
  )
}

const MIN: Record<MeetingItem['type'], { width: number; height: number }> = {
  feature: { width: 300, height: 220 },
  code: { width: 180, height: 56 },
  note: { width: 160, height: 120 },
  comment: { width: 220, height: 80 },
  image: { width: 200, height: 150 },
}

export function ItemNodeView({ data, selected, isConnectable }: NodeProps<ItemNode>) {
  const { item } = data
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={MIN[item.type].width}
        minHeight={MIN[item.type].height}
        maxWidth={900}
        maxHeight={900}
        color="#1f6feb"
        handleClassName="m-resize-handle"
        lineClassName="m-resize-line"
      />
      <PeerTags id={item.id} />
      <Handles connectable={isConnectable} />
      {item.type === 'feature' && <FeatureCard item={item} />}
      {item.type === 'code' && <CodeCard item={item} />}
      {item.type === 'note' && <NoteCard item={item} />}
      {item.type === 'comment' && <CommentCard item={item} />}
      {item.type === 'image' && <ImageCard item={item} />}
    </>
  )
}
