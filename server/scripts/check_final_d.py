"""09회차 #36 (D) 판정: 자료 수신·원문·이전 수집본·중복 방지·백업 복원 필수 동작을 한 번에 끝까지 확인한다.

새 기능을 만들지 않고, 09회차까지 만든 코드 그대로 D의 전체 시나리오를 실제 서버로 돌린다. (server 폴더에서)

    uv run python scripts/check_final_d.py            # 끝나면 임시 폴더를 지운다
    uv run python scripts/check_final_d.py --keep     # 임시 폴더(DB·보드·백업·복원본·기록)를 남긴다

이 스크립트가 임시 DB·임시 보드 폴더로 API 서버와 동기화 서버를 빈 포트(127.0.0.1)에 직접 띄우고 끈다.
실제 DB(server/studio_bridge.db)와 실제 보드(sync/data)는 쓰지 않는다. 필요한 것: uv, Node.js, sync에서 `npm ci`.

순서
1. 원문 보내기 (한글·탭·CRLF·줄 끝 공백·빈 줄·이모지) → 201
2. 같은 요청 재시도: 차례로 3번 + 동시에 5번 → 모두 200 중복, 같은 ID, 수집본 1개
3. 코드를 바꿔 새 request_id로 보내기 → 201, 같은 자료·새 수집본
4. 현재/이전 원문을 바이트 단위로 비교 (자료 상세·수집본 기록·source_uid 조회)
5. 기능 만들고 연결·결정 기록, 보드에 자료·기능 카드와 메모를 실제 WebSocket으로 기록
6. 두 서버를 끄고 backup_restore.py로 백업 → 새 폴더에 복원 → verify (#32)
7. 원본과 복원본 서버를 함께 띄워 verify-api (#32), check_restore_features.py compare (#31)
8. 복원본 서버에서 현재/이전 원문을 다시 바이트 단위로 비교
표준 라이브러리만 사용한다. 보드 기록·읽기는 sync/node_modules의 yjs·y-websocket을 쓴다.
"""

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
SYNC_DIR = SERVER_DIR.parent / "sync"
SCRIPTS = SERVER_DIR / "scripts"
PROJECT = "studio-bridge"
ROOM = "studio-bridge/main"

results: list[tuple[bool, str]] = []


def check(name: str, ok: bool, detail: object = "") -> bool:
    results.append((ok, name))
    print(f"[{'통과' if ok else '실패'}] {name}" + (f"  -> {detail}" if not ok and detail != "" else ""), flush=True)
    return ok


def step(title: str) -> None:
    print(f"\n== {title}", flush=True)


