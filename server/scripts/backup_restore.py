"""08회차 #32 (D): 자료·결정(SQLite)과 보드(Yjs)를 같은 시점에 백업하고, 시험 폴더에 복원해 대조한다.

server 폴더에서 실행한다. 절차와 확인표는 server/BACKUP.md에 있다.

    uv run python scripts/backup_restore.py backup                 # API 서버·동기화 서버를 끈 뒤
    uv run python scripts/backup_restore.py restore <백업 폴더> --to <새 시험 폴더>
    uv run python scripts/backup_restore.py verify <백업 폴더> --restored <시험 폴더>
    uv run python scripts/backup_restore.py verify-api <백업 폴더> --api http://127.0.0.1:8001

- 두 저장소를 '같은 시점'으로 맞추려고, API(8000)나 동기화 서버(1234)가 켜져 있으면 백업하지 않는다.
- 복원은 새(또는 빈) 폴더에만 한다. 실제 DB·보드 폴더를 덮어쓰거나 지우지 않는다.
- 백업 폴더에는 manifest.json(파일 SHA-256과 기준값)이 함께 저장되어, 복원 뒤 같은 값인지 대조한다.
표준 라이브러리만 사용한다. 보드는 sync/board-dump.cjs(Node)로 읽는다.
"""

import argparse
import hashlib
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SERVER_DIR.parent
DEFAULT_DB = SERVER_DIR / "studio_bridge.db"
DEFAULT_BOARD = REPO_DIR / "sync" / "data"
DEFAULT_OUT = REPO_DIR.parent / "studio-bridge-backups"  # 저장소 밖: 실수로 커밋되지 않게
BOARD_DUMP = REPO_DIR / "sync" / "board-dump.cjs"
DB_FILE = "studio_bridge.db"
BOARD_DIR = "board"
PROJECT = "studio-bridge"


def fail(message: str) -> None:
    print(f"중단: {message}", file=sys.stderr)
    sys.exit(1)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def text_hash(text: str | None) -> str | None:
    return None if text is None else sha256_bytes(text.encode("utf-8"))


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


# ---------- 기준값: 같은 값이 복원 뒤에도 나와야 한다 ----------
def db_values(db: Path) -> dict:
    """원문·현재/이전 수집본·기능·연결·결정을 비교하기 쉬운 모양으로 읽는다. 원문은 SHA-256으로 비교한다."""
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        def q(sql: str, *args):
            return con.execute(sql, args).fetchall()

        counts = {t: q(f"SELECT count(*) FROM {t}")[0][0]
                  for t in ("projects", "materials", "snapshots", "features", "feature_materials", "decisions")}
        materials = {}
        for material_id, source_uid in q("SELECT material_id, source_uid FROM materials ORDER BY material_id"):
            # 서버와 같은 순서: 받은 시각 최신 → 같으면 나중에 들어간 것 (07회차 #28)
            snaps = q(
                "SELECT snapshot_id, request_id, name, source_path, script_type, raw_code, received_at "
                "FROM snapshots WHERE material_id = ? ORDER BY received_at DESC, rowid DESC",
                material_id,
            )
            materials[material_id] = {
                "source_uid": source_uid,
                "current_snapshot_id": snaps[0][0] if snaps else None,
                "snapshots": [
                    {"snapshot_id": s[0], "request_id": s[1], "name": s[2], "source_path": s[3],
                     "script_type": s[4], "raw_sha256": text_hash(s[5]), "raw_chars": len(s[5]),
                     "received_at": s[6]}
                    for s in snaps
                ],
            }
        features = {
            fid: {"title": title, "status": status, "assignee": assignee}
            for fid, title, status, assignee in q(
                "SELECT feature_id, title, status, assignee FROM features ORDER BY feature_id")
        }
        links = sorted(f"{f}->{m}" for f, m in q("SELECT feature_id, material_id FROM feature_materials"))
        decisions: dict[str, list] = {}
        for fid, no, body, author, created in q(
            "SELECT feature_id, decision_no, body, author_display_name, created_at FROM decisions "
            "ORDER BY feature_id, decision_no"
        ):
            decisions.setdefault(fid, []).append(
                {"decision_no": no, "body_sha256": text_hash(body), "author_display_name": author, "created_at": created})
        return {"counts": counts, "materials": materials, "features": features, "links": links,
                "decisions": decisions}
    finally:
        con.close()


