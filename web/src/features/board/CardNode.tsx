import type { ReactNode } from 'react'
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'

export type CardNodeData = { label: ReactNode }
export type CardNodeType = Node<CardNodeData, 'card'>

// 카드 크기 한계. 너무 작으면 제목·아래 띠가 읽히지 않는다.
const CARD_MIN = { width: 170, height: 96 }
const CARD_MAX = { width: 640, height: 520 }

// 보드 카드. 선택하면 모서리·변을 끌어 크기를 바꿀 수 있고, 양옆 연결점은 크기를 바꿔도 가운데에 붙어 있다.
export function CardNode({ data, selected, isConnectable }: NodeProps<CardNodeType>) {
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={CARD_MIN.width}
        minHeight={CARD_MIN.height}
        maxWidth={CARD_MAX.width}
        maxHeight={CARD_MAX.height}
        color="#8960d2"
        handleClassName="card-resize-handle"
        lineClassName="card-resize-line"
      />
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <div className="card-body">{data.label}</div>
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </>
  )
}
