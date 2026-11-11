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
