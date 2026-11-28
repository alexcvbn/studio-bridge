import { createContext, useContext } from 'react'
import type { LinkedMaterial } from '../features/featuresApi'
import type { TargetInfo } from '../board/targetsApi'

export interface MeetingContextValue {
  // 서버의 기능·자료. "feature:ID" / "material:ID"로 찾는다.
  catalog: Map<string, TargetInfo>
  load: 'loading' | 'ready' | 'error'
  // 기능 ID -> 서버에 연결된 자료 목록 (기능 카드의 "연결된 구현")
  links: Record<string, LinkedMaterial[] | undefined>
  // 항목 ID -> 그 항목을 고른 다른 사람들의 색
  peerSelections: Record<string, { name: string; color: string }[]>
  onOpenInBoard: (kind: 'feature' | 'material', id: string) => void
}

export const MeetingContext = createContext<MeetingContextValue | null>(null)

export function useMeeting(): MeetingContextValue {
  const v = useContext(MeetingContext)
  if (!v) throw new Error('MeetingContext가 없습니다.')
  return v
}
