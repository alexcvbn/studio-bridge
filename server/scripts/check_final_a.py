"""09회차 #33 A 최종 판정: A 영역(접속·팀 키·전송·식별·문맥 조회·재시작)의 기존 검사를 같은 코드 버전에서 한 번에 돌린다.

새 검사를 만들지 않는다. 03~08회차에 만든 검사 스크립트를 임시 서버에 차례로 실행하고 결과를 한 표로 모은다.
임시 DB·임시 팀 키·빈 포트를 쓰고 끝나면 지운다. 실제 DB(server/studio_bridge.db)와 실제 팀 키는 쓰지 않는다. (server 폴더에서)

    uv run python scripts/check_final_a.py
    uv run python scripts/check_final_a.py --lan    # 공유 모드 서버를 0.0.0.0에 열고 이 PC의 LAN 주소로도 접속 검사
    uv run python scripts/check_final_a.py --keep   # 임시 폴더(DB·서버 기록)를 남김

순서:
1. check_restart.py — 스스로 서버를 띄우고 끄며 재시작·거절·복원본·키 노출을 본다 (#29)
2. 공유 모드 임시 서버(임시 팀 키) — check_access (#21), check_identity (#25)
3. 로컬 모드 임시 서버(키 없음) — check_access, check_context (#17), check_identity,
   check_materials_lookup (#20), check_retry (#28), check_snapshots (#24)
4. 2·3번 서버 기록에 팀 키 값이 없는지

--lan은 같은 PC에서 LAN 주소로 접속해 보는 것이라 방화벽·다른 PC는 확인하지 못한다. 실제 두 PC 확인은 FINAL_CHECK_A.md의 표를 사람이 채운다.
키 값은 출력하지 않는다. 표준 라이브러리만 사용한다.
"""

import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
SCRIPTS = SERVER_DIR / "scripts"
KEY_ENV = "STUDIO_BRIDGE_TEAM_KEY"
SUMMARY = re.compile(r"^(\d+)/(\d+) 통과$")

SHARED_CHECKS = ("check_access", "check_identity")
LOCAL_CHECKS = (
    "check_access",
    "check_context",
    "check_identity",
    "check_materials_lookup",
    "check_retry",
    "check_snapshots",
)

# (검사, 조건, 통과 수, 전체 수, 통과 여부)
rows: list[tuple[str, str, int, int, bool]] = []


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def lan_address() -> str | None:
    # 실제로 패킷을 보내지 않고, 바깥으로 나갈 때 쓰는 이 PC의 주소만 알아낸다. (app/serve.py와 같은 방법)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))
            return s.getsockname()[0]
    except OSError:
        return None


def clean_env(key: str | None) -> dict[str, str]:
    # 이 터미널에 실제 팀 키·DB 경로가 있어도 임시 서버와 검사에는 넘기지 않는다.
    env = {k: v for k, v in os.environ.items() if not k.startswith("STUDIO_BRIDGE_")}
    env["PYTHONIOENCODING"] = "utf-8"
    if key:
        env[KEY_ENV] = key
    return env


