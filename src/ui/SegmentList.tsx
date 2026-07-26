import { useEffect, useRef } from 'react'
import type { Segment } from '../core/subtitle/types'
import { segmentKey, useAppStore } from '../store/useAppStore'
import { formatTime, maskText } from './format'

/**
 * 문장(세그먼트) 목록.
 *
 * 클릭 한 번이 곧 "이 구간을 N번 반복"이다. 자동 병합이 어긋난 문장은
 * 여기서 바로 합치고 쪼갤 수 있어야 학습 흐름이 끊기지 않는다.
 */
export function SegmentList({ onSelect }: { onSelect: (index: number) => void }) {
  const segments = useAppStore((s) => s.segments)
  const activeIndex = useAppStore((s) => s.activeIndex)
  const hideSubtitles = useAppStore((s) => s.hideSubtitles)
  const results = useAppStore((s) => s.results)
  const loopStatus = useAppStore((s) => s.loopStatus)

  const listRef = useRef<HTMLUListElement>(null)

  // 키보드로 이동할 때 선택된 항목이 화면 밖으로 나가지 않게 한다
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex])

  if (segments.length === 0) {
    return <div className="p-4 text-sm text-slate-600">자막 파일을 불러오면 문장이 여기에 나옵니다.</div>
  }

  return (
    <ul ref={listRef} className="h-full overflow-y-auto py-1">
      {segments.map((segment, index) => (
        <SegmentRow
          key={segment.id}
          segment={segment}
          index={index}
          isActive={index === activeIndex}
          isLooping={loopStatus.running && loopStatus.targetId === segment.id}
          hidden={hideSubtitles}
          accuracy={results[segmentKey(segment)]?.accuracy}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}

interface RowProps {
  segment: Segment
  index: number
  isActive: boolean
  isLooping: boolean
  hidden: boolean
  accuracy: number | undefined
  onSelect: (index: number) => void
}

function SegmentRow({ segment, index, isActive, isLooping, hidden, accuracy, onSelect }: RowProps) {
  const mergeActiveWithNext = useAppStore((s) => s.mergeActiveWithNext)
  const splitActive = useAppStore((s) => s.splitActive)

  return (
    <li data-index={index}>
      <div
        className={`group border-l-2 px-3 py-2 transition ${
          isActive
            ? 'border-sky-400 bg-sky-400/10'
            : 'border-transparent hover:border-white/20 hover:bg-white/5'
        }`}
      >
        <button type="button" onClick={() => onSelect(index)} className="w-full text-left">
          <div className="flex items-center gap-2 text-[11px] tabular-nums text-slate-500">
            <span>{formatTime(segment.start)}</span>
            <span className="text-slate-700">·</span>
            <span>{(segment.end - segment.start).toFixed(1)}초</span>
            {isLooping && <span className="text-sky-400">▶ 반복 중</span>}
            {accuracy !== undefined && (
              <span className={`ml-auto font-medium ${accuracy >= 0.9 ? 'text-emerald-400' : accuracy >= 0.6 ? 'text-amber-400' : 'text-rose-400'}`}>
                {Math.round(accuracy * 100)}%
              </span>
            )}
          </div>

          <p className={`mt-0.5 text-sm leading-snug ${isActive ? 'text-slate-100' : 'text-slate-400'}`}>
            {hidden && accuracy === undefined ? (
              <span className="tracking-wider text-slate-600">{maskText(segment.text)}</span>
            ) : (
              segment.text
            )}
          </p>
        </button>

        {isActive && (
          <div className="mt-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <button type="button" onClick={mergeActiveWithNext} className="chip">
              다음과 합치기
            </button>
            {segment.cueIds.length > 1 && (
              <button type="button" onClick={splitActive} className="chip">
                쪼개기
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
