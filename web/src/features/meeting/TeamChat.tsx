import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, Paperclip, SendHorizontal, Users } from 'lucide-react'
import { getMeetingSync, sendChat, type ChatMessage } from './meetingSync'
import { initials, me } from './presence'
import { timeLabel } from './format'

// 아래쪽 팀 채팅. 동기화 문서에 저장되므로 나중에 들어온 사람도 앞의 대화를 본다.
export function TeamChat({
  people,
  open,
  onToggle,
  onAttach,
}: {
  people: number
  open: boolean
  onToggle: () => void
  onAttach: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => getMeetingSync().chat.toArray())
  const [text, setText] = useState('')
  const [seen, setSeen] = useState(messages.length)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const { chat } = getMeetingSync()
    const update = () => setMessages(chat.toArray())
    chat.observe(update)
    return () => chat.unobserve(update)
  }, [])
  useEffect(() => {
    if (!open) return
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages.length, open])
  const unread = open ? 0 : Math.max(0, messages.length - seen)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    sendChat(me(), text)
    setText('')
  }
  return (
    <section className={'team-chat' + (open ? ' open' : '')} aria-label="팀 채팅">
      <header>
        <h2>팀 채팅</h2>
        <span className="people">
          <Users /> {people}명
        </span>
        {unread > 0 && <span className="unread">새 메시지 {unread}</span>}
        <button
          className="icon"
          aria-label={open ? '채팅 접기' : '채팅 펼치기'}
          aria-expanded={open}
          onClick={() => {
            setSeen(messages.length)
            onToggle()
          }}
        >
          {open ? <ChevronDown /> : <ChevronUp />}
        </button>
      </header>
      {open && (
        <>
          <div className="chat-list" ref={list}>
            {messages.length === 0 && <p className="muted">아직 대화가 없어요. 첫 메시지를 남겨 보세요.</p>}
            {messages.map((m, i) => {
              const grouped = i > 0 && messages[i - 1].author.name === m.author.name
              return (
                <div className={'chat-msg' + (grouped ? ' grouped' : '')} key={m.id}>
                  <span className="avatar" style={{ background: m.author.color }}>
                    {grouped ? '' : initials(m.author.name)}
                  </span>
                  {!grouped && (
                    <span className="who">
                      <strong>{m.author.name}</strong>
                      <small>{timeLabel(m.at)}</small>
                    </span>
                  )}
                  <p>{m.text}</p>
                </div>
              )
            })}
          </div>
          <form className="chat-input" onSubmit={submit}>
            <button type="button" className="icon attach" aria-label="이미지 올리기" title="보드에 이미지 올리기" onClick={onAttach}>
              <Paperclip />
            </button>
            <input
              aria-label="채팅 입력"
              placeholder="팀원에게 메시지 보내기…"
              value={text}
              maxLength={1000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault()
              }}
            />
            <button className="send" aria-label="보내기" disabled={!text.trim()}>
              <SendHorizontal />
            </button>
          </form>
        </>
      )}
    </section>
  )
}
