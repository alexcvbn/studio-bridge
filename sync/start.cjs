// 보드 동기화 서버 실행. 카드·메모(Yjs 문서)를 YPERSISTENCE 폴더에 저장하고 시작할 때 다시 읽는다.
// Windows·macOS에서 같은 명령(npm start)으로 돌도록 환경변수를 여기서 정한다.
const path = require('path')

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

// y-websocket은 exports로 bin 경로를 막아 두어서 파일 경로로 직접 불러온다.
require(path.join(__dirname, 'node_modules', 'y-websocket', 'bin', 'server.cjs'))