def run_check(name: str, where: str, args: list[str], key: str | None) -> None:
    """검사 스크립트 하나를 실행하고 마지막 줄의 'N/M 통과'와 종료 코드를 함께 본다."""
    done = subprocess.run(
        [sys.executable, str(SCRIPTS / f"{name}.py"), *args],
        cwd=SERVER_DIR, env=clean_env(key), capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    lines = [line.strip() for line in done.stdout.splitlines() if line.strip()]
    found = SUMMARY.match(lines[-1]) if lines else None
    passed, total = (int(found[1]), int(found[2])) if found else (0, 0)
    ok = done.returncode == 0 and found is not None and total > 0 and passed == total
    rows.append((name, where, passed, total, ok))
    print(f"[{'통과' if ok else '실패'}] {name} ({where}): {passed}/{total}")
    if not ok:
        # 실패한 항목만 다시 보여 준다. 검사 스크립트는 키 값을 출력하지 않는다.
        for line in lines:
            if line.startswith("[실패]"):
                print(f"       {line}")
        if not found:
            tail = (done.stderr or done.stdout).strip().splitlines()[-3:]
            print("       결과 줄을 읽지 못함: " + " / ".join(tail))


class TempServer:
    def __init__(self, work: Path, name: str, key: str | None, host: str):
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.log_path = work / f"{name}.log"
        env = clean_env(key)
        env.update(STUDIO_BRIDGE_DB=str(work / f"{name}.db"), STUDIO_BRIDGE_PORT=str(self.port), STUDIO_BRIDGE_HOST=host)
        self.log = self.log_path.open("wb")
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "app.serve"], cwd=SERVER_DIR, env=env, stdout=self.log, stderr=subprocess.STDOUT,
        )

    def wait_ready(self) -> bool:
        for _ in range(80):
            if self.proc.poll() is not None:
                return False
            try:
                with urllib.request.urlopen(f"{self.base}/api/health", timeout=2) as res:
                    if res.status == 200:
                        return True
            except (urllib.error.URLError, OSError):
                pass
            time.sleep(0.25)
        return False

    def stop(self) -> None:
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        self.log.close()


def with_server(work: Path, name: str, key: str | None, host: str, body) -> None:
    server = TempServer(work, name, key, host)
    try:
        if server.wait_ready():
            body(server)
        else:
            rows.append((f"{name} 서버 시작", "임시 서버", 0, 1, False))
            print(f"[실패] {name} 임시 서버가 뜨지 않음. 기록: {server.log_path}")
    finally:
        server.stop()


def main() -> None:
    flags = set(sys.argv[1:])
    if flags - {"--lan", "--keep"}:
        sys.exit(__doc__)
    use_lan, keep = "--lan" in flags, "--keep" in flags
    lan = lan_address() if use_lan else None
    if use_lan and not lan:
        sys.exit("실행 중단: 이 PC의 LAN 주소를 찾지 못했습니다. 네트워크에 연결한 뒤 다시 실행하거나 --lan 없이 실행하세요.")

    work = Path(tempfile.mkdtemp(prefix="sb-final-a-"))
    key = secrets.token_urlsafe(18)
    try:
        print("== 1. 재시작·접근 거절·복원본 (#29)")
        run_check("check_restart", "스스로 서버를 띄움", [], None)

        print("== 2. 공유 모드 (임시 팀 키)")

        def shared(server: TempServer) -> None:
            for name in SHARED_CHECKS:
                run_check(name, "공유 모드 127.0.0.1", [server.base], key)
            if lan:
                run_check("check_access", "공유 모드 LAN 주소", [f"http://{lan}:{server.port}"], key)

        with_server(work, "shared", key, "0.0.0.0" if lan else "127.0.0.1", shared)

        print("== 3. 로컬 모드 (키 없음)")

        def local(server: TempServer) -> None:
            for name in LOCAL_CHECKS:
                run_check(name, "로컬 모드 127.0.0.1", [server.base], None)

        with_server(work, "local", None, "127.0.0.1", local)

        print("== 4. 서버 기록")
        logs = [path for path in (work / "shared.log", work / "local.log") if path.exists()]
        leaked = [path.name for path in logs if key.encode() in path.read_bytes()]
        ok = bool(logs) and not leaked
        rows.append(("서버 기록에 팀 키 값 없음", f"기록 {len(logs)}개", int(ok), 1, ok))
        print(f"[{'통과' if ok else '실패'}] 임시 서버 기록 {len(logs)}개에 팀 키 값이 없음" + (f"  -> {leaked}" if leaked else ""))
    finally:
        if keep:
            print(f"\n임시 폴더를 남김: {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)

    print("\n| 검사 | 조건 | 결과 | 판정 |")
    print("| --- | --- | --- | --- |")
    for name, where, passed, total, ok in rows:
        print(f"| {name} | {where} | {passed}/{total} | {'통과' if ok else '실패'} |")
    good = sum(ok for *_rest, ok in rows)
    print(f"\n{good}/{len(rows)} 통과")
    sys.exit(0 if good == len(rows) else 1)


if __name__ == "__main__":
    main()
