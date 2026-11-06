# BoardView (B 담당)

React Flow 기반 보드. 카드 위치는 `sync/` 서버(Yjs)로 다른 브라우저와 공유하고,
카드가 가리키는 자료·기능은 공통 서버(FastAPI)의 실제 ID를 쓴다.

## 실행 (서버 3개를 각각 다른 터미널에서)
1. 공통 서버: `cd server` 후 `uv run uvicorn app.main:app --reload --port 8000`
2. 동기화 서버: `cd sync && npm install && npm start` (ws://localhost:1234)
3. 웹: `cd web && npm ci && npm run dev` (http://localhost:5173, `/api`는 8000번으로 프록시)

검증: `cd web && npm run build && npm run lint`

## 카드 데이터
`{ card_id, kind: 'material' | 'feature', target_id, position: {x, y} }`
- `card_id`: 보드 위 카드 자신의 ID. 카드를 추가할 때마다 새로 만든다.
- `kind` + `target_id`: 카드가 가리키는 자료(`material_id`) 또는 기능(`feature_id`). 서버가 준 값을 그대로 쓴다.
- 같은 자료·기능을 여러 카드로 올릴 수 있고, 카드끼리는 `card_id`로 구분한다.
- 이동은 해당 카드의 `position`만 갱신한다.
- 제목은 카드에 저장하지 않는다. 서버의 자료·기능 목록에서 `target_id`로 찾아 그린다.

## 카드 표시
- 정상: 제목, 종류(자료/기능), `target_id` 앞 8자리.
- 서버에 없는 ID: "찾을 수 없음"(빨간 테두리). 기능 열기 버튼은 숨긴다.
- 목록을 읽지 못함(서버 꺼짐 등): "확인 실패"와 "다시 시도" 버튼. 없는 ID와 구분해서 표시한다.

## 다른 화면과 연결
```tsx
<BoardView onOpenFeature={(featureId) => { /* 기능 화면 열기 */ }} />
```
- `onOpenFeature(featureId)`: 보드에서 기능 카드를 선택하고 "기능 열기"를 누르면 호출된다.
- 자료함의 "보드에 추가" 버튼 연결은 04회차 범위다. 지금은 보드 상단 선택 목록에서 서버의 자료·기능을 골라 추가한다.
