# Studio Bridge 플러그인 (03회차 #9, 04회차 #13, 05회차 #17)

Roblox Studio에서 선택한 스크립트 하나의 현재 편집 원문을 서버 자료함으로 보내고,
그 스크립트와 연결된 기능의 현재 결정을 읽기 전용으로 보여준다.

- 파일: `StudioBridge.lua` (로컬 플러그인 스크립트 하나)
- 보내는 주소: `POST {서버 주소}/api/projects/studio-bridge/materials/collect`
- 결정 읽는 주소: `GET {서버 주소}/api/projects/studio-bridge/context?source_uid=...`
- 기본 서버 주소: `http://localhost:8000` (패널에서 바꾸면 Studio에 저장됨)

## 설치

1. 서버를 켠다. (`server/README.md`의 설치 및 실행)
2. Studio 상단 **Plugins** 탭 → **Plugins Folder**를 눌러 로컬 플러그인 폴더를 연다.
   - Windows: `%LOCALAPPDATA%\Roblox\Plugins`
   - macOS: `~/Documents/Roblox/Plugins`
3. `plugin/StudioBridge.lua`를 그 폴더에 복사한다.
4. Studio를 다시 열면(또는 장소를 다시 열면) Plugins 탭에 **Studio Bridge** 툴바가 생긴다.

macOS 저장소 최상위 폴더에서 복사:

```bash
mkdir -p ~/Documents/Roblox/Plugins && cp plugin/StudioBridge.lua ~/Documents/Roblox/Plugins/
```

Windows PowerShell 저장소 최상위 폴더에서 복사:

```powershell
Copy-Item plugin\StudioBridge.lua "$env:LOCALAPPDATA\Roblox\Plugins\"
```

플러그인 코드를 고친 뒤에는 다시 복사하고 Studio를 다시 연다.

## HTTP 허용

- 첫 전송 때 Studio가 이 플러그인의 `localhost` 접속 허용 여부를 묻는다. **허용**을 누른다.
- 거절했다면 Plugins 탭 → **Manage Plugins** → Studio Bridge의 HTTP 권한에서 다시 허용한다.
- 그래도 연결이 안 되면 Game Settings → Security → **Allow HTTP Requests**를 켜고 다시 시도한다.
- `localhost`로 안 되면 패널의 서버 주소를 `http://127.0.0.1:8000`으로 바꿔 본다.

## 사용

1. Plugins 탭 → Studio Bridge → **패널**을 눌러 패널을 연다. 서버 주소를 확인한다.
2. Explorer에서 Script / LocalScript / ModuleScript **하나**를 선택한다. (예: `ServerScriptService.BossAI`)
3. 패널 또는 툴바의 **코드 보내기**를 누른다.
4. 웹 자료함에서 **새로고침**을 누르면 같은 이름과 원문이 보인다.

| 상황 | 패널 표시 |
|---|---|
| 아무것도 선택하지 않음 / 여러 개 선택 / 스크립트가 아님 | 빨간 안내, 전송하지 않음 |
| 요청 중 | 노란 `전송 중`, 버튼 중복 클릭 무시 |
| 서버 꺼짐·HTTP 거절·주소 오류 | 빨간 `실패`와 **다시 시도 (같은 요청)** 버튼 |
| 같은 `source_uid`를 가진 다른 스크립트가 있음 (복제본) | 빨간 `전송 중단`과 같은 ID 경로, 전송하지 않음 |
| 서버가 오류 코드로 응답 (413, 422 등) | 빨간 `실패: 서버 오류 {코드}` |
| 201/200이고 `material_id`·`snapshot_id`가 있음 | 초록 `완료`, 이름·시각·ID |

## 보내는 값

```json
{
  "source_uid": "스크립트 attribute StudioBridgeSourceUid (처음 보낼 때 UUID 생성)",
  "request_id": "전송마다 새 UUID, 다시 시도에서는 같은 값",
  "name": "BossAI",
  "source_path": "ServerScriptService.BossAI",
  "script_type": "Script",
  "raw_code": "ScriptEditorService:GetEditorSource 결과 그대로"
}
```

- `source_uid`는 스크립트의 attribute `StudioBridgeSourceUid`에 저장된다. 처음 보낼 때만 붙이며 Ctrl+Z로 되돌릴 수 있다. 장소를 저장해야 다음에 열어도 남는다.
- 원문은 편집기에서 저장하지 않은 수정까지 포함한 현재 내용이다. 줄바꿈·공백·한글을 바꾸지 않는다.
- **다시 시도**는 실패한 요청의 `request_id`와 payload를 그대로 보낸다. **코드 보내기**는 항상 새 `request_id`를 만든다.

