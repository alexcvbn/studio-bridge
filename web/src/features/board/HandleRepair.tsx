import { useEffect } from 'react'
import { useStore, useUpdateNodeInternals, type ReactFlowState } from '@xyflow/react'

// 연결점 위치(handleBounds)를 잃은 카드 ID. 없으면 빈 문자열.
const missing = (s: ReactFlowState) => {
  const ids: string[] = []
  for (const [id, n] of s.nodeLookup) if (!n.hidden && !n.internals.handleBounds) ids.push(id)
  return ids.join(',')
}

// 카드 목록을 공유 문서에서 다시 만들 때, React Flow가 카드 크기를 다시 재기 전에 화면이 그려지면
// 연결점 위치가 지워진 채 남을 수 있다. 크기가 그대로라 다시 재지 않으므로 그 카드는 선이 그려지지 않고
// 연결점을 끌어도 연결이 시작되지 않는다. 그런 카드를 찾아 연결점 위치를 다시 재게 한다.
export function HandleRepair() {
  const ids = useStore(missing)
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    if (!ids) return
    const frame = requestAnimationFrame(() => updateNodeInternals(ids.split(',')))
    return () => cancelAnimationFrame(frame)
  }, [ids, updateNodeInternals])
  return null
}
