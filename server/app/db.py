import os
from pathlib import Path

from sqlalchemy import String, create_engine, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
# 기본은 server/studio_bridge.db. 검사할 때는 STUDIO_BRIDGE_DB로 임시 DB 파일을 지정해 실제 DB를 건드리지 않는다.
# 상대 경로는 서버를 띄운 폴더 기준이라 재시작 때 다른 폴더에서 띄우면 다른(빈) DB가 된다.
# 그래서 절대 경로로 바꿔 두고, 서버 시작 기록에 이 경로를 남긴다. (08회차 #29)
DATABASE_PATH = Path(os.environ.get("STUDIO_BRIDGE_DB") or BASE_DIR / "studio_bridge.db").expanduser().resolve()
FIXED_PROJECT_ID = "studio-bridge"

engine = create_engine(
    f"sqlite:///{DATABASE_PATH}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    project_id: Mapped[str] = mapped_column(String, primary_key=True)


def init_db() -> bool:
    """표를 만들고 고정 프로젝트를 넣는다. DB 파일을 이번에 새로 만들었으면 True를 돌려준다."""
    created = not DATABASE_PATH.exists()
    if created and not DATABASE_PATH.parent.is_dir():
        raise RuntimeError(f"DB를 둘 폴더가 없습니다: {DATABASE_PATH.parent} (STUDIO_BRIDGE_DB 확인)")
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        if session.get(Project, FIXED_PROJECT_ID) is None:
            session.add(Project(project_id=FIXED_PROJECT_ID))
            session.commit()
    return created


def table_counts() -> dict[str, int]:
    """표별 행 수. 재시작 뒤 같은 DB를 읽었는지 서버 시작 기록에서 바로 보려고 쓴다. (08회차 #29)"""
    with engine.connect() as conn:
        return {
            table.name: conn.execute(select(func.count()).select_from(table)).scalar_one()
            for table in Base.metadata.sorted_tables
        }


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def read_fixed_project() -> str | None:
    with SessionLocal() as session:
        project = session.get(Project, FIXED_PROJECT_ID)
        if project is None:
            return None
        return project.project_id