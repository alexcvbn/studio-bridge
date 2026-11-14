-- Studio Bridge 플러그인 (03회차 #9, A 담당)
-- Studio에서 선택한 스크립트 하나의 현재 편집 원문을 서버 자료함으로 보낸다.
-- 서버 계약: POST {서버}/api/projects/studio-bridge/materials/collect
--   보냄: source_uid, request_id, name, source_path, script_type, raw_code
--   받음: material_id, snapshot_id, deduplicated
-- 04회차 #13: 같은 source_uid를 가진 스크립트(복제본)가 있으면 전송을 멈춘다.
-- 05회차 #17: 선택한 스크립트의 연결 기능·현재 결정을 읽기 전용으로 보여준다.
--   GET {서버}/api/projects/studio-bridge/context?source_uid=...
--   받음: material 또는 null, features[] (기능마다 current_decision 또는 null)
-- 이번 범위에서 만들지 않는 것: 자동 전송 감시, 게임 값 변경, 코드 요약, 결정 작성·수정, 복제본 새 ID 부여(07회차).

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local PROJECT_ID = "studio-bridge"
local DEFAULT_SERVER = "http://localhost:8000"
local SETTING_SERVER = "StudioBridgeServerUrl"
-- source_uid는 스크립트 객체의 attribute에 둔다. 이름·경로가 바뀌어도 그대로 남는다.
local UID_ATTRIBUTE = "StudioBridgeSourceUid"
local SCRIPT_TYPES = { Script = true, LocalScript = true, ModuleScript = true }

type Payload = {
	source_uid: string,
	request_id: string,
	name: string,
	source_path: string,
	script_type: string,
	raw_code: string,
}

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

local sendButton = makeButton("코드 보내기", 3)
local retryButton = makeButton("다시 시도 (같은 요청)", 4)
retryButton.BackgroundColor3 = Color3.fromRGB(110, 110, 110)
retryButton.Visible = false

local statusLabel = makeLabel("스크립트 하나를 선택하고 '코드 보내기'를 누르세요.", 5, 0)
statusLabel.AutomaticSize = Enum.AutomaticSize.Y

-- 05회차 #17: 관련 결정 읽기 (읽기 전용)
local divider = makeLabel("관련 기능·현재 결정 (읽기 전용)", 6, 18)
divider.Font = Enum.Font.GothamBold
local readButton = makeButton("관련 결정 읽기", 7)
local readRetryButton = makeButton("다시 읽기 (같은 스크립트)", 8)
readRetryButton.BackgroundColor3 = Color3.fromRGB(110, 110, 110)
readRetryButton.Visible = false
local contextLabel = makeLabel("스크립트 하나를 선택하고 '관련 결정 읽기'를 누르세요.", 9, 0)
contextLabel.AutomaticSize = Enum.AutomaticSize.Y

-- ---------- 상태 ----------
local sending = false
-- 실패한 요청. 다시 시도할 때 같은 request_id·같은 payload를 그대로 보낸다.
local failedPayload: Payload? = nil

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

local function setContext(text: string, tone: Tone)
	contextLabel.Text = text
	contextLabel.TextColor3 = TONE_COLORS[tone]
end

local function refreshButtons()
	sendButton.Active = not sending
	sendButton.AutoButtonColor = not sending
	sendButton.Text = if sending then "전송 중..." else "코드 보내기"
	retryButton.Visible = failedPayload ~= nil
	retryButton.Active = not sending

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

local function ensureSourceUid(target: LuaSourceContainer): string
	local existing = target:GetAttribute(UID_ATTRIBUTE)
	if type(existing) == "string" and existing ~= "" then
		return existing
	end
	local uid = string.lower(HttpService:GenerateGUID(false))
	-- 처음 보내는 스크립트에만 attribute를 붙인다. Ctrl+Z로 되돌릴 수 있게 기록한다.
	local recording = ChangeHistoryService:TryBeginRecording("Studio Bridge source_uid 지정")
	target:SetAttribute(UID_ATTRIBUTE, uid)
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	return uid
end

-- 같은 source_uid를 가진 다른 스크립트를 찾는다. (04회차 #13)
-- 스크립트를 복제하면 attribute도 복사되므로, 서로 다른 스크립트가 같은 자료로 섞일 수 있다.
-- 찾으면 전송을 멈추고 알린다. 원본 ID를 자동으로 바꾸지 않는다. (복제본 새 ID 부여는 07회차)
local function findDuplicates(target: LuaSourceContainer): { string }
	local uid = target:GetAttribute(UID_ATTRIBUTE)
	if type(uid) ~= "string" or uid == "" then
		return {} -- 처음 보내는 스크립트는 새 UUID를 받으므로 겹치지 않는다.
	end
	local paths = {}
	for _, service in game:GetChildren() do
		-- 일부 서비스는 플러그인이 읽을 수 없어 오류가 난다. 그 서비스만 건너뛴다.
		local ok, descendants = pcall(function()
			return service:GetDescendants()
		end)
		if ok then
			for _, item in descendants do
				if item ~= target then
					local readOk, other = pcall(function()
						return item:IsA("LuaSourceContainer") and item:GetAttribute(UID_ATTRIBUTE)
					end)
					if readOk and other == uid then
						table.insert(paths, item:GetFullName())
					end
				end
			end
		end
	end
	return paths
end

local function buildPayload(target: LuaSourceContainer): Payload
	return {
		source_uid = ensureSourceUid(target),
		request_id = string.lower(HttpService:GenerateGUID(false)),
		name = target.Name,
		source_path = target:GetFullName(),
		script_type = target.ClassName,
		raw_code = readSource(target),
	}
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

local function send(payload: Payload)
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
	setStatus(`전송 중: {payload.name}\n{url}`, "busy")

	local ok, result = pcall(function()
		return HttpService:RequestAsync({
			Url = `{url}/api/projects/{PROJECT_ID}/materials/collect`,
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = HttpService:JSONEncode(payload),
		})
	end)

	sending = false
	if not ok then
		-- 서버 꺼짐, HTTP 허용 안 됨, 주소 오류 등. 성공으로 표시하지 않는다.
		failedPayload = payload
		setStatus(`실패: 서버에 연결하지 못했습니다.\n{tostring(result)}\n같은 요청으로 다시 시도할 수 있습니다.`, "fail")
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
		failedPayload = payload
		local message = if response.Success
			then "서버 응답에 material_id/snapshot_id가 없습니다."
			else errorMessage(response.StatusCode, response.Body)
		setStatus(`실패: {message}\n같은 요청으로 다시 시도할 수 있습니다.`, "fail")
		refreshButtons()
		return
	end

	failedPayload = nil
	local dedup = if data.deduplicated then " (이미 받은 요청)" else ""
	setStatus(
		`완료{dedup}: {payload.name}\n{os.date("%Y-%m-%d %H:%M:%S")}\nmaterial_id {data.material_id}\nsnapshot_id {data.snapshot_id}`,
		"ok"
	)
	refreshButtons()
end

local function sendSelected()
	if sending then
		return
	end
	local target, problem = pickScript()
	if target == nil then
		setStatus(problem or "선택을 확인하세요.", "fail")
		return
	end
	local duplicates = findDuplicates(target)
	if #duplicates > 0 then
		local shown = table.concat(duplicates, "\n", 1, math.min(#duplicates, 3))
		local more = if #duplicates > 3 then `\n외 {#duplicates - 3}개` else ""
		setStatus(
			`전송 중단: 같은 source_uid를 가진 스크립트가 {#duplicates}개 더 있습니다. 복제본일 수 있습니다.\n선택: {target:GetFullName()}\n같은 ID: {shown}{more}\n복제본의 attribute {UID_ATTRIBUTE}를 지운 뒤 다시 보내세요.`,
			"fail"
		)
		return
	end
	-- 새 전송은 새 request_id를 쓴다. 이전 실패 요청은 버린다.
	failedPayload = nil
	send(buildPayload(target))
end

-- ---------- 관련 결정 읽기 (05회차 #17) ----------
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

local function orText(value: any, fallback: string): string
	return if type(value) == "string" and value ~= "" then value else fallback
end

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
		})
	end)

	reading = false
	local failure: string? = nil
	local data: any = nil
	if not ok then
		-- 서버 꺼짐, HTTP 허용 안 됨, 주소 오류 등. "결정 없음"과 다르게 실패로 보여준다.
		failure = `서버에 연결하지 못했습니다.\n{tostring(result)}`
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
	local uid = target:GetAttribute(UID_ATTRIBUTE)
	if type(uid) ~= "string" or uid == "" then
		failedRead = nil
		refreshButtons()
		setContext(
			`{target.Name}은(는) 아직 보낸 적 없는 스크립트입니다. (attribute {UID_ATTRIBUTE} 없음)\n먼저 '코드 보내기'를 누르고 웹에서 기능에 연결하세요.`,
			"info"
		)
		return
	end
	-- 복제본이 같은 source_uid를 가지면 서버는 둘을 구분하지 못한다. 결과는 보여주되 경고한다. (자동 처리는 07회차)
	local duplicates = findDuplicates(target)
	local warning: string? = nil
	if #duplicates > 0 then
		local more = if #duplicates > 1 then ` 외 {#duplicates - 1}개` else ""
		warning =
			`주의: 같은 source_uid를 가진 스크립트가 {#duplicates}개 더 있습니다. 아래 결과는 그 스크립트와 같은 자료의 결과입니다.\n같은 ID: {duplicates[1]}{more}`
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

retryButton.Activated:Connect(function()
	local payload = failedPayload
	if payload and not sending then
		task.spawn(send, payload)
	end
end)

panelButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

sendToolbarButton.Click:Connect(function()
	widget.Enabled = true
	task.spawn(sendSelected)
end)

widget:GetPropertyChangedSignal("Enabled"):Connect(function()
	panelButton:SetActive(widget.Enabled)
end)

refreshButtons()
