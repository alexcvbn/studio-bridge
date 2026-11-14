"""D 담당: 받은 자료(material)와 수집본(snapshot) 저장·조회 API (02회차 #8, 04회차 #16, 05회차 #20)."""

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import ForeignKey, String, Text, func, select
from sqlalchemy.exc import IntegrityError
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


def count_snapshots(db: Session, material_id: str) -> int:
    """이 자료에 쌓인 수집본 수. 다시 보내면 늘어나고, 이전 원문은 지워지지 않는다."""
    query = select(func.count()).select_from(Snapshot).where(Snapshot.material_id == material_id)
    return db.scalar(query) or 0


def find_by_source_uid(
    db: Session, project_id: str, source_uid: str
) -> tuple[Material, Snapshot] | None:
    """project_id + source_uid로 자료와 가장 최근 수집본을 찾는다. (05회차 #20)

    - 이름·경로가 아니라 source_uid로만 찾는다. 이름이 같아도 UID가 다르면 다른 자료다.
    - 다른 프로젝트의 자료는 섞지 않는다.
    - 받은 적 없는 UID면 None.
    """
    material = db.scalars(
        select(Material).where(
            Material.project_id == project_id, Material.source_uid == source_uid
        )
    ).first()
    if material is None:
        return None
    snapshot = latest_snapshot(db, material.material_id)
    if snapshot is None:
        return None
    return material, snapshot


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


def find_retry(db: Session, body: CollectIn) -> dict | None:
    """같은 request_id로 이미 저장된 수집본이 있으면 그 결과를 돌려준다. (04회차 #16)

    - 처음 보는 request_id면 None (새로 저장하면 됨)
    - 같은 request_id + 같은 내용이면 이전 결과 그대로 (deduplicated: True)
    - 같은 request_id + 다른 내용이면 409 오류 (이전 자료는 그대로 둔다)
    """
    old = db.scalars(
        select(Snapshot).where(Snapshot.request_id == body.request_id)
    ).first()
    if old is None:
        return None

    old_material = db.get(Material, old.material_id)
    same = (
        old_material.source_uid == body.source_uid
        and old.name == body.name
        and old.source_path == body.source_path
        and old.script_type == body.script_type
        and old.raw_code == body.raw_code
    )
    if not same:
        raise error(
            409,
            "request_id_conflict",
            "같은 요청 ID로 다른 내용이 이미 저장되어 있습니다",
        )
    return {
        "material_id": old.material_id,
        "snapshot_id": old.snapshot_id,
        "deduplicated": True,
    }


def save_new(db: Session, body: CollectIn) -> dict:
    """처음 받은 요청을 저장한다. 같은 source_uid면 기존 자료에 수집본만 추가한다."""
    material = db.scalars(
        select(Material).where(Material.source_uid == body.source_uid)
    ).first()
    if material is None:
        material = Material(project_id=FIXED_PROJECT_ID, source_uid=body.source_uid)
        db.add(material)
        db.flush()  # material_id를 지금 만들어 받기

    snapshot = Snapshot(
        material_id=material.material_id, **body.model_dump(exclude={"source_uid"})
    )
    db.add(snapshot)
    db.commit()
    return {
        "material_id": material.material_id,
        "snapshot_id": snapshot.snapshot_id,
        "deduplicated": False,
    }


@router.post("/collect", status_code=201)
def collect(body: CollectIn, response: Response, db: Session = Depends(get_db)):
    if len(body.raw_code.encode("utf-8")) > MAX_RAW_BYTES:
        raise error(413, "raw_code_too_large", "코드 원문이 256KiB를 넘습니다")

    # 두 번까지 시도한다. 거의 동시에 온 다른 요청이 먼저 저장하면
    # DB 고유 제약(request_id, source_uid) 때문에 첫 저장이 IntegrityError로 막힌다.
    # 그때는 되돌린(rollback) 뒤, 먼저 저장된 내용을 보고 다시 판단한다.
    for attempt in range(2):
        # 1) 이미 받은 요청을 다시 보낸 것이면 이전 결과를 200으로 돌려준다
        retry = find_retry(db, body)
        if retry is not None:
            response.status_code = 200
            return retry
        # 2) 처음 받은 요청이면 저장하고 201
        try:
            return save_new(db, body)
        except IntegrityError:
            db.rollback()
            if attempt == 1:
                raise
    raise RuntimeError("unreachable")


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


def material_json(db: Session, m: Material, s: Snapshot) -> dict:
    return {
        "material_id": m.material_id,
        "source_uid": m.source_uid,
        "snapshot_count": count_snapshots(db, m.material_id),
        "current_snapshot": snapshot_json(s),
    }


# 주의: "/by-source"는 "/{material_id}"보다 먼저 등록해야 한다.
# 뒤에 두면 "by-source"를 material_id로 잘못 읽는다.
@router.get("/by-source")
def get_material_by_source(
    source_uid: str = Query(...), db: Session = Depends(get_db)
):
    """Studio 스크립트의 source_uid로 자료를 찾는다. 없으면 200 + material null. (05회차 #20)"""
    source_uid = source_uid.strip()
    if source_uid == "":
        raise error(422, "source_uid_required", "source_uid를 입력하세요")
    found = find_by_source_uid(db, FIXED_PROJECT_ID, source_uid)
    if found is None:
        return {"source_uid": source_uid, "material": None}
    m, s = found
    return {"source_uid": source_uid, "material": material_json(db, m, s)}


@router.get("/{material_id}")
def get_material(material_id: str, db: Session = Depends(get_db)):
    m = db.get(Material, material_id)
    s = latest_snapshot(db, material_id) if m else None
    if m is None or s is None:
        raise error(404, "material_not_found", "그 자료를 찾을 수 없습니다")
    return material_json(db, m, s)
