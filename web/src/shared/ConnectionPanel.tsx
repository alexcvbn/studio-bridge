import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { getBoardSync, type SyncStatus } from '../features/board/boardSync'
import { apiFetch, getTeamKey, saveTeamKey } from './connection'

/**
 * A 담당 (06회차 #21): 서버 연결 확인과 팀 키 입력.
 * 서버 꺼짐 / 키 필요 / 키 틀림 / 허용 안 됨 / 연결됨을 구분해 보여준다.
 * 키 값은 화면에 다시 보여주지 않는다.
 */

type Check =
  | { phase: 'checking' }
  | { phase: 'ok'; mode: 'shared' | 'local' }
  | { phase: 'key'; message: string } // 401: 키 필요·틀림
  | { phase: 'fail'; message: string } // 서버 꺼짐·403·그 밖의 오류

const SYNC_TEXT: Record<SyncStatus, string> = {
  connecting: '연결 중',
  connected: '연결됨',
  disconnected: '끊김 (동기화 서버가 꺼졌거나 팀 키가 맞지 않음)',
}
const SYNC_SLOW_MS = 5000
const SYNC_SLOW_TEXT = '연결되지 않음 (동기화 서버가 꺼졌거나 팀 키가 맞지 않음, 계속 다시 시도 중)'

const DOWN = '서버에 연결할 수 없습니다. 서버 실행 상태를 확인하세요.'

async function checkServer(): Promise<Check> {
  try {
    const health = await fetch('/api/health')
    // Vite가 서버에 닿지 못하면 502 등 5xx를 돌려준다.
    if (!health.ok) return { phase: 'fail', message: `${DOWN} (${health.status})` }
  } catch {
    return { phase: 'fail', message: DOWN }
  }
  let res: Response
  try {
    res = await apiFetch('/api/projects/studio-bridge/access')
  } catch {
    return { phase: 'fail', message: '서버에 연결할 수 없습니다.' }
  }
  const body = await res.json().catch(() => null)
  if (res.ok && (body?.mode === 'shared' || body?.mode === 'local')) {
    return { phase: 'ok', mode: body.mode }
  }
  const message: string = body?.detail?.message ?? `요청에 실패했습니다. (${res.status})`
  if (res.status === 401) return { phase: 'key', message }
  return { phase: 'fail', message }
}

export function ConnectionPanel() {
  const [check, setCheck] = useState<Check>({ phase: 'checking' })
  const [sync, setSync] = useState<SyncStatus>('connecting')
  const [syncSlow, setSyncSlow] = useState(false)
  const [open, setOpen] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const hasKey = getTeamKey() !== ''

  const applyResult = useCallback((result: Check) => {
    setCheck(result)
    if (result.phase === 'key') setOpen(true)
  }, [])

  const runCheck = useCallback(async () => {
    setCheck({ phase: 'checking' })
    applyResult(await checkServer())
  }, [applyResult])

  useEffect(() => {
    // 첫 화면에서 바로 확인한다. 처음 상태가 이미 '확인 중'이라 결과만 반영한다.
    let alive = true
    void checkServer().then((result) => {
      if (alive) applyResult(result)
    })
    return () => {
      alive = false
    }
  }, [applyResult])

  // y-websocket은 한 번도 연결되지 않은 채 거절되면 '끊김' 없이 계속 '연결 중'이다.
  // 그래서 몇 초 넘게 연결 중이면 원인을 안내한다. 재시도마다 '연결 중'이 다시 오므로 바뀔 때만 시간을 잰다.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let last: SyncStatus | null = null
    const unsubscribe = getBoardSync().subscribeStatus((next) => {
      if (next === last) return
      last = next
      setSync(next)
      setSyncSlow(false)
      clearTimeout(timer)
      if (next === 'connecting') timer = setTimeout(() => setSyncSlow(true), SYNC_SLOW_MS)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!saveTeamKey(keyInput)) {
      // 입력값은 그대로 두고 실패를 알린다.
      setSaveError('이 브라우저에 키를 저장하지 못했습니다. 브라우저의 사이트 데이터 설정을 확인하세요.')
      return
    }
    // 보드 동기화 연결은 연결할 때의 키를 쓰므로 새 키로 다시 연결하려고 새로고침한다.
    location.reload()
  }

  const clear = () => {
    if (!saveTeamKey('')) {
      setSaveError('저장된 키를 지우지 못했습니다.')
      return
    }
    location.reload()
  }

  const summary =
    check.phase === 'checking'
      ? '서버 확인 중…'
      : check.phase === 'ok'
        ? `서버 연결됨 (${check.mode === 'shared' ? '공유 모드' : '로컬 모드'})`
        : check.phase === 'key'
          ? '팀 키 필요'
          : '서버 연결 실패'
  const color = check.phase === 'ok' ? '#1a7f37' : check.phase === 'checking' ? '#9a6700' : '#cf222e'

  return (
    <section className="connection">
      <button
        className="connection-toggle"
        aria-label={summary + ' · 연결 설정'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <i style={{ background: color }} />
        {summary} <span>⌄</span>
      </button>
      {open && (
        <div className="connection-popup">
          <h3>연결 설정</h3>
          {check.phase !== 'ok' && check.phase !== 'checking' && <p role="alert">{check.message}</p>}
          <p>보드 동기화 · {syncSlow ? SYNC_SLOW_TEXT : SYNC_TEXT[sync]}</p>
          <button type="button" onClick={() => void runCheck()} disabled={check.phase === 'checking'}>
            다시 확인
          </button>
          <p>공유 모드의 팀 키는 이 브라우저에 저장됩니다.</p>
          <form onSubmit={save} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label>
              팀 키{' '}
              <input
                type="password"
                autoComplete="off"
                value={keyInput}
                placeholder={hasKey ? '저장된 키 있음 (바꾸려면 입력)' : '공유 모드 팀 키'}
                onChange={(e) => {
                  setKeyInput(e.target.value)
                  setSaveError(null)
                }}
              />
            </label>
            <button type="submit" disabled={keyInput.trim() === ''}>
              저장하고 다시 연결
            </button>
            {hasKey && (
              <button type="button" onClick={clear}>
                저장된 키 지우기
              </button>
            )}
          </form>
          {saveError && (
            <p role="alert" style={{ color: '#cf222e', margin: '6px 0 0' }}>
              {saveError}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
