// 회의 공간 데이터. 협업 보드와 같은 동기화 문서에 들어 있지만 이름(meeting.*)이 달라 서로 섞이지 않는다.
// 보드처럼 항목마다 한 덩어리로 저장하고, 고칠 때는 그 항목만 덮어쓴다. 지운 ID는 따로 남겨
// 늦게 도착한 수정이 지운 항목을 되살리지 못하게 한다.
import * as Y from 'yjs'
import { getBoardSync, newId } from '../board/boardSync'
import type { User } from './presence'

export type ItemType = 'feature' | 'code' | 'note' | 'comment' | 'image'
export type DiscussStatus = 'discussing' | 'agreed' | 'hold'
export interface ChangeRow {
  id: string
  label: string
  before: string
  after: string
}
export interface CheckRow {
  id: string
  text: string
  done: boolean
}
export interface MeetingItem {
  id: string
  type: ItemType
  position: { x: number; y: number }
  size?: { width: number; height: number }
  created_at: string
  author: User
  // feature·code: 서버의 기능·자료 ID
  target_id?: string
  // feature
  status?: DiscussStatus
  summary?: string
  changes?: ChangeRow[]
  checks?: CheckRow[]
  // note·comment·image 설명
  text?: string
  // image: 줄인 JPEG data URL
  image?: string
}
export interface MeetingEdge {
  id: string
  source: string
  target: string
}
export interface ChatMessage {
  id: string
  author: User
  text: string
  at: string
}

export interface MeetingSync {
  items: Y.Map<MeetingItem>
  removedItems: Y.Map<boolean>
  edges: Y.Map<MeetingEdge>
  removedEdges: Y.Map<boolean>
  chat: Y.Array<ChatMessage>
}

let cached: MeetingSync | null = null
let cachedDoc: Y.Doc | null = null

export function getMeetingSync(): MeetingSync {
  const { doc } = getBoardSync()
  if (cached && cachedDoc === doc) return cached
  const items = doc.getMap<MeetingItem>('meeting.items')
  const removedItems = doc.getMap<boolean>('meeting.removedItems')
  const edges = doc.getMap<MeetingEdge>('meeting.edges')
  const removedEdges = doc.getMap<boolean>('meeting.removedEdges')
  const chat = doc.getArray<ChatMessage>('meeting.chat')
  // 지운 항목이 늦은 수정으로 다시 들어오면 바로 지운다. 끝 항목이 사라진 선도 지운다.
  const purge = () => {
    const staleItems = [...items.keys()].filter((id) => removedItems.has(id))
    const staleEdges = [...edges.values()]
      .filter((e) => removedEdges.has(e.id) || removedItems.has(e.source) || removedItems.has(e.target))
      .map((e) => e.id)
    if (staleItems.length === 0 && staleEdges.length === 0) return
    doc.transact(() => {
      staleItems.forEach((id) => items.delete(id))
      staleEdges.forEach((id) => {
        edges.delete(id)
        removedEdges.set(id, true)
      })
    })
  }
  items.observe(purge)
  removedItems.observe(purge)
  edges.observe(purge)
  removedEdges.observe(purge)
  cached = { items, removedItems, edges, removedEdges, chat }
  cachedDoc = doc
  return cached
}

export function readItems(): MeetingItem[] {
  const { items, removedItems } = getMeetingSync()
  return [...items.values()].filter((i) => !removedItems.has(i.id))
}
export function readEdges(): MeetingEdge[] {
  const { edges, removedEdges, items, removedItems } = getMeetingSync()
  const alive = (id: string) => items.has(id) && !removedItems.has(id)
  return [...edges.values()].filter((e) => !removedEdges.has(e.id) && alive(e.source) && alive(e.target))
}

function freshId(taken: (id: string) => boolean): string {
  let id = newId()
  while (taken(id)) id = newId()
  return id
}

export function addItem(
  fields: Omit<MeetingItem, 'id' | 'created_at'> & Partial<Pick<MeetingItem, 'id'>>,
): MeetingItem {
  const { items, removedItems } = getMeetingSync()
  const id = freshId((x) => items.has(x) || removedItems.has(x))
  const item: MeetingItem = {
    ...fields,
    id,
    created_at: new Date().toISOString(),
  }
  if (item.type === 'feature') {
    item.status ??= 'discussing'
    item.changes ??= []
    item.checks ??= []
  }
  items.set(id, item)
  return item
}

// 항목의 일부만 바꾼다. 없는·지운 항목이면 아무것도 쓰지 않는다.
export function updateItem(id: string, patch: Partial<MeetingItem>) {
  const { items, removedItems } = getMeetingSync()
  const cur = items.get(id)
  if (!cur || removedItems.has(id)) return
  const next = { ...cur, ...patch, id }
  if (JSON.stringify(next) === JSON.stringify(cur)) return
  items.set(id, next)
}

export function removeItem(id: string) {
  const { items, removedItems, edges, removedEdges } = getMeetingSync()
  const doc = items.doc
  const run = () => {
    items.delete(id)
    removedItems.set(id, true)
    for (const e of [...edges.values()]) {
      if (e.source === id || e.target === id) {
        edges.delete(e.id)
        removedEdges.set(e.id, true)
      }
    }
  }
  if (doc) doc.transact(run)
  else run()
}

// 두 항목을 선으로 잇는다. 같은 항목끼리, 이미 이어진 두 항목(방향 무관)은 잇지 않는다.
export function addEdge(source: string, target: string): MeetingEdge | null {
  const { edges, removedEdges } = getMeetingSync()
  if (source === target) return null
  for (const e of readEdges()) {
    if ((e.source === source && e.target === target) || (e.source === target && e.target === source)) return null
  }
  const edge = { id: freshId((x) => edges.has(x) || removedEdges.has(x)), source, target }
  edges.set(edge.id, edge)
  return edge
}

export function removeEdge(id: string) {
  const { edges, removedEdges } = getMeetingSync()
  const run = () => {
    edges.delete(id)
    removedEdges.set(id, true)
  }
  if (edges.doc) edges.doc.transact(run)
  else run()
}

const CHAT_LIMIT = 500

export function sendChat(author: User, text: string) {
  const body = text.trim().slice(0, 1000)
  if (!body) return
  const { chat } = getMeetingSync()
  const run = () => {
    chat.push([{ id: newId(), author, text: body, at: new Date().toISOString() }])
    // 너무 길어지면 오래된 것부터 지운다.
    if (chat.length > CHAT_LIMIT) chat.delete(0, chat.length - CHAT_LIMIT)
  }
  if (chat.doc) chat.doc.transact(run)
  else run()
}

export const rowId = () => newId()

// 사진을 가로·세로 최대 900px JPEG로 줄여 data URL로 만든다. 동기화 문서에 그대로 들어가므로 작게 만든다.
export async function shrinkImage(file: File, max = 900): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
      el.src = url
    })
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('이미지를 줄이지 못했습니다.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.78)
  } finally {
    URL.revokeObjectURL(url)
  }
}
