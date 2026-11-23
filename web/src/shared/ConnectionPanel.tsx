import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { RefreshCw, Settings, X } from 'lucide-react'
import { getBoardSync, type SyncStatus } from '../features/board/boardSync'
import { describeSync, type AccessState } from '../features/board/syncAccess'
import { apiFetch, getTeamKey, saveTeamKey } from './connection'

/**
 * A 담당 (06회차 #21): 서버 연결 확인과 팀 키 입력.
 * 서버 꺼짐 / 키 필요 / 키 틀림 / 허용 안 됨 / 연결됨을 구분해 보여준다.
 * 키 값은 화면에 다시 보여주지 않는다.
 *
 * 화면에는 톱니바퀴(설정) 버튼과 상태 점만 두고, 서버·보드 동기화 상태와 팀 키는 설정 창 안에서 본다.
 * 점 색: 초록 = 서버·동기화 모두 연결, 노랑 = 확인·연결 중, 빨강 = 하나라도 실패.
 */

type Check =
  | { phase: 'checking' }
  | { phase: 'ok'; mode: 'shared' | 'local' }
  | { phase: 'key'; message: string } // 401: 키 필요·틀림
  | { phase: 'fail'; message: string } // 서버 꺼짐·403·그 밖의 오류

const TONE_COLOR = { ok: '#1a7f37', wait: '#9a6700', fail: '#cf222e' } as const
type Tone = keyof typeof TONE_COLOR

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
  const [access, setAccess] = useState<AccessState>({ phase: 'unknown' })
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLElement>(null)
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

  // 보드 동기화 상태. y-websocket은 거절돼도 '연결 중'에 머물러서, 접속 거절·서버 꺼짐은 /access 확인 결과로 구분한다.
  useEffect(() => {
    const sync = getBoardSync()
    const statusOff = sync.subscribeStatus(setSync)
    const accessOff = sync.subscribeAccess(setAccess)
    return () => {
      statusOff()
      accessOff()
    }
  }, [])

  // 설정 창 밖을 누르거나 Esc를 누르면 닫는다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

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
  const serverTone: Tone = check.phase === 'ok' ? 'ok' : check.phase === 'checking' ? 'wait' : 'fail'
  const syncInfo = describeSync(sync, access)
  const syncTone: Tone = syncInfo.tone === 'ok' ? 'ok' : syncInfo.tone === 'fail' ? 'fail' : 'wait'
  const overall: Tone =
    serverTone === 'fail' || syncTone === 'fail' ? 'fail' : serverTone === 'ok' && syncTone === 'ok' ? 'ok' : 'wait'
  const overallText = overall === 'ok' ? '모두 연결됨' : overall === 'wait' ? '연결 확인 중' : '연결 문제 있음'

  return (
    <section className="connection settings" ref={root}>
      <button
        className="settings-toggle"
        title={'설정 · ' + overallText}
        aria-label={'설정 · ' + overallText}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Settings />
        <i className="settings-dot" style={{ background: TONE_COLOR[overall] }} />
      </button>
      {open && (
        <div className="connection-popup settings-popup" role="dialog" aria-label="설정">
          <div className="settings-head">
            <h3>설정</h3>
            <button type="button" className="icon-btn" aria-label="설정 닫기" onClick={() => setOpen(false)}>
              <X />
            </button>
          </div>
          <h4>연결 상태</h4>
          <ul className="status-list">
            <li>
              <i style={{ background: TONE_COLOR[serverTone] }} />
              <span>서버</span>
              <strong>{summary}</strong>
            </li>
            <li>
              <i style={{ background: TONE_COLOR[syncTone] }} />
              <span>보드 동기화</span>
              <strong data-testid="sync-status">{syncInfo.text}</strong>
            </li>
          </ul>
          {check.phase !== 'ok' && check.phase !== 'checking' && <p role="alert">{check.message}</p>}
          {syncInfo.note && syncTone !== 'ok' && <p className="settings-note">{syncInfo.note}</p>}
          <button
            type="button"
            className="settings-recheck"
            onClick={() => void runCheck()}
            disabled={check.phase === 'checking'}
          >
            <RefreshCw /> 다시 확인
          </button>
          <h4>팀 키</h4>
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
