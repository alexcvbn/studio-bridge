# Studio Bridge 플러그인 (03회차 #9)

Roblox Studio에서 선택한 스크립트 하나의 현재 편집 원문을 서버 자료함으로 보낸다.

- 파일: `StudioBridge.lua` (로컬 플러그인 스크립트 하나)
- 보내는 주소: `POST {서버 주소}/api/projects/studio-bridge/materials/collect`
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

## 알려진 한계 (다음 회차)

- 서버의 같은 `request_id` 재시도 처리(200 + `deduplicated: true`, 다른 payload면 409)는 04회차 #16에서 들어간다.
  그 전에는 서버가 실제로 저장했는데 응답만 못 받은 요청을 다시 시도하면 서버 오류(500)가 난다.
- 스크립트를 복제하면 attribute도 복사되어 같은 `source_uid`를 갖는다. 복제 구분은 04회차 #13에서 다룬다.

## 검증 순서 (#9)

| 입력 | 조작 | 기대값 |
|---|---|---|
| BossAI 하나 선택 | 코드 보내기 | 초록 완료, material_id 표시 |
| 같은 상태 | 웹 자료함 새로고침 → BossAI 선택 | 이름·경로·원문이 Studio 코드와 같음, material_id가 패널 값과 같음 |
| 선택 없음 | 코드 보내기 | 빨간 안내, 서버 요청 없음 |
| Part 하나 선택 | 코드 보내기 | 빨간 안내, 서버 요청 없음 |
| 서버 종료 | 코드 보내기 | 빨간 실패 + 다시 시도 버튼, 완료 표시 없음 |
| 서버 다시 실행 | 다시 시도 | 초록 완료, 웹에 자료 1건 추가 |
