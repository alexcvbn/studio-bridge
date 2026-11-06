# sync — 보드 동기화 서버

보드 카드 이동을 다른 브라우저에 전달하는 Yjs WebSocket 서버입니다. (이슈 #6)

## 실행

```bash
cd sync
npm install
npm start
```

기본 주소는 `ws://localhost:1234`입니다. 포트는 `PORT`, 주소는 `HOST` 환경변수로 바꿉니다.
웹은 `VITE_SYNC_URL`로 서버 주소를 지정합니다. (기본값 `ws://localhost:1234`)

## 참고

- `y-websocket@2.1.0`과 `yjs@13` 조합으로 고정합니다. `@y/websocket-server`는 yjs 14 프리릴리스라
  yjs 13 클라이언트의 업데이트를 읽지 못하므로 쓰지 않습니다.
- 방 이름은 `studio-bridge/main`입니다.
- 영구 저장은 하지 않습니다. 서버를 끄면 카드 상태가 초기화됩니다.