def call(base: str, method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{base}{path}", data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, json.loads(res.read() or b"null")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"null")
    except OSError:
        return 0, None


def api(base: str, method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    return call(base, method, f"/api/projects/{PROJECT}{path}", body)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def clean_env() -> dict:
    # 실제 팀 키·DB 경로가 섞이지 않게 STUDIO_BRIDGE_ 값을 모두 빼고 로컬 모드로 띄운다
    return {k: v for k, v in os.environ.items()
            if not k.startswith("STUDIO_BRIDGE_") and k not in ("YPERSISTENCE", "PORT", "HOST")}


class Proc:
    def __init__(self, name: str, log: Path):
        self.name, self.log, self.proc = name, log, None

    def start(self, args: list[str], cwd: Path, env: dict, ready) -> None:
        with self.log.open("ab") as f:
            self.proc = subprocess.Popen(args, cwd=cwd, env=env, stdout=f, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                break
            if ready():
                return
            time.sleep(0.2)
        self.stop()
        sys.exit(f"{self.name}가 뜨지 않았습니다. 기록: {self.log}")

    def stop(self) -> None:
        if self.proc is None:
            return
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()
        self.proc = None


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.2)
        return s.connect_ex(("127.0.0.1", port)) == 0


def start_api(db: Path, port: int, log: Path) -> Proc:
    env = clean_env()
    env.update(STUDIO_BRIDGE_DB=str(db), STUDIO_BRIDGE_PORT=str(port), STUDIO_BRIDGE_HOST="127.0.0.1",
               PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
    p = Proc(f"API 서버({port})", log)
    p.start([sys.executable, "-m", "app.serve"], SERVER_DIR, env,
            lambda: call(f"http://127.0.0.1:{port}", "GET", "/api/health")[0] == 200)
    return p


def start_sync(board: Path, port: int, log: Path) -> Proc:
    env = clean_env()
    env.update(YPERSISTENCE=str(board), PORT=str(port), HOST="127.0.0.1")
    p = Proc(f"동기화 서버({port})", log)
    p.start(["node", "start.cjs"], SYNC_DIR, env, lambda: port_open(port))
    return p


# 실제 WebSocket으로 보드에 쓰고 읽는 작은 Node 클라이언트 (웹의 boardSync.ts와 같은 문서 구조)
BOARD_CLIENT = r"""
const Y = require('yjs'); const { WebsocketProvider } = require('y-websocket'); const WS = require('ws')
const [url, room, payload] = process.argv.slice(1)
const doc = new Y.Doc(); const p = new WebsocketProvider(url, room, doc, { WebSocketPolyfill: WS })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
p.on('sync', async (ok) => {
  if (!ok) return
  await wait(1500)  // sync/README: 저장된 내용은 연결 직후 잠시 뒤 반영된다
  const cards = doc.getMap('cards'), removed = doc.getMap('removedCardIds'), memo = doc.getText('memo')
  if (payload) {
    const w = JSON.parse(payload)
    doc.transact(() => {
      for (const c of w.cards) cards.set(c.card_id, c)
      for (const id of w.remove) { removed.set(id, true); cards.delete(id) }
      memo.insert(memo.length, w.memo)
    })
    await wait(1500)
  }
  const visible = Object.values(cards.toJSON()).filter((c) => !removed.has(c.card_id))
    .sort((a, b) => a.card_id.localeCompare(b.card_id))
  console.log(JSON.stringify({ cards: visible, removed: Object.keys(removed.toJSON()).sort(), memo: memo.toString() }))
  p.destroy(); process.exit(0)
})
setTimeout(() => { console.error('보드 연결 시간 초과'); process.exit(1) }, 20000)
"""


def board_client(sync_port: int, write: dict | None = None) -> dict | None:
    args = ["node", "-e", BOARD_CLIENT, f"ws://127.0.0.1:{sync_port}", ROOM]
    if write is not None:
        args.append(json.dumps(write, ensure_ascii=False))
    res = subprocess.run(args, cwd=SYNC_DIR, capture_output=True, text=True, timeout=40)
    if res.returncode != 0:
        print(f"   보드 클라이언트 오류: {res.stderr.strip()}")
        return None
    return json.loads(res.stdout)


def run_script(args: list[str], label: str) -> bool:
    """기존 검사·도구 스크립트를 그대로 실행하고 출력도 그대로 보여 준다."""
    print(f"   $ {label}", flush=True)
    res = subprocess.run([sys.executable, *args], cwd=SERVER_DIR, capture_output=True, text=True)
    for line in (res.stdout + res.stderr).strip().splitlines():
        print(f"     {line}")
    return res.returncode == 0


def raw_of(base: str, material_id: str) -> list[tuple[str, bool]]:
    _, body = api(base, "GET", f"/materials/{material_id}/snapshots")
    return [(s["raw_code"], s["is_current"]) for s in (body or {}).get("items", [])]


def same_bytes(a: str, b: str) -> bool:
    return a.encode("utf-8") == b.encode("utf-8")


def run(tmp: Path) -> None:
    db, board = tmp / "live.db", tmp / "live-board"
    logs = tmp / "logs"
    logs.mkdir()
    api_port, sync_port = free_port(), free_port()
    base = f"http://127.0.0.1:{api_port}"
    run_id = uuid.uuid4().hex[:6]
    uid = f"final-boss-{run_id}"
    # 한글·탭·CRLF·줄 끝 공백·빈 줄 여러 개·이모지. 어느 단계에서든 한 바이트라도 바뀌면 실패다.
    code_v1 = "-- 보스 AI 1차 🐗\r\n\tlocal hp = 5000  \r\n\r\n\r\nlocal name = \"멧돼지\"\r\nprint(hp, name)\r\n"
    code_v2 = "-- 보스 AI 2차 (체력 상향)\n\tlocal hp = 6000\t-- 탭 주석\n\nprint(hp)\n"

    def payload(req: str, code: str) -> dict:
        return {"source_uid": uid, "request_id": req, "name": "BossAI", "source_path": "Workspace.Boss.BossAI",
                "script_type": "Script", "raw_code": code}

    api_p = start_api(db, api_port, logs / "api.log")
    sync_p = start_sync(board, sync_port, logs / "sync.log")
    try:
        step("1. 원문 보내기")
        s, first = api(base, "POST", "/materials/collect", payload(f"r1-{run_id}", code_v1))
        check("첫 전송 201, deduplicated false", s == 201 and first["deduplicated"] is False, (s, first))
        mid = first["material_id"]

        step("2. 같은 요청 재시도 (차례로 3번 + 동시에 5번)")
        seq = [api(base, "POST", "/materials/collect", payload(f"r1-{run_id}", code_v1)) for _ in range(3)]
        with ThreadPoolExecutor(5) as ex:
            conc = list(ex.map(lambda _: api(base, "POST", "/materials/collect", payload(f"r1-{run_id}", code_v1)),
                               range(5)))
        allr = seq + conc
        check("재시도 8번 모두 200 중복, 같은 material_id·snapshot_id",
              all(s == 200 and b["deduplicated"] and b["snapshot_id"] == first["snapshot_id"]
                  and b["material_id"] == mid for s, b in allr), [s for s, _ in allr])
        check("재시도 뒤 수집본 1개", len(raw_of(base, mid)) == 1)

        step("3. 코드를 바꿔 새 request_id로 보내기")
        s, second = api(base, "POST", "/materials/collect", payload(f"r2-{run_id}", code_v2))
        check("새 수집 201, 같은 material_id, 새 snapshot_id",
              s == 201 and second["material_id"] == mid and second["snapshot_id"] != first["snapshot_id"],
              (s, second))

        step("4. 현재/이전 원문 바이트 비교")
        hist = raw_of(base, mid)
        check("수집본 기록 2개: 현재=새 코드, 이전=처음 코드 (바이트 단위 일치)",
              len(hist) == 2 and hist[0][1] and not hist[1][1]
              and same_bytes(hist[0][0], code_v2) and same_bytes(hist[1][0], code_v1),
              [(len(r), c) for r, c in hist])
        _, detail = api(base, "GET", f"/materials/{mid}")
        q = urllib.parse.urlencode({"source_uid": uid})
        _, found = api(base, "GET", f"/materials/by-source?{q}")
        check("자료 상세·source_uid 조회의 현재 원문도 새 코드와 바이트 일치",
              same_bytes(detail["current_snapshot"]["raw_code"], code_v2)
              and found["material"]["material_id"] == mid
              and same_bytes(found["material"]["current_snapshot"]["raw_code"], code_v2))

        step("5. 기능 연결·결정, 보드 카드·메모")
        _, feat = api(base, "POST", "/features", {"title": f"보스 2페이즈 {run_id}"})
        fid = feat["feature_id"]
        s1, _ = api(base, "PUT", f"/features/{fid}/materials/{mid}")
        s2, _ = api(base, "POST", f"/features/{fid}/decisions", {"body": "보스 체력 5000", "author_display_name": "황재민"})
        s3, _ = api(base, "POST", f"/features/{fid}/decisions", {"body": "보스 체력 6000", "author_display_name": "이하영"})
        _, ctx = api(base, "GET", f"/context?{q}")
        check("연결·결정 저장, Studio 문맥 조회에 현재 결정 6000",
              (s1, s2, s3) == (200, 201, 201) and ctx["features"][0]["feature_id"] == fid
              and ctx["features"][0]["current_decision"]["body"] == "보스 체력 6000", ctx)
        written = board_client(sync_port, {
            "cards": [
                {"card_id": f"card-m-{run_id}", "kind": "material", "target_id": mid, "position": {"x": 40, "y": 60}},
                {"card_id": f"card-f-{run_id}", "kind": "feature", "target_id": fid, "position": {"x": 320, "y": 60}},
                {"card_id": f"card-x-{run_id}", "kind": "material", "target_id": mid, "position": {"x": 40, "y": 300}},
            ],
            "remove": [f"card-x-{run_id}"],
            "memo": "2페이즈 체력 6000 합의\r\n\t다음: 전환 기준",
        })
        check("보드에 자료·기능 카드 2장(1장 제거)과 메모 기록",
              written is not None and [c["target_id"] for c in written["cards"]] == [fid, mid]
              and written["removed"] == [f"card-x-{run_id}"], written)
    finally:
        api_p.stop()
        sync_p.stop()

    step("6. 백업 → 새 폴더에 복원 → 파일·값 대조 (#32)")
    backups, restored = tmp / "backups", tmp / "restored"
    ok = run_script([str(SCRIPTS / "backup_restore.py"), "backup", "--db", str(db), "--board", str(board),
                     "--out", str(backups), "--api-port", str(api_port), "--sync-port", str(sync_port)],
                    "backup_restore.py backup")
    if not check("백업 성공 (두 서버를 끈 같은 시점)", ok):
        return
    backup = next(backups.iterdir())
    check("새 폴더에 복원 (SHA-256 일치)",
          run_script([str(SCRIPTS / "backup_restore.py"), "restore", str(backup), "--to", str(restored)],
                     "backup_restore.py restore"))
    check("복원본 값 대조 verify 전부 통과 (원문·수집본·연결·결정·카드·메모·카드 참조)",
          run_script([str(SCRIPTS / "backup_restore.py"), "verify", str(backup), "--restored", str(restored)],
                     "backup_restore.py verify"))

    step("7. 원본·복원본 서버를 함께 띄워 대조 (#32 verify-api, #31 compare)")
    before_port, after_port, rsync_port = free_port(), free_port(), free_port()
    before_p = start_api(db, before_port, logs / "api-before.log")
    after_p = start_api(restored / "studio_bridge.db", after_port, logs / "api-after.log")
    rsync_p = start_sync(restored / "board", rsync_port, logs / "sync-after.log")
    after = f"http://127.0.0.1:{after_port}"
    try:
        check("복원본 API가 백업 때 값을 돌려줌 (verify-api)",
              run_script([str(SCRIPTS / "backup_restore.py"), "verify-api", str(backup), "--api", after],
                         "backup_restore.py verify-api"))
        check("기능·연결·현재/이전 결정이 원본과 같음 (check_restore_features compare)",
              run_script([str(SCRIPTS / "check_restore_features.py"), "compare",
                          "--before", f"http://127.0.0.1:{before_port}", "--after", after,
                          "--after-db", str(restored / "studio_bridge.db")],
                         "check_restore_features.py compare"))

        step("8. 복원본에서 원문·보드 다시 확인")
        hist = raw_of(after, mid)
        check("복원본 현재/이전 원문이 처음 보낸 그대로 (바이트 단위)",
              len(hist) == 2 and same_bytes(hist[0][0], code_v2) and same_bytes(hist[1][0], code_v1))
        read = board_client(rsync_port)
        check("복원본 동기화 서버에 실제로 붙어 읽은 보드가 백업 전과 같음", read == written, read)
    finally:
        before_p.stop()
        after_p.stop()
        rsync_p.stop()


def main() -> None:
    p = argparse.ArgumentParser(description="09회차 #36 D 필수 동작 판정")
    p.add_argument("--keep", action="store_true", help="임시 폴더를 지우지 않고 남긴다")
    a = p.parse_args()
    for need, hint in (("node", "Node.js"),):
        if not shutil.which(need):
            sys.exit(f"{hint}가 필요합니다.")
    if not (SYNC_DIR / "node_modules" / "y-websocket").exists():
        sys.exit("sync/node_modules가 없습니다. sync 폴더에서 `npm ci`를 먼저 실행하세요.")
    tmp = Path(tempfile.mkdtemp(prefix="sb-final-d-"))
    try:
        run(tmp)
    finally:
        if a.keep:
            print(f"\n임시 폴더를 남겼습니다: {tmp}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)
    passed = sum(ok for ok, _ in results)
    print(f"\n{passed}/{len(results)} 통과")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
