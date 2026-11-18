# BoardView (B 담당)

React Flow 기반 보드. 카드 위치는 `sync/` 서버(Yjs)로 다른 브라우저와 공유하고,
카드가 가리키는 자료·기능은 공통 서버(FastAPI)의 실제 ID를 쓴다.

## 실행 (서버 3개를 각각 다른 터미널에서)
1. 공통 서버: `cd server` 후 `uv run uvicorn app.main:app --reload --port 8000`
2. 동기화 서버: `cd sync && npm install && npm start` (이 PC의 1234번. 웹은 웹을 연 호스트의 1234번으로 접속. 두 컴퓨터 공유는 `server/README.md`의 "두 컴퓨터 공유 실행")
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

## 카드 추가·제거 (04회차)
```ts
import { addMaterialCard } from './features/board'
addMaterialCard(materialId) // 새 card_id의 자료 카드를 만든다. 보드 화면이 숨겨져 있어도 동작한다.
```
- 같은 자료를 다시 추가하면 같은 `target_id`의 **새 카드**가 생긴다(중복 허용).
- "카드 제거 (보드에서만)"는 보드 상태에서만 지운다. 서버의 자료·기능·결정은 그대로이며 서버에 삭제 요청을 보내지 않는다.
- 제거한 `card_id`는 `removedCardIds`에 남겨, 다른 브라우저의 늦은 이동 이벤트가 카드를 되살리지 못하게 한다.
- 배치의 영구 저장은 06회차 범위다. 지금은 동기화 서버가 켜져 있는 동안만 유지된다.

## 연결 방법 (A·C·D에게)
보드 쪽은 준비돼 있고, 아래 두 파일에 한 줄씩 연결하면 이슈 #14의 장면이 완성된다.

**D — `MaterialLibrary.tsx`**: `onAddMaterial?: (materialId: string) => void` prop을 추가하고, 선택한 자료의 "보드에 추가" 버튼에서 `onAddMaterial(selectedId)`를 호출한다.

**A — `App.tsx`**: 조립만 하면 된다.
```tsx
import { BoardView, addMaterialCard } from './features/board'

const [openFeatureId, setOpenFeatureId] = useState<string | null>(null)

<BoardView onOpenFeature={(id) => { setOpenFeatureId(id); setMenu('features') }} />
<FeatureView openFeatureId={openFeatureId} onSelectFeature={setOpenFeatureId} />
<MaterialLibrary onAddMaterial={addMaterialCard} />
```
- C의 `FeatureView`는 이미 `openFeatureId`를 받는다. 기능 카드의 `target_id`가 상세의 기능 ID와 같다.
- `onOpenFeature(featureId)`: 보드에서 기능 카드를 선택하고 "기능 열기"를 누르면 호출된다.

## 공유 규칙 (05회차)
- 이동은 `moveCard(cardId, position)`로 해당 카드의 `position`만 쓴다. 위치가 그대로이거나 제거된 카드면 아무것도 쓰지 않는다.
- 제거는 `cards`에서 지우고 `removedCardIds`에 기록한다. 제거된 ID가 `cards`에 다시 나타나면(늦은 이동 이벤트) 접속한 클라이언트가 바로 지운다.
- 새 카드는 항상 새 `card_id`를 만든다. 제거된 ID는 다시 쓰지 않는다.
- 공유 상태가 바뀌면 화면 노드의 위치만 갱신한다. 화면 변경은 공유 상태에서만 일어나므로 서로 반복해서 쓰지 않는다.

## 두 브라우저로 확인하는 방법
같은 PC의 같은 브라우저 탭 두 개는 서버를 거치지 않고도 서로 보이므로 증거가 되지 않는다. 서로 다른 브라우저(또는 다른 프로필·PC)로 `http://localhost:5173`을 열고 보드에서 추가 → 이동 → 제거를 각각 해 본다.

## 공동 메모 (06회차)
- 메모는 같은 문서의 `memo` Y.Text이며 카드와 같은 서버에 함께 저장된다. 입력창(`MemoPanel`)은 전체를 덮어쓰지 않고 바뀐 부분만 지우고 넣어서, 동시에 쓴 다른 사람의 글이 사라지지 않는다.
- 남이 쓴 글이 들어오면 내 커서를 같은 글자 옆에 둔다.
- 서버 연결이 끊기면 화면에 안내가 나오고, 쓴 내용은 입력창에 남아 다시 연결되면 반영된다.
- 예시 카드를 자동으로 넣지 않는다. 카드는 사용자가 추가할 때만 생기므로 접속·새로고침으로 중복되지 않는다.

## 동시 조작·끊김 확인 순서 (07회차)
서로 다른 브라우저 두 개(또는 두 PC) A, B로 같은 보드(`http://localhost:5173` 또는 공유 모드 주소)를 연다. 연결을 끊을 때는 브라우저 개발자 도구의 Network → Offline을 쓴다(다시 켜면 재접속).
1. **서로 다른 카드 동시 이동**: A는 카드 1, B는 카드 2를 동시에 끈다. 기대: 두 화면 모두 두 카드가 각자 위치로 간다.
2. **같은 카드 동시 이동**: B를 Offline으로 하고 B에서 카드 1을 옮긴 뒤, A에서 같은 카드 1을 다른 곳으로 옮기고, B를 Online으로 되돌린다. 기대: 두 화면의 카드 1 위치가 같다. 어느 쪽 값이 이기는지는 Yjs가 정하며 "마지막에 놓은 사람"은 보장하지 않는다.
3. **제거와 늦은 이동**: B를 Offline으로 하고 카드 3을 옮긴다. A에서 카드 3을 제거한다. B를 Online으로 되돌린다. 기대: 카드 3은 두 화면 모두에 다시 나타나지 않는다.
4. **끊김 후 재접속**: 동기화 서버를 끄고 A에서 메모, 카드 추가·이동·제거를 한 뒤 서버를 다시 켠다. 기대: A의 변경이 모두 서버에 합쳐지고 B에도 보인다. 끊긴 동안 화면 상단에 연결 상태, 메모 아래에 안내가 보인다.
5. **재접속 후 제거 카드**: 모든 브라우저를 닫은 상태에서 서버를 재시작해도 제거한 카드는 나타나지 않는다.

한계:
- 제거된 카드를 지우는 정리는 보드를 연 브라우저가 한다. 브라우저가 하나도 없을 때 들어온 늦은 이동은 서버에 되살아난 카드로 잠시 남고, 다음에 브라우저가 접속하면 지워진다(화면에는 나타나지 않는다).
- 두 사람이 같은 순간에 카드를 추가하면 서로 다른 `card_id`로 둘 다 생기지만 같은 격자 위치에 겹칠 수 있다. 데이터는 잃지 않으며 끌어서 떼어 놓는다.
- 완전한 오프라인 편집은 지원하지 않는다.

