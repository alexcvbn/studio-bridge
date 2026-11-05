"""D 담당: 받은 자료(material)와 수집본(snapshot) 저장·조회 API (02회차 #8)."""

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import ForeignKey, String, Text, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.db import FIXED_PROJECT_ID, Base, get_db

MAX_RAW_BYTES = 256 * 1024  # 원문 최대 256KiB (공통 안내 5절)


def new_id() -> str:
    return str(uuid.uuid4())


def now_utc() -> str:
    return datetime.now(UTC).isoformat()


# ---------- DB 표 ----------
class Material(Base):
    """원본 스크립트 하나. 같은 source_uid로 다시 보내도 같은 자료로 묶인다."""

    __tablename__ = "materials"

    material_id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.project_id"))
    source_uid: Mapped[str] = mapped_column(String, unique=True)


class Snapshot(Base):
    """'보내기'를 누른 순간의 코드 원문 한 벌."""

    __tablename__ = "snapshots"

    snapshot_id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    material_id: Mapped[str] = mapped_column(ForeignKey("materials.material_id"))
    request_id: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    source_path: Mapped[str] = mapped_column(String)
    script_type: Mapped[str] = mapped_column(String)
    raw_code: Mapped[str] = mapped_column(Text)  # 가공하지 않고 그대로 저장
    received_at: Mapped[str] = mapped_column(String, default=now_utc)


# ---------- 받는 JSON 모양 (공통 안내 6절) ----------
class CollectIn(BaseModel):
    source_uid: str
    request_id: str
    name: str
    source_path: str
    script_type: Literal["Script", "LocalScript", "ModuleScript"]
    raw_code: str


router = APIRouter(prefix=f"/api/projects/{FIXED_PROJECT_ID}/materials")


def error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message})


def latest_snapshot(db: Session, material_id: str) -> Snapshot | None:
    query = (
        select(Snapshot)
        .where(Snapshot.material_id == material_id)
        .order_by(Snapshot.received_at.desc())
    )
    return db.scalars(query).first()


def snapshot_json(s: Snapshot) -> dict:
    return {
        "snapshot_id": s.snapshot_id,
        "request_id": s.request_id,
        "name": s.name,
        "source_path": s.source_path,
        "script_type": s.script_type,
        "raw_code": s.raw_code,
        "received_at": s.received_at,
    }


@router.post("/collect", status_code=201)
def collect(body: CollectIn, db: Session = Depends(get_db)):
    if len(body.raw_code.encode("utf-8")) > MAX_RAW_BYTES:
        raise error(413, "raw_code_too_large", "코드 원문이 256KiB를 넘습니다")

    material = db.scalars(select(Material).where(Material.source_uid == body.source_uid)).first()
    if material is None:
        material = Material(project_id=FIXED_PROJECT_ID, source_uid=body.source_uid)
        db.add(material)
        db.flush()  # material_id를 지금 만들어 받기

    snapshot = Snapshot(material_id=material.material_id, **body.model_dump(exclude={"source_uid"}))
    db.add(snapshot)
    db.commit()
    # 같은 request_id 재시도(200)·충돌(409) 처리는 04회차 #16에서 추가
    return {
        "material_id": material.material_id,
        "snapshot_id": snapshot.snapshot_id,
        "deduplicated": False,
    }


@router.get("")
def list_materials(db: Session = Depends(get_db)):
    items = []
    for m in db.scalars(select(Material)):
        s = latest_snapshot(db, m.material_id)
        if s is None:
            continue
        items.append(
            {
                "material_id": m.material_id,
                "source_uid": m.source_uid,
                "name": s.name,
                "source_path": s.source_path,
                "script_type": s.script_type,
                "received_at": s.received_at,
            }
        )
    return {"items": items}


@router.get("/{material_id}")
def get_material(material_id: str, db: Session = Depends(get_db)):
    m = db.get(Material, material_id)
    s = latest_snapshot(db, material_id) if m else None
    if m is None or s is None:
        raise error(404, "material_not_found", "그 자료를 찾을 수 없습니다")
    return {
        "material_id": m.material_id,
        "source_uid": m.source_uid,
        "current_snapshot": snapshot_json(s),
    }
