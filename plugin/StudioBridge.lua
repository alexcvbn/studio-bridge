-- Studio Bridge 플러그인 (03회차 #9, A 담당)
-- Studio에서 선택한 스크립트 하나의 현재 편집 원문을 서버 자료함으로 보낸다.
-- 서버 계약: POST {서버}/api/projects/studio-bridge/materials/collect
--   보냄: source_uid, request_id, name, source_path, script_type, raw_code
--   받음: material_id, snapshot_id, deduplicated
-- 04회차 #13: 같은 source_uid를 가진 스크립트(복제본)가 있으면 전송을 멈춘다.
-- 05회차 #17: 선택한 스크립트의 연결 기능·현재 결정을 읽기 전용으로 보여준다.
--   GET {서버}/api/projects/studio-bridge/context?source_uid=...
--   받음: material 또는 null, features[] (기능마다 current_decision 또는 null)
-- 06회차 #21: 공유 모드 서버의 팀 키를 X-StudioBridge-Key 헤더로 보내고, '연결 확인'으로
--   서버 꺼짐 / 키 필요·틀림 / 허용 안 됨 / 연결됨을 구분한다.
--   GET {서버}/api/projects/studio-bridge/access → { project_id, mode: "shared" | "local" }
-- 07회차 #25: 이름 변경·복제·선택 없음·전송 실패를 안전하게 처리한다.
--   · 지금 선택한 것과 그 ID를 패널에 항상 보여준다. 이름·위치를 바꿔도 ID는 그대로다.
--   · 복제본(같은 source_uid)을 찾으면 전송을 멈추고, 사람이 복제본이라고 확인한 쪽에만 새 ID를 준다.
--     원본의 ID는 자동으로 바꾸지 않는다. 원본 확인을 돕기 위해 서버가 마지막에 받은 원문과 비교해 보여준다.
--     GET {서버}/api/projects/studio-bridge/materials/by-source?source_uid=... (D #20)
--   · 보내지 못한 요청(payload·request_id)은 이 PC의 플러그인 설정에 보존한다. Studio를 다시 열어도 남고,
--     '다시 시도'는 같은 request_id·같은 payload를 그대로 보낸다. 조용히 버리지 않는다.
-- 이번 범위에서 만들지 않는 것: 자동 전송 감시, 게임 값 변경, 코드 요약, 결정 작성·수정,
--   원본·복제본 자동 판별, 충돌한 스크립트를 같은 자료로 합치기.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local PROJECT_ID = "studio-bridge"
local DEFAULT_SERVER = "http://localhost:8000"
local SETTING_SERVER = "StudioBridgeServerUrl"
-- 팀 키는 이 PC의 플러그인 설정에만 둔다. 화면에는 다시 보여주지 않는다. (06회차 #21)
local SETTING_KEY = "StudioBridgeTeamKey"
local KEY_HEADER = "X-StudioBridge-Key"
local KEY_MASK = "●●●●●●●● (저장됨, 바꾸려면 클릭)"
-- source_uid는 스크립트 객체의 attribute에 둔다. 이름·경로가 바뀌어도 그대로 남는다.
local UID_ATTRIBUTE = "StudioBridgeSourceUid"
local SCRIPT_TYPES = { Script = true, LocalScript = true, ModuleScript = true }
-- 서버가 받는 원문 최대 크기(UTF-8 바이트). 넘으면 보내기 전에 멈춘다. (공통 안내 5절, 서버는 413)
local MAX_RAW_BYTES = 256 * 1024
-- 보내지 못한 요청을 보존하는 플러그인 설정 이름. 이 PC에만 저장된다. (07회차 #25)
local SETTING_FAILED = "StudioBridgeFailedSend"
-- 같은 요청을 다시 보내도 결과가 같은 서버 응답. 원인을 고친 뒤 새 요청으로 보내야 한다.
local NOT_RETRYABLE = { [409] = true, [413] = true, [422] = true }

type Payload = {
	source_uid: string,
	request_id: string,
	name: string,
	source_path: string,
	script_type: string,
	raw_code: string,
}
local PAYLOAD_FIELDS = { "source_uid", "request_id", "name", "source_path", "script_type", "raw_code" }

-- ---------- 화면 ----------
local toolbar = plugin:CreateToolbar("Studio Bridge")
local panelButton = toolbar:CreateButton("패널", "Studio Bridge 패널 열기/닫기", "")
local sendToolbarButton = toolbar:CreateButton("코드 보내기", "선택한 스크립트 하나를 웹 자료함으로 보내기", "")
local readToolbarButton =
	toolbar:CreateButton("관련 결정 읽기", "선택한 스크립트와 연결된 기능의 현재 결정 읽기", "")
panelButton.ClickableWhenViewportHidden = true
sendToolbarButton.ClickableWhenViewportHidden = true
readToolbarButton.ClickableWhenViewportHidden = true

local widget = plugin:CreateDockWidgetPluginGui(
	"StudioBridgePanel",
	DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 360, 520, 280, 320)
)
widget.Title = "Studio Bridge"

-- 결정이 여러 개면 길어지므로 패널 전체를 스크롤한다.
local root = Instance.new("ScrollingFrame")
root.Size = UDim2.fromScale(1, 1)
root.BackgroundColor3 = Color3.fromRGB(46, 46, 46)
root.BorderSizePixel = 0
root.CanvasSize = UDim2.new(0, 0, 0, 0)
root.AutomaticCanvasSize = Enum.AutomaticSize.Y
root.ScrollingDirection = Enum.ScrollingDirection.Y
root.ScrollBarThickness = 6
root.Parent = widget

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 8)
padding.PaddingBottom = UDim.new(0, 8)
padding.PaddingLeft = UDim.new(0, 8)
padding.PaddingRight = UDim.new(0, 14)
padding.Parent = root

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 6)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = root

local function makeLabel(text: string, order: number, height: number): TextLabel
	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, 0, 0, height)
	label.BackgroundTransparency = 1
	label.TextColor3 = Color3.fromRGB(230, 230, 230)
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextYAlignment = Enum.TextYAlignment.Top
	label.TextWrapped = true
	label.Font = Enum.Font.Gotham
	label.TextSize = 13
	label.Text = text
	label.LayoutOrder = order
	label.Parent = root
	return label
end

local function makeButton(text: string, order: number): TextButton
	local button = Instance.new("TextButton")
	button.Size = UDim2.new(1, 0, 0, 28)
	button.BackgroundColor3 = Color3.fromRGB(0, 120, 215)
	button.TextColor3 = Color3.new(1, 1, 1)
	button.Font = Enum.Font.GothamBold
	button.TextSize = 14
	button.Text = text
	button.AutoButtonColor = true
	button.LayoutOrder = order
	button.Parent = root
	return button