def board_values(board: Path) -> dict:
    if not shutil.which("node"):
        fail("node를 찾지 못했습니다. 보드(Yjs)를 읽으려면 Node.js가 필요합니다.")
    if not (REPO_DIR / "sync" / "node_modules" / "y-leveldb").exists():
        fail("sync/node_modules에 y-leveldb가 없습니다. sync 폴더에서 `npm ci`를 먼저 실행하세요.")
    res = subprocess.run(["node", str(BOARD_DUMP), str(board)], capture_output=True, text=True,
                         cwd=REPO_DIR / "sync")
    if res.returncode != 0:
        fail(f"보드를 읽지 못했습니다: {res.stderr.strip()}")
    return json.loads(res.stdout)


def card_refs(db: dict, board: dict) -> dict:
    """보드 카드가 가리키는 자료·기능이 DB에 실제로 있는지."""
    broken = []
    for c in board["cards"]:
        pool = db["materials"] if c["kind"] == "material" else db["features"]
        if c["target_id"] not in pool:
            broken.append(c["card_id"])
    return {"cards": len(board["cards"]), "broken_card_ids": broken}


def all_values(db: Path, board: Path) -> dict:
    d = db_values(db)
    b = board_values(board)
    return {"db": d, "board": b, "card_refs": card_refs(d, b)}


def file_hashes(root: Path) -> dict:
    files = {DB_FILE: sha256_file(root / DB_FILE)}
    for p in sorted((root / BOARD_DIR).rglob("*")):
        if p.is_file() and p.name != "LOCK":  # LOCK은 LevelDB 실행 잠금 표시라 내용 비교 대상이 아니다
            files[f"{BOARD_DIR}/{p.relative_to(root / BOARD_DIR).as_posix()}"] = sha256_file(p)
    return files


# ---------- 백업 ----------
def cmd_backup(a) -> None:
    db, board = Path(a.db).resolve(), Path(a.board).resolve()
    running = [f"{name}({port})" for name, port in (("API 서버", a.api_port), ("동기화 서버", a.sync_port))
               if port_open(port)]
    if running:
        fail(f"{', '.join(running)}가 켜져 있습니다. 두 저장소를 같은 시점으로 맞추려면 둘 다 끈 뒤 백업하세요.")
    if not db.is_file():
        fail(f"DB 파일이 없습니다: {db}")
    if not (board / "CURRENT").is_file():
        fail(f"보드 저장 폴더가 없습니다: {board}  (DB만 백업하면 전체 백업이 아닙니다)")

    out = Path(a.out).resolve() / datetime.now().strftime("%Y%m%d-%H%M%S")
    if out.exists():
        fail(f"이미 있는 백업 폴더입니다: {out}")
    out.mkdir(parents=True)

    # SQLite는 backup API로 일관된 사본을 만든다. 보드(LevelDB)는 폴더째 복사한다.
    src = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    dst = sqlite3.connect(out / DB_FILE)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()
    shutil.copytree(board, out / BOARD_DIR, ignore=shutil.ignore_patterns("LOCK"))

    before = all_values(db, board)
    saved = all_values(out / DB_FILE, out / BOARD_DIR)
    if saved != before:
        shutil.rmtree(out)
        fail("백업 중에 원본이 바뀌었습니다. 서버가 모두 꺼졌는지 확인하고 다시 하세요. (백업 폴더는 지웠습니다)")
    manifest = {
        "format": 1,
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "sources": {"db": str(db), "board": str(board)},
        "files": file_hashes(out),
        "values": saved,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print_summary("백업 완료", out, saved)


def print_summary(title: str, folder: Path, v: dict) -> None:
    c = v["db"]["counts"]
    b = v["board"]
    print(f"{title}: {folder}")
    print(f"  자료 {c['materials']}개 · 수집본 {c['snapshots']}개 · 기능 {c['features']}개 · "
          f"연결 {c['feature_materials']}개 · 결정 {c['decisions']}개")
    print(f"  보드 카드 {len(b['cards'])}장 · 제거 기록 {len(b['removed_card_ids'])}개 · 메모 {len(b['memo'])}자 · "
          f"끊어진 카드 참조 {len(v['card_refs']['broken_card_ids'])}개")


# ---------- 복원 ----------
def load_manifest(backup: Path) -> dict:
    m = backup / "manifest.json"
    if not m.is_file():
        fail(f"manifest.json이 없습니다. backup 명령으로 만든 폴더인지 확인하세요: {backup}")
    return json.loads(m.read_text(encoding="utf-8"))


def cmd_restore(a) -> None:
    backup, target = Path(a.backup).resolve(), Path(a.to).resolve()
    manifest = load_manifest(backup)
    if target.exists() and any(target.iterdir()):
        fail(f"복원할 폴더가 비어 있지 않습니다: {target}  (기존 데이터를 덮어쓰지 않도록 새 폴더를 지정하세요)")
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(backup / DB_FILE, target / DB_FILE)
    shutil.copytree(backup / BOARD_DIR, target / BOARD_DIR)
    if file_hashes(target) != manifest["files"]:
        fail("복원한 파일이 백업과 다릅니다 (SHA-256 불일치). 백업 폴더가 손상됐을 수 있습니다.")
    print(f"복원 완료: {target}  (파일 {len(manifest['files'])}개 SHA-256 일치)")
    print("\n이 시험 복사본으로 실행하려면 (실제 데이터와 다른 포트):")
    print(f"  server> STUDIO_BRIDGE_DB='{target / DB_FILE}' uv run uvicorn app.main:app --port 8001")
    print(f"  sync>   YPERSISTENCE='{target / BOARD_DIR}' PORT=1235 npm start")
    print("  web>    STUDIO_BRIDGE_API_TARGET=http://127.0.0.1:8001 VITE_SYNC_URL=ws://127.0.0.1:1235 npm run dev")
    print(f"\n값 대조:  uv run python scripts/backup_restore.py verify '{backup}' --restored '{target}'")


# ---------- 대조 ----------
class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[bool, str]] = []

    def check(self, name: str, ok: bool, detail: object = "") -> None:
        self.rows.append((ok, name))
        print(f"[{'통과' if ok else '실패'}] {name}" + (f"  -> {detail}" if not ok and detail != "" else ""))

    def finish(self) -> None:
        passed = sum(ok for ok, _ in self.rows)
        print(f"\n{passed}/{len(self.rows)} 통과")
        sys.exit(0 if passed == len(self.rows) else 1)


