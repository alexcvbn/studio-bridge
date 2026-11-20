"""08회차 #31 (C): 백업을 복원한 뒤 기능·연결·현재와 이전 결정이 그대로인지 API로 대조한다.

server 폴더에서 실행한다. 백업·복원 자체는 scripts/backup_restore.py와 BACKUP.md(08회차 #32)를 따른다.

    # 1) 원본 서버에 시험 장면(F-1: 상태·담당자·BossAI 연결·결정 5000→6000)을 만든다
    uv run python scripts/check_restore_features.py seed --api http://127.0.0.1:8765
    # 2) 서버를 끄고 backup → restore 한 뒤, 원본과 복원본 서버를 다른 포트로 함께 띄워 비교한다
    uv run python scripts/check_restore_features.py compare \\
        --before http://127.0.0.1:8765 --after http://127.0.0.1:8766 --after-db <복원 폴더>/studio_bridge.db

- 비교 대상: 모든 기능의 ID·제목·상태·담당자, 연결 자료(순서 포함), 결정 전체(번호·문장·표시명·시각, 순서),
  현재 결정, Studio 문맥 조회(같은 source_uid로 같은 기능·현재 결정).
- 복원본에서 추가로: 다른 프로젝트 요청은 403이고 데이터가 섞이지 않는지, DB에 고아 연결·결정이 없는지.
  (연결 목록 API는 자료가 없는 연결을 건너뛰고 보여 주므로, 고아 연결은 DB에서 직접 센다.)
공유 모드면 --key 또는 STUDIO_BRIDGE_TEAM_KEY. 표준 라이브러리만 사용한다.
"""

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

PROJECT = "studio-bridge"
results: list[tuple[bool, str]] = []


def call(base: str, method: str, path: str, body: dict | None = None, key: str | None = None,
         project: str = PROJECT) -> tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{base.rstrip('/')}/api/projects/{project}{path}", data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if key:
        req.add_header("X-StudioBridge-Key", key)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, json.loads(res.read() or b"null")
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            return err.code, json.loads(raw or b"null")
        except ValueError:
            return err.code, None
    except OSError as err:
        print(f"중단: API에 연결하지 못했습니다 ({base}): {err}", file=sys.stderr)
        sys.exit(1)


def check(name: str, ok: bool, detail: object = "") -> None:
    results.append((ok, name))
    print(f"[{'통과' if ok else '실패'}] {name}" + (f"  -> {detail}" if not ok and detail != "" else ""))


# ---------- 1) 시험 장면 만들기 ----------
def cmd_seed(a) -> None:
    base, key = a.api, a.key
    run = uuid.uuid4().hex[:6]

    def ok(res: tuple[int, object], want: int, what: str) -> dict:
        if res[0] != want:
            print(f"중단: {what} 실패 ({res[0]}): {res[1]}", file=sys.stderr)
            sys.exit(1)
        return res[1]

    def collect(uid: str, name: str, code: str) -> dict:
        return ok(call(base, "POST", "/materials/collect", {
            "source_uid": uid, "request_id": f"req-{uuid.uuid4().hex}", "name": name,
            "source_path": f"ServerScriptService.{name}", "script_type": "Script", "raw_code": code,
        }, key), 201, f"{name} 보내기")

    boss = collect(f"boss-{run}", "BossAI", "local hp = 5000\nprint(hp)\n")
    intro = collect(f"intro-{run}", "BossIntroCutscene", "-- 등장 연출\n")
    f1 = ok(call(base, "POST", "/features", {"title": f"F-1 보스 2페이즈 {run}"}, key), 201, "F-1 만들기")
    f2 = ok(call(base, "POST", "/features", {"title": f"F-2 보스 등장 연출 {run}"}, key), 201, "F-2 만들기")
    fid = f1["feature_id"]
    ok(call(base, "PATCH", f"/features/{fid}", {"status": "doing", "assignee": "이하영"}, key), 200, "상태·담당자")
    ok(call(base, "PUT", f"/features/{fid}/materials/{boss['material_id']}", key=key), 200, "BossAI 연결")
    ok(call(base, "PUT", f"/features/{fid}/materials/{intro['material_id']}", key=key), 200, "두 번째 연결")
    ok(call(base, "PUT", f"/features/{f2['feature_id']}/materials/{intro['material_id']}", key=key), 200, "F-2 연결")
    ok(call(base, "POST", f"/features/{fid}/decisions",
            {"body": "보스 체력 5000", "author_display_name": "황재민"}, key), 201, "결정 1")
    ok(call(base, "POST", f"/features/{fid}/decisions",
            {"body": "보스 체력 6000으로 상향 (2페이즈 난이도)", "author_display_name": "이하영"}, key), 201, "결정 2")
    print(json.dumps({"F-1": fid, "F-2": f2["feature_id"], "BossAI": boss["material_id"],
                      "source_uid": f"boss-{run}"}, ensure_ascii=False))
    print("F-1 준비 완료: 상태 doing · 담당 이하영 · BossAI 연결 · 결정 5000 → 6000")