end

makeLabel("서버 주소", 1, 16)

local serverBox = Instance.new("TextBox")
serverBox.Size = UDim2.new(1, 0, 0, 26)
serverBox.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
serverBox.TextColor3 = Color3.new(1, 1, 1)
serverBox.Font = Enum.Font.Code
serverBox.TextSize = 13
serverBox.TextXAlignment = Enum.TextXAlignment.Left
serverBox.ClearTextOnFocus = false
serverBox.Text = (plugin:GetSetting(SETTING_SERVER) :: string?) or DEFAULT_SERVER
serverBox.LayoutOrder = 2
serverBox.Parent = root

-- 06회차 #21: 팀 키 (공유 모드 서버일 때만)
makeLabel("팀 키 (공유 모드 서버일 때만. 로컬 모드는 비워 둠)", 3, 16)

local teamKey: string = (plugin:GetSetting(SETTING_KEY) :: string?) or ""

local keyBox = Instance.new("TextBox")
keyBox.Size = UDim2.new(1, 0, 0, 26)
keyBox.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
keyBox.TextColor3 = Color3.new(1, 1, 1)
keyBox.PlaceholderText = "팀 키 입력 후 Enter"
keyBox.Font = Enum.Font.Code
keyBox.TextSize = 13
keyBox.TextXAlignment = Enum.TextXAlignment.Left
-- 누르면 가림 표시를 지우고 새 키를 받는다. 아무것도 입력하지 않으면 기존 키를 유지한다.
keyBox.ClearTextOnFocus = true
keyBox.LayoutOrder = 4
keyBox.Parent = root

local checkButton = makeButton("연결 확인", 5)
local clearKeyButton = makeButton("저장된 팀 키 지우기", 6)
clearKeyButton.BackgroundColor3 = Color3.fromRGB(110, 110, 110)
local connLabel = makeLabel("서버 주소와 (공유 모드면) 팀 키를 넣고 '연결 확인'을 누르세요.", 7, 0)
connLabel.AutomaticSize = Enum.AutomaticSize.Y

-- 07회차 #25: 지금 선택한 것과 그 ID. 누르기 전에 무엇이 보내질지 알 수 있다.
local selectionLabel = makeLabel("선택: 확인 중...", 12, 0)
selectionLabel.AutomaticSize = Enum.AutomaticSize.Y

local sendButton = makeButton("코드 보내기", 13)
local retryButton = makeButton("다시 시도 (같은 요청)", 14)
retryButton.BackgroundColor3 = Color3.fromRGB(110, 110, 110)
retryButton.Visible = false
local discardButton = makeButton("실패한 요청 버리기", 15)
discardButton.BackgroundColor3 = Color3.fromRGB(110, 110, 110)
discardButton.Visible = false
-- 복제본 충돌 안내가 떠 있을 때만 보인다. 두 번 눌러야 새 ID를 준다.
local CLONE_TEXT = "선택한 스크립트는 복제본 → 새 ID 부여"
local CLONE_CONFIRM_TEXT = "확인: 이 스크립트에 새 ID 부여"
local cloneButton = makeButton(CLONE_TEXT, 16)
cloneButton.BackgroundColor3 = Color3.fromRGB(190, 110, 30)
cloneButton.Visible = false

local statusLabel = makeLabel("스크립트 하나를 선택하고 '코드 보내기'를 누르세요.", 17, 0)
statusLabel.AutomaticSize = Enum.AutomaticSize.Y

-- 05회차 #17: 관련 결정 읽기 (읽기 전용)
local divider = makeLabel("관련 기능·현재 결정 (읽기 전용)", 18, 18)
divider.Font = Enum.Font.GothamBold
local readButton = makeButton("관련 결정 읽기", 19)
local readRetryButton = makeButton("다시 읽기 (같은 스크립트)", 20)
readRetryButton.BackgroundColor3 = Color3.fromRGB(110, 110, 110)
readRetryButton.Visible = false
local contextLabel = makeLabel("스크립트 하나를 선택하고 '관련 결정 읽기'를 누르세요.", 21, 0)
contextLabel.AutomaticSize = Enum.AutomaticSize.Y

