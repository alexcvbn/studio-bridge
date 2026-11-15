"""A 담당: 로컬/공유 모드와 팀 키 검사 (06회차 #21).

- 로컬 모드 (STUDIO_BRIDGE_TEAM_KEY 없음): 이 PC(loopback)에서 온 요청만 받는다.
- 공유 모드 (STUDIO_BRIDGE_TEAM_KEY 있음): 제품 API는 X-StudioBridge-Key 헤더가 팀 키와 같아야 한다.
  키는 팀 접근 제한일 뿐 개인 신원 인증이 아니다.
- 두 모드 모두 /api/health는 키 없이 응답한다. health에는 제품 데이터가 없다.
- /api/projects/{project_id}/... 에서 허용하지 않은 project_id는 403으로 거절한다.

거절 기록에는 키 값과 헤더를 남기지 않는다. 사유 코드·보낸 곳 IP·메서드·경로만 남긴다.
"""

import hmac
import logging
import os
from dataclasses import dataclass
from ipaddress import ip_address

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.db import FIXED_PROJECT_ID

KEY_HEADER = "X-StudioBridge-Key"
KEY_ENV = "STUDIO_BRIDGE_TEAM_KEY"
MIN_KEY_LENGTH = 8
# 키 없이 열어 두는 주소. 서버 연결 확인용이며 제품 데이터를 싣지 않는다.
OPEN_PATHS = {"/api/health"}

logger = logging.getLogger("studio_bridge.access")


@dataclass(frozen=True)
class AccessSettings:
    team_key: str  # 빈 값이면 로컬 모드

    @property
    def mode(self) -> str:
        return "shared" if self.team_key else "local"


def load_settings() -> AccessSettings:
    team_key = os.environ.get(KEY_ENV, "").strip()
    if team_key and len(team_key) < MIN_KEY_LENGTH:
        # 키 값은 출력하지 않는다.
        raise RuntimeError(f"{KEY_ENV}는 {MIN_KEY_LENGTH}자 이상이어야 합니다.")
    return AccessSettings(team_key=team_key)


def is_loopback(host: str | None) -> bool:
    if not host:
        return False
    if host == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def _reject(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": {"code": code, "message": message}})


def _project_of(path: str) -> str | None:
    # /api/projects/{project_id} 또는 /api/projects/{project_id}/...
    prefix = "/api/projects/"
    if not path.startswith(prefix):
        return None
    return path[len(prefix):].split("/", 1)[0]


class AccessMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: AccessSettings):
        super().__init__(app)
        self.settings = settings

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/") or path in OPEN_PATHS:
            return await call_next(request)

        client = request.client.host if request.client else None

        def denied(status: int, code: str, message: str) -> JSONResponse:
            logger.warning("접속 거절 %s %s from=%s %s %s", status, code, client, request.method, path)
            return _reject(status, code, message)

        if self.settings.mode == "local":
            if not is_loopback(client):
                return denied(
                    403,
                    "local_only",
                    "로컬 모드 서버는 서버 PC에서만 접속할 수 있습니다. 공유하려면 서버를 팀 키와 함께 공유 모드로 실행하세요.",
                )
        else:
            sent = request.headers.get(KEY_HEADER, "")
            if not sent:
                return denied(401, "team_key_required", "공유 모드 서버입니다. 팀 키를 입력하세요.")
            if not hmac.compare_digest(sent.encode(), self.settings.team_key.encode()):
                return denied(401, "team_key_invalid", "팀 키가 맞지 않습니다. 서버를 띄운 팀원에게 키를 다시 확인하세요.")

        project_id = _project_of(path)
        if project_id is not None and project_id != FIXED_PROJECT_ID:
            return denied(403, "project_forbidden", "허용되지 않은 프로젝트입니다.")

        return await call_next(request)


router = APIRouter(prefix="/api/projects/{project_id}", tags=["access"])


@router.get("/access")
def check_access(project_id: str, request: Request) -> dict[str, str]:
    """웹·Studio의 '연결 확인'. 여기까지 왔으면 모드·키·프로젝트 검사를 통과한 것이다."""
    return {"project_id": project_id, "mode": request.app.state.access.mode}
