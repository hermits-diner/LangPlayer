import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ENVELOPE_FRAME_SEC } from '../core/sync/audioAnalysis'
import { useAppStore } from '../store/useAppStore'
import { formatTime } from './format'

export interface WaveformView {
  startSec: number
  endSec: number
}

export interface WaveformProps {
  /** 드래그로 고른 구간을 재생 */
  onPlayRange: (startSec: number, endSec: number) => void
  /** 오른쪽 클릭 — 재생/정지 토글 */
  onTogglePlay: () => void
  /** Ctrl+오른쪽 클릭 — 그 지점에서 문장 나누기 */
  onSplitAt: (timeSec: number) => void
  onSelectSegment: (index: number, modifiers: { shift: boolean; ctrl: boolean }) => void
  view: WaveformView
  onViewChange: (view: WaveformView) => void
  durationSec: number
}

/** 화면 가로 1픽셀에 포락선 몇 칸이 들어가든, 그 구간의 최대값을 그린다 */
const MIN_VIEW_SEC = 1

/**
 * 음파창.
 *
 * 자동 맞춤이 쓰는 에너지 포락선을 그대로 그린다. 원본 샘플(수천만 개)이 아니라
 * 10 ms로 압축된 값이라 2시간짜리도 72만 칸이면 끝나서, 매 프레임 다시 그려도
 * 가볍다.
 */
