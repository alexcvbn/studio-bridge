from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import materials
from app.db import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(materials.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
