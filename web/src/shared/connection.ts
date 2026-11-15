/**
 * A 담당 (06회차 #21): 웹의 서버 주소와 팀 키를 한 곳에서 정한다.
 *
 * - 제품 API: 지금 연 웹 주소의 `/api`. Vite 개발 서버가 같은 PC의 8000번 서버로 넘긴다.
 *   그래서 다른 PC에서 http://서버IP:5173 으로 열어도 API는 같은 서버로 간다.
 * - 보드 동기화(WS): 지금 연 웹 주소의 호스트, 1234번 포트. VITE_SYNC_URL로 바꿀 수 있다.
 * - 팀 키: 사용자가 연결 패널에 입력해 이 브라우저에만 저장한다. 웹 빌드(VITE_ 변수)에 넣지 않는다.
 *   HTTP는 X-StudioBridge-Key 헤더, WS는 브라우저가 헤더를 붙일 수 없어 연결 주소의 key 값으로 보낸다.
 */

export const KEY_HEADER = 'X-StudioBridge-Key'
const KEY_STORAGE = 'studio-bridge.teamKey'

export function getTeamKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

/** 저장에 실패하면 false. 호출한 쪽은 입력값을 지우지 않고 실패를 알린다. */
export function saveTeamKey(key: string): boolean {
  try {
    const trimmed = key.trim()
    if (trimmed) localStorage.setItem(KEY_STORAGE, trimmed)
    else localStorage.removeItem(KEY_STORAGE)
    return true
  } catch {
    return false
  }
}

/** 제품 API 요청. 저장된 팀 키가 있으면 헤더에 붙인다. */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const key = getTeamKey()
  if (!key) return fetch(input, init)
  const headers = new Headers(init?.headers)
  headers.set(KEY_HEADER, key)
  return fetch(input, { ...init, headers })
}

/** 보드 동기화 서버 주소. 웹을 연 호스트와 같은 호스트를 쓴다. */
export function syncUrl(): string {
  const configured = import.meta.env.VITE_SYNC_URL
  if (configured) return configured
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.hostname}:1234`
}

/** 보드 동기화 연결에 붙일 값. 연결 주소에 들어가므로 화면·기록에 주소를 그대로 보이지 않는다. */
export function syncParams(): Record<string, string> {
  const key = getTeamKey()
  return key ? { key } : {}
}
