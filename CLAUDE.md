# Studio Bridge 작업 규칙

## 프로젝트
Roblox Studio 코드를 웹으로 보내 자료함에 모으고, 기능 카드에 연결해 결정 이유를 남기고, Studio에서 관련 결정을 다시 조회하는 협업 도구.
예: BossAI 전송 → "보스 2페이즈" 기능에 연결 → "체력 5000" 결정 기록 → Studio에서 조회.
범위 밖: GitHub 연동, AI 요약, 자동 diff, 채팅, OAuth/권한 UI, 다중 프로젝트, 웹에서 코드 편집.

## 나는 B(정승호)
담당: `web/src/features/board/`, `sync/`, 웹 `package.json`·lockfile.
- `web/src/App.tsx`는 수정하지 않는다 (A가 조립). `BoardView`만 export한다.
- C·D·A 담당 폴더는 수정하지 않는다. 필요하면 이유와 영향을 먼저 설명한다.
- 패키지 추가는 B가 모아서 반영한다. 추가 전에 이유를 설명한다.
- 컴포넌트 간 callback(`onAddMaterial(materialId)`, `onOpenFeature(featureId)`)을 바꾸면 상대 담당과 같이 수정한다.
- 없는 API·실행 파일이 이미 있다고 가정하지 않는다. 서버는 A 담당이며 `feat/1-server-health` 브랜치에 `GET /api/health`와 SQLite 기반만 있다(포트 8000, `uv run uvicorn app.main:app --port 8000`). 자료·기능 API는 아직 없다.

## 보드 데이터 규칙 (Yjs)
- 문서 이름: `studio-bridge/main` 하나. 사람마다 다른 방을 만들지 않는다.
- `cards` (Y.Map): `card_id` 키. 값은 `kind`(material/feature), `target_id`, `position{x,y}`.
- 카드 이동은 `position`만 갱신한다. 전체 카드를 덮어쓰지 않는다.
- `removedCardIds` (Y.Map): 제거된 카드는 그리지 않고 이동 이벤트도 무시한다. 재추가는 새 `card_id`.
- `memo` (Y.Text): 접속할 때마다 예시 카드를 중복 추가하지 않는다.
- 카드 제목·결정은 `target_id`로 DB에서 읽는다. 보드에서 카드 제거는 화면에서만 제거이며 DB는 그대로.
- 동시 이동은 두 화면이 같은 위치로 수렴하는 것까지만 보장한다. "마지막 사람이 이긴다"고 설명하지 않는다.

## 작업 방식
- 큰 화면을 한 번에 만들지 않는다. 작은 변경 → 실행 → 확인 순서로 진행한다.
- 코드 작성과 검증 완료를 구분해 보고하고, 실행하지 않은 것은 "미실행"이라고 적는다.
- 웹 변경 후 `npm run build`, `npm run lint`를 실행한다 (`web/`에서).
- 같은 PC의 탭 두 개만으로 동기화 성공을 결론내리지 않는다. 다른 브라우저 프로필 또는 다른 PC로 확인한다.
- 설치는 기록된 Node/npm 버전으로 `npm ci`를 쓴다. 실패해도 패키지를 임의로 최신화하지 않고 버전과 오류를 남긴다.
- y-websocket은 공식 README에서 실제 버전·실행법을 확인하고 `sync/`의 package.json·lockfile·README에 고정한다.
- 비밀 키·공유 URL은 로그, 화면, Git, `VITE_` 변수에 넣지 않는다. `node_modules`, `.venv`는 Git에 올리지 않는다.
- 커밋은 `git diff`로 확인한 파일만 `git add` 한다. 변경한 파일의 이유를 설명할 수 있어야 한다.

## Git
`git switch main` → `git pull --ff-only` → `git switch -c feat/<이슈번호>-<이름>` → 작업 → `git diff` → 확인한 파일만 add → push → PR.

## 환경 기록
- Node v24.16.0 / npm 11.13.0 (macOS, 2026-11-02 기준)
