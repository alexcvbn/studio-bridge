// 06회차 #21 동기화 서버 접속 검사. 실행 중인 sync 서버에 실제 WebSocket 연결을 열어 본다.
//
//   node check-access.cjs ws://127.0.0.1:1234
//
// 공유 모드 서버라면 같은 STUDIO_BRIDGE_TEAM_KEY를 환경변수로 준다. 키 값과 연결 주소는 출력하지 않는다.
// 마지막에 키를 가진 두 연결이 같은 보드 문서의 변경을 주고받는지 본다.
// 실제 보드(sync/data)를 건드리지 않도록 YPERSISTENCE를 임시 폴더로 지정해 띄운 서버에 실행한다.
const WebSocket = require('ws')
const Y = require('yjs')
const { WebsocketProvider } = require('y-websocket')

const base = (process.argv[2] || 'ws://127.0.0.1:1234').replace(/\/+$/, '')
const key = (process.env.STUDIO_BRIDGE_TEAM_KEY || '').trim()
const ROOM = 'studio-bridge/main'
const results = []

const check = (name, ok, detail) => {
  results.push(ok)
  console.log(`[${ok ? '통과' : '실패'}] ${name}${ok || detail === undefined ? '' : `  -> ${detail}`}`)
}

// 연결 결과: 'open' 또는 거절된 HTTP 상태 코드
const tryConnect = (room, sentKey) =>
  new Promise((resolve) => {
    const q = sentKey === undefined ? '' : `?key=${encodeURIComponent(sentKey)}`
    const ws = new WebSocket(`${base}/${room}${q}`)
    ws.on('open', () => {
      ws.close()
      resolve('open')
    })
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode))
    ws.on('error', (err) => resolve(`error ${err.code || err.message}`))
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const anon = await tryConnect(ROOM)
  if (typeof anon === 'string' && anon !== 'open') {
    console.error(`동기화 서버에 연결하지 못했습니다: ${anon} (서버가 켜져 있는지, 주소·포트가 맞는지 확인)`)
    process.exit(1)
  }
  const mode = anon === 'open' ? 'local' : 'shared'
  console.log(`-- 서버 모드: ${mode}`)

  if (mode === 'shared') {
    if (!key) {
      console.error('공유 모드 서버입니다. STUDIO_BRIDGE_TEAM_KEY에 같은 키를 넣고 다시 실행하세요.')
      process.exit(1)
    }
    check('키 없이 연결: 401', anon === 401, anon)
    const wrong = await tryConnect(ROOM, `${key}-wrong`)
    check('틀린 키로 연결: 401', wrong === 401, wrong)
    const ok = await tryConnect(ROOM, key)
    check('맞는 키로 studio-bridge/main 연결', ok === 'open', ok)
  } else {
    check('로컬 모드: 이 PC에서 키 없이 연결', anon === 'open', anon)
  }
  const other = await tryConnect('studio-bridge/other', key || undefined)
  check('다른 보드 이름: 403', other === 403, other)
  const otherProject = await tryConnect('other-team/main', key || undefined)
  check('다른 프로젝트 보드: 403', otherProject === 403, otherProject)

  // 키를 가진 두 연결이 같은 문서를 공유하는지 본다. (임시 메모 키에만 쓴다)
  const params = key ? { key } : {}
  const docA = new Y.Doc()
  const docB = new Y.Doc()
  const a = new WebsocketProvider(base, ROOM, docA, { WebSocketPolyfill: WebSocket, params })
  const b = new WebsocketProvider(base, ROOM, docB, { WebSocketPolyfill: WebSocket, params })
  const probe = `check-${Date.now()}`
  await sleep(1500)
  docA.getMap('accessCheck').set(probe, 'from-a')
  let seen
  for (let i = 0; i < 20 && seen === undefined; i++) {
    await sleep(200)
    seen = docB.getMap('accessCheck').get(probe)
  }
  check('두 연결이 같은 보드 문서의 변경을 주고받음', seen === 'from-a', seen)
  a.destroy()
  b.destroy()

  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} 통과`)
  process.exit(passed === results.length ? 0 : 1)
}

main()
