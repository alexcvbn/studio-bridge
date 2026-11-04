from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import ForeignKey, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.db import FIXED_PROJECT_ID, Base, get_db

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


def error_detail(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def check_project(project_id: str) -> str:
    if project_id != FIXED_PROJECT_ID:
        raise HTTPException(
            status_code=403,
            detail=error_detail("project_forbidden", "허용되지 않은 프로젝트입니다."),
        )
    return project_id


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
