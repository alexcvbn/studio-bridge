
export type MaterialSample = {
  material_id: string
  source_uid: string
  request_id: string
  name: string
  source_path: string
  script_type: 'Script' | 'LocalScript' | 'ModuleScript'
  raw_code: string
}

export const SAMPLE_MATERIALS: MaterialSample[] = [
  {
    material_id: 'M-1',
    source_uid: 'demo-boss-ai',
    request_id: 'demo-request-001',
    name: 'BossAI',
    source_path: 'ServerScriptService.BossAI',
    script_type: 'Script',
    raw_code: '-- 보스 체력 예시\nlocal maxHealth = 5000\nprint(maxHealth)\n',
  },
  {
    material_id: 'M-2',
    source_uid: 'demo-reward',
    request_id: 'demo-request-002',
    name: 'Reward',
    source_path: 'ServerScriptService.Reward',
    script_type: 'ModuleScript',
    raw_code:
      '-- 보상 지급 예시\nlocal Reward = {}\n\nfunction Reward.give(player)\n    print(player.Name .. " 님에게 골드 100")\nend\n\nreturn Reward\n',
  },
]
