// 두 클라이언트의 카드·메모 수렴, 제거, 재접속, 서버 재시작, 접속 거절을 한 번에 확인한다. (09회차 #34, B)
//
//   node check-converge.cjs
//
// 임시 저장 폴더와 1239번 포트에 공유 모드 서버를 직접 띄우므로 실제 보드(sync/data)를 건드리지 않는다.
// 두 클라이언트는 BroadcastChannel을 끄고(disableBc) 서버를 거쳐서만 서로 보게 한다.
// 웹과 같은 규칙(제거된 카드는 늦은 이동이 와도 바로 지움)을 흉내 낸다. 하나라도 실패하면 종료 코드 1.
const path = require('path'), os = require('os'), fs = require('fs'), http = require('http')
const { spawn } = require('child_process')
const SYNC = __dirname
const Y = require(SYNC + '/node_modules/yjs')
const { WebsocketProvider } = require(SYNC + '/node_modules/y-websocket')
const WS = require(SYNC + '/node_modules/ws')

const KEY = 'team-key-1234'
const PORT = 1239
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sb9-'))
const ROOM = 'studio-bridge/main'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`) }

let server
const startServer = async () => {
  server = spawn('node', [path.join(SYNC, 'start.cjs')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', YPERSISTENCE: DATA, STUDIO_BRIDGE_TEAM_KEY: KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr.on('data', (d) => process.stderr.write('[server] ' + d))
  await sleep(2000)
}
const stopServer = async () => { server.kill(); await sleep(1500) }

// 웹(boardSync.ts)과 같은 purge 규칙을 흉내 낸다
const client = (name, key = KEY) => {
  const doc = new Y.Doc()
  const cards = doc.getMap('cards'), removed = doc.getMap('removedCardIds'), memo = doc.getText('memo')
  const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}`, ROOM, doc, { WebSocketPolyfill: WS, disableBc: true, params: { key } })
  const purge = () => { const s = [...cards.keys()].filter((i) => removed.has(i)); if (s.length) doc.transact(() => s.forEach((i) => cards.delete(i))) }
  cards.observe(purge); removed.observe(purge)
  return { name, doc, cards, removed, memo, p }
}
const view = (c) => JSON.stringify({
  cards: [...c.cards.values()].filter((x) => !c.removed.has(x.card_id)).map((x) => [x.card_id, x.target_id, x.position]).sort((a, b) => a[0].localeCompare(b[0])),
  memo: c.memo.toString(),
})
const mk = (id, x, y) => ({ card_id: id, kind: 'feature', target_id: 'feat-' + id, position: { x, y } })
const move = (c, id, x, y) => { const cur = c.cards.get(id); if (cur && !c.removed.has(id)) c.cards.set(id, { ...cur, position: { x, y } }) }
const remove = (c, id) => c.doc.transact(() => { c.cards.delete(id); c.removed.set(id, true) })
const memoSet = (c, at, text) => c.memo.insert(at, text)
const converged = async (cs, label) => { await sleep(1500); const v = cs.map(view); const ok = v.every((s) => s === v[0]); check(label, ok, ok ? '' : '\n  ' + v.join('\n  ')); return ok }
const connected = (c) => new Promise((res) => (c.p.wsconnected ? res() : c.p.on('status', ({ status }) => status === 'connected' && res())))

const probe = (key) => new Promise((res) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: `/access?room=${encodeURIComponent(ROOM)}`, headers: key ? { 'X-StudioBridge-Key': key } : {} }, (rs) => { let b = ''; rs.on('data', (d) => (b += d)); rs.on('end', () => res([rs.statusCode, b])) })
  r.on('error', () => res([0, 'unreachable'])); r.end()
})

;(async () => {
  await startServer()
  const A = client('A'), B = client('B')
  await Promise.all([connected(A), connected(B)]); await sleep(1500)

  // 1. 서로 다른 카드·메모 동시 변경
  A.cards.set('c1', mk('c1', 40, 40)); A.cards.set('c2', mk('c2', 280, 40)); B.cards.set('c3', mk('c3', 520, 40))
  await sleep(800)
  move(A, 'c1', 100, 100); move(B, 'c2', 300, 300)
  memoSet(A, 0, 'A의 메모. '); memoSet(B, 0, 'B의 메모. ')
  await converged([A, B], '1 다른 카드·메모 동시 변경이 두 클라이언트에서 수렴')
  check('1b 두 사람의 메모가 모두 남음', A.memo.toString().includes('A의 메모') && A.memo.toString().includes('B의 메모'))

  // 2. 같은 카드 동시 이동 (B 오프라인 → 양쪽 수정 → 재접속)
  B.p.disconnect(); await sleep(500)
  move(B, 'c1', 700, 700); move(A, 'c1', 150, 150)
  await sleep(500); B.p.connect()
  await converged([A, B], '2 같은 카드 동시 이동 후 최종 위치 수렴')

  // 3. 제거와 늦은 이동
  B.p.disconnect(); await sleep(500)
  move(B, 'c3', 900, 900); remove(A, 'c3'); await sleep(500)
  B.p.connect()
  await converged([A, B], '3 제거한 카드가 늦은 이동으로 되살아나지 않고 수렴')
  check('3b c3가 두 화면에서 보이지 않음', !view(A).includes('"c3"') === true && !view(A).includes('c3'))

  // 4. 서버 종료 중 변경 → 재시작 후 합쳐짐
  await stopServer()
  memoSet(A, A.memo.length, '[서버 꺼진 중 A] '); A.cards.set('c4', mk('c4', 40, 200)); move(B, 'c2', 333, 333)
  await startServer()
  await Promise.all([connected(A), connected(B)])
  await converged([A, B], '4 서버 꺼진 동안의 변경이 재시작 후 합쳐져 수렴')

  // 5. 모든 클라이언트 종료 → 서버 재시작 → 새 클라이언트가 같은 상태를 읽음
  const before = view(A)
  A.p.destroy(); B.p.destroy(); await sleep(1500)
  await stopServer(); await startServer()
  const C = client('C'); await connected(C); await sleep(2500)
  const after = view(C)
  check('5 서버 재시작 뒤 새 클라이언트가 저장된 같은 상태를 읽음', before === after, before === after ? '' : `\n  before ${before}\n  after  ${after}`)
  check('5b 제거한 c3는 재시작 후에도 없음', !after.includes('"c3"') && !after.includes('feat-c3'))

  // 6. 접속 거절
  const bad = client('bad', 'wrong-key-0000'); await sleep(2500)
  check('6a 틀린 키는 WebSocket 연결 안 됨', !bad.p.wsconnected)
  const [s1] = await probe(''), [s2] = await probe('wrong-key-0000'), [s3, b3] = await probe(KEY)
  check('6b /access: 키 없음 401, 틀린 키 401, 맞는 키 200', s1 === 401 && s2 === 401 && s3 === 200, `${s1} ${s2} ${s3}`)
  bad.p.destroy(); C.p.destroy()

  await stopServer()
  fs.rmSync(DATA, { recursive: true, force: true })
  const failed = results.filter(([, ok]) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 통과`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); try { server.kill() } catch {} process.exit(2) })
