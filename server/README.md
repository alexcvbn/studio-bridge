# Studio Bridge 서버

준비: uv 설치. 아래 명령은 저장소 최상위 폴더에서 시작한다.

## 설치 및 실행

cd server
uv sync
uv run uvicorn app.main:app --reload --port 8000

위 명령은 혼자 개발할 때(로컬 모드)다. 두 컴퓨터가 같은 서버를 쓰려면 아래 "두 컴퓨터 공유 실행 (06회차 #21)"을 따른다.

## 서버 연결 확인

브라우저에서 http://127.0.0.1:8000/api/health 접속
기대 응답: {"status":"ok"}

## DB 확인

server 폴더의 별도 터미널에서 실행:
uv run python -c "from app.db import read_fixed_project; print(read_fixed_project())"

기대 출력: studio-bridge
서버를 종료하고 다시 실행한 뒤에도 같은 값이 나와야 한다.


## 공통 서버·DB 설정

- 서버 주소: http://127.0.0.1:8000
- API 문서: http://127.0.0.1:8000/docs
- 고정 프로젝트 ID: studio-bridge
- DB 파일: server/studio_bridge.db
- 기능·자료 API는 app/db.py의 같은 DB 연결과 세션을 사용한다.
- DB 파일은 서버를 종료해도 유지된다.
- 로컬 모드 실행에는 필수 환경변수가 없다. 공유 모드는 `STUDIO_BRIDGE_TEAM_KEY`가 필요하다. (아래 참고)

server 폴더에서 DB의 실제 절대 경로 확인:

```bash
uv run python -c "from app.db import DATABASE_PATH; print(DATABASE_PATH)"
```

## 웹 연결 설정