# ---------- 2) 원본과 복원본 비교 ----------
def snapshot_of(base: str, key: str | None) -> dict:
    """한 서버에서 C 영역 값을 모두 읽는다."""
    status, flist = call(base, "GET", "/features", key=key)
    if status != 200:
        print(f"중단: 기능 목록 {status} ({base})", file=sys.stderr)
        sys.exit(1)
    features = {}
    source_uids = set()
    for f in flist["items"]:
        fid = f["feature_id"]
        _, detail = call(base, "GET", f"/features/{fid}", key=key)
        _, links = call(base, "GET", f"/features/{fid}/materials", key=key)
        _, dec = call(base, "GET", f"/features/{fid}/decisions", key=key)
        for m in links["items"]:
            source_uids.add(m["source_uid"])
        features[fid] = {
            "detail": {k: detail[k] for k in ("feature_id", "title", "status", "assignee", "created_at")},
            "links": [(m["material_id"], m["source_uid"], m["linked_at"]) for m in links["items"]],
            "decisions": [(d["decision_no"], d["body"], d["author_display_name"], d["created_at"])
                          for d in dec["items"]],
            "current": None if dec["current"] is None else dec["current"]["decision_no"],
        }
    contexts = {}
    for uid in sorted(source_uids):
        q = urllib.parse.urlencode({"source_uid": uid})
        _, ctx = call(base, "GET", f"/context?{q}", key=key)
        contexts[uid] = [(f["feature_id"], None if f["current_decision"] is None else
                          (f["current_decision"]["decision_no"], f["current_decision"]["body"]))
                         for f in ctx["features"]]
    return {"features": features, "contexts": contexts}


def orphan_counts(db_path: str) -> dict:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        one = lambda sql: con.execute(sql).fetchone()[0]  # noqa: E731
        return {
            "자료 없는 연결": one("SELECT count(*) FROM feature_materials fm "
                             "LEFT JOIN materials m ON m.material_id = fm.material_id WHERE m.material_id IS NULL"),
            "기능 없는 연결": one("SELECT count(*) FROM feature_materials fm "
                             "LEFT JOIN features f ON f.feature_id = fm.feature_id WHERE f.feature_id IS NULL"),
            "기능 없는 결정": one("SELECT count(*) FROM decisions d "
                             "LEFT JOIN features f ON f.feature_id = d.feature_id WHERE f.feature_id IS NULL"),
            "번호가 겹친 결정": one("SELECT count(*) FROM (SELECT feature_id, decision_no FROM decisions "
                              "GROUP BY feature_id, decision_no HAVING count(*) > 1)"),
        }
    finally:
        con.close()


def cmd_compare(a) -> None:
    key = a.key
    before, after = snapshot_of(a.before, key), snapshot_of(a.after, key)
    bf, af = before["features"], after["features"]
    check(f"기능 ID 목록 같음 ({len(bf)}개)", sorted(bf) == sorted(af), sorted(set(bf) ^ set(af)))
    common = sorted(set(bf) & set(af))
    diff = lambda part: [f for f in common if bf[f][part] != af[f][part]]  # noqa: E731
    check("기능 제목·상태·담당자·만든 시각", diff("detail") == [], diff("detail"))
    check("연결 자료 (ID·source_uid·연결 시각·순서)", diff("links") == [], diff("links"))
    check("결정 전체 (번호·문장·표시명·시각, 최신이 먼저)", diff("decisions") == [], diff("decisions"))
    swapped = [f for f in common if af[f]["current"] != (af[f]["decisions"][0][0] if af[f]["decisions"] else None)
               or af[f]["current"] != bf[f]["current"]]
    check("현재 결정이 바뀌지 않음 (가장 큰 번호, 원본과 같음)", swapped == [], swapped)
    wrong_order = [f for f in common if [d[0] for d in af[f]["decisions"]]
                   != sorted((d[0] for d in af[f]["decisions"]), reverse=True)]
    check("이전 결정이 현재보다 뒤에 남음 (번호 내림차순)", wrong_order == [], wrong_order)
    check("Studio 문맥 조회: 같은 source_uid → 같은 기능·현재 결정",
          before["contexts"] == after["contexts"],
          [u for u in before["contexts"] if before["contexts"][u] != after["contexts"].get(u)])

    # 다른 프로젝트로 묻는 요청은 거절되고 데이터가 섞이지 않는다
    probes = ["/features", f"/features/{common[0]}" if common else "/features/x", "/materials",
              "/context?source_uid=x"]
    leaked = []
    for path in probes:
        status, body = call(a.after, "GET", path, key=key, project="other-project")
        if status != 403 or (isinstance(body, dict) and ("items" in body or "features" in body)):
            leaked.append((path, status))
    check("다른 프로젝트 요청은 403, 데이터 없음", leaked == [], leaked)

    if a.after_db:
        counts = orphan_counts(a.after_db)
        check("복원 DB에 고아 연결·결정 없음", all(v == 0 for v in counts.values()), counts)
    else:
        print("[건너뜀] 고아 연결·결정 검사 (--after-db를 주면 복원 DB를 직접 셉니다)")

    passed = sum(ok for ok, _ in results)
    print(f"\n{passed}/{len(results)} 통과")
    sys.exit(0 if passed == len(results) else 1)


def main() -> None:
    p = argparse.ArgumentParser(description="복원 전후 기능·연결·결정 대조 (08회차 #31)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seed", help="F-1 시험 장면 만들기")
    s.add_argument("--api", required=True)
    c = sub.add_parser("compare", help="원본과 복원본 서버 비교")
    c.add_argument("--before", required=True, help="원본 데이터로 띄운 API")
    c.add_argument("--after", required=True, help="복원본으로 띄운 API")
    c.add_argument("--after-db", help="복원본 DB 파일 (고아 연결·결정 검사)")
    for sp in (s, c):
        sp.add_argument("--key", default=os.environ.get("STUDIO_BRIDGE_TEAM_KEY"))
    a = p.parse_args()
    {"seed": cmd_seed, "compare": cmd_compare}[a.cmd](a)


if __name__ == "__main__":
    main()
