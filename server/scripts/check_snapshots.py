"""06회차 #24 다시 보내기 검사: 코드를 다시 보내도 이전 원문과 기능 연결이 남는지 실제 HTTP로 확인한다.

실제 DB를 건드리지 않도록 임시 DB로 띄운 서버에 실행한다. (server 폴더에서)

    STUDIO_BRIDGE_DB=/tmp/sb-check.db uv run uvicorn app.main:app --port 8765
    uv run python scripts/check_snapshots.py http://127.0.0.1:8765

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


def collect_body(source_uid: str, raw_code: str, name: str) -> dict:
    return {
        "source_uid": source_uid,
        "request_id": f"req-{uuid.uuid4().hex}",
        "name": name,
        "source_path": f"ServerScriptService.{name}",
        "script_type": "Script",
        "raw_code": raw_code,
    }


def send(body: dict) -> tuple[int, dict]:
    return call("POST", f"{P}/materials/collect", body)


def snapshots(material_id: str) -> tuple[int, dict]:
    return call("GET", f"{P}/materials/{material_id}/snapshots")


run = uuid.uuid4().hex[:8]
uid = f"check-resend-{run}"
other_uid = f"check-resend-other-{run}"
# 한글·탭·빈 줄·줄 끝 공백·CRLF가 섞인 원문. 저장·조회에서 한 글자도 바뀌면 안 된다.
code_v1 = "-- 보스 1차\r\n\tlocal hp = 5000  \r\n\r\n\r\nprint(hp)\r\n"
code_v2 = "-- 보스 2차 (체력 상향)\n\tlocal hp = 8000\n\nprint(hp)\n"

# 1. 처음 보내고 기능에 연결
_, first = send(collect_body(uid, code_v1, "BossAI"))
material_id = first["material_id"]
_, feature = call("POST", f"{P}/features", {"title": f"보스 2페이즈 {run}"})
feature_id = feature["feature_id"]
status, _ = call("PUT", f"{P}/features/{feature_id}/materials/{material_id}")
status_s, body = snapshots(material_id)
check(
    "처음 보냄: 수집본 1개, 현재 표시, 원문 그대로",
    status == 200
    and status_s == 200
    and len(body["items"]) == 1
    and body["items"][0]["is_current"] is True
    and body["items"][0]["raw_code"] == code_v1,
    body,
)

# 2. 코드를 바꿔 새 요청으로 다시 보냄
status, second = send(collect_body(uid, code_v2, "BossAI"))
check(
    "다시 보냄: 201, 같은 material_id, 새 snapshot_id",
    status == 201
    and second["material_id"] == material_id
    and second["snapshot_id"] != first["snapshot_id"]
    and second["deduplicated"] is False,
    second,
)

# 3. 현재 원문은 새 코드
_, detail = call("GET", f"{P}/materials/{material_id}")
check(
    "현재 원문: 새 코드, 현재 snapshot_id는 두 번째",
    detail["current_snapshot"]["raw_code"] == code_v2
    and detail["current_snapshot"]["snapshot_id"] == second["snapshot_id"]
    and detail["snapshot_count"] == 2,
    detail,
)

# 4. 이전 원문이 남아 있고 다시 열 수 있다
_, body = snapshots(material_id)
items = body["items"]
check(
    "수집본 기록: 2개, 최근 것부터, 이전 원문이 글자 그대로 남음",
    len(items) == 2
    and [i["snapshot_id"] for i in items] == [second["snapshot_id"], first["snapshot_id"]]
    and [i["is_current"] for i in items] == [True, False]
    and items[0]["raw_code"] == code_v2
    and items[1]["raw_code"] == code_v1,
    body,
)

# 5. 기능 연결이 그대로 남는다
_, linked = call("GET", f"{P}/features/{feature_id}/materials")
q = urllib.parse.urlencode({"source_uid": uid})
_, ctx = call("GET", f"{P}/context?{q}")
check(
    "기능 연결 유지: 기능의 연결 자료와 A context에 그대로",
    [m["material_id"] for m in linked["items"]] == [material_id]
    and [f["feature_id"] for f in ctx["features"]] == [feature_id],
    (linked, ctx),
)

# 6. 같은 요청을 재시도하면 수집본이 늘지 않는다 (#16)
retry_body = collect_body(uid, code_v2, "BossAI")
send(retry_body)
status, again = send(retry_body)
_, body = snapshots(material_id)
check(
    "같은 요청 재시도: 200 deduplicated, 수집본은 한 번만 늘어 3개",
    status == 200 and again["deduplicated"] is True and len(body["items"]) == 3,
    (again, len(body["items"])),
)

# 7. 이름을 바꿔 다시 보내면 목록·보드 제목은 최신 이름, 자료는 여전히 하나
_, renamed = send(collect_body(uid, code_v2, "BossAI_v2"))
_, listing = call("GET", f"{P}/materials")
mine = [m for m in listing["items"] if m["source_uid"] == uid]
_, body = snapshots(material_id)
check(
    "이름 변경 재전송: 자료 1건 유지, 목록 이름은 최신, 이전 이름은 기록에 남음",
    renamed["material_id"] == material_id
    and len(mine) == 1
    and mine[0]["name"] == "BossAI_v2"
    and [i["name"] for i in body["items"]] == ["BossAI_v2", "BossAI", "BossAI", "BossAI"],
    (mine, [i["name"] for i in body["items"]]),
)

# 8. 다른 자료의 수집본은 섞이지 않는다
_, other = send(collect_body(other_uid, "-- 다른 스크립트\n", "BossAI"))
_, other_body = snapshots(other["material_id"])
_, body = snapshots(material_id)
check(
    "다른 자료와 분리: 각자 자기 수집본만",
    len(other_body["items"]) == 1
    and other_body["items"][0]["snapshot_id"] == other["snapshot_id"]
    and other["snapshot_id"] not in [i["snapshot_id"] for i in body["items"]],
    other_body,
)

# 9. 없는 자료
status, body = snapshots(f"no-such-material-{run}")
check(
    "없는 material_id: 404 material_not_found",
    status == 404 and body["detail"]["code"] == "material_not_found",
    body,
)

# 10. 수집본을 고치거나 지우는 길이 없다 (읽기 전용)
url = f"{P}/materials/{material_id}/snapshots"
codes = [call(method, url, {} if method != "DELETE" else None)[0] for method in ("PUT", "PATCH", "DELETE")]
_, body = snapshots(material_id)
check(
    "수집본 수정·삭제 불가: PUT/PATCH/DELETE 405, 기록 그대로",
    codes == [405, 405, 405] and len(body["items"]) == 4 and body["items"][-1]["raw_code"] == code_v1,
    codes,
)

passed = sum(ok for ok, _ in results)
print(f"\n{passed}/{len(results)} 통과")
sys.exit(0 if passed == len(results) else 1)
