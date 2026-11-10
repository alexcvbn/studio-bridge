export type FeatureStatus = 'todo' | 'doing' | 'done'

// 서버(GET/POST /features) 응답과 같은 형태
export interface Feature {
  feature_id: string
  project_id: string
  title: string
  status: FeatureStatus
  assignee: string | null
  created_at: string
}

export class ApiError extends Error {
  status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000'
const PROJECT_URL = `${API_BASE}/api/projects/studio-bridge`

// 기능 요청의 주소는 모두 여기서 만든다 (ID 처리 통일)
const featuresUrl = () => `${PROJECT_URL}/features`
const featureUrl = (featureId: string) =>
  `${PROJECT_URL}/features/${encodeURIComponent(featureId)}`

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.', null)
  }
  if (!res.ok) {
    let message = `요청에 실패했습니다. (${res.status})`
    try {
      const body = await res.json()
      const detail = body?.detail
      if (Array.isArray(detail)) {
        message = '입력 형식이 올바르지 않습니다.'
      } else if (detail && typeof detail.message === 'string') {
        message = detail.message
      }
    } catch {
      // 응답 본문이 없으면 기본 메시지를 쓴다
    }
    throw new ApiError(message, res.status)
  }
  return (await res.json()) as T
}

/** 실제 기능 목록 (D의 연결 선택 화면도 이 함수를 쓴다) */
export async function fetchFeatures(): Promise<Feature[]> {
  const data = await request<{ items: Feature[] }>(featuresUrl())
  return data.items
}

export function fetchFeature(featureId: string): Promise<Feature> {
  return request<Feature>(featureUrl(featureId))
}

export function createFeature(title: string): Promise<Feature> {
  return request<Feature>(featuresUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
}
