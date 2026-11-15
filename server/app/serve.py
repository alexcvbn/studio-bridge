"""서버 실행 진입점 (06회차 #21). server 폴더에서 `uv run python -m app.serve`.

- 팀 키(STUDIO_BRIDGE_TEAM_KEY)가 없으면 로컬 모드: 127.0.0.1에서만 연다.
- 팀 키가 있으면 공유 모드: 0.0.0.0에서 열어 같은 네트워크의 다른 PC가 접속할 수 있다.
- STUDIO_BRIDGE_HOST·STUDIO_BRIDGE_PORT로 바꿀 수 있다. 로컬 모드에서 외부 주소로 열려고 하면 멈춘다.
- 공유 운영은 --reload 없이 띄운다. 키 값은 화면에 출력하지 않는다.
"""

import os
import socket
import sys

import uvicorn

from app.access import KEY_ENV, is_loopback, load_settings


def lan_address() -> str | None:
    # 실제로 패킷을 보내지 않고, 바깥으로 나갈 때 쓰는 이 PC의 주소만 알아낸다.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))
            return s.getsockname()[0]
    except OSError:
        return None


def main() -> None:
    try:
        settings = load_settings()
    except RuntimeError as err:
        sys.exit(f"실행 중단: {err}")

    port = int(os.environ.get("STUDIO_BRIDGE_PORT", "8000"))
    default_host = "0.0.0.0" if settings.mode == "shared" else "127.0.0.1"
    host = os.environ.get("STUDIO_BRIDGE_HOST", default_host)

    if settings.mode == "local" and not is_loopback(host):
        sys.exit(
            f"실행 중단: 로컬 모드(팀 키 없음)는 이 PC에서만 열 수 있습니다. (STUDIO_BRIDGE_HOST={host})\n"
            f"다른 PC와 공유하려면 {KEY_ENV}에 팀 키를 넣고 다시 실행하세요."
        )

    if settings.mode == "shared":
        lan = lan_address() or "<서버 PC의 IP>"
        print("공유 모드: 팀 키가 있어야 제품 API를 쓸 수 있습니다.")
        print(f"  다른 PC의 Studio 서버 주소: http://{lan}:{port}")
        print(f"  다른 PC의 웹: http://{lan}:5173  (web에서 npm run dev:shared)")
        print(f"  다른 PC의 보드 동기화: ws://{lan}:1234  (sync에서 팀 키와 함께 npm start)")
    else:
        print(f"로컬 모드: 이 PC에서만 접속합니다. http://127.0.0.1:{port}")

    uvicorn.run("app.main:app", host=host, port=port)


if __name__ == "__main__":
    main()
