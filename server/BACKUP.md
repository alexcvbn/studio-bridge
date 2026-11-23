# 백업·복원 절차 (08회차 #32, D)

자료·결정과 보드는 **서로 다른 두 저장소**에 있습니다. 둘을 **같은 시점**에 보존해야 전체 백업입니다.
DB만 복사하면 보드 카드가 사라지고, 보드만 복사하면 카드가 없는 자료를 가리킬 수 있습니다.

| 저장소 | 기본 위치 | 바꾸는 환경변수 | 담긴 것 | 실행 프로세스 |
| --- | --- | --- | --- | --- |
| SQLite | `server/studio_bridge.db` | `STUDIO_BRIDGE_DB` | 자료, 현재·이전 수집본 원문, 기능(상태·담당자), 자료–기능 연결, 결정 | API 서버 (`uvicorn`, 기본 8000) |
| Yjs (LevelDB) | `sync/data/` | `YPERSISTENCE` | 보드 카드(위치·대상 ID·색·크기), 카드 제거 기록, 카드 연결선과 지운 선 기록, 공동 메모 | 동기화 서버 (`npm start`, 기본 1234) |

도구: `server/scripts/backup_restore.py` (표준 라이브러리만 사용), 보드 읽기는 `sync/board-dump.cjs` (Node, `sync`에서 `npm ci` 필요).
명령은 모두 `server` 폴더에서 실행합니다.

## 1. 백업

1. 백업 전에 화면에서 기준이 될 장면을 확인합니다. (예: 자료함의 BossAI 현재 원문과 수집본 기록, 기능의 현재 결정, 보드 카드 위치와 메모)
2. **API 서버와 동기화 서버를 둘 다 끕니다** (각 터미널에서 Ctrl+C). 쓰기를 멈춰야 두 저장소가 같은 시점이 됩니다.
3. 백업합니다.

   ```bash
   uv run python scripts/backup_restore.py backup
   ```

   - 8000이나 1234 포트가 열려 있으면 백업하지 않고 멈춥니다. 다른 포트로 띄웠다면 `--api-port`, `--sync-port`로 알려 줍니다.
   - 기본 저장 위치는 저장소 **바깥**의 `../studio-bridge-backups/<날짜-시각>/`입니다 (실수로 커밋되지 않게). `--out`으로 바꿉니다.
   - 백업 폴더: `studio_bridge.db`, `board/`(보드 폴더 사본), `manifest.json`(파일 SHA-256과 기준값).
   - 원본과 사본에서 읽은 값이 다르면 백업 폴더를 지우고 실패로 끝냅니다.
4. 출력의 개수(자료·수집본·기능·연결·결정, 카드·제거 기록·메모 글자 수)를 1번에서 본 화면과 맞춰 봅니다.

## 2. 시험 복원과 대조

실제 데이터를 건드리지 않도록 **새 폴더**에 복원합니다. 비어 있지 않은 폴더에는 복원하지 않습니다.

```bash
uv run python scripts/backup_restore.py restore ../../studio-bridge-backups/<날짜-시각> --to /tmp/sb-restore
uv run python scripts/backup_restore.py verify ../../studio-bridge-backups/<날짜-시각> --restored /tmp/sb-restore
```

`verify`는 12개 항목을 대조합니다: 파일 SHA-256, 표별 행 수, 자료 ID·source_uid, 현재 수집본, 이전 수집본까지 원문,
기능, 연결, 결정, 보드 카드(색·크기 포함), 제거 기록, 카드 연결선, 지운 연결선 기록, 메모, 카드 참조(카드가 가리키는 자료·기능이 DB에 있는지). 연결선 기능 이전에 만든 백업은 연결선을 빈 목록으로 보고 비교한다.

## 3. 복원본으로 다시 띄워 확인

`restore`가 출력한 명령으로, 실제와 **다른 포트**에서 복원본을 띄웁니다.

```bash
# server 폴더
STUDIO_BRIDGE_DB=/tmp/sb-restore/studio_bridge.db uv run uvicorn app.main:app --port 8001
# sync 폴더
YPERSISTENCE=/tmp/sb-restore/board PORT=1235 npm start
# web 폴더
STUDIO_BRIDGE_API_TARGET=http://127.0.0.1:8001 VITE_SYNC_URL=ws://127.0.0.1:1235 npm run dev
```

API가 백업 때 값을 돌려주는지 대조합니다 (공유 모드면 `--key` 또는 `STUDIO_BRIDGE_TEAM_KEY`).

```bash
uv run python scripts/backup_restore.py verify-api ../../studio-bridge-backups/<날짜-시각> --api http://127.0.0.1:8001
```

### 복원 확인표 (화면에서 직접)

| 확인할 것 | 어디서 | 담당 | 기대 결과 |
| --- | --- | --- | --- |
| 현재 원문과 이전 수집본 | 자료함 → 자료 선택 → 수집본 기록 | D | 백업 때와 같은 현재 원문, 이전 수집본도 열림 |
| 자료 ID·source_uid | 자료함 상세 아래 작은 글씨 | D | 백업 때와 같은 값 |
| 기능 상태·담당자, 연결 자료 | 기능 화면 | C | 같음 |
| 현재 결정과 이전 결정 | 기능 화면 결정 목록 | C | 같은 번호·문장·표시명 |
| 카드 위치·종류·색·크기, 메모 | 보드 | B | 같은 위치·색·크기, 제거한 카드는 안 보임, 메모 글자 그대로 |
| 카드 연결선 | 보드 | B | 같은 카드끼리 같은 관계(1:1·1:N·N:M)·이름·방향, 지운 선은 안 보임 |
| 카드 → 자료·기능 열기 | 보드 카드 클릭 | B·D | 같은 자료·기능이 열림 |
| Studio 관련 결정 읽기 | 플러그인 서버 주소를 8001로 | A | 같은 기능·현재 결정 |

## 4. 실제 데이터로 되돌리기 (필요할 때만)

시험 복원으로 값이 맞는 것을 확인한 뒤에만 합니다. 기존 파일은 **지우지 않고 이름만 바꿔** 둡니다.

1. API 서버·동기화 서버를 끄고, **보드를 연 브라우저 탭을 모두 닫습니다** (아래 주의 1).
2. `server/studio_bridge.db` → `studio_bridge.db.before-<날짜>`, `sync/data` → `sync/data.before-<날짜>`로 이름을 바꿉니다.
3. 백업 폴더의 `studio_bridge.db`를 `server/`에, `board/`를 `sync/data`로 복사합니다.
4. 두 서버를 다시 켜고 3번 확인표대로 봅니다.

## 주의

1. **보드 탭을 닫고 복원합니다.** 브라우저는 보드 내용을 들고 있다가 다시 연결되면 서버와 합칩니다. 복원 전 탭이 남아 있으면 복원 뒤의 카드·메모가 섞일 수 있습니다.
2. **둘 중 하나만 복원하지 않습니다.** DB만 예전으로 돌리면 보드 카드가 없는 자료를 가리킬 수 있습니다 (`verify`의 "카드 참조"가 잡아냅니다).
3. 백업에는 자료 원문과 결정 문장이 그대로 들어 있습니다. 백업 폴더를 저장소에 올리거나 공유 드라이브에 그대로 두지 않습니다.
4. 팀 키는 백업에 들어가지 않습니다 (환경변수로만 씁니다). 복원본을 공유 모드로 띄울 때 키를 다시 지정합니다.
5. 서버가 켜진 채 폴더를 복사하지 않습니다. LevelDB는 켜진 채 복사하면 일관되지 않을 수 있습니다 (sync/README.md "백업" 참고).
