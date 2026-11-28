import { useEffect, useMemo } from 'react'
import { ViewportPortal, useOnViewportChange, useReactFlow, useStore, useViewport, type Viewport } from '@xyflow/react'
import { setPresence, throttle, type Peer } from './presence'

// React Flow 안에 두는 실시간 층.
// - 내 커서와 내가 보는 화면 위치를 다른 사람에게 보낸다.
// - 다른 사람 커서를 이름표와 함께 그린다 (배율이 바뀌어도 크기는 그대로).
// - 따라가는 사람이 있으면 그 사람이 보는 곳으로 내 화면을 옮긴다.
export function LiveLayer({ peers, followTarget }: { peers: Peer[]; followTarget: Peer | null }) {
  const { screenToFlowPosition, setViewport } = useReactFlow()
  const domNode = useStore((s) => s.domNode)
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  const { zoom } = useViewport()

  const sendCursor = useMemo(() => throttle((c: { x: number; y: number } | null) => setPresence({ cursor: c }), 40), [])
  const sendView = useMemo(
    () => throttle((v: { cx: number; cy: number; zoom: number }) => setPresence({ view: v }), 60),
    [],
  )

  useEffect(() => {
    if (!domNode) return
    const move = (e: PointerEvent) => {
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY }, { snapToGrid: false })
      sendCursor({ x: Math.round(p.x), y: Math.round(p.y) })
    }
    const leave = () => sendCursor(null)
    domNode.addEventListener('pointermove', move)
    domNode.addEventListener('pointerleave', leave)
    return () => {
      domNode.removeEventListener('pointermove', move)
      domNode.removeEventListener('pointerleave', leave)
    }
  }, [domNode, screenToFlowPosition, sendCursor])

  const toView = (v: Viewport) => ({
    cx: Math.round((width / 2 - v.x) / v.zoom),
    cy: Math.round((height / 2 - v.y) / v.zoom),
    zoom: Math.round(v.zoom * 1000) / 1000,
  })
  useOnViewportChange({ onChange: (v) => width && sendView(toView(v)) })
  const viewport = useViewport()
  useEffect(() => {
    if (width) sendView(toView(viewport))
    // 화면 크기가 바뀌었을 때만 다시 보낸다. 이동은 useOnViewportChange가 보낸다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height])

  // 따라가기: 상대가 보는 가운데를 내 화면 가운데에 둔다(창 크기가 달라도 같은 곳이 보이게).
  const target = followTarget?.view
  useEffect(() => {
    if (!target || !width) return
    void setViewport({ x: width / 2 - target.cx * target.zoom, y: height / 2 - target.cy * target.zoom, zoom: target.zoom })
  }, [target, width, height, setViewport])

  return (
    <ViewportPortal>
      {peers
        .filter((p) => p.cursor)
        .map((p) => (
          <div
            key={p.clientId}
            className="live-cursor"
            style={{
              transform: `translate(${p.cursor!.x}px, ${p.cursor!.y}px) scale(${1 / zoom})`,
              ['--who' as string]: p.user.color,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
              <path d="M3 2.5 20.5 10l-7.4 2.1L10 19.8z" fill={p.user.color} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            <span>{p.user.name}</span>
          </div>
        ))}
    </ViewportPortal>
  )
}
