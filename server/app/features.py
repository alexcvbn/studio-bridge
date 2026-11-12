from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.db import FIXED_PROJECT_ID, Base, get_db
from app.materials import Material, latest_snapshot

TITLE_MAX = 100
BODY_MAX = 2000
AUTHOR_MAX = 30


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


class Decision(Base):
    """기능에 대한 팀의 결정. 덮어쓰지 않고 새 기록만 추가하며, 가장 큰 decision_no가 현재 결정이다."""

    __tablename__ = "decisions"
    __table_args__ = (UniqueConstraint("feature_id", "decision_no"),)

    decision_id: Mapped[str] = mapped_column(String, primary_key=True)
    feature_id: Mapped[str] = mapped_column(
        ForeignKey("features.feature_id"), index=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.project_id"), index=True
    )
    body: Mapped[str] = mapped_column(Text)
    # 사용자가 직접 입력한 표시명이다. 로그인한 사용자의 신원이 아니다.
    author_display_name: Mapped[str] = mapped_column(String(AUTHOR_MAX))
    created_at: Mapped[str] = mapped_column(String)  # 서버 UTC ISO 8601
    decision_no: Mapped[int] = mapped_column(Integer)


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


class DecisionCreate(BaseModel):
    body: str
    author_display_name: str


class DecisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    decision_id: str
    feature_id: str
    body: str
    author_display_name: str
    created_at: str
    decision_no: int


class DecisionList(BaseModel):
    current: DecisionOut | None
    items: list[DecisionOut]  # decision_no 내림차순 (첫 항목이 현재 결정)


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


def current_decision_of(db: Session, feature_id: str) -> dict[str, str | int] | None:
    """기능의 현재 결정(가장 큰 decision_no)을 문맥 조회 응답 모양으로 돌려준다. 없으면 None."""
    decision = db.scalars(
        select(Decision)
        .where(Decision.feature_id == feature_id)
        .order_by(Decision.decision_no.desc())
    ).first()
    if decision is None:
        return None
    return {
        "decision_no": decision.decision_no,
        "body": decision.body,
        "author_display_name": decision.author_display_name,
        "created_at": decision.created_at,
    }


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


@router.post("/{feature_id}/decisions", response_model=DecisionOut, status_code=201)
def create_decision(
    feature_id: str,
    body: DecisionCreate,
    project_id: str = Depends(check_project),
    db: Session = Depends(get_db),
) -> Decision:
    """결정을 새로 기록한다. 이전 결정은 그대로 남고, 시각과 decision_no는 서버가 정한다."""
    require_feature(db, project_id, feature_id)
    text = body.body.strip()
    author = body.author_display_name.strip()
    if not 1 <= len(text) <= BODY_MAX:
        raise HTTPException(
            status_code=422,
            detail=error_detail(
                "body_invalid", f"결정 내용은 1~{BODY_MAX}자로 입력하세요."
            ),
        )
    if not 1 <= len(author) <= AUTHOR_MAX:
        raise HTTPException(
            status_code=422,
            detail=error_detail(
                "author_invalid", f"작성자 표시명은 1~{AUTHOR_MAX}자로 입력하세요."
            ),
        )
    for _ in range(3):  # 같은 기능에 동시에 저장되면 decision_no가 겹칠 수 있어 다시 시도한다
        last_no = db.scalar(
            select(func.max(Decision.decision_no)).where(
                Decision.feature_id == feature_id
            )
        )
        decision = Decision(
            decision_id=str(uuid4()),
            feature_id=feature_id,
            project_id=project_id,
            body=text,
            author_display_name=author,
            created_at=datetime.now(timezone.utc).isoformat(),
            decision_no=(last_no or 0) + 1,
        )
        db.add(decision)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        db.refresh(decision)
        return decision
    raise HTTPException(
        status_code=409,
        detail=error_detail("decision_conflict", "다른 저장과 겹쳤습니다. 다시 시도하세요."),
    )


@router.get("/{feature_id}/decisions", response_model=DecisionList)
def list_decisions(
    feature_id: str,
    project_id: str = Depends(check_project),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    require_feature(db, project_id, feature_id)
    items = list(
        db.scalars(
            select(Decision)
            .where(Decision.feature_id == feature_id)
            .order_by(Decision.decision_no.desc())
        ).all()
    )
    return {"current": items[0] if items else None, "items": items}
