import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import access, context, materials
from app.db import init_db
from app.features import router as features_router

# 접속 거절 기록(키 값 없음)이 uvicorn 로그와 같이 보이게 한다.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s %(message)s")

# 서버를 띄울 때 모드·팀 키를 한 번 읽는다. 키가 너무 짧으면 여기서 멈춘다. (06회차 #21)
settings = access.load_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    logging.getLogger("studio_bridge.access").info(
        "실행 모드: %s", "공유 (팀 키 필요)" if settings.mode == "shared" else "로컬 (이 PC만)"
    )
    yield


app = FastAPI(lifespan=lifespan)
app.state.access = settings
# 미들웨어는 나중에 추가한 것이 바깥이다. CORS를 바깥에 두어 거절 응답(401·403)에도
# CORS 헤더가 붙고, 브라우저의 사전 요청(OPTIONS)은 키 검사 전에 처리된다.
app.add_middleware(access.AccessMiddleware, settings=settings)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(features_router)
app.include_router(materials.router)
app.include_router(context.router)
app.include_router(access.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
