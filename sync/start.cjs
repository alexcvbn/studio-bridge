// 보드 동기화 서버 실행. 카드·메모(Yjs 문서)를 YPERSISTENCE 폴더에 저장하고 시작할 때 다시 읽는다.
// Windows·macOS에서 같은 명령(npm start)으로 돌도록 환경변수를 여기서 정한다.
//
// 06회차 #21 (A·B): 접속 검사
// - 로컬 모드 (STUDIO_BRIDGE_TEAM_KEY 없음): 이 PC(loopback)에서 온 연결만 받는다.
// - 공유 모드 (STUDIO_BRIDGE_TEAM_KEY 있음): 0.0.0.0에서 열고, 연결 주소의 `key` 값이 팀 키와 같아야 한다.
//   브라우저 WebSocket에는 임의 헤더를 붙일 수 없어 HTTP(X-StudioBridge-Key)와 달리 주소의 값으로 받는다.
// - 두 모드 모두 보드 이름은 studio-bridge/main만 받는다. 다른 보드는 403으로 거절한다.
// - 연결 주소(req.url)에는 키가 들어 있으므로 기록·오류에 주소를 남기지 않는다.
const path = require('path')
const crypto = require('crypto')
const http = require('http')
const net = require('net')

process.env.YPERSISTENCE = process.env.YPERSISTENCE || path.join(__dirname, 'data')

// y-leveldb는 y-websocket의 선택 의존성이라 설치에 실패해도 조용히 넘어간다.
// 저장이 꺼진 채 서버만 뜨면 재시작 때 카드·메모가 사라지므로 여기서 멈춘다.
try {
  require('y-leveldb')
} catch (err) {
  console.error('y-leveldb를 불러오지 못해 저장을 켤 수 없습니다. `npm ci`를 다시 실행하세요.')
  console.error(err.message)
  process.exit(1)
}

const ALLOWED_ROOM = 'studio-bridge/main'
const MIN_KEY_LENGTH = 8
const teamKey = (process.env.STUDIO_BRIDGE_TEAM_KEY || '').trim()
const shared = teamKey !== ''
if (shared && teamKey.length < MIN_KEY_LENGTH) {
  console.error(`실행 중단: STUDIO_BRIDGE_TEAM_KEY는 ${MIN_KEY_LENGTH}자 이상이어야 합니다.`)
  process.exit(1)
}

const isLoopback = (host) => {
  if (!host) return false
  if (host === 'localhost') return true
  const plain = host.replace(/^::ffff:/, '')
  return plain === '::1' || (net.isIPv4(plain) && plain.startsWith('127.'))
}

const host = process.env.HOST || (shared ? '0.0.0.0' : '127.0.0.1')
const port = Number.parseInt(process.env.PORT || '1234', 10)
if (!shared && !isLoopback(host)) {
  console.error(`실행 중단: 로컬 모드(팀 키 없음)는 이 PC에서만 열 수 있습니다. (HOST=${host})`)
  console.error('다른 PC와 공유하려면 STUDIO_BRIDGE_TEAM_KEY에 팀 키를 넣고 다시 실행하세요.')
  process.exit(1)
}

// 길이가 달라도 시간 차이로 키를 추측하지 못하게 해시끼리 비교한다.
const sameKey = (sent) => {
  const a = crypto.createHash('sha256').update(sent).digest()
  const b = crypto.createHash('sha256').update(teamKey).digest()
  return crypto.timingSafeEqual(a, b)
}

// 연결을 받을지 정한다. 거절이면 [상태, 사유 코드], 허용이면 null.
const checkUpgrade = (request) => {
  const url = new URL(request.url || '/', 'http://sync.local')
  const room = decodeURIComponent(url.pathname.slice(1))
  const remote = request.socket.remoteAddress
  if (!shared && !isLoopback(remote)) return [403, 'local_only']
  if (shared) {
    const sent = url.searchParams.get('key') || ''
    if (sent === '') return [401, 'team_key_required']
    if (!sameKey(sent)) return [401, 'team_key_invalid']
  }
  if (room !== ALLOWED_ROOM) return [403, 'board_forbidden']
  return null
}

// y-websocket은 exports로 bin 경로를 막아 두어서 파일 경로로 직접 불러온다.
// (YPERSISTENCE를 정한 뒤에 불러와야 저장이 켜진다.)
const { setupWSConnection } = require(
  path.join(__dirname, 'node_modules', 'y-websocket', 'bin', 'utils.cjs'),
)
const WebSocket = require('ws')
const wss = new WebSocket.Server({ noServer: true })
wss.on('connection', (conn, request) => setupWSConnection(conn, request, { docName: ALLOWED_ROOM }))

const REASONS = { 401: 'Unauthorized', 403: 'Forbidden' }
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
})

server.on('upgrade', (request, socket, head) => {
  const denied = checkUpgrade(request)
  if (denied) {
    const [status, code] = denied
    // 주소(키 포함)는 남기지 않는다.
    console.warn(`[sync] 접속 거절 ${status} ${code} from=${request.socket.remoteAddress}`)
    socket.write(`HTTP/1.1 ${status} ${REASONS[status]}\r\nConnection: close\r\n\r\n`)
    socket.destroy()
    return
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
})

server.listen(port, host, () => {
  console.log(`running at '${host}' on port ${port}`)
  console.log(
    shared
      ? `공유 모드: 팀 키가 있어야 보드(${ALLOWED_ROOM})에 연결됩니다.`
      : `로컬 모드: 이 PC에서만 보드(${ALLOWED_ROOM})에 연결됩니다.`,
  )
})
