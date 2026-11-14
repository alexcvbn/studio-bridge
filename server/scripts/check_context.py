"""05회차 #17 문맥 조회 검사: 실행 중인 서버에 실제 HTTP 요청을 보내 응답을 확인한다.

실제 DB를 건드리지 않도록 임시 DB로 띄운 서버에 실행한다. (server 폴더에서)

    STUDIO_BRIDGE_DB=/tmp/sb-check.db uv run uvicorn app.main:app --port 8765
    uv run python scripts/check_context.py http://127.0.0.1:8765

Windows PowerShell:

    $env:STUDIO_BRIDGE_DB="$env:TEMP\\sb-check.db"; uv run uvicorn app.main:app --port 8765
    uv run python scripts/check_context.py http://127.0.0.1:8765

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


def call(method: str, url: str, body: dict | None = None) -> tuple[int, dict | list | None]:
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


def context(source_uid: str) -> tuple[int, dict]:
    q = urllib.parse.urlencode({"source_uid": source_uid})
    return call("GET", f"{P}/context?{q}")  # type: ignore[return-value]


run = uuid.uuid4().hex[:8]
uid = f"check-boss-ai-{run}"

# 1. 받은 적 없는 source_uid
status, body = context(f"never-sent-{run}")
check("미수집: 200, material null, features []", status == 200 and body["material"] is None and body["features"] == [], body)

# 2. BossAI 수집 (#16 수신 예시와 같은 원문)
status, collected = call(
    "POST",
    f"{P}/materials/collect",
    {
        "source_uid": uid,
        "request_id": f"check-request-{run}",
        "name": "BossAI",
        "source_path": "ServerScriptService.BossAI",
        "script_type": "Script",
        "raw_code": "-- 보스 체력 예시\nlocal maxHealth = 5000\nprint(maxHealth)\n",
    },
)
check("수집: 201", status == 201, (status, collected))
material_id = collected["material_id"]  # type: ignore[index]

status, body = context(uid)
check(
    "미연결: 200, material 있음, features []",
    status == 200 and body["material"]["material_id"] == material_id and body["features"] == [],
    body,
)

# 3. 기능 두 개를 만들고 둘 다 연결 (다중 연결)
status, phase2 = call("POST", f"{P}/features", {"title": "보스 2페이즈"})
status2, intro = call("POST", f"{P}/features", {"title": "보스 등장 연출"})
check("기능 2개 생성: 201", status == 201 and status2 == 201, (status, status2))
f1, f2 = phase2["feature_id"], intro["feature_id"]  # type: ignore[index]
for fid in (f1, f2):
    status, link = call("PUT", f"{P}/features/{fid}/materials/{material_id}")
    check(f"연결 {fid[:8]}: 200", status == 200, (status, link))

status, body = context(uid)
check(
    "결정 없음: 두 기능 모두 표시, current_decision null",
    status == 200
    and [f["feature_id"] for f in body["features"]] == [f1, f2]
    and all(f["current_decision"] is None for f in body["features"]),
    body,
)

# 4. 보스 2페이즈에 결정 저장 → 현재 결정
decision_body = "체력 5000. 이유: 첫 테스트의 전투 시간을 맞추기 위해서."
status, saved = call(
    "POST", f"{P}/features/{f1}/decisions", {"body": decision_body, "author_display_name": "황재민"}
)
check("결정 저장: 201", status == 201, (status, saved))

status, body = context(uid)
by_id = {f["feature_id"]: f for f in body["features"]}
current = by_id[f1]["current_decision"]
check(
    "현재 결정: 같은 문장·표시명·시각·decision_no",
    current is not None
    and current["body"] == decision_body
    and current["author_display_name"] == "황재민"
    and current["created_at"] == saved["created_at"]  # type: ignore[index]
    and current["decision_no"] == saved["decision_no"],  # type: ignore[index]
    current,
)
check("다른 기능은 그대로 결정 없음", by_id[f2]["current_decision"] is None, by_id[f2])

# 5. 결정을 바꾸면 현재 결정은 가장 큰 decision_no
status, newer = call(
    "POST", f"{P}/features/{f1}/decisions", {"body": "체력 6000으로 변경.", "author_display_name": "이하영"}
)
status, body = context(uid)
current = {f["feature_id"]: f for f in body["features"]}[f1]["current_decision"]
check(
    "새 결정 후 현재 결정이 바뀜",
    current["body"] == "체력 6000으로 변경." and current["decision_no"] == newer["decision_no"],  # type: ignore[index]
    current,
)

# 6. 오류 응답은 200의 "없음"과 다르다
status, body = call("GET", f"{P}/context")
check("source_uid 빠짐: 422", status == 422, (status, body))
status, body = call("GET", f"{P}/context?source_uid=%20")
check("source_uid 빈 값: 422 source_uid_required", status == 422 and body["detail"]["code"] == "source_uid_required", body)  # type: ignore[index]
status, body = call("GET", f"{BASE}/api/projects/other/context?source_uid={uid}")
check("다른 프로젝트: 403", status == 403, (status, body))

passed = sum(ok for ok, _ in results)
print(f"\n{passed}/{len(results)} 통과")
sys.exit(0 if passed == len(results) else 1)
