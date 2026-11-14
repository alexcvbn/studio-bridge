import os
from pathlib import Path

from sqlalchemy import String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
# 기본은 server/studio_bridge.db. 검사할 때는 STUDIO_BRIDGE_DB로 임시 DB 파일을 지정해 실제 DB를 건드리지 않는다.
DATABASE_PATH = Path(os.environ.get("STUDIO_BRIDGE_DB") or BASE_DIR / "studio_bridge.db")
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


def init_db() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        if session.get(Project, FIXED_PROJECT_ID) is None:
            session.add(Project(project_id=FIXED_PROJECT_ID))
            session.commit()


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