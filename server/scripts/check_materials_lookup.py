"""05회차 #20 source_uid로 자료 찾기 검사: 실행 중인 서버에 실제 HTTP 요청을 보내 확인한다.

실제 DB를 건드리지 않도록 임시 DB로 띄운 서버에 실행한다. (server 폴더에서)

    STUDIO_BRIDGE_DB=/tmp/sb-check.db uv run uvicorn app.main:app --port 8765
    uv run python scripts/check_materials_lookup.py http://127.0.0.1:8765

검사마다 새 source_uid를 쓰므로 같은 임시 DB에 여러 번 실행해도 된다.
표준 라이브러리만 사용한다.
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765").rstrip("/")
P = f"{BASE}/api/projects/studio-bridge"

results: list[tuple[bool, str]] = []


def call(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read() or b"null")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"null")


def check(name: str, ok: bool, detail: object = "") -> None:
    results.append((ok, name))
    mark = "통과" if ok else "실패"
    print(f"[{mark}] {name}" + (f"  -> {detail}" if not ok else ""))


def by_source(source_uid: str) -> tuple[int, dict]:
    q = urllib.parse.urlencode({"source_uid": source_uid})
    return call("GET", f"{P}/materials/by-source?{q}")


def collect(source_uid: str, raw_code: str, name: str = "BossAI") -> tuple[int, dict]:
    return call(
        "POST",
        f"{P}/materials/collect",
        {
            "source_uid": source_uid,
            "request_id": f"req-{uuid.uuid4().hex}",
            "name": name,
            "source_path": f"ServerScriptService.{name}",
            "script_type": "Script",
            "raw_code": raw_code,
        },
    )


run = uuid.uuid4().hex[:8]
uid_a = f"check-boss-a-{run}"
uid_b = f"check-boss-b-{run}"
code_a1 = "-- 보스 A 1차\n\tlocal hp = 5000\n\nprint(hp)\n"
code_a2 = "-- 보스 A 2차\nlocal hp = 6000\n"
code_b = "-- 이름만 같은 다른 보스\nprint('B')\n"

# 1. 받은 적 없는 source_uid
status, body = by_source(f"never-sent-{run}")
check("미수집 UID: 200, material null", status == 200 and body["material"] is None, body)

# 2. 빈 값 / 빠진 값
status, body = by_source("   ")
check("빈 source_uid: 422 source_uid_required", status == 422 and body["detail"]["code"] == "source_uid_required", body)
status, _ = call("GET", f"{P}/materials/by-source")
check("source_uid 없음: 422 (material_id로 잘못 읽지 않음)", status == 422, status)

# 3. 보낸 뒤 찾기
_, first = collect(uid_a, code_a1)
status, body = by_source(uid_a)
m = body.get("material") or {}
check(
    "보낸 UID: 같은 material_id, 원문 그대로, 수집본 1개",
    status == 200
    and m.get("material_id") == first["material_id"]
    and m["current_snapshot"]["raw_code"] == code_a1
    and m["snapshot_count"] == 1,
    body,
)

# 4. 이름이 같은 다른 UID는 다른 자료
_, other = collect(uid_b, code_b)
_, body_b = by_source(uid_b)
_, body_a = by_source(uid_a)
check(
    "같은 이름 다른 UID: 서로 다른 material_id, 각자 원문",
    other["material_id"] != first["material_id"]
    and body_b["material"]["material_id"] == other["material_id"]
    and body_b["material"]["current_snapshot"]["raw_code"] == code_b
    and body_a["material"]["current_snapshot"]["raw_code"] == code_a1,
    (body_a, body_b),
)

# 5. 다시 보내면 같은 자료에 수집본이 쌓이고 ID는 그대로
_, second = collect(uid_a, code_a2)
_, body = by_source(uid_a)
m = body["material"]
check(
    "다시 보냄: material_id 유지, 새 snapshot_id, 수집본 2개, 최신 원문",
    second["material_id"] == first["material_id"]
    and second["snapshot_id"] != first["snapshot_id"]
    and m["material_id"] == first["material_id"]
    and m["snapshot_count"] == 2
    and m["current_snapshot"]["raw_code"] == code_a2,
    body,
)

# 6. 상세 API도 같은 값
status, detail = call("GET", f"{P}/materials/{first['material_id']}")
check(
    "상세 API: source_uid·snapshot_count 포함",
    status == 200 and detail["source_uid"] == uid_a and detail["snapshot_count"] == 2,
    detail,
)

# 7. A의 문맥 조회와 같은 자료를 가리키는지 대조
q = urllib.parse.urlencode({"source_uid": uid_a})
status, ctx = call("GET", f"{P}/context?{q}")
check(
    "A context와 대조: 같은 material_id",
    status == 200 and (ctx.get("material") or {}).get("material_id") == first["material_id"],
    ctx,
)

passed = sum(ok for ok, _ in results)
print(f"\n{passed}/{len(results)} 통과")
sys.exit(0 if passed == len(results) else 1)
