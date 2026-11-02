from pathlib import Path

from sqlalchemy import String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = BASE_DIR / "studio_bridge.db"
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