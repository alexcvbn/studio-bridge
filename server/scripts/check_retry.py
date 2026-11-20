"""07회차 #28 검사: 같은 요청의 재시도와 새 코드 수집을 확실히 구분하는지 실제 HTTP로 확인한다.

실제 DB를 건드리지 않도록 임시 DB로 띄운 서버에 실행한다. (server 폴더에서)

    STUDIO_BRIDGE_DB=/tmp/sb-check.db uv run uvicorn app.main:app --port 8765
    uv run python scripts/check_retry.py http://127.0.0.1:8765

검사마다 새 source_uid·request_id를 쓰므로 같은 임시 DB에 여러 번 실행해도 된다.
동시 요청은 스레드로 한꺼번에 보낸다. 표준 라이브러리만 사용한다.
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765").rstrip("/")
P = f"{BASE}/api/projects/studio-bridge"

results: list[tuple[bool, str]] = []


def call(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b"null")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"null")


def check(name: str, ok: bool, detail: object = "") -> None:
    results.append((ok, name))
    mark = "통과" if ok else "실패"
    print(f"[{mark}] {name}" + (f"  -> {detail}" if not ok else ""))


def body(source_uid: str, request_id: str, raw_code: str, name: str = "BossAI") -> dict:
    return {
        "source_uid": source_uid,
        "request_id": request_id,
        "name": name,
        "source_path": f"ServerScriptService.{name}",
        "script_type": "Script",
        "raw_code": raw_code,
    }


def send(b: dict) -> tuple[int, dict]:
    return call("POST", f"{P}/materials/collect", b)


def send_many(bodies: list[dict]) -> list[tuple[int, dict]]:
    with ThreadPoolExecutor(len(bodies)) as ex:
        return list(ex.map(send, bodies))


def history(material_id: str) -> list[dict]:
    return call("GET", f"{P}/materials/{material_id}/snapshots")[1]["items"]


def lookup(source_uid: str) -> dict | None:
    q = urllib.parse.urlencode({"source_uid": source_uid})
    return call("GET", f"{P}/materials/by-source?{q}")[1]["material"]


run = uuid.uuid4().hex[:8]
uid = f"check-retry-{run}"
# 탭·CRLF·빈 줄·줄 끝 공백이 섞인 원문. 재시도와 새 수집을 거쳐도 한 글자도 바뀌면 안 된다.
code_v1 = "-- 보스 1차\r\n\tlocal hp = 5000  \r\n\r\nprint(hp)\r\n"
code_v2 = "-- 보스 2차\n\tlocal hp = 6000\n"
req1 = f"req-1-{run}"

# 1. 같은 요청을 차례로 세 번
r = [send(body(uid, req1, code_v1)) for _ in range(3)]
first = r[0][1]
material_id = first["material_id"]
check(
    "같은 요청 3번 차례로: 201 한 번, 200 두 번, 같은 ID, 수집본 1개",
    [s for s, _ in r] == [201, 200, 200]
    and [b["deduplicated"] for _, b in r] == [False, True, True]
    and all(b["material_id"] == material_id and b["snapshot_id"] == first["snapshot_id"] for _, b in r)
    and len(history(material_id)) == 1,
    r,
)

# 2. 같은 요청을 동시에 20번 (Studio 재시도가 겹친 상황)
uid_c = f"check-retry-conc-{run}"
r = send_many([body(uid_c, f"req-conc-{run}", code_v1)] * 20)
statuses = sorted(s for s, _ in r)
snap_ids = {b.get("snapshot_id") for _, b in r}
conc_mid = r[0][1].get("material_id")
check(
    "같은 요청 동시 20번: 201 한 번·200 열아홉 번, 모두 같은 snapshot_id, 수집본 1개",
    statuses == [200] * 19 + [201] and len(snap_ids) == 1 and len(history(conc_mid)) == 1,
    (statuses, len(snap_ids)),
)

# 3. 같은 request_id로 다른 원문: 거절하고 이전 원문을 지킨다
status, b = send(body(uid, req1, "-- 몰래 바뀐 코드\n"))
items = history(material_id)
check(
    "같은 request_id·다른 원문: 409 request_id_conflict, 저장된 원문 그대로",
    status == 409
    and b["detail"]["code"] == "request_id_conflict"
    and len(items) == 1
    and items[0]["raw_code"] == code_v1,
    (status, b),
)

# 4. 같은 request_id를 다른 스크립트(source_uid)가 쓰면 거절하고 새 자료도 만들지 않는다
other_uid = f"check-retry-other-{run}"
status, b = send(body(other_uid, req1, code_v1))
check(
    "같은 request_id·다른 source_uid: 409, 새 자료 안 생김",
    status == 409 and lookup(other_uid) is None,
    (status, b),
)

# 5. 코드를 바꿔 새 request_id로 보내면 새 수집본
status, second = send(body(uid, f"req-2-{run}", code_v2))
items = history(material_id)
check(
    "새 request_id·바뀐 코드: 201, 같은 material_id, 새 snapshot_id",
    status == 201
    and second["material_id"] == material_id
    and second["snapshot_id"] != first["snapshot_id"]
    and second["deduplicated"] is False,
    second,
)
check(
    "새 수집 후: 현재는 새 원문, 이전 원문은 글자 그대로",
    [i["snapshot_id"] for i in items] == [second["snapshot_id"], first["snapshot_id"]]
    and [i["is_current"] for i in items] == [True, False]
    and items[0]["raw_code"] == code_v2
    and items[1]["raw_code"] == code_v1,
    items,
)

# 6. 1차 요청을 늦게 다시 보내도 현재 수집본은 그대로 새 원문
status, b = send(body(uid, req1, code_v1))
_, detail = call("GET", f"{P}/materials/{material_id}")
check(
    "늦게 온 1차 재시도: 200 중복, 현재 원문은 여전히 새 코드, 수집본 2개",
    status == 200
    and b["snapshot_id"] == first["snapshot_id"]
    and detail["current_snapshot"]["snapshot_id"] == second["snapshot_id"]
    and detail["snapshot_count"] == 2,
    (status, detail),
)

# 7. 서로 다른 새 요청 10개를 동시에: 하나의 자료에 수집본 10개, 현재는 정확히 하나
uid_n = f"check-retry-new-{run}"
r = send_many([body(uid_n, f"req-n{i}-{run}", f"print({i})\n") for i in range(10)])
mids = {b.get("material_id") for _, b in r}
mid_n = r[0][1].get("material_id")
items = history(mid_n)
_, detail = call("GET", f"{P}/materials/{mid_n}")
check(
    "새 요청 동시 10개: 모두 201, 자료 1개, 수집본 10개",
    [s for s, _ in r] == [201] * 10 and len(mids) == 1 and len(items) == 10
    and len({i["snapshot_id"] for i in items}) == 10,
    ([s for s, _ in r], len(mids), len(items)),
)
check(
    "현재 수집본은 하나: 기록 맨 앞 = 상세의 현재 수집본",
    sum(i["is_current"] for i in items) == 1
    and items[0]["is_current"]
    and items[0]["snapshot_id"] == detail["current_snapshot"]["snapshot_id"],
    [i["is_current"] for i in items],
)

# 8. 재시도와 새 수집을 거쳐도 기능 연결은 그대로
_, feature = call("POST", f"{P}/features", {"title": f"재시도 검사 {run}"})
call("PUT", f"{P}/features/{feature['feature_id']}/materials/{material_id}")
send(body(uid, req1, code_v1))
send(body(uid, f"req-3-{run}", code_v2 + "-- 3차\n"))
_, linked = call("GET", f"{P}/features/{feature['feature_id']}/materials")
q = urllib.parse.urlencode({"source_uid": uid})
_, ctx = call("GET", f"{P}/context?{q}")
check(
    "재시도·새 수집 뒤에도 기능 연결 유지 (기능 연결 목록, Studio 문맥 조회)",
    [m["material_id"] for m in linked["items"]] == [material_id]
    and [f["feature_id"] for f in ctx["features"]] == [feature["feature_id"]],
    (linked, ctx),
)

# 9. 이름을 바꾼 스크립트(같은 source_uid)는 같은 자료로 이어진다
status, renamed = send(body(uid, f"req-4-{run}", code_v2, name="BossAI_Renamed"))
_, detail = call("GET", f"{P}/materials/{material_id}")
check(
    "이름 변경 후 새 요청: 같은 material_id, 현재 이름은 새 이름",
    status == 201
    and renamed["material_id"] == material_id
    and detail["current_snapshot"]["name"] == "BossAI_Renamed",
    (status, detail),
)

# 10. 빈 값은 저장 전에 거절한다
cases = [
    ("request_id", "", "request_id_required"),
    ("request_id", "   ", "request_id_required"),
    ("source_uid", "", "source_uid_required"),
    ("source_uid", "  ", "source_uid_required"),
]
before = len(history(material_id))
outcomes = []
for field, value, code in cases:
    b = body(uid, f"req-blank-{field}-{len(value)}-{run}", code_v1)
    b[field] = value
    status, res = send(b)
    outcomes.append(status == 422 and res["detail"]["code"] == code)
check(
    "빈 request_id·source_uid (공백만 포함): 422와 오류 코드, 아무것도 저장 안 됨",
    all(outcomes) and len(history(material_id)) == before,
    outcomes,
)

passed = sum(ok for ok, _ in results)
print(f"\n{passed}/{len(results)} 통과")
sys.exit(0 if passed == len(results) else 1)
