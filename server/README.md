# Studio Bridge 서버

준비: uv 설치. 아래 명령은 저장소 최상위 폴더에서 시작한다.

## 설치 및 실행

cd server
uv sync
uv run uvicorn app.main:app --reload --port 8000

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
- 현재 기본 실행에는 필수 환경변수 설정이 없다.

server 폴더에서 DB의 실제 절대 경로 확인:

```bash
uv run python -c "from app.db import DATABASE_PATH; print(DATABASE_PATH)"
```

## 웹 연결 설정

- 기능 화면은 VITE_API_BASE를 사용하며 기본값은 http://127.0.0.1:8000이다.
- 기능 API의 CORS 허용 주소는 http://localhost:5173과 http://127.0.0.1:5173이다.
- 자료함의 /api 요청은 Vite 개발 서버의 프록시를 통해 8000번 서버로 전달된다.

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