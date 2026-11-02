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