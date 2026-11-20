import { KEY_HEADER, getTeamKey, syncUrl } from '../../shared/connection'
import type { SyncStatus } from './boardSync'

// 브라우저 WebSocket은 거절돼도 401/403을 알려 주지 않고 '연결 중'만 반복한다.
// 그래서 동기화 서버의 /access(같은 접속 규칙, 키는 헤더)로 이유를 물어 거절과 서버 꺼짐을 가른다.
export type RejectCode =
  | 'team_key_required'
  | 'team_key_invalid'
  | 'board_forbidden'
  | 'local_only'
  | 'other'

export type AccessState =
  | { phase: 'unknown' }
  | { phase: 'ok' }
  | { phase: 'rejected'; code: RejectCode }
  | { phase: 'down' }

const PROBE_TIMEOUT_MS = 4000
const KNOWN_CODES: RejectCode[] = ['team_key_required', 'team_key_invalid', 'board_forbidden', 'local_only']

// ws://host:1234 → http://host:1234. 기록·화면에 키가 남지 않도록 키는 주소가 아니라 헤더로 보낸다.
function accessUrl(room: string): string {
  const origin = new URL(syncUrl().replace(/^ws/, 'http')).origin
  return `${origin}/access?room=${encodeURIComponent(room)}`
}

export async function probeAccess(room: string): Promise<AccessState> {
  const key = getTeamKey()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(accessUrl(room), {
      headers: key ? { [KEY_HEADER]: key } : {},
      cache: 'no-store',
      signal: controller.signal,
    })
    if (res.ok) return { phase: 'ok' }
    if (res.status === 401 || res.status === 403) {
      const body = (await res.json().catch(() => null)) as { code?: string } | null
      const code = KNOWN_CODES.find((c) => c === body?.code) ?? 'other'
      return { phase: 'rejected', code }
    }
    // 서버는 있는데 거절이 아닌 오류. 거절로 단정하지 않는다.
    return { phase: 'down' }
  } catch {
    // 응답 자체가 없음: 서버 꺼짐, 주소 오류, 시간 초과.
    return { phase: 'down' }
  } finally {
    clearTimeout(timer)
  }
}

const REJECT_TEXT: Record<RejectCode, string> = {
  team_key_required: '팀 키가 필요합니다',
  team_key_invalid: '팀 키가 맞지 않습니다',
  board_forbidden: '허용되지 않은 보드입니다',
  local_only: '이 PC에서만 연결할 수 있는 서버입니다',
  other: '서버가 접속을 허용하지 않았습니다',
}

export interface SyncDescription {
  text: string
  tone: 'ok' | 'wait' | 'fail'
  // 메모처럼 입력한 내용이 서버에 닿는지 알려야 하는 곳에서 쓴다.
  note?: string
}

export function describeSync(status: SyncStatus, access: AccessState): SyncDescription {
  if (status === 'connected') return { text: '동기화 연결됨', tone: 'ok' }
  if (access.phase === 'rejected') {
    const why = REJECT_TEXT[access.code]
    return {
      text: `접속 거절: ${why}`,
      tone: 'fail',
      note: `접속이 거절되었습니다(${why}). 지금 쓰는 내용은 서버에 저장되거나 다른 사람에게 보이지 않고 이 화면에만 남습니다.`,
    }
  }
  if (access.phase === 'down') {
    return {
      text: '동기화 서버에 연결할 수 없음 (서버가 꺼졌거나 주소가 다름)',
      tone: 'fail',
      note: '서버에 연결할 수 없습니다. 쓴 내용은 이 화면에 남고 다시 연결되면 반영됩니다. 화면을 닫으면 사라질 수 있습니다.',
    }
  }
  return status === 'connecting'
    ? { text: '동기화 연결 중', tone: 'wait', note: '서버에 연결하는 중입니다. 지금 쓴 내용은 연결되면 반영됩니다.' }
    : { text: '동기화 연결 끊김', tone: 'fail', note: '연결이 끊겼습니다. 쓴 내용은 이 화면에 남고 다시 연결되면 반영됩니다.' }
}