- 웹의 모든 제품 API(기능·자료함·보드 제목)는 지금 연 웹 주소의 `/api`로 요청하고, Vite 개발 서버의 프록시가 같은 PC의 8000번 서버로 넘긴다. (06회차 #21부터 기능 화면도 같은 방식)
- 서버 포트를 바꿨다면 web을 띄울 때 `STUDIO_BRIDGE_API_TARGET=http://127.0.0.1:포트`를 준다. `VITE_API_BASE`를 주면 그 주소로 직접 요청한다(이때만 CORS 허용 주소 http://localhost:5173·http://127.0.0.1:5173이 의미 있음).

## 주요 API

- POST /api/projects/{project_id}/features: 기능 생성
- GET /api/projects/{project_id}/features: 기능 목록
- GET /api/projects/{project_id}/features/{feature_id}: 기능 상세
- POST /api/projects/studio-bridge/materials/collect: 자료 수신·저장
- GET /api/projects/studio-bridge/materials: 자료 목록
- GET /api/projects/studio-bridge/materials/{material_id}: 자료 원문 조회
- PUT /api/projects/{project_id}/features/{feature_id}/materials/{material_id}: 자료를 기능에 연결
- GET /api/projects/{project_id}/features/{feature_id}/materials: 기능에 연결된 자료 목록
- GET /api/projects/{project_id}/context?source_uid=...: Studio 스크립트의 자료·연결 기능·현재 결정 (04회차 #13, 05회차 #17)
- GET /api/projects/{project_id}/access: 연결 확인. 모드·팀 키·프로젝트 검사를 통과하면 `{"project_id":"studio-bridge","mode":"shared"|"local"}` (06회차 #21)

## 문맥 조회 (04회차 #13, C·D와 맞출 응답 모양)

`source_uid`만으로 찾는다. 이름·경로로 찾지 않는다.

```json
{
  "source_uid": "demo-boss-ai",
  "material": {
    "material_id": "...",
    "name": "BossAI",
    "source_path": "ServerScriptService.BossAI",
    "script_type": "Script",
    "received_at": "..."
  },
  "features": [
    {
      "feature_id": "...", "title": "보스 2페이즈", "status": "todo", "assignee": null,
      "current_decision": {
        "decision_no": 1,
        "body": "체력 5000. 이유: 첫 테스트의 전투 시간을 맞추기 위해서.",
        "author_display_name": "황재민",
        "created_at": "2026-11-14T04:25:02.039147+00:00"
      }
    },
    { "feature_id": "...", "title": "보스 등장 연출", "status": "todo", "assignee": null, "current_decision": null }
  ]
}
```

| 상황 | 응답 |
|---|---|
| 아직 받은 적 없는 source_uid | 200, `material: null`, `features: []` |
| 받았지만 연결된 기능 없음 | 200, `material` 있음, `features: []` |
| 여러 기능에 연결 | 200, 연결한 순서대로 모두 |
| 결정이 없는 기능 | `current_decision: null` |
| 결정이 있는 기능 | 가장 큰 `decision_no`의 `decision_no`·`body`·`author_display_name`·`created_at`. 표시명은 입력값이며 인증된 신원이 아니다 |
| source_uid 빠짐 | 422 (FastAPI 기본 detail 배열) |
| source_uid가 빈 값 | 422 `source_uid_required` |
| 다른 프로젝트 | 403 `project_forbidden` |
| 서버 꺼짐·오류 | 연결 실패 또는 5xx. 200의 "없음"과 다르게 표시해야 한다 |

## 문맥 조회 검사 (05회차 #17)

실제 DB를 건드리지 않도록 `STUDIO_BRIDGE_DB`로 임시 DB를 지정해 서버를 띄우고, 실제 HTTP로 검사한다. (server 폴더)

```bash
STUDIO_BRIDGE_DB=/tmp/sb-check.db uv run uvicorn app.main:app --port 8765
```

다른 터미널에서:

```bash
uv run python scripts/check_context.py http://127.0.0.1:8765
```

Windows PowerShell은 `$env:STUDIO_BRIDGE_DB="$env:TEMP\sb-check.db"` 후 같은 명령으로 실행한다.
미수집·미연결·다중 연결·결정 없음·현재 결정·결정 변경·422·403을 확인하고 `14/14 통과`가 나와야 한다.
`STUDIO_BRIDGE_DB`를 지정하지 않으면 기본 DB `server/studio_bridge.db`를 쓴다.

## 통합 검증 방법

1. /docs에서 기능과 자료를 각각 생성하고 반환된 ID를 기록한다.
2. 서버를 종료한 뒤 다시 실행한다.
3. GET 요청으로 기록한 ID를 조회해 데이터가 유지되는지 확인한다.
4. 웹의 기능·자료함에서도 저장한 데이터를 확인한다.
5. 서버 종료 상태에서 오류 표시와 저장 실패 시 입력 보존을 확인한다.
6. 서버를 다시 실행하고 재시도해 정상 동작을 확인한다.
## 두 컴퓨터 공유 실행 (06회차 #21)

한 PC(서버 PC)가 API 서버·보드 동기화 서버·웹을 띄우고, 다른 PC는 브라우저와 Studio만 쓴다.
**다른 PC의 `localhost`는 서버 PC가 아니다.** 웹·Studio·보드 주소를 모두 서버 PC의 주소로 맞춘다.

### 모드

| 모드 | 조건 | 열리는 주소 | 접근 |
|---|---|---|---|
| 로컬 | `STUDIO_BRIDGE_TEAM_KEY` 없음 | 127.0.0.1만 | 서버 PC에서 온 요청만. 다른 PC에서 오면 403 `local_only` |
| 공유 | `STUDIO_BRIDGE_TEAM_KEY`에 8자 이상 키 | 0.0.0.0 (같은 네트워크) | 제품 API는 팀 키가 맞아야 함. 없으면 401 `team_key_required`, 틀리면 401 `team_key_invalid` |

- 두 모드 모두 `/api/health`는 키 없이 200이다. 제품 데이터는 싣지 않는다.
- 두 모드 모두 `studio-bridge`가 아닌 project_id는 403 `project_forbidden`, `studio-bridge/main`이 아닌 보드는 403으로 거절한다.
- 팀 키는 팀 접근 제한이지 개인 신원 확인이 아니다. 키·DB·로그는 Git에 올리지 않는다. 웹 빌드의 `VITE_` 변수에 키를 넣지 않는다.
- 로컬 모드인데 외부 주소로 열려고 하면(`STUDIO_BRIDGE_HOST=0.0.0.0`, sync의 `HOST=0.0.0.0`) 실행을 멈춘다.

### 서버 PC 실행 순서 (터미널 3개, 같은 팀 키)

팀 키는 서버를 띄우는 사람이 정해 팀원에게 메신저로 따로 알린다. 아래 `<팀 키>`를 실제 키로 바꾼다. 이 문서·이슈·화면 녹화에 키를 적지 않는다.

macOS/Linux:

```bash
# 1) API 서버 (server 폴더)
cd server
STUDIO_BRIDGE_TEAM_KEY='<팀 키>' uv run python -m app.serve
```

```bash
# 2) 보드 동기화 서버 (sync 폴더)
cd sync
STUDIO_BRIDGE_TEAM_KEY='<팀 키>' npm start
```

```bash
# 3) 웹 (web 폴더) — 다른 PC가 열 수 있게 0.0.0.0에서 연다
cd web
npm run dev:shared
```

Windows PowerShell (각 터미널에서):

```powershell
$env:STUDIO_BRIDGE_TEAM_KEY = '<팀 키>'
cd server; uv run python -m app.serve
```

```powershell
$env:STUDIO_BRIDGE_TEAM_KEY = '<팀 키>'
cd sync; npm start
```

```powershell
cd web; npm run dev:shared
```

API 서버는 시작할 때 다른 PC가 쓸 주소를 출력한다(키는 출력하지 않는다).

```text
공유 모드: 팀 키가 있어야 제품 API를 쓸 수 있습니다.
  다른 PC의 Studio 서버 주소: http://192.168.0.10:8000
  다른 PC의 웹: http://192.168.0.10:5173  (web에서 npm run dev:shared)
  다른 PC의 보드 동기화: ws://192.168.0.10:1234  (sync에서 팀 키와 함께 npm start)
```

서버 PC 방화벽에서 **8000(API·Studio), 5173(웹), 1234(보드 동기화)** 의 들어오는 연결을 같은 네트워크에 한해 허용한다. 공용 Wi-Fi나 인터넷에 열지 않는다(외부 공개는 이번 범위가 아님).

### 다른 PC에서 접속

| 화면 | 넣을 주소 | 팀 키 넣는 곳 |
|---|---|---|
| 웹 | 브라우저에서 `http://<서버 PC IP>:5173` | 상단 **연결 설정** → 팀 키 → **저장하고 다시 연결** (이 브라우저에만 저장) |
| Studio 플러그인 | 패널 **서버 주소**에 `http://<서버 PC IP>:8000` | 패널 **팀 키** 칸에 입력 후 Enter → **연결 확인** |
| 보드 동기화 | 자동: 웹을 연 호스트의 1234번 | 웹에 저장한 팀 키를 그대로 씀 |

웹의 API는 웹을 연 주소의 `/api`로 가고 Vite가 서버 PC의 8000번으로 넘기므로, 웹과 API가 항상 같은 서버를 쓴다.

### HTTP와 WS의 접근 방식 차이

| | HTTP (웹 API·Studio) | WS (보드 동기화) |
|---|---|---|
| 키 전달 | `X-StudioBridge-Key` 헤더 | 연결 주소의 `?key=` 값 (브라우저 WebSocket은 임의 헤더를 붙일 수 없음) |
| 거절 | 401 JSON `{detail:{code,message}}` — 화면이 사유를 보여줌 | 연결 단계에서 HTTP 401/403 후 끊음 — 브라우저는 사유를 못 읽음 |
| 화면 표시 | 웹 연결 패널·플러그인 `연결 확인`이 키 필요/틀림/허용 안 됨/서버 꺼짐을 구분 | 웹 연결 패널이 5초 넘게 연결되지 않으면 "동기화 서버가 꺼졌거나 팀 키가 맞지 않음"으로 안내. 정확한 사유는 HTTP 연결 확인 결과로 판단 |
| 키 노출 위험 | 헤더는 서버 접근 기록에 남지 않음 | 주소에 키가 들어감. sync 서버는 거절 기록에 주소를 남기지 않고 사유·IP만 남긴다. WS는 Vite 프록시를 거치지 않고 1234번에 직접 연결해 프록시 기록에도 남지 않게 했다 |
| 남은 문제·계획 | — | ① 브라우저 개발자 도구에는 주소(키 포함)가 보이므로 화면 녹화·발표 때 열지 않는다. ② 같은 네트워크의 평문 ws://라 엿볼 수 있다. 외부 접속이 필요해지면 HTTPS/WSS를 먼저 적용한다(이번 범위 아님). ③ 키 누락·틀림 거절과 서버 재시작 회귀는 08회차(#29·#30)에서 다시 검증한다 |

### 접속 오류 기록 (키 값 없음)

거절할 때 서버는 사유 코드·보낸 곳 IP·메서드·경로만 남긴다. 실제 기록 예:

```text
WARNING:     studio_bridge.access 접속 거절 401 team_key_required from=192.168.10.100 GET /api/projects/studio-bridge/access
WARNING:     studio_bridge.access 접속 거절 401 team_key_invalid from=192.168.10.100 GET /api/projects/studio-bridge/access
WARNING:     studio_bridge.access 접속 거절 403 project_forbidden from=192.168.10.100 GET /api/projects/other-team/materials
[sync] 접속 거절 401 team_key_invalid from=192.168.10.100
[sync] 접속 거절 403 board_forbidden from=192.168.10.100
```

| 보이는 증상 | 원인 | 해결 |
|---|---|---|
| 웹 "서버 연결 실패 … (502)" | Vite는 떠 있지만 API 서버가 꺼짐 / 포트 다름 | 서버 PC에서 API 서버 실행, 포트를 바꿨으면 `STUDIO_BRIDGE_API_TARGET` |
| 웹이 아예 열리지 않음 | `npm run dev`(이 PC만)로 띄움, 방화벽 | `npm run dev:shared`, 5173 허용 |
| 웹 "팀 키 필요" / "팀 키가 맞지 않습니다" | 키 미입력 / 오타·다른 키 | 연결 설정에서 키 다시 저장 |
| 웹 보드 동기화 "연결되지 않음" | sync 꺼짐, sync를 키 없이 띄움(로컬 모드라 다른 PC 접속 불가), 키 다름, 1234 방화벽 | sync를 같은 키로 `npm start`, 1234 허용 |
| Studio `HttpError: ConnectFail` | 주소가 `localhost`(다른 PC), 서버가 로컬 모드, 8000 방화벽 | 서버 PC IP로 주소 변경, 공유 모드 실행, 8000 허용 |
| Studio `서버 오류 401` | 팀 키 없음·틀림 | 패널 팀 키 입력 후 연결 확인 |
| `403 local_only` | 서버를 키 없이(로컬 모드) `--host 0.0.0.0`로 띄움 | `uv run python -m app.serve`를 팀 키와 함께 실행 |

### 접속 검사 (임시 DB, 실제 HTTP·WS)

```bash
# server 폴더: 공유 모드 서버를 임시 DB로
STUDIO_BRIDGE_TEAM_KEY='<검사용 키>' STUDIO_BRIDGE_DB=/tmp/sb-access.db STUDIO_BRIDGE_PORT=8765 uv run python -m app.serve
# 다른 터미널 (server 폴더): 서버 PC의 LAN 주소로 검사 → 15/15 통과
STUDIO_BRIDGE_TEAM_KEY='<검사용 키>' uv run python scripts/check_access.py http://<서버 PC IP>:8765
```

```bash
# sync 폴더: 임시 저장 폴더로 공유 모드 동기화 서버
STUDIO_BRIDGE_TEAM_KEY='<검사용 키>' YPERSISTENCE=/tmp/sb-ydata PORT=12340 npm start
# 다른 터미널 (sync 폴더) → 6/6 통과
STUDIO_BRIDGE_TEAM_KEY='<검사용 키>' node check-access.cjs ws://<서버 PC IP>:12340
```

키 없이 띄운 로컬 모드 서버에 실행하면 로컬 모드 항목(이 PC 200, LAN 주소에서 403 `local_only`)을 검사한다.

### 06회차 확인 결과 (2026-11-15, 서버 PC 1대 macOS)

| 입력 → 조작 | 기대값 | 실제값 | 결과 |
|---|---|---|---|
| 공유 모드 API, LAN 주소로 `check_access.py` | 키 없음·틀림 401, 다른 프로젝트 403, 키 있으면 수집→기능→연결→결정→문맥 조회 | 15/15 | 통과 |
| 로컬 모드 API, 127.0.0.1 / LAN 주소 | 이 PC 200, LAN 403 `local_only` | 12/12 | 통과 |
| 로컬 모드에 외부 주소·짧은 키로 실행 | 실행 중단 | 둘 다 안내 후 종료 | 통과 |
| 공유 모드 sync, LAN 주소로 `check-access.cjs` | 키 없음·틀림 401, 다른 보드 403, 두 연결이 같은 문서 공유 | 6/6 | 통과 |
| 기존 검사 회귀 (`check_context` 14, `check_materials_lookup` 8) | 모두 통과 | 14/14, 8/8 | 통과 |
| 웹 `http://<LAN IP>:5173`을 키 없이 열기 | "팀 키 필요" | "팀 키 필요 · 공유 모드 서버입니다" | 통과 |
| 웹에 틀린 키 / 맞는 키 저장 | 틀림 안내 / "서버 연결됨 (공유 모드)·보드 동기화 연결됨", 자료함·기능 목록 표시 | 같음 | 통과 |
| 웹 보드에 카드 추가·메모 입력 → 별도 프로세스가 LAN 주소+키로 보드 읽기 | 카드 1개·메모 같음 | 같음 | 통과 |
| API 서버만 끄고 웹 다시 확인 | 서버 꺼짐 안내 | "서버에 연결할 수 없습니다 … (502)" | 통과 |
| Studio 패널: 주소 `http://<LAN IP>:8765`, 키 없이 연결 확인 | 401 안내 | "서버 오류 401: 공유 모드 서버입니다…" | 통과 |
| Studio 패널: 키 입력 → 연결 확인 → BoarAI 코드 보내기 → (API로 기능 연결·결정 저장) → 관련 결정 읽기 | 연결됨, 완료(material_id), 원문 207줄 일치, 현재 결정 표시 | 같음 | 통과 |

**미완료:** 실제로 서로 다른 두 컴퓨터에서는 아직 확인하지 않았다. 위 결과는 서버 PC 한 대에서 LAN 주소로 접속한 것이다. 다른 팀원 PC에서 같은 순서로 재현해야 "두 컴퓨터가 같은 프로젝트에 연결" 조건을 체크할 수 있다. Windows 방화벽 설정도 실제로 확인하지 않았다.
