import { useState, type FormEvent } from 'react'
import { Link2, MonitorUp, UserPlus } from 'lucide-react'
import { initials, setMyName, type Peer, type User } from './presence'

// 위쪽 참여자 줄: 동그라미(누르면 그 사람 화면 따라가기), 인원 수, 발표, 초대.
export function PresenceBar({
  self,
  peers,
  following,
  presenting,
  onFollow,
  onPresent,
}: {
  self: User
  peers: Peer[]
  following: number | null
  presenting: boolean
  onFollow: (clientId: number | null) => void
  onPresent: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(self.name)
  const [copied, setCopied] = useState(false)
  const shown = peers.slice(0, 5)
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) setMyName(name)
    setEditing(false)
  }
  const invite = async () => {
    const url = location.origin + location.pathname + '#meeting'
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      window.prompt('이 주소를 팀원에게 보내세요', url)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="presence-bar">
      <div className="avatars">
        <button
          className="avatar me"
          style={{ background: self.color }}
          title={self.name + ' (나) · 눌러서 이름 바꾸기'}
          aria-label="내 이름 바꾸기"
          onClick={() => {
            setName(self.name)
            setEditing(!editing)
          }}
        >
          {initials(self.name)}
        </button>
        {shown.map((p) => (
          <button
            key={p.clientId}
            className={'avatar' + (following === p.clientId ? ' following' : '') + (p.spotlight ? ' presenting' : '')}
            style={{ background: p.user.color, ['--who' as string]: p.user.color }}
            title={p.user.name + (p.spotlight ? ' · 발표 중' : '') + ' · 눌러서 화면 따라가기'}
            aria-label={p.user.name + ' 화면 따라가기'}
            aria-pressed={following === p.clientId}
            onClick={() => onFollow(following === p.clientId ? null : p.clientId)}
          >
            {initials(p.user.name)}
          </button>
        ))}
        {peers.length > shown.length && <span className="avatar more">+{peers.length - shown.length}</span>}
      </div>
      <span className="people-count" data-testid="people-count">
        {peers.length + 1}명 참여 중
      </span>
      <button className={'bar-btn' + (presenting ? ' on' : '')} aria-pressed={presenting} onClick={onPresent} title="모두가 내 화면을 따라오게 하기">
        <MonitorUp /> {presenting ? '발표 끝내기' : '발표'}
      </button>
      <button className="bar-btn" onClick={invite} title="회의 공간 주소 복사">
        {copied ? <Link2 /> : <UserPlus />} {copied ? '주소 복사됨' : '초대'}
      </button>
      {editing && (
        <form className="name-pop" onSubmit={save}>
          <label htmlFor="my-name">회의에서 보일 내 이름</label>
          <input id="my-name" autoFocus maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <button type="button" onClick={() => setEditing(false)}>
              취소
            </button>
            <button className="primary" disabled={!name.trim()}>
              저장
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