export function Waveform({
  onPlayRange,
  onTogglePlay,
  onSplitAt,
  onSelectSegment,
  view,
  onViewChange,
  durationSec,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const waveform = useAppStore((s) => s.waveform)
  const waveformState = useAppStore((s) => s.waveformState)
  const segments = useAppStore((s) => s.segments)
  const activeIndex = useAppStore((s) => s.activeIndex)
  const selection = useAppStore((s) => s.selection)
  const currentTime = useAppStore((s) => s.currentTime)

  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const selectedSet = useMemo(() => new Set(selection), [selection])

  const measure = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    setSize((previous) =>
      Math.abs(previous.width - rect.width) < 0.5 && Math.abs(previous.height - rect.height) < 0.5
        ? previous // 값이 그대로면 같은 객체를 돌려줘 리렌더 루프를 막는다
        : { width: rect.width, height: rect.height },
    )
  }, [])

  // 렌더할 때마다 직접 잰다. ResizeObserver만 믿으면 관측 대상이 붙기 전에
  // 놓친 첫 크기를 영영 못 받는 경우가 생긴다.
  useLayoutEffect(measure)

  // 창 크기 변화는 이벤트로 따라간다 (ResizeObserver는 있으면 덤으로 쓴다)
  useEffect(() => {
    const container = containerRef.current
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (container) observer?.observe(container)
    window.addEventListener('resize', measure)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return view.startSec

      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return view.startSec + ratio * (view.endSec - view.startSec)
    },
    [view],
  )

  // ─── 그리기 ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)

    const span = Math.max(0.001, view.endSec - view.startSec)
    const toX = (sec: number) => ((sec - view.startSec) / span) * size.width
    const mid = size.height / 2

    // 1. 문장 구간 배경 — 선택된 것은 도드라지게
    segments.forEach((segment, index) => {
      const left = toX(segment.start)
      const right = toX(segment.end)
      if (right < 0 || left > size.width) return

      const isActive = index === activeIndex
      const isSelected = selectedSet.has(index)
      if (!isActive && !isSelected) return

      ctx.fillStyle = isActive ? 'rgba(210,167,71,0.16)' : 'rgba(158,150,138,0.10)'
      ctx.fillRect(left, 0, Math.max(1, right - left), size.height)
    })

    // 2. 파형 — 배경으로 물러나야 한다. 여기서 가장 중요한 건 문장이지 파형이 아니다
    if (waveform && waveform.length > 0) {
      ctx.fillStyle = 'rgba(158,150,138,0.5)'

      for (let x = 0; x < size.width; x++) {
        const from = view.startSec + (x / size.width) * span
        const to = view.startSec + ((x + 1) / size.width) * span

        const fromFrame = Math.max(0, Math.floor(from / ENVELOPE_FRAME_SEC))
        const toFrame = Math.min(waveform.length, Math.ceil(to / ENVELOPE_FRAME_SEC))
        if (toFrame <= fromFrame) continue

        // 한 픽셀에 여러 칸이 겹치면 최대값을 살린다 — 짧은 발화가 사라지지 않게
        let peak = 0
        for (let f = fromFrame; f < toFrame; f++) {
          if (waveform[f] > peak) peak = waveform[f]
        }

        const half = Math.min(mid, peak * mid * 3.2)
        if (half < 0.4) continue
        ctx.fillRect(x, mid - half, 1, half * 2)
      }
    }

    // 3. 문장 경계선
    ctx.strokeStyle = 'rgba(158,150,138,0.22)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const segment of segments) {
      const x = Math.round(toX(segment.start)) + 0.5
      if (x < 0 || x > size.width) continue
      ctx.moveTo(x, 0)
      ctx.lineTo(x, size.height)
    }
    ctx.stroke()

    // 4. 드래그 중인 구간
    if (drag) {
      const left = toX(Math.min(drag.from, drag.to))
      const right = toX(Math.max(drag.from, drag.to))
      ctx.fillStyle = 'rgba(210,167,71,0.18)'
      ctx.fillRect(left, 0, right - left, size.height)
      ctx.strokeStyle = 'rgba(210,167,71,0.75)'
      ctx.strokeRect(left + 0.5, 0.5, right - left - 1, size.height - 1)
    }

    // 5. 재생 위치 — 유일하게 밝은 요소. 눈이 여기로 오게 한다
    const playX = toX(currentTime)
    if (playX >= 0 && playX <= size.width) {
      ctx.strokeStyle = '#f3efe8'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playX, 0)
      ctx.lineTo(playX, size.height)
      ctx.stroke()
    }
  }, [waveform, segments, activeIndex, selectedSet, currentTime, view, size, drag])

  // ─── 마우스 ────────────────────────────────────────────────────
  const segmentAt = (sec: number) => segments.findIndex((s) => sec >= s.start && sec < s.end)

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)

    const sec = timeAt(e.clientX)

    if (e.shiftKey) {
      // Shift+클릭: 현재 문장부터 클릭한 문장까지 범위 선택
      const index = segmentAt(sec)
      if (index >= 0) onSelectSegment(index, { shift: true, ctrl: e.ctrlKey })
      return
    }

    setDrag({ from: sec, to: sec })
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    setDrag({ ...drag, to: timeAt(e.clientX) })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drag) return
    const from = Math.min(drag.from, drag.to)
    const to = Math.max(drag.from, drag.to)
    setDrag(null)

    // 드래그 거리가 거의 없으면 클릭으로 간주 — 그 문장을 고른다
    if (to - from < 0.05) {
      const index = segmentAt(from)
      if (index >= 0) onSelectSegment(index, { shift: false, ctrl: e.ctrlKey })
      return
    }

    onPlayRange(from, to)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    // Ctrl+오른쪽 클릭은 그 지점에서 문장 나누기
    if (e.ctrlKey) onSplitAt(timeAt(e.clientX))
    else onTogglePlay()
  }

  const handleWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.altKey) return
    e.preventDefault()

    const anchor = timeAt(e.clientX)
    const span = view.endSec - view.startSec
    const nextSpan = Math.min(durationSec, Math.max(MIN_VIEW_SEC, span * (e.deltaY > 0 ? 1.25 : 0.8)))
    const ratio = span === 0 ? 0.5 : (anchor - view.startSec) / span

    let start = anchor - ratio * nextSpan
    start = Math.min(Math.max(0, start), Math.max(0, durationSec - nextSpan))
    onViewChange({ startSec: start, endSec: start + nextSpan })
  }

  const ready = waveformState === 'ready'

  // 컨테이너는 항상 렌더링한다. 준비 상태에 따라 통째로 갈아끼우면 ResizeObserver가
  // 붙기 전에 요소가 사라져 캔버스 크기가 0으로 남는다.
  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full select-none overflow-hidden bg-ink-900 ${ready ? 'cursor-crosshair' : ''}`}
      onPointerDown={ready ? handlePointerDown : undefined}
      onPointerMove={ready ? handlePointerMove : undefined}
      onPointerUp={ready ? handlePointerUp : undefined}
      onContextMenu={ready ? handleContextMenu : undefined}
      onWheel={ready ? handleWheel : undefined}
      title={
        ready
          ? '드래그: 구간 재생 · 오른쪽 클릭: 재생/정지 · Ctrl+오른쪽 클릭: 나누기 · Ctrl+휠: 확대'
          : undefined
      }
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

      {ready ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-2 pb-0.5 text-[10px] tabular-nums text-slate-600">
          <span>{formatTime(view.startSec)}</span>
          <span>{formatTime(view.endSec)}</span>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-600">
          {waveformState === 'loading'
            ? '파형을 만드는 중…'
            : waveformState === 'unavailable'
              ? '이 소스는 파형을 표시할 수 없습니다'
              : ''}
        </div>
      )}
    </div>
  )
}
