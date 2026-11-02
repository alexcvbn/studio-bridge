# BoardView (B 담당, 01회차)

React Flow 기반 보드 컴포넌트. 01회차는 로컬 React 상태만 사용하며 새로고침하면 초기화된다.

## A에게: 조립 방법
```tsx
import { BoardView } from './features/board'
<div style={{ height: '100svh' }}><BoardView onOpenFeature={(featureId) => {}} /></div>
```
- 부모 요소에 높이가 있어야 보드가 보인다.
- `App.tsx`는 수정하지 않았다. 조립은 A가 한다.

## 카드 데이터 (Yjs 구조를 미리 따름)
`{ card_id, kind: 'material' | 'feature', target_id, position: {x, y} }`
- 이동은 해당 카드의 `position`만 갱신한다.
- 제목은 `target_id`로 읽는 자리이며, 지금은 `sampleCards.ts`의 예시 값이다.

## 실행
`cd web && npm ci && npm run dev` / 검증: `npm run build && npm run lint`
