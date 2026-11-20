"""08회차 #29 검사: 서버를 껐다 켜도 설정·DB가 유지되고, 허용된 팀·프로젝트만 접근하는지 실제 HTTP로 확인한다.

이 스크립트가 임시 DB와 임시 팀 키로 서버를 직접 띄우고, 끄고, 다시 띄운다. 실제 DB(server/studio_bridge.db)와
실제 팀 키는 쓰지 않는다. 8000번이 아닌 빈 포트를 골라 127.0.0.1에서만 연다. (server 폴더에서)

    uv run python scripts/check_restart.py

순서:
1. 공유 모드로 띄움 → 키 없음·틀린 키·다른 프로젝트 거절(모든 제품 API), 거절된 저장은 남지 않음
   → BossAI 원문 5000→6000, 기능(상태·담당자), 연결, 결정 5000→6000 준비 → 기준값 기록
2. 서버 끔 → 연결 실패(응답 없음)가 401·403과 구분됨 → 같은 설정으로 다시 띄움 → 거절 규칙과 기준값이 그대로
3. DB 파일을 다른 폴더에 복사(복원본)해 그 파일로 띄움 → 기준값이 그대로
4. 실수로 다른 DB 경로로 띄움 → 시작 기록이 "DB 새로 만듦"으로 알려 주고 데이터는 비어 있음
5. 팀 키 없이 다시 띄움 → 로컬 모드 (키는 DB가 아니라 환경변수라 재시작 때 다시 줘야 함)
6. 서버 기록 전체에 팀 키 값이 없음

D의 복원본(#32)처럼 이미 떠 있는 서버끼리 비교할 때는 기록·대조만 따로 쓴다.
기록 파일에는 코드 원문과 결정 문장이 들어가므로 저장소 밖에 둔다. 공유 모드면 STUDIO_BRIDGE_TEAM_KEY를 준다.

    uv run python scripts/check_restart.py record http://127.0.0.1:8000 ../../sb-before.json
    uv run python scripts/check_restart.py compare http://127.0.0.1:8001 ../../sb-before.json

키 값은 출력하지 않는다. 표준 라이브러리만 사용한다.
"""

import json
import os
import secrets
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
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SERVER_DIR.parent
PROJECT = "studio-bridge"
P = f"/api/projects/{PROJECT}"
OTHER = "/api/projects/other-team"
KEY_HEADER = "X-StudioBridge-Key"
METHODS = ("get", "post", "put", "patch", "delete")

results: list[tuple[bool, str]] = []


def check(name: str, ok: bool, detail: object = "") -> bool:
    results.append((bool(ok), name))
    print(f"[{'통과' if ok else '실패'}] {name}" + (f"  -> {detail}" if not ok else ""))
    return bool(ok)


def finish() -> None:
    passed = sum(ok for ok, _ in results)
    print(f"\n{passed}/{len(results)} 통과")
    sys.exit(0 if passed == len(results) else 1)


