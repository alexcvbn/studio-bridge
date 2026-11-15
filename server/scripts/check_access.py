"""06회차 #21 접속 검사: 실행 중인 서버에 실제 HTTP 요청을 보내 모드·팀 키·프로젝트 거절과 제품 흐름을 확인한다.

임시 DB로 띄운 서버에 실행한다. (server 폴더에서)

공유 모드 (macOS/Linux):

    export STUDIO_BRIDGE_TEAM_KEY='팀에서 정한 키'
    STUDIO_BRIDGE_DB=/tmp/sb-access.db STUDIO_BRIDGE_PORT=8765 uv run python -m app.serve
    uv run python scripts/check_access.py http://127.0.0.1:8765

로컬 모드: 팀 키 없이 같은 명령으로 띄운다. 두 번째 인자로 같은 서버의 LAN 주소를 주면
다른 PC에서 온 요청이 403 local_only로 거절되는지도 본다. (이때 서버는 STUDIO_BRIDGE_HOST=0.0.0.0이 필요하지만
serve는 로컬 모드의 외부 주소를 막으므로 `uv run uvicorn app.main:app --host 0.0.0.0 --port 8765`로 띄운다.)

    uv run python scripts/check_access.py http://127.0.0.1:8765 http://192.168.0.10:8765

검사 스크립트는 STUDIO_BRIDGE_TEAM_KEY 환경변수에서 키를 읽고, 키 값을 출력하지 않는다.
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
REMOTE = sys.argv[2].rstrip("/") if len(sys.argv) > 2 else None
KEY = os.environ.get("STUDIO_BRIDGE_TEAM_KEY", "").strip()
P = "/api/projects/studio-bridge"

results: list[tuple[bool, str]] = []


def call(method: str, path: str, body: dict | None = None, key: str | None = None, base: str = BASE):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if key is not None:
        req.add_header("X-StudioBridge-Key", key)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            raw = res.read()
            return res.status, json.loads(raw or b"null"), raw
    except urllib.error.HTTPError as err:
        raw = err.read()
        return err.code, json.loads(raw or b"null"), raw


def code_of(body) -> str | None:
    detail = body.get("detail") if isinstance(body, dict) else None
    return detail.get("code") if isinstance(detail, dict) else None


def check(name: str, ok: bool, detail: object = "") -> None:
    results.append((ok, name))
    print(f"[{'통과' if ok else '실패'}] {name}" + (f"  -> {detail}" if not ok else ""))


status, body, _ = call("GET", "/api/health")
check("health: 키 없이 200 {status: ok}", status == 200 and body == {"status": "ok"}, (status, body))

status, body, _ = call("GET", f"{P}/access")
mode = "local" if status == 200 else "shared"
print(f"-- 서버 모드: {mode}")

if mode == "shared":
    if not KEY:
        sys.exit("공유 모드 서버입니다. STUDIO_BRIDGE_TEAM_KEY에 같은 키를 넣고 다시 실행하세요.")
    check("키 없음: 401 team_key_required", status == 401 and code_of(body) == "team_key_required", (status, body))

    wrong = KEY + "-wrong"
    status, body, raw = call("GET", f"{P}/access", key=wrong)
    check("틀린 키: 401 team_key_invalid", status == 401 and code_of(body) == "team_key_invalid", (status, body))
    check("거절 응답에 키 값이 없음", KEY.encode() not in raw and wrong.encode() not in raw)

    status, body, _ = call("GET", f"{P}/features")
    check("키 없이 제품 API(기능 목록): 401", status == 401, (status, body))
    status, body, _ = call("POST", f"{P}/materials/collect", {"source_uid": "x"})
    check("키 없이 코드 보내기: 401 (저장 안 함)", status == 401, (status, body))

    status, body, _ = call("GET", f"{P}/access", key=KEY)
    check("맞는 키: 200 mode shared", status == 200 and body == {"project_id": "studio-bridge", "mode": "shared"}, (status, body))
else:
    check("로컬 모드: 이 PC에서 키 없이 200 mode local", body == {"project_id": "studio-bridge", "mode": "local"}, (status, body))
    if REMOTE:
        status, body, _ = call("GET", f"{P}/access", base=REMOTE)
        check("로컬 모드: 다른 주소(LAN)에서 온 요청 403 local_only", status == 403 and code_of(body) == "local_only", (status, body))
        status, body, _ = call("GET", "/api/health", base=REMOTE)
        check("로컬 모드: LAN 주소의 health는 200", status == 200, (status, body))

k = KEY or None
status, body, _ = call("GET", "/api/projects/other-team/access", key=k)
check("다른 프로젝트(access): 403 project_forbidden", status == 403 and code_of(body) == "project_forbidden", (status, body))
status, body, _ = call("GET", "/api/projects/other-team/materials", key=k)
check("다른 프로젝트(자료 목록): 403 project_forbidden", status == 403 and code_of(body) == "project_forbidden", (status, body))

# 제품 흐름: 수집 → 기능 → 연결 → 결정 → Studio 문맥 조회 (키가 있으면 키와 함께)
run = uuid.uuid4().hex[:8]
payload = {
    "source_uid": f"access-boss-ai-{run}",
    "request_id": f"access-request-{run}",
    "name": "BossAI",
    "source_path": "ServerScriptService.BossAI",
    "script_type": "Script",
    "raw_code": "-- 보스 체력 예시\nlocal maxHealth = 5000\nprint(maxHealth)\n",
}
status, collected, _ = call("POST", f"{P}/materials/collect", payload, key=k)
check("코드 보내기: 201", status == 201 and isinstance(collected, dict) and "material_id" in collected, (status, collected))
status, again, _ = call("POST", f"{P}/materials/collect", payload, key=k)
check("같은 요청 재시도: 200 deduplicated, 같은 snapshot_id",
      status == 200 and again.get("deduplicated") is True and again.get("snapshot_id") == collected.get("snapshot_id"), (status, again))

status, feature, _ = call("POST", f"{P}/features", {"title": f"보스 2페이즈 {run}"}, key=k)
check("기능 만들기: 201", status == 201 and "feature_id" in feature, (status, feature))
fid, mid = feature.get("feature_id"), collected.get("material_id")
status, body, _ = call("PUT", f"{P}/features/{fid}/materials/{mid}", key=k)
check("기능에 자료 연결: 200", status == 200, (status, body))
decision = {"body": "체력 5000. 이유: 첫 테스트의 전투 시간을 맞추기 위해서.", "author_display_name": "황재민"}
status, body, _ = call("POST", f"{P}/features/{fid}/decisions", decision, key=k)
check("결정 저장: 201", status == 201, (status, body))

q = urllib.parse.urlencode({"source_uid": payload["source_uid"]})
status, ctx, _ = call("GET", f"{P}/context?{q}", key=k)
current = (ctx.get("features") or [{}])[0].get("current_decision") if isinstance(ctx, dict) else None
check("Studio 문맥 조회: 연결 기능의 현재 결정이 보임",
      status == 200 and ctx["material"]["material_id"] == mid and current and current["body"] == decision["body"], (status, ctx))

passed = sum(ok for ok, _ in results)
print(f"\n{passed}/{len(results)} 통과")
sys.exit(0 if passed == len(results) else 1)
