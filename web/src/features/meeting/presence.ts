// 회의 공간의 "지금 누가 있는지" 정보. Yjs awareness를 쓰므로 저장되지 않고, 창을 닫으면 사라진다.
// 이름은 로그인 계정이 아니라 이 브라우저에 저장한 표시 이름이다.
import { useEffect, useState } from 'react'
import { getBoardSync } from '../board/boardSync'

export type Space = 'board' | 'meeting'
export interface User {
  name: string
  color: string
}
// 다른 사람에게 보내는 내 상태. 좌표는 모두 캔버스(flow) 좌표라 화면 크기·배율이 달라도 같은 곳을 가리킨다.
export interface PresenceState {
  user: User
  space: Space
  cursor: { x: number; y: number } | null
  // 내가 보고 있는 화면의 가운데와 배율. 따라가기·발표에 쓴다.
  view: { cx: number; cy: number; zoom: number } | null
  // 발표 중이면 다른 사람 화면이 나를 따라온다.
  spotlight: boolean
  // 내가 고른 항목. 다른 사람 화면에 내 색 테두리로 보인다.
  selected: string[]
}
export interface Peer extends PresenceState {
  clientId: number
}

const NAME_KEY = 'studio-bridge.displayName'
const COLOR_KEY = 'studio-bridge.cursorColor'
export const PEOPLE_COLORS = ['#0d9488', '#7c3aed', '#2563eb', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#c026d3']

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 저장이 막힌 브라우저에서도 이번 접속 동안은 그대로 쓴다.
  }
}

export function savedName(): string {
  return read(NAME_KEY).trim()
}

function myColor(): string {
  let c = read(COLOR_KEY)
  if (!PEOPLE_COLORS.includes(c)) {
    c = PEOPLE_COLORS[Math.floor(Math.random() * PEOPLE_COLORS.length)]
    write(COLOR_KEY, c)
  }
  return c
}

export function myClientId(): number {
  return getBoardSync().awareness.clientID
}

export function me(): User {
  const name = savedName() || '손님 ' + String(myClientId() % 100).padStart(2, '0')
  // 이번 접속에서 색을 바꿨다면 그 색을 그대로 쓴다.
  const current = (getBoardSync().awareness.getLocalState() as Partial<PresenceState> | null)?.user?.color
  return { name, color: current ?? myColor() }
}

// 이 브라우저의 표시 이름을 바꾸고 바로 다른 사람에게 알린다.
export function setMyName(name: string) {
  const trimmed = name.trim().slice(0, 20)
  write(NAME_KEY, trimmed)
  setPresence({ user: me() })
}

export function setPresence(partial: Partial<PresenceState>) {
  const { awareness } = getBoardSync()
  const cur = (awareness.getLocalState() ?? {}) as Partial<PresenceState>
  awareness.setLocalState({ ...cur, ...partial })
}

// 이 화면(공간)에 들어왔음을 알린다. 나가면 커서·발표를 지운다.
export function enterSpace(space: Space) {
  setPresence({ user: me(), space, cursor: null, view: null, spotlight: false, selected: [] })
}

function readPeers(): Peer[] {
  const { awareness } = getBoardSync()
  const out: Peer[] = []
  awareness.getStates().forEach((state, clientId) => {
    const s = state as Partial<PresenceState>
    if (clientId === awareness.clientID || !s.user) return
    out.push({
      clientId,
      user: s.user,
      space: s.space ?? 'board',
      cursor: s.cursor ?? null,
      view: s.view ?? null,
      spotlight: !!s.spotlight,
      selected: s.selected ?? [],
    })
  })
  return out.sort((a, b) => a.clientId - b.clientId)
}

// 같은 공간에 있는 다른 사람 목록. 커서가 움직일 때마다 바뀐다.
export function usePeers(space: Space): Peer[] {
  const [peers, setPeers] = useState<Peer[]>(() => readPeers().filter((p) => p.space === space))
  useEffect(() => {
    const { awareness } = getBoardSync()
    const update = () => {
      const all = readPeers()
      avoidSameColor(all)
      setPeers(all.filter((p) => p.space === space))
    }
    awareness.on('change', update)
    update()
    return () => awareness.off('change', update)
  }, [space])
  return peers
}

// 먼저 들어온 사람과 색이 같으면 이번 접속 동안 안 쓰는 색으로 바꾼다(커서·이름표가 헷갈리지 않게).
function avoidSameColor(peers: Peer[]) {
  const { awareness } = getBoardSync()
  const mine = (awareness.getLocalState() as Partial<PresenceState> | null)?.user
  if (!mine) return
  const clash = peers.some((p) => p.clientId < awareness.clientID && p.user.color === mine.color)
  if (!clash) return
  const used = new Set(peers.map((p) => p.user.color))
  const free = PEOPLE_COLORS.find((c) => !used.has(c))
  if (free) setPresence({ user: { ...mine, color: free } })
}

export const initials = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '?'

// 너무 자주 보내지 않도록 마지막 값만 일정 간격으로 보낸다.
export function throttle<T>(fn: (v: T) => void, ms: number): (v: T) => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: T
  return (v: T) => {
    pending = v
    const now = Date.now()
    if (now - last >= ms) {
      last = now
      fn(v)
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = undefined
        last = Date.now()
        fn(pending)
      }, ms - (now - last))
    }
  }
}

// 내 이름·색. 이름을 바꾸면 다시 그린다.
export function useSelf(): User {
  const [self, setSelf] = useState<User>(me)
  useEffect(() => {
    const { awareness } = getBoardSync()
    const update = () => {
      const u = (awareness.getLocalState() as Partial<PresenceState> | null)?.user
      if (u) setSelf((cur) => (cur.name === u.name && cur.color === u.color ? cur : u))
    }
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [])
  return self
}
