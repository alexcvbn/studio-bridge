// 보드 저장 폴더(YPERSISTENCE)의 카드·제거 기록·공동 메모를 JSON으로 출력한다. (08회차 #32, D)
//
//   node board-dump.cjs <저장 폴더>        예: node board-dump.cjs data
//
// 백업·복원 확인용 읽기 전용 도구다. 원본 폴더를 직접 열지 않고 임시 폴더에 복사한 뒤 읽는다.
// (y-leveldb는 읽는 중에도 정리(flush)하며 쓸 수 있어서, 백업본이 바뀌지 않게 하려는 것이다.)
// 동기화 서버가 켜진 채로 복사하면 일관되지 않을 수 있으니 서버를 끈 상태에서 실행한다.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { LeveldbPersistence } = require('y-leveldb')

const ROOM = 'studio-bridge/main' // start.cjs의 ALLOWED_ROOM과 같다

async function main() {
  const src = process.argv[2]
  if (!src) {
    console.error('사용법: node board-dump.cjs <보드 저장 폴더>')
    process.exit(2)
  }
  if (!fs.existsSync(path.join(src, 'CURRENT'))) {
    console.error(`보드 저장 폴더가 아닙니다 (LevelDB CURRENT 파일 없음): ${src}`)
    process.exit(1)
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-board-'))
  fs.cpSync(src, tmp, { recursive: true })
  const store = new LeveldbPersistence(tmp)
  try {
    const docNames = await store.getAllDocNames()
    const doc = await store.getYDoc(ROOM)
    const removed = Object.keys(doc.getMap('removedCardIds').toJSON()).sort()
    const cards = Object.values(doc.getMap('cards').toJSON())
      .filter((c) => !removed.includes(c.card_id)) // 웹과 같이, 제거 기록이 있는 카드는 보이지 않는다
      .map((c) => ({ card_id: c.card_id, kind: c.kind, target_id: c.target_id, position: c.position }))
      .sort((a, b) => a.card_id.localeCompare(b.card_id))
    const out = {
      room: ROOM,
      room_saved: docNames.includes(ROOM),
      cards,
      removed_card_ids: removed,
      memo: doc.getText('memo').toString(),
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  } finally {
    await store.destroy()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(`보드를 읽지 못했습니다: ${err.message}`)
  process.exit(1)
})