def call(base: str, method: str, path: str, body: dict | None = None, key: str | None = None):
    """(상태, JSON 본문, 원문 bytes). 서버에 닿지 못하면 상태가 None이고 본문에 이유가 들어간다."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method.upper())
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if key:
        req.add_header(KEY_HEADER, key)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as err:
        status, raw = err.code, err.read()
    except (urllib.error.URLError, OSError) as err:
        return None, f"연결 실패: {getattr(err, 'reason', err)}", b""
    try:
        return status, json.loads(raw or b"null"), raw
    except ValueError:
        return status, None, raw


def code_of(body) -> str | None:
    detail = body.get("detail") if isinstance(body, dict) else None
    return detail.get("code") if isinstance(detail, dict) else None


def quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")


# ---------- 기준값: 재시작·복원 뒤에도 같은 응답이 나와야 하는 조회 ----------
def capture(base: str, key: str | None) -> dict[str, list]:
    """기능·연결·결정·자료·수집본·Studio 문맥을 모두 조회해 {주소: [상태, 본문]}으로 돌려준다."""
    out: dict[str, list] = {}

    def get(path: str):
        status, body, _ = call(base, "GET", path, key=key)
        out[path] = [status, body]
        return body if status == 200 and isinstance(body, dict) else {}

    for feature in get(f"{P}/features").get("items", []):
        fid = quote(feature["feature_id"])
        get(f"{P}/features/{fid}")
        get(f"{P}/features/{fid}/materials")
        get(f"{P}/features/{fid}/decisions")
    for material in get(f"{P}/materials").get("items", []):
        mid, uid = quote(material["material_id"]), quote(material["source_uid"])
        get(f"{P}/materials/{mid}")
        get(f"{P}/materials/{mid}/snapshots")
        get(f"{P}/materials/by-source?source_uid={uid}")
        get(f"{P}/context?source_uid={uid}")
    return out


def differences(want: dict[str, list], got: dict[str, list]) -> list[str]:
    diffs = [f"{path}: 없어짐" for path in want if path not in got]
    diffs += [f"{path}: 새로 생김" for path in got if path not in want]
    diffs += [f"{path}: 응답이 달라짐" for path in want if path in got and want[path] != got[path]]
    return diffs


def summary(values: dict[str, list]) -> str:
    def count(path: str) -> int:
        body = values.get(path, [None, None])[1]
        return len(body.get("items", [])) if isinstance(body, dict) else 0

    decisions = sum(
        len(body.get("items", []))
        for path, (_status, body) in values.items()
        if path.endswith("/decisions") and isinstance(body, dict)
    )
    snapshots = sum(
        len(body.get("items", []))
        for path, (_status, body) in values.items()
        if path.endswith("/snapshots") and isinstance(body, dict)
    )
    return (
        f"기능 {count(f'{P}/features')} · 결정 {decisions} · 자료 {count(f'{P}/materials')} · "
        f"수집본 {snapshots} · 조회 {len(values)}건"
    )


# ---------- 이미 떠 있는 서버끼리 비교 (D 복원본 등) ----------
def env_key() -> str | None:
    return os.environ.get("STUDIO_BRIDGE_TEAM_KEY", "").strip() or None


def require_reachable(base: str, key: str | None) -> None:
    status, body, _ = call(base, "GET", f"{P}/access", key=key)
    if status is None:
        sys.exit(f"서버에 연결할 수 없습니다: {base} ({body})")
    if status != 200:
        sys.exit(f"접속이 거절됐습니다: {status} {code_of(body)} (공유 모드면 STUDIO_BRIDGE_TEAM_KEY 확인)")


def cmd_record(base: str, file: Path) -> None:
    if REPO_DIR in file.resolve().parents:
        sys.exit("기록 파일에는 코드 원문·결정 문장이 들어갑니다. 저장소 밖 경로를 지정하세요.")
    key = env_key()
    require_reachable(base, key)
    values = capture(base, key)
    file.write_text(json.dumps(values, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"기록: {summary(values)}\n저장: {file.resolve()}")


def cmd_compare(base: str, file: Path) -> None:
    key = env_key()
    require_reachable(base, key)
    want = json.loads(file.read_text(encoding="utf-8"))
    got = capture(base, key)
    print(f"기록 때: {summary(want)}\n지금:    {summary(got)}")
    diffs = differences(want, got)
    check("기록 때와 모든 조회 응답이 같음 (기능·연결·결정·자료·수집본·Studio 문맥)", not diffs, diffs[:10])
    finish()


# ---------- 서버를 직접 띄우고 끄기 ----------
def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    """임시 DB·임시 키로 띄우는 검사용 서버. 출력은 파일로 모아 나중에 키가 섞였는지 본다."""

    def __init__(self, port: int, log_path: Path):
        self.port = port
        self.base = f"http://127.0.0.1:{port}"
        self.log_path = log_path
        self.proc: subprocess.Popen | None = None
        self.log_start = 0

    def start(self, db: Path, key: str | None) -> None:
        env = {k: v for k, v in os.environ.items() if not k.startswith("STUDIO_BRIDGE_")}
        env.update(
            STUDIO_BRIDGE_DB=str(db),
            STUDIO_BRIDGE_PORT=str(self.port),
            STUDIO_BRIDGE_HOST="127.0.0.1",  # 검사 중에는 같은 네트워크에 열지 않는다
            PYTHONUNBUFFERED="1",
            PYTHONIOENCODING="utf-8",
        )
        if key:
            env["STUDIO_BRIDGE_TEAM_KEY"] = key
        self.log_start = self.log_path.stat().st_size if self.log_path.exists() else 0
        with self.log_path.open("ab") as log:
            self.proc = subprocess.Popen(
                [sys.executable, "-m", "app.serve"], cwd=SERVER_DIR, env=env, stdout=log, stderr=subprocess.STDOUT
            )
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                break
            if call(self.base, "GET", "/api/health")[0] == 200:
                return
            time.sleep(0.2)
        self.stop()
        sys.exit(f"검사용 서버가 뜨지 않았습니다. 기록: {self.log_path}")

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

    def log_since_start(self) -> str:
        """가장 최근에 띄운 뒤로 쌓인 기록."""
        return self.log_path.read_bytes()[self.log_start:].decode("utf-8", "replace")


def product_routes(base: str) -> list[tuple[str, str, str]]:
    """서버가 실제로 등록한 제품 API 전체: (메서드, 우리 프로젝트 주소, 다른 프로젝트 주소).

    /openapi.json에서 읽으므로 C·D가 주소를 추가해도 자동으로 검사 대상이 된다.
    """
    status, spec, _ = call(base, "GET", "/openapi.json")
    if status != 200 or not isinstance(spec, dict):
        return []
    routes = []
    for template, operations in spec.get("paths", {}).items():
        if not template.startswith("/api/projects/"):
            continue
        rest = template[len("/api/projects/"):].split("/", 1)
        tail = "/" + rest[1] if len(rest) > 1 else ""
        # {feature_id} 같은 자리에는 없는 값을 넣는다. 거절은 그 값을 보기 전에 일어나야 한다.
        for name in set(part[1:-1] for part in tail.split("/") if part.startswith("{")):
            tail = tail.replace("{" + name + "}", "none")
        for method in operations:
            if method in METHODS:
                routes.append((method.upper(), P + tail, OTHER + tail))
    return sorted(routes)


def check_rejections(base: str, key: str, label: str) -> None:
    """키 없음·틀린 키·다른 프로젝트를 모든 제품 API에서 거절하는지 본다."""
    routes = product_routes(base)
    wrong = key + "-wrong"
    no_key, bad_key, other, leaked = [], [], [], []
    for method, own, foreign in routes:
        status, body, raw = call(base, method, own)
        if (status, code_of(body)) != (401, "team_key_required"):
            no_key.append(f"{method} {own} -> {status}")
        status, body, raw_wrong = call(base, method, own, key=wrong)
        if (status, code_of(body)) != (401, "team_key_invalid"):
            bad_key.append(f"{method} {own} -> {status}")
        status, body, raw_other = call(base, method, foreign, key=key)
        if (status, code_of(body)) != (403, "project_forbidden"):
            other.append(f"{method} {foreign} -> {status}")
        if any(key.encode() in r for r in (raw, raw_wrong, raw_other)):
            leaked.append(f"{method} {own}")
    n = len(routes)
    check(f"{label}: 제품 API {n}개를 찾음", n >= 10, n)
    check(f"{label}: 키 없음 → {n}개 모두 401 team_key_required", n > 0 and not no_key, no_key)
    check(f"{label}: 틀린 키 → {n}개 모두 401 team_key_invalid", n > 0 and not bad_key, bad_key)
    check(f"{label}: 맞는 키 + 다른 프로젝트 → {n}개 모두 403 project_forbidden", n > 0 and not other, other)
    check(f"{label}: 거절 응답에 키 값이 없음", not leaked, leaked)
    status, body, _ = call(base, "GET", "/api/health")
    check(f"{label}: health는 키 없이 200이고 제품 데이터가 없음", status == 200 and body == {"status": "ok"}, (status, body))


def run_full() -> None:
    key = secrets.token_urlsafe(24)  # 이 검사에서만 쓰는 임시 키. 출력하지 않는다.
    run = uuid.uuid4().hex[:8]
    with tempfile.TemporaryDirectory(prefix="sb-restart-") as tmp_name:
        tmp = Path(tmp_name)
        db = tmp / "studio_bridge.db"
        server = Server(free_port(), tmp / "server.log")
        base = server.base
        try:
            # ---- 1. 공유 모드로 처음 띄움 ----
            print("-- 1. 공유 모드 서버 (새 임시 DB)")
            server.start(db, key)
            check("처음 띄움: 시작 기록이 'DB 새로 만듦'과 경로를 알려 줌",
                  "DB 새로 만듦" in server.log_since_start() and str(db.resolve()) in server.log_since_start())
            status, body, _ = call(base, "GET", f"{P}/access", key=key)
            check("맞는 키: 200 mode shared", status == 200 and body == {"project_id": PROJECT, "mode": "shared"}, (status, body))
            check_rejections(base, key, "처음")

            blocked_uid = f"restart-blocked-{run}"
            blocked = {"source_uid": blocked_uid, "request_id": f"restart-blocked-req-{run}", "name": "Blocked",
                       "source_path": "ServerScriptService.Blocked", "script_type": "Script", "raw_code": "print('no')\n"}
            s1, _, _ = call(base, "POST", f"{P}/materials/collect", blocked)
            s2, _, _ = call(base, "POST", f"{P}/materials/collect", blocked, key=key + "-wrong")
            s3, _, _ = call(base, "POST", f"{OTHER}/materials/collect", blocked, key=key)
            status, body, _ = call(base, "GET", f"{P}/materials/by-source?source_uid={blocked_uid}", key=key)
            check("거절된 코드 보내기(키 없음·틀린 키·다른 프로젝트)는 저장되지 않음",
                  (s1, s2, s3) == (401, 401, 403) and status == 200 and body.get("material") is None, (s1, s2, s3, status, body))

            # ---- 기준 데이터: BossAI 5000 → 6000, 기능 F-1, 연결, 결정 5000 → 6000 ----
            uid = f"restart-boss-ai-{run}"
            first = {"source_uid": uid, "request_id": f"restart-req-1-{run}", "name": "BossAI",
                     "source_path": "ServerScriptService.BossAI", "script_type": "Script",
                     "raw_code": "-- 보스 체력\nlocal maxHealth = 5000\nprint(maxHealth)\n"}
            second = {**first, "request_id": f"restart-req-2-{run}",
                      "raw_code": "-- 보스 체력\nlocal maxHealth = 6000\nprint(maxHealth)\n"}
            s1, collected, _ = call(base, "POST", f"{P}/materials/collect", first, key=key)
            s2, collected2, _ = call(base, "POST", f"{P}/materials/collect", second, key=key)
            mid = collected.get("material_id") if isinstance(collected, dict) else None
            s3, feature, _ = call(base, "POST", f"{P}/features", {"title": f"F-1 보스 체력 {run}"}, key=key)
            fid = feature.get("feature_id") if isinstance(feature, dict) else None
            s4, _, _ = call(base, "PATCH", f"{P}/features/{fid}", {"status": "doing", "assignee": "이하영"}, key=key)
            s5, _, _ = call(base, "PUT", f"{P}/features/{fid}/materials/{mid}", key=key)
            s6, _, _ = call(base, "POST", f"{P}/features/{fid}/decisions",
                            {"body": "보스 체력 5000", "author_display_name": "황재민"}, key=key)
            s7, _, _ = call(base, "POST", f"{P}/features/{fid}/decisions",
                            {"body": "보스 체력 6000. 이유: 전투 시간이 짧았다.", "author_display_name": "황재민"}, key=key)
            check("기준 데이터 준비: 원문 2번 수집·기능·상태/담당자·연결·결정 2개",
                  (s1, s2, s3, s4, s5, s6, s7) == (201, 201, 201, 200, 200, 201, 201)
                  and collected2.get("material_id") == mid, (s1, s2, s3, s4, s5, s6, s7))

            def scene(values: dict[str, list]) -> list[str]:
                """'보여줄 장면'이 그대로인지: 틀린 것의 목록을 돌려준다."""
                wrong = []
                ctx = values.get(f"{P}/context?source_uid={uid}", [None, None])[1] or {}
                feats = ctx.get("features") or [{}]
                current = feats[0].get("current_decision") or {}
                if (ctx.get("material") or {}).get("material_id") != mid:
                    wrong.append("Studio 문맥의 자료 ID")
                if feats[0].get("feature_id") != fid or feats[0].get("status") != "doing" or feats[0].get("assignee") != "이하영":
                    wrong.append("Studio 문맥의 기능·상태·담당자")
                if current.get("decision_no") != 2 or "6000" not in current.get("body", ""):
                    wrong.append("Studio 문맥의 현재 결정(6000)")
                decisions = values.get(f"{P}/features/{fid}/decisions", [None, None])[1] or {}
                if [d.get("decision_no") for d in decisions.get("items", [])] != [2, 1]:
                    wrong.append("결정 순서(현재 2, 이전 1)")
                if "5000" not in (decisions.get("items") or [{}, {}])[-1].get("body", ""):
                    wrong.append("이전 결정(5000)")
                snaps = (values.get(f"{P}/materials/{mid}/snapshots", [None, None])[1] or {}).get("items", [])
                if len(snaps) != 2 or not snaps[0].get("is_current") or "6000" not in snaps[0].get("raw_code", ""):
                    wrong.append("현재 수집본(6000)")
                if len(snaps) != 2 or "5000" not in snaps[1].get("raw_code", ""):
                    wrong.append("이전 수집본(5000)")
                return wrong

            baseline = capture(base, key)
            print(f"   기준값: {summary(baseline)}")
            check("재시작 전: 현재 결정 6000·이전 결정 5000, 현재 원문 6000·이전 원문 5000", not scene(baseline), scene(baseline))

            # ---- 2. 끄고 같은 설정으로 다시 띄움 ----
            print("-- 2. 서버를 끄고 같은 설정으로 다시 띄움")
            server.stop()
            status, body, _ = call(base, "GET", f"{P}/access", key=key)
            check("서버가 꺼져 있을 때: 응답 없음(연결 실패)이라 401·403과 구분됨", status is None, (status, body))
            server.start(db, key)
            log = server.log_since_start()
            check("재시작: 시작 기록이 같은 DB 경로를 '기존 파일'과 행 수로 알려 줌",
                  "DB 기존 파일" in log and str(db.resolve()) in log and "features=1" in log and "DB 새로 만듦" not in log)
            status, body, _ = call(base, "GET", f"{P}/access", key=key)
            check("재시작 뒤 설정 유지: 같은 키로 200 mode shared", status == 200 and body.get("mode") == "shared", (status, body))
            check_rejections(base, key, "재시작 뒤")
            after = capture(base, key)
            diffs = differences(baseline, after)
            check(f"재시작 뒤: 모든 조회 응답이 재시작 전과 같음 ({len(baseline)}건)", not diffs, diffs[:10])
            check("재시작 뒤: 현재·이전 결정과 현재·이전 원문이 뒤바뀌지 않음", not scene(after), scene(after))
            status, again, _ = call(base, "POST", f"{P}/materials/collect", second, key=key)
            check("재시작 뒤 같은 요청 재시도: 200 deduplicated (수집본이 늘지 않음)",
                  status == 200 and again.get("deduplicated") is True
                  and again.get("snapshot_id") == collected2.get("snapshot_id"), (status, again))

            # ---- 3. DB 파일 복사본(복원본)으로 띄움 ----
            print("-- 3. DB 복사본(복원본)으로 띄움")
            server.stop()
            restored_dir = tmp / "restored"
            restored_dir.mkdir()
            restored_db = restored_dir / "studio_bridge.db"
            shutil.copy2(db, restored_db)
            server.start(restored_db, key)
            check("복원본: 시작 기록의 DB 경로가 복원본 경로", str(restored_db.resolve()) in server.log_since_start())
            restored = capture(base, key)
            diffs = differences(baseline, restored)
            check(f"복원본: 모든 조회 응답이 기준값과 같음 ({len(baseline)}건)", not diffs, diffs[:10])
            check("복원본: Studio 문맥의 현재 결정이 6000", not scene(restored), scene(restored))

            # ---- 4. 실수로 다른 DB 경로로 띄움 ----
            print("-- 4. 다른(없는) DB 경로로 띄움")
            server.stop()
            server.start(tmp / "wrong-place.db", key)
            status, body, _ = call(base, "GET", f"{P}/features", key=key)
            check("다른 DB 경로: 시작 기록이 'DB 새로 만듦'으로 경고하고 목록은 비어 있음 (오류가 아니라 빈 결과)",
                  "DB 새로 만듦" in server.log_since_start() and status == 200 and body == {"items": []}, (status, body))

            # ---- 5. 키 없이 다시 띄움 ----
            print("-- 5. 팀 키 없이 다시 띄움")
            server.stop()
            server.start(db, None)
            status, body, _ = call(base, "GET", f"{P}/access")
            check("팀 키 없이 재시작: 로컬 모드 (키는 환경변수라 재시작 때 다시 줘야 공유 모드)",
                  status == 200 and body.get("mode") == "local", (status, body))
            local = capture(base, None)
            check("로컬 모드에서도 같은 DB의 데이터는 그대로", not differences(baseline, local), differences(baseline, local)[:10])
            status, body, _ = call(base, "GET", f"{OTHER}/features")
            check("로컬 모드: 다른 프로젝트는 403 project_forbidden",
                  status == 403 and code_of(body) == "project_forbidden", (status, body))
            server.stop()

            # ---- 6. 서버 기록에 키가 없는지 ----
            print("-- 6. 서버 기록")
            full_log = server.log_path.read_bytes()
            check("서버 기록 전체(시작·거절·접속 기록)에 팀 키 값이 없음", key.encode() not in full_log)
            check("거절 기록에 사유 코드가 남음 (team_key_required·team_key_invalid·project_forbidden)",
                  all(code.encode() in full_log for code in ("team_key_required", "team_key_invalid", "project_forbidden")))

            # 주소(?key=)로 보낸 키는 받지 않는다. 주소는 접속 기록에 남으므로 이 검사는 기록 확인 뒤에 한다.
            server.start(db, key)
            status, body, _ = call(base, "GET", f"{P}/access?key={quote(key)}")
            check("키를 헤더가 아니라 주소(?key=)에 넣으면 받지 않음: 401 team_key_required",
                  status == 401 and code_of(body) == "team_key_required", (status, body))
        finally:
            server.stop()
    finish()


def main() -> None:
    args = sys.argv[1:]
    if not args:
        run_full()
    elif len(args) == 3 and args[0] in ("record", "compare"):
        base, file = args[1].rstrip("/"), Path(args[2])
        (cmd_record if args[0] == "record" else cmd_compare)(base, file)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
