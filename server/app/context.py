"""A 담당: Studio에서 고른 스크립트의 문맥(자료·연결된 기능·현재 결정) 조회 (04회차 #13).

판별 기준은 source_uid 하나다. 이름·경로는 표시 정보일 뿐 대상을 찾는 데 쓰지 않는다.

응답 모양 (C·D와 맞출 기준):
- 아직 받은 적 없는 source_uid: 200, material null, features []
- 받았지만 연결된 기능 없음: 200, material 있음, features []
- 여러 기능에 연결: 200, 연결한 순서대로 모두 (하나를 숨기지 않음)
- 기능마다 current_decision: 결정 기록이 생기기 전(05회차 C)까지는 null
- 서버 실패는 200이 아닌 오류 응답이라 위의 "없음"과 구분된다.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.features import Feature, FeatureMaterial, check_project, current_decision_of, error_detail
from app.materials import Material, latest_snapshot


class DecisionOut(BaseModel):
    body: str
    author_display_name: str
    created_at: str


class ContextMaterialOut(BaseModel):
    material_id: str
    name: str
    source_path: str
    script_type: str
    received_at: str


class ContextFeatureOut(BaseModel):
    feature_id: str
    title: str
    status: str
    assignee: str | None
    current_decision: DecisionOut | None


class ContextOut(BaseModel):
    source_uid: str
    material: ContextMaterialOut | None
    features: list[ContextFeatureOut]


router = APIRouter(prefix="/api/projects/{project_id}/context", tags=["context"])


@router.get("", response_model=ContextOut)
def get_context(
    source_uid: str = Query(...),
    project_id: str = Depends(check_project),
    db: Session = Depends(get_db),
) -> dict:
    source_uid = source_uid.strip()
    if source_uid == "":
        raise HTTPException(
            status_code=422,
            detail=error_detail("source_uid_required", "source_uid를 입력하세요."),
        )

    material = db.scalars(
        select(Material).where(
            Material.project_id == project_id, Material.source_uid == source_uid
        )
    ).first()
    snapshot = latest_snapshot(db, material.material_id) if material else None
    if material is None or snapshot is None:
        return {"source_uid": source_uid, "material": None, "features": []}

    rows = db.execute(
        select(Feature)
        .join(FeatureMaterial, FeatureMaterial.feature_id == Feature.feature_id)
        .where(
            FeatureMaterial.material_id == material.material_id,
            FeatureMaterial.project_id == project_id,
        )
        .order_by(FeatureMaterial.linked_at, Feature.feature_id)
    ).scalars()

    return {
        "source_uid": source_uid,
        "material": {
            "material_id": material.material_id,
            "name": snapshot.name,
            "source_path": snapshot.source_path,
            "script_type": snapshot.script_type,
            "received_at": snapshot.received_at,
        },
        "features": [
            {
                "feature_id": f.feature_id,
                "title": f.title,
                "status": f.status,
                "assignee": f.assignee,
                "current_decision": current_decision_of(db, f.feature_id),
            }
            for f in rows
        ],
    }
