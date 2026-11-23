import { useEffect, useRef } from 'react'
import { useNodesInitialized, useReactFlow, useStore, useViewport } from '@xyflow/react'
import { Maximize, Minus, Plus } from 'lucide-react'

export function CanvasNavigation() {
  const { fitView, zoomIn, zoomOut, getViewport, setViewport } = useReactFlow()
  const { zoom } = useViewport()
  const ready = useNodesInitialized()
  const width = useStore((state) => state.width)
  const previousWidth = useRef(width)
  const framed = useRef(false)

  // Keep the same point centered when either side panel changes the canvas width.
  useEffect(() => {
    if (!width) return
    const previous = previousWidth.current
    previousWidth.current = width
    if (!framed.current || !previous || previous === width) return
    const current = getViewport()
    void setViewport({ ...current, x: current.x + (width - previous) / 2 })
  }, [width, getViewport, setViewport])
  useEffect(() => {
    if (!ready || framed.current) return
    framed.current = true
    void fitView({ padding: 0.25, maxZoom: 1.12 })
  }, [ready, fitView])

  return (
    <div className="zoom-tools" role="group" aria-label="화면 배율">
      <button title="축소" aria-label="축소" disabled={zoom <= 0.25} onClick={() => void zoomOut()}>
        <Minus />
      </button>
      <output aria-label="현재 배율">{Math.round(zoom * 100)}%</output>
      <button title="확대" aria-label="확대" disabled={zoom >= 2} onClick={() => void zoomIn()}>
        <Plus />
      </button>
      <button
        title="전체 카드 맞춤"
        aria-label="전체 카드 맞춤"
        onClick={() => void fitView({ padding: 0.25, maxZoom: 1.12, duration: 180 })}
      >
        <Maximize />
      </button>
    </div>
  )
}
