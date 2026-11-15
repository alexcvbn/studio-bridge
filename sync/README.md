# sync — 보드 동기화 서버

보드 카드·공동 메모를 다른 브라우저에 전달하고 디스크에 저장하는 Yjs WebSocket 서버입니다. (이슈 #6, #22)

## 실행

```bash
cd sync
npm install
npm start
```

기본은 로컬 모드로 `ws://127.0.0.1:1234`(이 PC만)에서 엽니다. 포트는 `PORT`, 주소는 `HOST` 환경변수로 바꿉니다.
웹은 웹을 연 주소의 호스트, 1234번 포트로 접속합니다. `VITE_SYNC_URL`로 바꿀 수 있습니다. (06회차 #21)

두 컴퓨터가 같이 쓰려면 API 서버와 **같은 팀 키**로 공유 모드를 띄웁니다. 전체 순서는 `server/README.md`의 "두 컴퓨터 공유 실행"을 따릅니다.

```bash
STUDIO_BRIDGE_TEAM_KEY='<팀 키>' npm start   # 0.0.0.0:1234, 팀 키 필요
```

## 참고

- `y-websocket@2.1.0`과 `yjs@13` 조합으로 고정합니다. `@y/websocket-server`는 yjs 14 프리릴리스라
  yjs 13 클라이언트의 업데이트를 읽지 못하므로 쓰지 않습니다.
- 방 이름은 `studio-bridge/main`입니다.

## 저장 (06회차)
`npm start`는 `start.cjs`로 서버를 띄우며, 카드(`cards`)·제거 기록(`removedCardIds`)·공동 메모(`memo`)를 `sync/data/`에 저장하고 시작할 때 다시 읽습니다.
- 시작 로그에 `Persisting documents to ".../sync/data"`가 나오면 저장이 켜진 것입니다.
- 저장 위치는 `YPERSISTENCE` 환경변수로 바꿉니다. 기본값은 `sync/data`입니다.
- `y-leveldb`를 불러오지 못하면 서버가 뜨지 않고 `npm ci`를 다시 하라고 알려 줍니다. 저장이 꺼진 채 조용히 뜨지 않습니다.
- 서버를 껐다 켜도 같은 카드·위치·메모가 돌아옵니다. 서버는 연결 직후 빈 문서를 먼저 보내고 저장된 내용을 잠시 뒤 반영하므로, 확인 스크립트는 연결 후 1~2초 기다렸다가 읽어야 합니다.
- 서버를 완전히 지우려면 서버를 끄고 `sync/data/`를 삭제합니다.
- `sync/data/`는 Git에 올리지 않습니다.

## 백업 (D 참고)
- 백업할 폴더는 `sync/data/` 전체입니다. LevelDB 폴더이므로 **서버를 끈 상태에서** 폴더째 복사합니다. 켜진 채 복사하면 일관되지 않을 수 있습니다.
- 복원은 서버를 끄고 폴더를 교체한 뒤 다시 시작합니다.
- 자료·결정은 `server/studio_bridge.db`(SQLite)에 있어 따로 백업해야 합니다. 두 곳을 같은 시점에 보존해야 전체 복원입니다.

## 접속 제한 (06회차 #21, A·B)
`start.cjs`가 연결을 받기 전에 검사합니다.
- 로컬 모드(`STUDIO_BRIDGE_TEAM_KEY` 없음): 이 PC(loopback)에서 온 연결만 받습니다. `HOST=0.0.0.0`처럼 외부 주소로 열려고 하면 실행을 멈춥니다.
- 공유 모드(`STUDIO_BRIDGE_TEAM_KEY` 8자 이상): 기본 `0.0.0.0`에서 열고, 연결 주소의 `key` 값이 팀 키와 같아야 합니다. 없으면·틀리면 401로 끊습니다.
  브라우저 WebSocket은 임의 헤더를 붙일 수 없어 HTTP(`X-StudioBridge-Key` 헤더)와 달리 주소의 값으로 받습니다. 웹은 연결 패널에 입력한 키를 `y-websocket`의 `params`로 넘깁니다.
- 보드 이름은 `studio-bridge/main`만 받습니다. 다른 보드·프로젝트는 403입니다.
- 거절 기록에는 사유·IP만 남기고 주소(키 포함)는 남기지 않습니다: `[sync] 접속 거절 401 team_key_invalid from=192.168.10.100`
- 검사: `STUDIO_BRIDGE_TEAM_KEY='<키>' node check-access.cjs ws://<서버 IP>:<포트>` (실제 보드를 건드리지 않게 `YPERSISTENCE`를 임시 폴더로 지정해 띄운 서버에 실행)
- 웹 빌드의 `VITE_` 변수에 비밀 키를 넣지 않습니다.