-- ---------- 상태 ----------
local sending = false
-- 보내지 못한 요청. 다시 시도할 때 같은 request_id·같은 payload를 그대로 보낸다.
-- 성공하거나 사람이 '실패한 요청 버리기'를 누를 때까지 지우지 않는다. (07회차 #25)
type FailedSend = { payload: Payload, failed_at: string, retryable: boolean }
local failedSend: FailedSend? = nil
local failedPersisted = false -- 플러그인 설정에도 저장됐는지. 안 됐으면 패널이 열려 있는 동안만 남는다.

-- 복제본 충돌 안내 상태. 같은 source_uid를 가진 스크립트가 둘 이상일 때만 있다. (07회차 #25)
type ServerCopy = { name: string, source_path: string, raw_code: string, received_at: any }
type Collision = {
	uid: string,
	server: ServerCopy?, -- 서버가 이 ID로 마지막에 받은 수집본. 원본 확인을 돕는 참고 정보다.
	serverNote: string, -- 서버 기록이 없을 때 그 이유
	confirming: boolean, -- 새 ID 부여를 한 번 눌러 확인을 기다리는 중
}
local collision: Collision? = nil

-- 결정 조회 상태
type ReadTarget = { source_uid: string, name: string, path: string, warning: string? }
local reading = false
local failedRead: ReadTarget? = nil -- 실패한 조회. 다시 읽기는 선택이 바뀌어도 같은 스크립트를 읽는다.
local lastReadText: string? = nil -- 마지막으로 성공한 조회 결과. 실패해도 지우지 않는다.

local TONE_COLORS = {
	info = Color3.fromRGB(230, 230, 230),
	busy = Color3.fromRGB(255, 214, 102),
	ok = Color3.fromRGB(120, 220, 140),
	fail = Color3.fromRGB(255, 120, 120),
}
type Tone = "info" | "busy" | "ok" | "fail"

local function setStatus(text: string, tone: Tone)
	statusLabel.Text = text
	statusLabel.TextColor3 = TONE_COLORS[tone]
end

local function setConn(text: string, tone: Tone)
	connLabel.Text = text
	connLabel.TextColor3 = TONE_COLORS[tone]
end

local function setContext(text: string, tone: Tone)
	contextLabel.Text = text
	contextLabel.TextColor3 = TONE_COLORS[tone]
end

local function refreshButtons()
	sendButton.Active = not sending
	sendButton.AutoButtonColor = not sending
	sendButton.Text = if sending then "전송 중..." else "코드 보내기"
	retryButton.Visible = failedSend ~= nil
	retryButton.Active = not sending
	discardButton.Visible = failedSend ~= nil
	discardButton.Active = not sending
	cloneButton.Visible = collision ~= nil
	cloneButton.Active = not sending
	cloneButton.Text = if collision ~= nil and collision.confirming then CLONE_CONFIRM_TEXT else CLONE_TEXT

	readButton.Active = not reading
	readButton.AutoButtonColor = not reading
	readButton.Text = if reading then "읽는 중..." else "관련 결정 읽기"
	readRetryButton.Visible = failedRead ~= nil
	readRetryButton.Active = not reading
end

local function serverUrl(): string
	-- 끝의 / 는 지워서 주소를 이어 붙일 때 // 가 생기지 않게 한다.
	local url = string.gsub(serverBox.Text, "%s+", "")
	url = string.gsub(url, "/+$", "")
	return url
end

serverBox.FocusLost:Connect(function()
	serverBox.Text = serverUrl()
	plugin:SetSetting(SETTING_SERVER, serverBox.Text)
end)

-- ---------- 표시용 도우미 ----------
local function orText(value: any, fallback: string): string
	return if type(value) == "string" and value ~= "" then value else fallback
end

-- 서버 시각(UTC ISO 8601)을 이 PC의 현지 시각으로 바꾼다. 읽지 못하면 받은 문자열 그대로 둔다.
local function localTime(iso: any): string
	if type(iso) ~= "string" then
		return "시각 없음"
	end
	local y, mo, d, h, mi, s = string.match(iso, "^(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)")
	if not y then
		return iso
	end
	local ok, formatted = pcall(function()
		local dt = DateTime.fromUniversalTime(
			tonumber(y) :: number,
			tonumber(mo) :: number,
			tonumber(d) :: number,
			tonumber(h) :: number,
			tonumber(mi) :: number,
			tonumber(s) :: number
		)
		return dt:FormatLocalTime("YYYY-MM-DD HH:mm:ss", "ko-kr")
	end)
	return if ok then formatted else iso
end

-- 웹 자료함의 '줄 수'와 같은 기준(줄바꿈 개수 + 1)으로 센다.
local function lineCount(code: string): number
	local _, breaks = string.gsub(code, "\n", "")
	return breaks + 1
end

-- 웹의 이전 원문 목록이 보여주는 '요청 앞 8자'와 같은 모양. 화면에서 서로 맞춰 볼 수 있다.
local function shortId(id: string): string
	return string.sub(id, 1, 8)
end

-- ---------- 팀 키 (06회차 #21) ----------
local function showKeyMask()
	keyBox.Text = if teamKey ~= "" then KEY_MASK else ""
	clearKeyButton.Visible = teamKey ~= ""
end

keyBox.FocusLost:Connect(function()
	local typed = string.gsub(keyBox.Text, "^%s+", "")
	typed = string.gsub(typed, "%s+$", "")
	if typed ~= "" and typed ~= KEY_MASK then
		teamKey = typed
		plugin:SetSetting(SETTING_KEY, teamKey)
		setConn("팀 키를 저장했습니다. '연결 확인'으로 서버가 받아 주는지 확인하세요.", "info")
	end
	showKeyMask()
end)

clearKeyButton.Activated:Connect(function()
	teamKey = ""
	plugin:SetSetting(SETTING_KEY, "")
	showKeyMask()
	setConn("저장된 팀 키를 지웠습니다. 로컬 모드 서버에만 연결됩니다.", "info")
end)

-- 모든 제품 요청에 같은 헤더를 붙인다. 키는 헤더로만 보내고 주소·화면에 넣지 않는다.
local function requestHeaders(json: boolean): { [string]: string }
	local headers = {}
	if json then
		headers["Content-Type"] = "application/json"
	end
	if teamKey ~= "" then
		headers[KEY_HEADER] = teamKey
	end
	return headers
end

-- 연결 자체가 안 될 때 확인할 것. 다른 PC의 localhost는 서버 PC가 아니다.
local CONNECT_HINT =
	"확인: 서버가 켜져 있는지, 다른 PC의 서버라면 주소가 http://서버PC IP:8000인지(localhost 아님), 서버가 공유 모드로 실행 중인지, 서버 PC 방화벽이 8000번을 막지 않는지."

-- ---------- 선택 검사 ----------
local function pickScript(): (LuaSourceContainer?, string?)
	local selected = Selection:Get()
	if #selected == 0 then
		return nil, "선택한 스크립트가 없습니다. Explorer에서 스크립트 하나를 선택하세요."
	end
	if #selected > 1 then
		return nil, `{#selected}개를 선택했습니다. 스크립트 하나만 선택하세요.`
	end
	local target = selected[1]
	if not SCRIPT_TYPES[target.ClassName] then
		return nil, `{target.Name}은(는) {target.ClassName}입니다. Script/LocalScript/ModuleScript만 보낼 수 있습니다.`
	end
	return target :: LuaSourceContainer, nil
end

-- 스크립트에 붙어 있는 source_uid. 없거나 읽을 수 없으면 nil. 여기서는 새로 만들지 않는다.
local function sourceUidOf(item: Instance): string?
	local ok, uid = pcall(function()
		return item:GetAttribute(UID_ATTRIBUTE)
	end)
	if ok and type(uid) == "string" and uid ~= "" then
		return uid
	end
	return nil
end

-- 지금 선택한 것과 그 ID를 보여준다. 이름·위치를 바꾸면 이름·경로 줄만 바뀌고 ID 줄은 그대로다. (07회차 #25)
local DIM_COLOR = Color3.fromRGB(170, 170, 170)
local watched: { RBXScriptConnection } = {}

local function refreshSelection()
	for _, connection in watched do
		connection:Disconnect()
	end
	table.clear(watched)

	local target, problem = pickScript()
	if target == nil then
		selectionLabel.Text = `선택: {problem or "확인할 수 없습니다."}`
		selectionLabel.TextColor3 = DIM_COLOR
		return
	end
	local uid = sourceUidOf(target)
	local idText = if uid
		then `ID {shortId(uid)}… (이름·위치를 바꿔도 그대로)`
		else "ID 없음: 아직 보낸 적 없는 스크립트 (처음 보낼 때 생성)"
	selectionLabel.Text = `선택: {target.Name} · {target.ClassName}\n{target:GetFullName()}\n{idText}`
	selectionLabel.TextColor3 = TONE_COLORS.info
	-- 선택은 그대로인데 이름·위치·ID만 바뀌는 경우도 따라간다.
	table.insert(watched, target:GetPropertyChangedSignal("Name"):Connect(refreshSelection))
	table.insert(watched, target.AncestryChanged:Connect(refreshSelection))
	table.insert(watched, target:GetAttributeChangedSignal(UID_ATTRIBUTE):Connect(refreshSelection))
end

-- ---------- 원문·ID ----------
local function readSource(target: LuaSourceContainer): string
	-- 편집기에 열려 있으면 저장 전 편집 내용까지 읽는다. 실패하면 Source 속성을 쓴다.
	local ok, source = pcall(function()
		return ScriptEditorService:GetEditorSource(target)
	end)
	if ok and type(source) == "string" then
		return source
	end
	return (target :: any).Source
end

local function newUid(): string
	return string.lower(HttpService:GenerateGUID(false))
end

-- attribute를 쓰는 유일한 곳. Ctrl+Z로 되돌릴 수 있게 기록한다.
local function writeSourceUid(target: LuaSourceContainer, uid: string, recordName: string)
	local recording = ChangeHistoryService:TryBeginRecording(recordName)
	target:SetAttribute(UID_ATTRIBUTE, uid)
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
end

local function ensureSourceUid(target: LuaSourceContainer): string
	local existing = sourceUidOf(target)
	if existing then
		return existing
	end
	-- 처음 보내는 스크립트에만 attribute를 붙인다.
	local uid = newUid()
	writeSourceUid(target, uid, "Studio Bridge source_uid 지정")
	return uid
end

-- 같은 source_uid를 가진 다른 스크립트를 찾는다. (04회차 #13)
-- 스크립트를 복제하면 attribute도 복사되므로, 서로 다른 스크립트가 같은 자료로 섞일 수 있다.
-- 찾으면 전송을 멈춘다. 새 ID는 사람이 복제본이라고 확인한 쪽에만 준다. (07회차 #25)
local function findDuplicates(target: LuaSourceContainer): { LuaSourceContainer }
	local found: { LuaSourceContainer } = {}
	local uid = sourceUidOf(target)
	if uid == nil then
		return found -- 처음 보내는 스크립트는 새 UUID를 받으므로 겹치지 않는다.
	end
	for _, service in game:GetChildren() do
		-- 일부 서비스는 플러그인이 읽을 수 없어 오류가 난다. 그 서비스만 건너뛴다.
		local ok, descendants = pcall(function()
			return service:GetDescendants()
		end)
		if ok then
			for _, item in descendants do
				if item ~= target then
					local readOk, same = pcall(function()
						return item:IsA("LuaSourceContainer") and item:GetAttribute(UID_ATTRIBUTE) == uid
					end)
					if readOk and same then
						table.insert(found, item :: any)
					end
				end
			end
		end
	end
	return found
end

local function buildPayload(target: LuaSourceContainer, source: string): Payload
	return {
		source_uid = ensureSourceUid(target),
		request_id = newUid(),
		name = target.Name,
		source_path = target:GetFullName(),
		script_type = target.ClassName,
		raw_code = source,
	}
end

-- ---------- 보내지 못한 요청 보존 (07회차 #25) ----------
-- 플러그인 설정에 저장한다. 저장에 성공했는지 돌려준다.
local function persistFailed(): boolean
	local current = failedSend
	local ok, stored = pcall(function()
		if current == nil then
			plugin:SetSetting(SETTING_FAILED, "")
			return true
		end
		local encoded = HttpService:JSONEncode(current)
		-- 다시 읽었을 때 원문이 한 글자라도 달라지면 '같은 payload 재시도'가 아니게 된다. 그런 저장은 하지 않는다.
		local back = HttpService:JSONDecode(encoded)
		if
			type(back) ~= "table"
			or type(back.payload) ~= "table"
			or back.payload.raw_code ~= current.payload.raw_code
		then
			plugin:SetSetting(SETTING_FAILED, "")
			return false
		end
		plugin:SetSetting(SETTING_FAILED, encoded)
		return true
	end)
	return ok and stored == true
end

-- 이전 Studio 실행에서 보존한 요청을 읽는다. 모양이 맞지 않으면 쓰지 않는다.
local function loadFailed(): FailedSend?
	local ok, decoded = pcall(function()
		local raw = plugin:GetSetting(SETTING_FAILED)
		if type(raw) ~= "string" or raw == "" then
			return nil
		end
		return HttpService:JSONDecode(raw)
	end)
	if not ok or type(decoded) ~= "table" or type(decoded.payload) ~= "table" then
		return nil
	end
	local stored = decoded.payload
	for _, field in PAYLOAD_FIELDS do
		if type(stored[field]) ~= "string" then
			return nil
		end
	end
	if stored.source_uid == "" or stored.request_id == "" or not SCRIPT_TYPES[stored.script_type] then
		return nil
	end
	return {
		payload = {
			source_uid = stored.source_uid,
			request_id = stored.request_id,
			name = stored.name,
			source_path = stored.source_path,
			script_type = stored.script_type,
			raw_code = stored.raw_code,
		},
		failed_at = orText(decoded.failed_at, "시각 모름"),
		retryable = decoded.retryable ~= false,
	}
end

local function rememberFailure(payload: Payload, retryable: boolean)
	failedSend = {
		payload = payload,
		failed_at = os.date("%Y-%m-%d %H:%M:%S") :: string,
		retryable = retryable,
	}
	failedPersisted = persistFailed()
end

local function forgetFailure()
	failedSend = nil
	failedPersisted = false
	persistFailed()
end

local function failedSummary(failed: FailedSend): string
	local stored = failed.payload
	return `{stored.name}  ({stored.source_path})\n실패 시각 {failed.failed_at} · 원문 {lineCount(stored.raw_code)}줄 · 요청 {shortId(stored.request_id)}`
end

local function failureGuide(retryable: boolean): string
	local kept = if failedPersisted
		then "보내려던 원문과 요청 ID를 이 PC에 보존했습니다. Studio를 다시 열어도 남습니다."
		else "보내려던 원문과 요청 ID를 보존했습니다. 단, 설정에 저장하지 못해 Studio를 닫으면 사라집니다."
	if retryable then
		return `{kept}\n서버가 준비되면 '다시 시도 (같은 요청)'을 누르세요. 선택을 바꾸거나 해제해도 같은 요청을 보냅니다.`
	end
	return `{kept}\n이 오류는 같은 요청을 다시 보내도 그대로입니다. 원인을 고친 뒤 '실패한 요청 버리기'를 누르고 새로 보내세요.`
end

-- ---------- 전송 ----------
local function errorMessage(statusCode: number, body: string): string
	local ok, decoded = pcall(function()
		return HttpService:JSONDecode(body)
	end)
	if ok and type(decoded) == "table" then
		local detail = decoded.detail
		if type(detail) == "table" and type(detail.message) == "string" then
			return `서버 오류 {statusCode}: {detail.message}`
		end
		if type(detail) == "table" and detail[1] ~= nil then
			return `서버 오류 {statusCode}: 보낸 값의 형식이 맞지 않습니다.`
		end
	end
	return `서버 오류 {statusCode}`
end

-- isRetry: 보존해 둔 요청을 같은 request_id·같은 payload로 다시 보내는 경우.
local function send(payload: Payload, isRetry: boolean)
	if sending then
		return
	end
	local url = serverUrl()
	if url == "" then
		setStatus("서버 주소를 입력하세요.", "fail")
		return
	end
	sending = true
	refreshButtons()
	local what = if isRetry then `다시 시도 중 (같은 요청 {shortId(payload.request_id)})` else "전송 중"
	setStatus(`{what}: {payload.name}\n{url}`, "busy")

	local ok, result = pcall(function()
		return HttpService:RequestAsync({
			Url = `{url}/api/projects/{PROJECT_ID}/materials/collect`,
			Method = "POST",
			Headers = requestHeaders(true),
			Body = HttpService:JSONEncode(payload),
		})
	end)

	sending = false
	if not ok then
		-- 서버 꺼짐, HTTP 허용 안 됨, 주소 오류 등. 성공으로 표시하지 않는다.
		-- 응답만 못 받았을 수도 있으므로 같은 request_id로 다시 보내야 서버에 두 번 저장되지 않는다.
		rememberFailure(payload, true)
		setStatus(
			`실패: 서버에 연결하지 못했습니다. 저장됐다고 확인하지 못했습니다.\n{tostring(result)}\n{CONNECT_HINT}\n{failureGuide(true)}`,
			"fail"
		)
		refreshButtons()
		return
	end

	local response = result :: { Success: boolean, StatusCode: number, Body: string }
	local decodedOk, data = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	local saved = response.Success
		and decodedOk
		and type(data) == "table"
		and type(data.material_id) == "string"
		and type(data.snapshot_id) == "string"

	if not saved then
		local retryable = response.Success or not NOT_RETRYABLE[response.StatusCode]
		rememberFailure(payload, retryable)
		local message = if response.Success
			then "서버 응답에 material_id/snapshot_id가 없습니다. Studio Bridge 서버 주소가 맞는지 확인하세요."
			else errorMessage(response.StatusCode, response.Body)
		setStatus(`실패: {message}\n{failureGuide(retryable)}`, "fail")
		refreshButtons()
		return
	end

	forgetFailure()
	local dedup = if data.deduplicated then " (서버가 이미 받은 요청, 새로 저장하지 않음)" else ""
	setStatus(
		`완료{dedup}: {payload.name}\n{os.date("%Y-%m-%d %H:%M:%S")}\nmaterial_id {data.material_id}\nsnapshot_id {data.snapshot_id}\n요청 {shortId(payload.request_id)} · 원문 {lineCount(payload.raw_code)}줄`,
		"ok"
	)
	refreshButtons()
end

-- ---------- 복제본 충돌 처리 (07회차 #25) ----------
local function clearCollision()
	collision = nil
	refreshButtons()
end

-- 서버가 이 ID로 마지막에 받은 수집본을 읽는다. 원본 확인을 돕는 참고 정보이며, 실패해도 충돌 처리는 계속된다.
local function fetchServerCopy(uid: string): (ServerCopy?, string)
	local unreadable =
		"서버 기록을 읽지 못했습니다 (서버 꺼짐·주소·팀 키 확인). 어느 쪽이 원본인지 Explorer에서 직접 확인하세요."
	local url = serverUrl()
	if url == "" then
		return nil, unreadable
	end
	local ok, result = pcall(function()
		return HttpService:RequestAsync({
			Url = `{url}/api/projects/{PROJECT_ID}/materials/by-source?source_uid={HttpService:UrlEncode(uid)}`,
			Method = "GET",
			Headers = requestHeaders(false),
		})
	end)
	if not ok or not (result :: any).Success then
		return nil, unreadable
	end
	local decodedOk, decoded = pcall(function()
		return HttpService:JSONDecode((result :: any).Body)
	end)
	if not decodedOk or type(decoded) ~= "table" or decoded.source_uid ~= uid then
		return nil, unreadable
	end
	local material = decoded.material
	if type(material) ~= "table" then
		return nil, "서버에는 이 ID로 받은 자료가 없습니다. 아직 한 번도 보내지 않은 ID입니다."
	end
	local snapshot = material.current_snapshot
	if type(snapshot) ~= "table" or type(snapshot.raw_code) ~= "string" then
		return nil, unreadable
	end
	return {
		name = orText(snapshot.name, "(이름 없음)"),
		source_path = orText(snapshot.source_path, "(경로 없음)"),
		raw_code = snapshot.raw_code,
		received_at = snapshot.received_at,
	},
		""
end

-- 같은 이름·같은 경로의 복제본도 구분할 수 있게 줄 수와 서버 원문 비교 결과를 붙인다.
local function describeScript(item: LuaSourceContainer, server: ServerCopy?): string
	local ok, source = pcall(readSource, item)
	if not ok or type(source) ~= "string" then
		return "원문을 읽지 못함"
	end
	local compare = ""
	if server then
		compare = if source == server.raw_code then " · 서버 최신 원문과 같음" else " · 서버 최신 원문과 다름"
	end
	return `{lineCount(source)}줄{compare}`
end

-- 충돌 안내를 지금 선택한 스크립트 기준으로 다시 그린다.
local function renderCollision(target: LuaSourceContainer)
	local current = collision
	if current == nil then
		return
	end
	local others = findDuplicates(target)
	if #others == 0 then
		clearCollision()
		setStatus("같은 ID를 가진 스크립트가 이제 하나뿐입니다. '코드 보내기'를 누르세요.", "info")
		return
	end

	local lines = {}
	if current.confirming then
		table.insert(lines, "확인: 아래 스크립트를 복제본으로 보고 새 ID를 줍니다.")
		table.insert(lines, `▶ {target:GetFullName()} ({describeScript(target, current.server)})`)
		table.insert(
			lines,
			"· 다음 전송부터 서버에서 새 자료가 됩니다. 기존 자료의 이전 원문·기능 연결·결정은 따라오지 않습니다."
		)
		table.insert(lines, `· 같은 ID의 나머지 {#others}개는 바꾸지 않습니다. 그쪽이 기존 자료(원본)로 남습니다.`)
		table.insert(lines, "· Ctrl+Z로 되돌릴 수 있습니다.")
		table.insert(
			lines,
			`맞으면 '{CLONE_CONFIRM_TEXT}'를 누르세요. 아니면 Explorer에서 다른 스크립트를 선택하세요.`
		)
	else
		table.insert(
			lines,
			`전송 중단: source_uid가 같은 스크립트가 {#others + 1}개 있습니다. 복제하면 ID도 같이 복사되어 서버가 둘을 구분하지 못합니다.`
		)
		table.insert(lines, `ID {shortId(current.uid)}…`)
		table.insert(lines, `▶ 선택: {target:GetFullName()} ({describeScript(target, current.server)})`)
		for index, other in others do
			if index > 4 then
				table.insert(lines, `   외 {#others - 4}개`)
				break
			end
			table.insert(lines, `· 같은 ID: {other:GetFullName()} ({describeScript(other, current.server)})`)
		end
		local server = current.server
		if server then
			table.insert(
				lines,
				`서버가 이 ID로 마지막에 받은 것: {server.name} ({server.source_path}) · {localTime(server.received_at)}`
			)
		else
			table.insert(lines, current.serverNote)
		end
		table.insert(lines, "")
		table.insert(
			lines,
			"원본의 ID는 바꾸지 않습니다. 복제본에만 새 ID를 줍니다. 어느 쪽이 원본인지는 사람이 정합니다."
		)
		table.insert(lines, `· 지금 선택한 쪽이 복제본이면 '{CLONE_TEXT}'를 누르세요.`)
		table.insert(
			lines,
			"· 지금 선택한 쪽이 원본이면 Explorer에서 복제본을 선택하세요. 이 안내가 그 스크립트 기준으로 바뀝니다."
		)
		table.insert(
			lines,
			"서버 원문과 같다는 것은 참고 정보입니다. 복제 직후에는 둘 다 같습니다. 기능·결정이 계속 붙어 있어야 하는 쪽이 원본입니다."
		)
	end
	setStatus(table.concat(lines, "\n"), "fail")
	refreshButtons()
end

local function enterCollision(target: LuaSourceContainer, uid: string)
	local entered: Collision =
		{ uid = uid, server = nil, serverNote = "서버 기록을 읽는 중...", confirming = false }
	collision = entered
	renderCollision(target)

	local copy, note = fetchServerCopy(uid)
	if collision ~= entered then
		return -- 읽는 동안 안내가 닫혔다.
	end
	entered.server = copy
	entered.serverNote = note
	local selectedNow = pickScript()
	if selectedNow and sourceUidOf(selectedNow) == uid then
		renderCollision(selectedNow)
	end
end

-- 복제본 버튼. 첫 번째 누름은 확인 문구만 보여주고, 두 번째 누름에서 선택한 스크립트에만 새 ID를 준다.
-- 원본(선택하지 않은 쪽)의 ID는 건드리지 않는다.
local function confirmClone()
	local current = collision
	if current == nil or sending then
		return
	end
	local target = pickScript()
	if target == nil or sourceUidOf(target) ~= current.uid then
		clearCollision()
		setStatus(
			"취소: 같은 ID의 스크립트 하나를 선택한 상태가 아닙니다. 아무것도 바꾸지 않았습니다.\n복제본을 선택하고 '코드 보내기'를 다시 누르세요.",
			"fail"
		)
		return
	end
	local others = findDuplicates(target)
	if #others == 0 then
		clearCollision()
		setStatus(
			"같은 ID를 가진 스크립트가 이제 하나뿐입니다. 새 ID를 주지 않았습니다. '코드 보내기'를 누르세요.",
			"info"
		)
		return
	end
	if not current.confirming then
		current.confirming = true
		renderCollision(target)
		return
	end

	local uid = newUid()
	local ok, problem = pcall(writeSourceUid, target, uid, "Studio Bridge 복제본에 새 source_uid")
	if not ok then
		current.confirming = false
		refreshButtons()
		refreshSelection()
		setStatus(
			`실패: 새 ID를 붙이지 못했습니다. 위 '선택' 줄의 ID가 그대로인지 확인하세요.\n{tostring(problem)}`,
			"fail"
		)
		return
	end
	clearCollision()
	refreshSelection()
	local left = if #others > 1
		then `주의: 이전 ID를 가진 스크립트가 아직 {#others}개 있습니다. 그중 하나를 보내면 다시 멈춥니다.`
		else `이전 ID는 {others[1]:GetFullName()}에만 남았습니다. 기존 자료·기능 연결·결정은 그 스크립트의 것입니다.`
	setStatus(
		`새 ID 부여 완료: {target:GetFullName()}\n이전 ID {shortId(current.uid)}… → 새 ID {shortId(uid)}… (Ctrl+Z로 되돌릴 수 있음)\n{left}\n아직 서버에는 보내지 않았습니다. '코드 보내기'를 누르면 새 자료로 저장됩니다.`,
		"ok"
	)
end

-- 선택이 바뀌면 선택 표시를 고치고, 충돌 안내는 새 선택 기준으로 다시 그리거나 닫는다.
local function onSelectionChanged()
	refreshSelection()
	local current = collision
	if current == nil then
		return
	end
	local target = pickScript()
	if target and sourceUidOf(target) == current.uid then
		current.confirming = false -- 다른 스크립트를 골랐으면 확인을 처음부터 다시 받는다.
		renderCollision(target)
	else
		clearCollision()
		setStatus(
			"복제본 처리를 닫았습니다. 같은 ID의 스크립트가 아닌 것을 선택했습니다. 아무것도 바꾸지 않았습니다.\n스크립트 하나를 선택하고 '코드 보내기'를 누르면 다시 검사합니다.",
			"info"
		)
	end
end

local function sendSelected()
	if sending then
		return
	end
	local target, problem = pickScript()
	if target == nil then
		clearCollision()
		local pending = if failedSend
			then "\n보내지 못한 요청은 그대로 있습니다. '다시 시도 (같은 요청)'은 선택 없이도 누를 수 있습니다."
			else ""
		setStatus(`보내지 않음: {problem or "선택을 확인하세요."}{pending}`, "fail")
		return
	end
	if serverUrl() == "" then
		setStatus("서버 주소를 입력하세요.", "fail")
		return
	end

	-- 1) 복제본 검사: 같은 ID가 둘 이상이면 보내지 않고, 사람이 복제본을 확인하게 한다.
	local uid = sourceUidOf(target)
	if uid and #findDuplicates(target) > 0 then
		enterCollision(target, uid)
		return
	end
	clearCollision()

	-- 2) 크기 검사: 서버가 거절할 원문은 요청을 만들기 전에 멈춘다.
	local source = readSource(target)
	if #source > MAX_RAW_BYTES then
		setStatus(
			`보내지 않음: {target.Name}의 원문이 {math.ceil(#source / 1024)}KiB입니다. 서버는 256KiB까지만 받습니다. 스크립트를 나눈 뒤 다시 보내세요.`,
			"fail"
		)
		return
	end

	-- 3) 보내지 못한 요청이 남아 있으면 조용히 버리지 않는다.
	local pending = failedSend
	if pending then
		local stored = pending.payload
		local same = uid == stored.source_uid
			and target.Name == stored.name
			and target:GetFullName() == stored.source_path
			and target.ClassName == stored.script_type
			and source == stored.raw_code
		if same then
			-- 같은 스크립트·같은 내용이면 새 요청이 아니라 같은 요청의 재시도다.
			-- 첫 요청이 서버에 닿았는데 응답만 못 받은 경우에도 수집본이 두 벌 생기지 않는다.
			send(stored, true)
		else
			setStatus(
				`보내지 않음: 아직 보내지 못한 요청이 남아 있습니다.\n{failedSummary(pending)}\n먼저 '다시 시도 (같은 요청)'으로 보내거나, 필요 없으면 '실패한 요청 버리기'를 누른 뒤 다시 '코드 보내기'를 누르세요.`,
				"fail"
			)
		end
		return
	end

	-- 4) 새 전송은 새 request_id를 쓴다.
	send(buildPayload(target, source), false)
end

-- ---------- 관련 결정 읽기 (05회차 #17) ----------
-- 서버 응답을 패널 문장으로 바꾼다. 연결된 기능은 하나도 숨기지 않고 서버가 준 순서대로 모두 보여준다.
local function formatContext(target: ReadTarget, data: { [string]: any }): (string, Tone)
	local lines = {}
	if target.warning then
		table.insert(lines, target.warning)
		table.insert(lines, "")
	end
	table.insert(lines, `스크립트: {target.name}  ({target.path})`)
	local material = data.material
	if type(material) ~= "table" then
		table.insert(lines, "")
		table.insert(lines, "서버에 이 스크립트의 자료가 없습니다.")
		table.insert(lines, "이 서버로 보낸 적이 없거나 서버 주소가 다릅니다. 먼저 '코드 보내기'를 누르세요.")
		return table.concat(lines, "\n"), "info"
	end

	table.insert(
		lines,
		`서버 자료: {orText(material.name, "(이름 없음)")} · 마지막 수집 {localTime(material.received_at)}`
	)
	local features = data.features :: { any }
	if #features == 0 then
		table.insert(lines, "")
		table.insert(lines, "연결된 기능이 없습니다.")
		table.insert(lines, "웹 자료함에서 이 자료를 기능에 연결하면 여기에 결정이 보입니다.")
		return table.concat(lines, "\n"), "info"
	end

	table.insert(lines, `연결된 기능 {#features}개`)
	local withDecision = 0
	for index, feature in features do
		table.insert(lines, "")
		local assignee = if type(feature.assignee) == "string" then ` · 담당 {feature.assignee}` else ""
		table.insert(
			lines,
			`[{index}] {orText(feature.title, "(제목 없음)")}  ({orText(feature.status, "?")}{assignee})`
		)
		local decision = feature.current_decision
		if type(decision) == "table" then
			withDecision += 1
			local no = if type(decision.decision_no) == "number" then ` #{decision.decision_no}` else ""
			table.insert(lines, `  현재 결정{no}: {orText(decision.body, "(내용 없음)")}`)
			table.insert(
				lines,
				`  표시명: {orText(decision.author_display_name, "(없음)")}  (작성자가 직접 입력한 이름, 로그인 확인 아님)`
			)
			table.insert(lines, `  기록 시각: {localTime(decision.created_at)}`)
		else
			table.insert(lines, "  결정 없음. 웹의 기능 상세에서 결정을 기록할 수 있습니다.")
		end
	end
	table.insert(lines, "")
	table.insert(lines, `조회 시각: {os.date("%Y-%m-%d %H:%M:%S")}`)
	return table.concat(lines, "\n"), if withDecision > 0 then "ok" else "info"
end

local function readContext(target: ReadTarget)
	if reading then
		return
	end
	local url = serverUrl()
	if url == "" then
		setContext("서버 주소를 입력하세요.", "fail")
		return
	end
	reading = true
	failedRead = nil
	refreshButtons()
	setContext(`읽는 중: {target.name}\n{url}`, "busy")

	local ok, result = pcall(function()
		return HttpService:RequestAsync({
			Url = `{url}/api/projects/{PROJECT_ID}/context?source_uid={HttpService:UrlEncode(target.source_uid)}`,
			Method = "GET",
			Headers = requestHeaders(false),
		})
	end)

	reading = false
	local failure: string? = nil
	local data: any = nil
	if not ok then
		-- 서버 꺼짐, HTTP 허용 안 됨, 주소 오류 등. "결정 없음"과 다르게 실패로 보여준다.
		failure = `서버에 연결하지 못했습니다.\n{tostring(result)}\n{CONNECT_HINT}`
	else
		local response = result :: { Success: boolean, StatusCode: number, Body: string }
		if not response.Success then
			failure = errorMessage(response.StatusCode, response.Body)
		else
			local decodedOk, decoded = pcall(function()
				return HttpService:JSONDecode(response.Body)
			end)
			if decodedOk and type(decoded) == "table" and type(decoded.features) == "table" then
				data = decoded
			else
				failure = "서버 응답 형식이 맞지 않습니다. (features 없음)"
			end
		end
	end

	if failure then
		failedRead = target
		local previous = if lastReadText
			then `\n\n--- 마지막으로 성공한 조회 (지금과 다를 수 있음) ---\n{lastReadText}`
			else ""
		setContext(`실패: {failure}\n다시 읽기를 누를 수 있습니다.{previous}`, "fail")
		refreshButtons()
		return
	end

	local message, tone = formatContext(target, data)
	lastReadText = message
	setContext(message, tone)
	refreshButtons()
end

local function readSelected()
	if reading then
		return
	end
	local target, problem = pickScript()
	if target == nil then
		setContext(problem or "선택을 확인하세요.", "fail")
		return
	end
	-- 읽기만 한다. 아직 보낸 적 없는 스크립트에 source_uid를 새로 붙이지 않는다.
	local uid = sourceUidOf(target)
	if uid == nil then
		failedRead = nil
		refreshButtons()
		setContext(
			`{target.Name}은(는) 아직 보낸 적 없는 스크립트입니다. (attribute {UID_ATTRIBUTE} 없음)\n먼저 '코드 보내기'를 누르고 웹에서 기능에 연결하세요.`,
			"info"
		)
		return
	end
	-- 복제본이 같은 source_uid를 가지면 서버는 둘을 구분하지 못한다. 결과는 보여주되 경고한다.
	-- 읽기에서는 ID를 바꾸지 않는다. 새 ID 부여는 '코드 보내기'의 복제본 확인에서만 한다. (07회차 #25)
	local duplicates = findDuplicates(target)
	local warning: string? = nil
	if #duplicates > 0 then
		local more = if #duplicates > 1 then ` 외 {#duplicates - 1}개` else ""
		warning =
			`주의: 같은 source_uid를 가진 스크립트가 {#duplicates}개 더 있습니다. 아래는 이 ID로 서버에 저장된 자료의 결과입니다. 선택한 스크립트가 복제본이면 원본의 결과입니다.\n같은 ID: {duplicates[1]:GetFullName()}{more}\n'코드 보내기'를 누르면 복제본을 확인하고 새 ID를 줄 수 있습니다.`
	end
	readContext({ source_uid = uid, name = target.Name, path = target:GetFullName(), warning = warning })
end

readButton.Activated:Connect(function()
	task.spawn(readSelected)
end)

readRetryButton.Activated:Connect(function()
	local target = failedRead
	if target and not reading then
		task.spawn(readContext, target)
	end
end)

readToolbarButton.Click:Connect(function()
	widget.Enabled = true
	task.spawn(readSelected)
end)

sendButton.Activated:Connect(function()
	task.spawn(sendSelected)
end)

-- 다시 시도는 선택과 상관없이 보존해 둔 요청을 같은 request_id·같은 payload로 보낸다.
retryButton.Activated:Connect(function()
	local failed = failedSend
	if failed and not sending then
		clearCollision()
		task.spawn(send, failed.payload, true)
	end
end)

-- 보내지 못한 요청은 사람이 버리겠다고 누를 때만 지운다. (07회차 #25)
discardButton.Activated:Connect(function()
	local failed = failedSend
	if failed == nil or sending then
		return
	end
	forgetFailure()
	refreshButtons()
	local stored = failed.payload
	setStatus(
		`버림: 보내지 못한 요청을 지웠습니다. 이 요청이 서버에 저장됐다고 확인된 적은 없습니다.\n{stored.name}  ({stored.source_path}) · 요청 {shortId(stored.request_id)}\nStudio의 스크립트는 그대로입니다. 필요하면 다시 '코드 보내기'를 누르세요.`,
		"info"
	)
end)

cloneButton.Activated:Connect(function()
	task.spawn(confirmClone)
end)

-- 선택이 한 번에 여러 번 바뀌어도(해제 후 선택 등) 마지막 상태만 한 번 처리한다.
local selectionQueued = false
Selection.SelectionChanged:Connect(function()
	if selectionQueued then
		return
	end
	selectionQueued = true
	task.defer(function()
		selectionQueued = false
		onSelectionChanged()
	end)
end)

panelButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

sendToolbarButton.Click:Connect(function()
	widget.Enabled = true
	task.spawn(sendSelected)
end)

-- ---------- 연결 확인 (06회차 #21) ----------
local checking = false

local function checkConnection()
	if checking then
		return
	end
	local url = serverUrl()
	if url == "" then
		setConn("서버 주소를 입력하세요.", "fail")
		return
	end
	checking = true
	checkButton.Text = "확인 중..."
	setConn(`확인 중: {url}`, "busy")

	local ok, result = pcall(function()
		return HttpService:RequestAsync({
			Url = `{url}/api/projects/{PROJECT_ID}/access`,
			Method = "GET",
			Headers = requestHeaders(false),
		})
	end)

	checking = false
	checkButton.Text = "연결 확인"
	if not ok then
		setConn(`실패: 서버에 연결하지 못했습니다.\n{tostring(result)}\n{CONNECT_HINT}`, "fail")
		return
	end
	local response = result :: { Success: boolean, StatusCode: number, Body: string }
	if not response.Success then
		local hint = if response.StatusCode == 401
			then "\n팀 키를 서버를 띄운 팀원에게 다시 확인하고 위 칸에 입력하세요."
			else ""
		setConn(`실패: {errorMessage(response.StatusCode, response.Body)}{hint}`, "fail")
		return
	end
	local decodedOk, data = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decodedOk or type(data) ~= "table" or (data.mode ~= "shared" and data.mode ~= "local") then
		setConn("실패: 서버 응답 형식이 맞지 않습니다. Studio Bridge 서버 주소가 맞는지 확인하세요.", "fail")
		return
	end
	local modeText = if data.mode == "shared" then "공유 모드 (팀 키 확인됨)" else "로컬 모드 (이 PC만)"
	setConn(`연결됨: {modeText}\n{url}\n{os.date("%Y-%m-%d %H:%M:%S")}`, "ok")
end

checkButton.Activated:Connect(function()
	task.spawn(checkConnection)
end)

widget:GetPropertyChangedSignal("Enabled"):Connect(function()
	panelButton:SetActive(widget.Enabled)
end)

-- 이전 Studio 실행에서 보내지 못한 요청이 있으면 되살린다. (07회차 #25)
local restored = loadFailed()
if restored then
	failedSend = restored
	failedPersisted = true
	setStatus(
		`보내지 못한 요청이 남아 있습니다. (이전에 실패해 이 PC에 보존한 요청)\n{failedSummary(restored)}\n서버가 켜져 있으면 '다시 시도 (같은 요청)'을 누르세요. 필요 없으면 '실패한 요청 버리기'를 누르세요.`,
		"fail"
	)
end

refreshButtons()
showKeyMask()
refreshSelection()
