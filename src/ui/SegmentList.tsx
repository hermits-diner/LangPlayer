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
export interface SegmentSelectModifiers {
  shift: boolean
  ctrl: boolean
}

export interface SegmentListProps {
  onSelect: (index: number, modifiers: SegmentSelectModifiers) => void
  /** 편집 후 바뀐 구간을 다시 들려주기 위해 App의 명령을 그대로 쓴다 */
  onMerge: () => void
  onSplit: () => void
}

export function SegmentList({ onSelect, onMerge, onSplit }: SegmentListProps) {
  const segments = useAppStore((s) => s.segments)
  const activeIndex = useAppStore((s) => s.activeIndex)
  const hideSubtitles = useAppStore((s) => s.hideSubtitles)
  const results = useAppStore((s) => s.results)
  const loopStatus = useAppStore((s) => s.loopStatus)
  const selection = useAppStore((s) => s.selection)
  const gradingEnabled = useAppStore((s) => s.gradingEnabled)
  const toggleSelection = useAppStore((s) => s.toggleSelection)

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
          isSelected={selection.includes(index)}
          isLooping={loopStatus.running && loopStatus.targetId === segment.id}
          hidden={hideSubtitles}
          accuracy={gradingEnabled ? results[segmentKey(segment)]?.accuracy : undefined}
          onSelect={onSelect}
          onToggleSelect={toggleSelection}
          onMerge={onMerge}
          onSplit={onSplit}
        />
      ))}
    </ul>
  )
}

interface RowProps {
  segment: Segment
  index: number
  isActive: boolean
  isSelected: boolean
  isLooping: boolean
  hidden: boolean
  accuracy: number | undefined
  onSelect: (index: number, modifiers: SegmentSelectModifiers) => void
  onToggleSelect: (index: number) => void
  onMerge: () => void
  onSplit: () => void
}

function SegmentRow({
  segment,
  index,
  isActive,
  isSelected,
  isLooping,
  hidden,
  accuracy,
  onSelect,
  onToggleSelect,
  onMerge,
  onSplit,
}: RowProps) {
  const background = isActive
    ? 'border-sky-400 bg-sky-400/10'
    : isSelected
      ? 'border-slate-400 bg-white/[0.07]'
      : 'border-transparent hover:border-white/20 hover:bg-white/5'

  return (
    <li data-index={index}>
      <div
        className={`group border-l-2 px-3 py-2 transition ${background}`}
        // 오른쪽 클릭은 개별 선택 토글 — 브라우저 기본 메뉴는 막는다
        onContextMenu={(e) => {
          e.preventDefault()
          onToggleSelect(index)
        }}
      >
        <button
          type="button"
          onClick={(e) => onSelect(index, { shift: e.shiftKey, ctrl: e.ctrlKey })}
          className="w-full text-left"
        >
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

        {/* 선택된 문장에서만, 그리고 늘 보이게 둔다 — 단축키를 알리는 자리이기도 하다 */}
        {isActive && (
          <div className="mt-1.5 flex gap-1">
            <button
              type="button"
              onClick={onMerge}
              className="chip"
              title="여러 문장을 골라 두었으면 그 범위를 통째로 합칩니다 (F3)"
            >
              다음과 합치기 <kbd className="kbd ml-0.5">F3</kbd>
            </button>
            <button
              type="button"
              onClick={onSplit}
              className="chip"
              title="재생 위치에서 가릅니다. 문장 첫머리에 있으면 원래 자막 경계로 되돌립니다 (F4)"
            >
              쪼개기 <kbd className="kbd ml-0.5">F4</kbd>
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
