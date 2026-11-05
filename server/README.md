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

## 통합 검증 방법

1. /docs에서 기능과 자료를 각각 생성하고 반환된 ID를 기록한다.
2. 서버를 종료한 뒤 다시 실행한다.
3. GET 요청으로 기록한 ID를 조회해 데이터가 유지되는지 확인한다.
4. 웹의 기능·자료함에서도 저장한 데이터를 확인한다.
5. 서버 종료 상태에서 오류 표시와 저장 실패 시 입력 보존을 확인한다.
6. 서버를 다시 실행하고 재시도해 정상 동작을 확인한다.