def diff_keys(a: dict, b: dict) -> list:
    return sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))


def compare_values(r: Report, want: dict, got: dict) -> None:
    wd, gd = want["db"], got["db"]
    r.check("표별 행 수 (자료·수집본·기능·연결·결정)", wd["counts"] == gd["counts"], (wd["counts"], gd["counts"]))
    r.check("자료 ID와 source_uid", {k: v["source_uid"] for k, v in wd["materials"].items()}
            == {k: v["source_uid"] for k, v in gd["materials"].items()})
    r.check("현재 수집본 (자료마다 같은 snapshot_id)",
            {k: v["current_snapshot_id"] for k, v in wd["materials"].items()}
            == {k: v["current_snapshot_id"] for k, v in gd["materials"].items()})
    r.check("이전 수집본까지 원문 SHA-256·순서·이름·경로", diff_keys(wd["materials"], gd["materials"]) == [],
            diff_keys(wd["materials"], gd["materials"]))
    r.check("기능 (제목·상태·담당자)", wd["features"] == gd["features"], diff_keys(wd["features"], gd["features"]))
    r.check("자료–기능 연결", wd["links"] == gd["links"])
    r.check("결정 (번호·본문 SHA-256·표시명·시각)", wd["decisions"] == gd["decisions"],
            diff_keys(wd["decisions"], gd["decisions"]))
    wb, gb = want["board"], got["board"]
    r.check("보드 카드 (ID·종류·대상·위치)", wb["cards"] == gb["cards"])
    r.check("보드 제거 기록", wb["removed_card_ids"] == gb["removed_card_ids"])
    r.check("공동 메모 (글자 그대로)", wb["memo"] == gb["memo"])
    r.check("카드 참조: 모든 카드의 자료·기능이 DB에 있음",
            got["card_refs"]["broken_card_ids"] == [], got["card_refs"]["broken_card_ids"])


def cmd_verify(a) -> None:
    backup, restored = Path(a.backup).resolve(), Path(a.restored).resolve()
    manifest = load_manifest(backup)
    r = Report()
    hashes = file_hashes(restored)
    r.check(f"파일 SHA-256 ({len(manifest['files'])}개)", hashes == manifest["files"],
            diff_keys(manifest["files"], hashes))
    compare_values(r, manifest["values"], all_values(restored / DB_FILE, restored / BOARD_DIR))
    r.finish()


