"""07회차 #25 검사: 이름 변경·복제·같은 요청 재시도를 거쳐도 스크립트가 올바르게 식별되는지 실제 HTTP로 확인한다.

플러그인이 서버에 보내는 것과 같은 요청을 차례로 보낸다.
- 이름·경로를 바꿔 다시 보내도 같은 자료이고, 기존 기능 연결·결정을 그대로 찾는다.
- 복제본에 새 source_uid를 준 뒤 보내면 원본과 다른 자료가 되고, 원본의 연결·결정이 섞이지 않는다.
- 보존해 둔 요청(같은 request_id·같은 payload)을 다시 보내면 새로 저장하지 않는다.

실제 DB를 건드리지 않도록 임시 DB로 띄운 서버에 실행한다. (server 폴더에서)

    STUDIO_BRIDGE_DB=/tmp/sb-check.db uv run uvicorn app.main:app --port 8765
    uv run python scripts/check_identity.py http://127.0.0.1:8765

Windows PowerShell:

    $env:STUDIO_BRIDGE_DB="$env:TEMP\\sb-check.db"; uv run uvicorn app.main:app --port 8765
    uv run python scripts/check_identity.py http://127.0.0.1:8765

공유 모드 서버라면 같은 터미널에 STUDIO_BRIDGE_TEAM_KEY를 넣고 실행한다.
검사마다 새 source_uid·request_id를 쓰므로 같은 임시 DB에 여러 번 실행해도 된다.
표준 라이브러리만 사용한다.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765").rstrip("/")
P = f"{BASE}/api/projects/studio-bridge"
KEY = os.environ.get("STUDIO_BRIDGE_TEAM_KEY", "")

results: list[tuple[bool, str]] = []


def call(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if KEY:
        req.add_header("X-StudioBridge-Key", KEY)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b"null")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"null")


def check(name: str, ok: bool, detail: object = "") -> None:
    results.append((ok, name))
    mark = "통과" if ok else "실패"
    print(f"[{mark}] {name}" + (f"  -> {detail}" if not ok else ""))


def payload(source_uid: str, name: str, path: str, raw_code: str) -> dict:
    """플러그인의 '코드 보내기'와 같은 모양. request_id는 전송마다 새로 만든다."""
    return {
        "source_uid": source_uid,
        "request_id": str(uuid.uuid4()),
        "name": name,
        "source_path": path,
        "script_type": "Script",
        "raw_code": raw_code,
    }


def collect(body: dict) -> tuple[int, dict]:
    return call("POST", f"{P}/materials/collect", body)


def context(source_uid: str) -> dict:
    q = urllib.parse.urlencode({"source_uid": source_uid})
    return call("GET", f"{P}/context?{q}")[1]


def by_source(source_uid: str) -> dict | None:
    q = urllib.parse.urlencode({"source_uid": source_uid})
    return call("GET", f"{P}/materials/by-source?{q}")[1]["material"]


def history(material_id: str) -> list[dict]:
    return call("GET", f"{P}/materials/{material_id}/snapshots")[1]["items"]


def decision_of(ctx: dict, feature_id: str) -> dict | None:
    for feature in ctx["features"]:
        if feature["feature_id"] == feature_id:
            return feature["current_decision"]
    return None


run = uuid.uuid4().hex[:8]
original_uid = str(uuid.uuid4())
# 탭·CRLF·줄 끝 공백·한글이 섞인 원문. 어떤 단계에서도 한 글자도 바뀌면 안 된다.
code_v1 = "-- 보스 체력\r\n\tlocal maxHealth = 5000  \r\n\r\nprint(maxHealth)\r\n"
code_v2 = "-- 보스 체력 (2페이즈 추가)\n\tlocal maxHealth = 5000\n\tlocal phase = 2\n"
decision_text = "체력 5000. 이유: 첫 테스트의 전투 시간을 맞추기 위해서."

# ---------- 준비: BossAI 수집 → 기능 연결 → 결정 ----------
first = payload(original_uid, "BossAI", "ServerScriptService.BossAI", code_v1)
status, saved = collect(first)
check("준비: BossAI 첫 수집 201", status == 201 and saved.get("deduplicated") is False, (status, saved))
material_id = saved["material_id"]

status, feature = call("POST", f"{P}/features", {"title": f"보스 2페이즈 {run}"})
feature_id = feature["feature_id"]
status2, _ = call("PUT", f"{P}/features/{feature_id}/materials/{material_id}")
status3, decision = call(
    "POST",
    f"{P}/features/{feature_id}/decisions",
    {"body": decision_text, "author_display_name": "황재민"},
)
check("준비: 기능 생성·연결·결정 저장", (status, status2, status3) == (201, 200, 201), (status, status2, status3))

# ---------- 1. 이름·경로 변경 뒤 재전송 ----------
renamed = payload(original_uid, "BossBrain", "ServerScriptService.Boss.BossBrain", code_v2)
status, again = collect(renamed)
check(
    "이름 변경 후 재전송: 201, 같은 material_id, 새 snapshot_id",
    status == 201
    and again["material_id"] == material_id
    and again["snapshot_id"] != saved["snapshot_id"],
    (status, again),
)

ctx = context(original_uid)
check(
    "이름 변경 후 문맥 조회: 같은 자료가 새 이름·새 경로로 보임",
    ctx["material"] is not None
    and ctx["material"]["material_id"] == material_id
    and ctx["material"]["name"] == "BossBrain"
    and ctx["material"]["source_path"] == "ServerScriptService.Boss.BossBrain",
    ctx["material"],
)
current = decision_of(ctx, feature_id)
check(
    "이름 변경 후에도 기존 기능 연결과 현재 결정을 찾음",
    [f["feature_id"] for f in ctx["features"]] == [feature_id]
    and current is not None
    and current["body"] == decision_text
    and current["decision_no"] == decision["decision_no"],
    ctx["features"],
)

items = history(material_id)
check(
    "이전 이름의 원문이 이전 수집본으로 그대로 남음",
    len(items) == 2
    and items[0]["is_current"] is True
    and items[0]["name"] == "BossBrain"
    and items[0]["raw_code"] == code_v2
    and items[1]["name"] == "BossAI"
    and items[1]["raw_code"] == code_v1,
    [(i["name"], i["is_current"]) for i in items],
)

status, listing = call("GET", f"{P}/materials")
same_uid = [m for m in listing["items"] if m["source_uid"] == original_uid]
check(
    "자료함에 이 스크립트는 한 건뿐 (이름이 바뀌어도 새 자료가 생기지 않음)",
    len(same_uid) == 1 and same_uid[0]["name"] == "BossBrain",
    same_uid,
)

# ---------- 2. 복제본: 플러그인이 새 source_uid를 준 뒤 전송 ----------
# 복제 직후에는 이름·경로·원문이 원본과 완전히 같다. 다른 것은 source_uid뿐이다.
clone_uid = str(uuid.uuid4())
check("복제본의 새 ID로는 아직 자료가 없음", by_source(clone_uid) is None)

clone = payload(clone_uid, "BossBrain", "ServerScriptService.Boss.BossBrain", code_v2)
status, cloned = collect(clone)
check(
    "복제본 전송: 201, 원본과 다른 material_id",
    status == 201 and cloned["material_id"] != material_id,
    (status, cloned),
)

clone_ctx = context(clone_uid)
check(
    "복제본에는 원본의 기능 연결·결정이 섞이지 않음",
    clone_ctx["material"] is not None
    and clone_ctx["material"]["material_id"] == cloned["material_id"]
    and clone_ctx["features"] == [],
    clone_ctx,
)

ctx = context(original_uid)
check(
    "원본은 그대로: 같은 자료·같은 연결·같은 현재 결정, 수집본 2건",
    ctx["material"]["material_id"] == material_id
    and [f["feature_id"] for f in ctx["features"]] == [feature_id]
    and decision_of(ctx, feature_id)["body"] == decision_text
    and len(history(material_id)) == 2,
    ctx,
)

server_copy = by_source(original_uid)
check(
    "원본 확인용 조회: 원본 ID의 서버 최신 원문이 마지막에 보낸 원문과 같음",
    server_copy is not None
    and server_copy["current_snapshot"]["raw_code"] == code_v2
    and server_copy["current_snapshot"]["name"] == "BossBrain",
    server_copy,
)

# 복제본만 고쳐서 다시 보내도 원본의 최신 원문은 바뀌지 않는다.
code_clone = code_v2 + "\tlocal isClone = true\n"
status, _ = collect(payload(clone_uid, "BossBrainCopy", "ServerScriptService.Boss.BossBrainCopy", code_clone))
check(
    "복제본을 고쳐 보내도 원본 원문은 그대로",
    status == 201
    and by_source(original_uid)["current_snapshot"]["raw_code"] == code_v2
    and by_source(clone_uid)["current_snapshot"]["raw_code"] == code_clone,
)

# ---------- 3. 보존한 요청의 재시도 ----------
# 플러그인은 실패한 요청을 JSON으로 저장했다가 그대로 다시 보낸다. 저장을 거친 사본으로 재시도한다.
retry_uid = str(uuid.uuid4())
pending = payload(retry_uid, "DoorScript", "Workspace.Door.DoorScript", code_v1)
kept = json.loads(json.dumps(pending))  # 플러그인 설정에 저장했다가 읽은 것과 같은 왕복

status, stored = collect(pending)  # 서버에는 닿았지만 플러그인이 응답을 못 받은 상황
check("첫 요청이 서버에 저장됨: 201", status == 201, (status, stored))

status, retried = collect(kept)
check(
    "보존한 요청 재시도: 200, deduplicated, 같은 material_id·snapshot_id",
    status == 200
    and retried["deduplicated"] is True
    and retried["material_id"] == stored["material_id"]
    and retried["snapshot_id"] == stored["snapshot_id"],
    (status, retried),
)
items = history(stored["material_id"])
check(
    "재시도해도 수집본은 1건, 원문은 보낸 그대로",
    len(items) == 1 and items[0]["raw_code"] == code_v1 and items[0]["request_id"] == pending["request_id"],
    [(i["request_id"], len(i["raw_code"])) for i in items],
)

# 같은 request_id에 다른 내용이 오면 거절하고 이전 원문을 지킨다. (플러그인은 이런 요청을 만들지 않는다.)
changed = {**kept, "raw_code": code_v2}
status, conflict = collect(changed)
check(
    "같은 request_id에 다른 원문: 409 request_id_conflict",
    status == 409 and conflict["detail"]["code"] == "request_id_conflict",
    (status, conflict),
)
check(
    "409 뒤에도 이전 원문이 그대로",
    by_source(retry_uid)["current_snapshot"]["raw_code"] == code_v1 and len(history(stored["material_id"])) == 1,
)

passed = sum(ok for ok, _ in results)
print(f"\n{passed}/{len(results)} 통과")
sys.exit(0 if passed == len(results) else 1)