## 같은 스크립트를 알아보는 기준 (04회차 #13)

| 값 | 역할 | 바뀌는 때 |
|---|---|---|
| `name`, `source_path` | 화면에 보여줄 정보. 대상을 찾는 데 쓰지 않는다 | 이름 변경·폴더 이동 때마다 |
| `source_uid` | 같은 스크립트인지 판단하는 유일한 기준 (attribute `StudioBridgeSourceUid`) | 처음 보낼 때 한 번 생성. 그 뒤로 플러그인이 바꾸지 않는다 |
| `request_id` | 전송 한 번의 ID. 재시도인지 새 전송인지 구분 | **코드 보내기**마다 새로 생성. **다시 시도**는 같은 값 |

서버는 `source_uid`가 같으면 같은 자료(`material_id`)에 새 수집본(`snapshot_id`)을 추가한다.
같은 `request_id`가 다시 오면 저장하지 않고 이전 결과를 돌려준다 (#16).

### 상황별 기대 결과

| 상황 | 플러그인이 보내는 값 | 서버 결과 | 상태 |
|---|---|---|---|
| BossAI를 처음 보냄 | 새 `source_uid` A, 새 `request_id` | 201, 새 `material_id` M | 구현 |
| 코드만 고쳐서 다시 보냄 | `source_uid` A, 새 `request_id` | 201, 같은 M, 새 `snapshot_id` | 구현 |
| 이름을 BossAI2로 바꾸고 보냄 | `source_uid` A, 새 `request_id`, name BossAI2 | 201, 같은 M, 자료함 이름이 BossAI2로 보임 | 구현 |
| 다른 폴더로 옮기고 보냄 | `source_uid` A, `source_path`만 바뀜 | 201, 같은 M | 구현 |
| 응답을 못 받아 **다시 시도** | 같은 `request_id`, 같은 payload | 200, `deduplicated: true`, 같은 M·`snapshot_id` | 구현 (#16) |
| 같은 `request_id`에 다른 내용 | — (플러그인은 만들지 않음) | 409 `request_id_conflict`, 이전 자료 그대로 | 구현 (#16) |
| BossAI를 복제(Ctrl+D)하고 둘 중 하나를 보냄 | 보내지 않음 | 요청 없음. 패널에 `전송 중단`과 같은 ID를 가진 경로 표시 | 구현 (이번 회차) |
| 복제본의 attribute를 지우고 보냄 | 복제본에 새 `source_uid` B | 201, 새 자료 | 수동 처리 |
| 복제본에 자동으로 새 ID 부여 | — | — | **미구현 (07회차)** |
| attribute를 지우고 원본을 보냄 | 새 `source_uid` | 새 자료로 생김 (이전 원문·기능 연결과 분리) | 알려진 한계 |

- 복제 검사는 선택한 스크립트에 이미 `source_uid`가 있을 때만 장소 전체의 스크립트를 훑는다. 플러그인이 읽을 수 없는 서비스는 건너뛴다.
- 원본과 복제본 중 어느 쪽이 원본인지 플러그인이 정하지 않는다. 사람이 확인하고 **복제본의** attribute를 지운다.
- 다른 장소 파일에 스크립트를 복사해 붙여 넣어도 attribute가 따라가므로 같은 자료로 묶인다. 이 경우는 검사하지 못한다.

## 관련 결정 읽기 (05회차 #17)

1. Explorer에서 이미 보낸 스크립트 하나를 선택한다. (예: `ServerScriptService.BossAI`)
2. 패널 또는 툴바의 **관련 결정 읽기**를 누른다.
3. 연결된 기능마다 제목·상태, 현재 결정 문장, 표시명, 기록 시각(이 PC 현지 시각)이 나온다.

- 읽기 전용이다. 결정 작성·수정은 웹 기능 상세에서 한다. 게임 속 체력 값을 읽거나 바꾸지 않는다.
- 찾는 기준은 스크립트 attribute `StudioBridgeSourceUid` 하나다. 이름·경로로 찾지 않는다.
- 읽기만 하므로 아직 보낸 적 없는 스크립트에 `source_uid`를 새로 붙이지 않는다.
- 연결된 기능이 여러 개면 서버가 준 순서(연결한 순서)대로 **모두** 보여준다. 하나를 골라 숨기지 않는다.
- 표시명은 결정을 적은 사람이 직접 입력한 이름이다. 로그인으로 확인한 신원이 아니라고 패널에 함께 적는다.
- 현재 결정은 서버가 정한 가장 큰 `decision_no`다. 플러그인이 시각으로 다시 고르지 않는다.

| 상황 | 패널 표시 | 서버 요청 |
|---|---|---|
| 선택 없음 / 여러 개 / 스크립트 아님 | 빨간 안내 | 없음 |
| attribute 없음 (아직 보낸 적 없음) | 흰색 `아직 보낸 적 없는 스크립트` | 없음 |
| 요청 중 | 노란 `읽는 중`, 버튼 `읽는 중...`, 중복 클릭 무시 | 1회 |
| 200, `material: null` (이 서버에 자료 없음) | 흰색 `서버에 이 스크립트의 자료가 없습니다` | 1회 |
| 200, `features: []` (연결 없음) | 흰색 `연결된 기능이 없습니다` | 1회 |
| 200, 기능은 있으나 `current_decision: null` | 기능 제목 아래 `결정 없음` | 1회 |
| 200, 결정 있음 | 초록, 기능별 현재 결정·표시명·시각 | 1회 |
| 서버 꺼짐·HTTP 거절·주소 오류·4xx/5xx | 빨간 `실패`와 **다시 읽기 (같은 스크립트)**. 마지막 성공 결과는 지우지 않고 아래에 따로 표시 | 1회 |
| 같은 `source_uid`를 가진 복제본이 있음 | 결과 위에 `주의` 문장과 같은 ID 경로 | 1회 |

**다시 읽기**는 실패했던 스크립트를 다시 읽는다. 그 사이 선택이 바뀌어도 대상이 바뀌지 않는다.

## 알려진 한계 (다음 회차)

- 복제본에 새 `source_uid`를 자동으로 붙이는 처리는 07회차(#25)에서 다룬다. 지금은 전송을 멈추고 안내만 한다.

## 검증 순서 (#9)

| 입력 | 조작 | 기대값 |
|---|---|---|
| BossAI 하나 선택 | 코드 보내기 | 초록 완료, material_id 표시 |
| 같은 상태 | 웹 자료함 새로고침 → BossAI 선택 | 이름·경로·원문이 Studio 코드와 같음, material_id가 패널 값과 같음 |
| 선택 없음 | 코드 보내기 | 빨간 안내, 서버 요청 없음 |
| Part 하나 선택 | 코드 보내기 | 빨간 안내, 서버 요청 없음 |
| 서버 종료 | 코드 보내기 | 빨간 실패 + 다시 시도 버튼, 완료 표시 없음 |
| 서버 다시 실행 | 다시 시도 | 초록 완료, 웹에 자료 1건 추가 |

## 검증 순서 (#13)

| 입력 | 조작 | 기대값 |
|---|---|---|
| 이미 보낸 BossAI | 이름을 BossAI2로 바꾸고 코드 보내기 | 초록 완료, material_id가 이전과 같음. 자료함 이름 BossAI2 |
| BossAI2 | Ctrl+D로 복제 후 원본 선택 → 코드 보내기 | 빨간 전송 중단, 복제본 경로 표시, 서버 요청 없음 |
| 복제본 | Properties에서 `StudioBridgeSourceUid` 삭제 → 복제본 코드 보내기 | 초록 완료, 새 material_id |
| 원본 | 다시 코드 보내기 | 초록 완료, 처음 material_id 그대로 |

## 검증 순서 (#17)

준비: 서버 실행, 웹에서 기능 `보스 2페이즈` 생성 → 자료함의 BossAI를 그 기능에 연결 → 기능 상세에서 결정 `체력 5000. 이유: 첫 테스트의 전투 시간을 맞추기 위해서.` (표시명 `황재민`) 저장.

| 입력 | 조작 | 기대값 |
|---|---|---|
| BossAI 선택 | 관련 결정 읽기 | 초록, `[1] 보스 2페이즈`, 현재 결정이 웹과 같은 문장, 표시명 `황재민`, 시각이 웹과 같음 |
| BossAI를 기능 하나에 더 연결 | 관련 결정 읽기 | 기능 2개 모두 표시. 결정 없는 쪽은 `결정 없음` |
| 웹에서 결정을 하나 더 저장 | 관련 결정 읽기 | 새 결정으로 바뀜, `#` 번호 증가 |
| 한 번도 보내지 않은 스크립트 | 관련 결정 읽기 | `아직 보낸 적 없는 스크립트`, attribute가 새로 생기지 않음 |
| 보냈지만 연결 안 한 스크립트 | 관련 결정 읽기 | `연결된 기능이 없습니다` |
| 서버 종료 | 관련 결정 읽기 | 빨간 실패 + 다시 읽기, 이전 성공 결과는 아래에 따로 남음 |
| 서버 다시 실행 | 다시 읽기 | 초록, 결정 표시 |
