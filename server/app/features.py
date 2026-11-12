from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import ForeignKey, String, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.db import FIXED_PROJECT_ID, Base, get_db
from app.materials import Material, latest_snapshot

TITLE_MAX = 100


class Feature(Base):
    __tablename__ = "features"

    feature_id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.project_id"), index=True
    )
    title: Mapped[str] = mapped_column(String(TITLE_MAX))
    status: Mapped[str] = mapped_column(String, default="todo")  # todo / doing / done
    assignee: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String)  # 서버 UTC ISO 8601


class FeatureMaterial(Base):
    """기능과 자료의 연결. (기능, 자료) 쌍이 기본키라서 같은 연결은 하나만 존재한다."""

    __tablename__ = "feature_materials"

    feature_id: Mapped[str] = mapped_column(
        ForeignKey("features.feature_id"), primary_key=True
    )
    material_id: Mapped[str] = mapped_column(
        ForeignKey("materials.material_id"), primary_key=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.project_id"), index=True
    )
    linked_at: Mapped[str] = mapped_column(String)  # 서버 UTC ISO 8601


class FeatureCreate(BaseModel):
    title: str


class FeatureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    feature_id: str
    project_id: str
    title: str
    status: str
    assignee: str | None
    created_at: str


class FeatureList(BaseModel):
    items: list[FeatureOut]


class MaterialLinkOut(BaseModel):
    feature_id: str
    material_id: str
    already_linked: bool


class LinkedMaterialOut(BaseModel):
    material_id: str
    source_uid: str
    name: str
    source_path: str
    script_type: str
    received_at: str
    linked_at: str


class LinkedMaterialList(BaseModel):
    items: list[LinkedMaterialOut]


def error_detail(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def check_project(project_id: str) -> str:
    if project_id != FIXED_PROJECT_ID:
        raise HTTPException(
            status_code=403,
            detail=error_detail("project_forbidden", "허용되지 않은 프로젝트입니다."),
        )
    return project_id


def require_feature(db: Session, project_id: str, feature_id: str) -> Feature:
    feature = db.scalars(
        select(Feature).where(
            Feature.feature_id == feature_id, Feature.project_id == project_id
        )
    ).first()
    if feature is None:
        raise HTTPException(
            status_code=404,
            detail=error_detail("feature_not_found", "기능을 찾을 수 없습니다."),
        )
    return feature


router = APIRouter(
    prefix="/api/projects/{project_id}/features", tags=["features"]
)


@router.post("", response_model=FeatureOut, status_code=201)
def create_feature(
    body: FeatureCreate,
    project_id: str = Depends(check_project),
    db: Session = Depends(get_db),
) -> Feature:
    title = body.title.strip()
    if not 1 <= len(title) <= TITLE_MAX:
        raise HTTPException(
            status_code=422,
            detail=error_detail(
                "title_invalid", f"기능 제목은 1~{TITLE_MAX}자로 입력하세요."
            ),
        )
    feature = Feature(
        feature_id=str(uuid4()),
        project_id=project_id,
        title=title,
        status="todo",
        assignee=None,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(feature)
    db.commit()
    db.refresh(feature)
    return feature


@router.get("", response_model=FeatureList)
def list_features(
    project_id: str = Depends(check_project),
    db: Session = Depends(get_db),
) -> dict[str, list[Feature]]:
    rows = db.scalars(
        select(Feature)
        .where(Feature.project_id == project_id)
        .order_by(Feature.created_at, Feature.feature_id)
    ).all()
    return {"items": list(rows)}


@router.get("/{feature_id}", response_model=FeatureOut)
def get_feature(
    feature_id: str,
    project_id: str = Depends(check_project),
    db: Session = Depends(get_db),
) -> Feature:
    return require_feature(db, project_id, feature_id)


@router.put("/{feature_id}/materials/{material_id}", response_model=MaterialLinkOut)
def link_material(
    feature_id: str,
    material_id: str,
    project_id: str = Depends(check_project),
    db: Session = Depends(get_db),
) -> dict[str, str | bool]:
    """자료를 기능에 연결한다. 같은 연결을 다시 요청해도 200이고 중복 생성하지 않는다."""
    require_feature(db, project_id, feature_id)
    material = db.get(Material, material_id)
    if material is None or material.project_id != project_id:
        raise HTTPException(
            status_code=404,
            detail=error_detail("material_not_found", "그 자료를 찾을 수 없습니다."),
        )
    result = {"feature_id": feature_id, "material_id": material_id}
    if db.get(FeatureMaterial, (feature_id, material_id)) is not None:
        return {**result, "already_linked": True}
    db.add(
        FeatureMaterial(
            feature_id=feature_id,
            material_id=material_id,
            project_id=project_id,
            linked_at=datetime.now(timezone.utc).isoformat(),
        )
    )
    try:
        db.commit()
    except IntegrityError:  # 동시에 같은 요청이 먼저 저장된 경우
        db.rollback()
        return {**result, "already_linked": True}
    return {**result, "already_linked": False}


@router.get("/{feature_id}/materials", response_model=LinkedMaterialList)
def list_linked_materials(
    feature_id: str,
    project_id: str = Depends(check_project),
    db: Session = Depends(get_db),
) -> dict[str, list[dict[str, str]]]:
    require_feature(db, project_id, feature_id)
    links = db.scalars(
        select(FeatureMaterial)
        .where(
            FeatureMaterial.feature_id == feature_id,
            FeatureMaterial.project_id == project_id,
        )
        .order_by(FeatureMaterial.linked_at, FeatureMaterial.material_id)
    ).all()
    items = []
    for link in links:
        material = db.get(Material, link.material_id)
        if material is None:
            continue
        snap = latest_snapshot(db, link.material_id)
        items.append(
            {
                "material_id": material.material_id,
                "source_uid": material.source_uid,
                "name": snap.name if snap else material.source_uid,
                "source_path": snap.source_path if snap else "",
                "script_type": snap.script_type if snap else "",
                "received_at": snap.received_at if snap else "",
                "linked_at": link.linked_at,
            }
        )
    return {"items": items}