# ---------- 복원본으로 다시 띄운 API 대조 ----------
def api_get(base: str, path: str, key: str | None) -> tuple[int, object]:
    req = urllib.request.Request(f"{base}/api/projects/{PROJECT}{path}")
    if key:
        req.add_header("X-StudioBridge-Key", key)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as err:
        return err.code, None
    except OSError as err:
        fail(f"API에 연결하지 못했습니다 ({base}): {err}")


def cmd_verify_api(a) -> None:
    want = load_manifest(Path(a.backup).resolve())["values"]["db"]
    base, key = a.api.rstrip("/"), a.key or os.environ.get("STUDIO_BRIDGE_TEAM_KEY")
    r = Report()
    status, listing = api_get(base, "/materials", key)
    r.check("자료 목록 200, 같은 자료 ID", status == 200
            and sorted(m["material_id"] for m in listing["items"]) == sorted(want["materials"]), status)
    bad = []
    for mid, m in want["materials"].items():
        status, body = api_get(base, f"/materials/{mid}/snapshots", key)
        got = [(s["snapshot_id"], text_hash(s["raw_code"]), s["is_current"]) for s in (body or {}).get("items", [])]
        exp = [(s["snapshot_id"], s["raw_sha256"], i == 0) for i, s in enumerate(m["snapshots"])]
        if status != 200 or got != exp:
            bad.append(mid)
    r.check("자료마다 현재·이전 수집본 원문과 현재 표시", bad == [], bad)
    status, flist = api_get(base, "/features", key)
    got_f = {f["feature_id"]: {"title": f["title"], "status": f["status"], "assignee": f["assignee"]}
             for f in (flist or {}).get("items", [])}
    r.check("기능 목록 (제목·상태·담당자)", status == 200 and got_f == want["features"], diff_keys(want["features"], got_f))
    links, dec_bad = [], []
    for fid in want["features"]:
        _, lm = api_get(base, f"/features/{fid}/materials", key)
        links += [f"{fid}->{m['material_id']}" for m in (lm or {}).get("items", [])]
        _, dl = api_get(base, f"/features/{fid}/decisions", key)
        got_d = sorted((d["decision_no"], text_hash(d["body"]), d["author_display_name"]) for d in (dl or {}).get("items", []))
        exp_d = sorted((d["decision_no"], d["body_sha256"], d["author_display_name"]) for d in want["decisions"].get(fid, []))
        if got_d != exp_d:
            dec_bad.append(fid)
    r.check("자료–기능 연결", sorted(links) == want["links"])
    r.check("기능마다 결정 기록", dec_bad == [], dec_bad)
    r.finish()


def main() -> None:
    p = argparse.ArgumentParser(description="자료·결정(SQLite)과 보드(Yjs)를 같은 시점에 백업·복원·대조한다.")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("backup", help="두 저장소를 같은 시점에 백업 (서버를 끈 뒤)")
    b.add_argument("--db", default=str(DEFAULT_DB))
    b.add_argument("--board", default=str(DEFAULT_BOARD), help="보드 저장 폴더 (YPERSISTENCE)")
    b.add_argument("--out", default=str(DEFAULT_OUT))
    b.add_argument("--api-port", type=int, default=8000)
    b.add_argument("--sync-port", type=int, default=1234)
    r = sub.add_parser("restore", help="백업을 새 시험 폴더에 복원")
    r.add_argument("backup")
    r.add_argument("--to", required=True)
    v = sub.add_parser("verify", help="복원한 파일의 값이 백업 때와 같은지 대조")
    v.add_argument("backup")
    v.add_argument("--restored", required=True)
    va = sub.add_parser("verify-api", help="복원본으로 띄운 API가 백업 때 값을 돌려주는지 대조")
    va.add_argument("backup")
    va.add_argument("--api", required=True)
    va.add_argument("--key", help="공유 모드 팀 키 (없으면 STUDIO_BRIDGE_TEAM_KEY 환경변수)")
    a = p.parse_args()
    {"backup": cmd_backup, "restore": cmd_restore, "verify": cmd_verify, "verify-api": cmd_verify_api}[a.cmd](a)


if __name__ == "__main__":
    main()
