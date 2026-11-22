import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react'
import type { Relation } from './types'

export type RelationEdgeData = { relation: Relation; label: string }
export type RelationEdgeType = Edge<RelationEdgeData, 'relation'>

// 관계 종류별 양 끝 표시. 시작 카드 쪽, 끝 카드 쪽 순서.
const ENDS: Record<Relation, [string, string]> = {
  '1:1': ['1', '1'],
  '1:N': ['1', 'N'],
  'N:M': ['N', 'M'],
}

// 끝 표시를 카드 연결점에서 조금 떨어진 곳에 둔다.
function endPoint(x: number, y: number, side: Position) {
  const d = 14
  if (side === Position.Left) return { x: x - d, y: y - 9 }
  if (side === Position.Right) return { x: x + d, y: y - 9 }
  if (side === Position.Top) return { x: x + 10, y: y - d }
  return { x: x + 10, y: y + d }
}

// DB 관계도처럼 꺾인 선 위에 관계 종류와 이름, 양 끝에 1·N을 표시한다.
export function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<RelationEdgeType>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
  })
  const relation = data?.relation ?? '1:N'
  const [from, to] = ENDS[relation]
  const a = endPoint(sourceX, sourceY, sourcePosition)
  const b = endPoint(targetX, targetY, targetPosition)
  const tone = selected ? ' selected' : ''
  return (
    <>
      <BaseEdge id={id} path={path} className={'relation-path' + tone} interactionWidth={20} />
      <EdgeLabelRenderer>
        <span
          className={'relation-end' + tone}
          style={{ transform: `translate(-50%, -50%) translate(${a.x}px, ${a.y}px)` }}
        >
          {from}
        </span>
        <span
          className={'relation-end' + tone}
          style={{ transform: `translate(-50%, -50%) translate(${b.x}px, ${b.y}px)` }}
        >
          {to}
        </span>
        <span
          className={'relation-chip' + tone}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <b>{relation}</b>
          {data?.label && <span>{data.label}</span>}
        </span>
      </EdgeLabelRenderer>
    </>
  )
}
