import { useEffect, useRef, useState } from 'react'
import type { Segment } from '../core/subtitle/types'
import { useAppStore } from '../store/useAppStore'
import { formatTime, maskText } from './format'

/**
 * 문장(세그먼트) 목록.
 *
 * 클릭 한 번이 곧 "이 구간을 N번 반복"이다. 자동 병합이 어긋난 문장은 여기서
 * 바로 합치고 쪼갤 수 있고, 자막 자체가 틀렸으면 그 자리에서 고칠 수 있다.
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
  const loopStatus = useAppStore((s) => s.loopStatus)
  const selection = useAppStore((s) => s.selection)
  const toggleSelection = useAppStore((s) => s.toggleSelection)

  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // 키보드로 이동할 때 선택된 항목이 화면 밖으로 나가지 않게 한다
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex])

  // 다른 문장으로 옮기면 편집을 닫는다
  useEffect(() => setEditingIndex(null), [activeIndex])

  if (segments.length === 0) {
    return <div className="p-4 text-sm text-slate-600">자막 파일을 불러오면 문장이 여기에 나옵니다.</div>
  }

  return (
    <ul
      ref={listRef}
      // PageUp/PageDown이 이 목록을 찾아 넘긴다 (App의 scrollSegments)
      data-segment-list
      className="h-full overflow-y-auto py-1"
    >
      {segments.map((segment, index) => (
        <SegmentRow
          key={segment.id}
          segment={segment}
          index={index}
          isActive={index === activeIndex}
          isSelected={selection.includes(index)}
          isLooping={loopStatus.running && loopStatus.targetId === segment.id}
          isEditing={editingIndex === index}
          hidden={hideSubtitles}
          onSelect={onSelect}
          onToggleSelect={toggleSelection}
          onMerge={onMerge}
          onSplit={onSplit}
          onEdit={() => setEditingIndex(index)}
          onEditDone={() => setEditingIndex(null)}
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
  isEditing: boolean
  hidden: boolean
  onSelect: (index: number, modifiers: SegmentSelectModifiers) => void
  onToggleSelect: (index: number) => void
  onMerge: () => void
  onSplit: () => void
  onEdit: () => void
  onEditDone: () => void
}

function SegmentRow({
  segment,
  index,
  isActive,
  isSelected,
  isLooping,
  isEditing,
  hidden,
  onSelect,
  onToggleSelect,
  onMerge,
  onSplit,
  onEdit,
  onEditDone,
}: RowProps) {
  const setSegmentText = useAppStore((s) => s.setSegmentText)

  const background = isActive
    ? 'border-sky-400 bg-sky-400/[0.09]'
    : isSelected
      ? 'border-slate-500 bg-white/[0.05]'
      : 'border-transparent hover:border-white/15 hover:bg-white/[0.035]'

  return (
    <li data-index={index}>
      <div
        className={`group border-l-2 px-3 py-2.5 transition duration-150 ${background}`}
        // 오른쪽 클릭은 개별 선택 토글 — 브라우저 기본 메뉴는 막는다
        onContextMenu={(e) => {
          e.preventDefault()
          onToggleSelect(index)
        }}
      >
        <div className="flex items-center gap-1.5 text-[10.5px] tabular-nums tracking-wide text-slate-600">
          <span className={isActive ? 'text-slate-400' : undefined}>{formatTime(segment.start)}</span>
          <span className="text-slate-700">·</span>
          <span>{(segment.end - segment.start).toFixed(1)}초</span>
          {isLooping && <span className="ml-1 text-sky-400">▶ 반복 중</span>}
        </div>

        {isEditing ? (
          <SegmentEditor
            text={segment.text}
            onCommit={(text) => {
              setSegmentText(index, text)
              onEditDone()
            }}
            onCancel={onEditDone}
          />
        ) : (
          <button
            type="button"
            onClick={(e) => onSelect(index, { shift: e.shiftKey, ctrl: e.ctrlKey })}
            // 자막이 틀렸을 때 바로 고칠 수 있는 가장 빠른 길
            onDoubleClick={onEdit}
            className="w-full text-left"
          >
            <p className={`mt-1 text-[13.5px] leading-relaxed ${isActive ? 'text-slate-100' : 'text-slate-400'}`}>
              {hidden ? (
                <span className="tracking-wider text-slate-600">{maskText(segment.text)}</span>
              ) : (
                segment.text
              )}
            </p>
          </button>
        )}

        {isActive && !isEditing && (
          <div className="mt-1.5 flex gap-1">
            <button type="button" onClick={onEdit} className="chip" title="자막 문장 고치기 (두 번 클릭)">
              고치기
            </button>
            <button
              type="button"
              onClick={onMerge}
              className="chip"
              title="여러 문장을 골라 두었으면 그 범위를 통째로 합칩니다 (F3)"
            >
              합치기 <kbd className="kbd ml-0.5">F3</kbd>
            </button>
            <button
              type="button"
              onClick={onSplit}
              className="chip"
              title="재생 위치 → 문장 단위 → 자막 경계 순으로 나눕니다 (F4)"
            >
              쪼개기 <kbd className="kbd ml-0.5">F4</kbd>
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * 자막 한 문장 고치기.
 *
 * 자막이 가려져 있어도 편집할 때는 실제 글자를 보여준다 — 안 보이는 것을
 * 고칠 수는 없다. Enter로 확정, Esc로 취소, 밖을 누르면 그대로 저장한다.
 */
function SegmentEditor({
  text,
  onCommit,
  onCancel,
}: {
  text: string
  onCommit: (text: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(text)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        e.stopPropagation() // 전역 단축키가 편집을 가로채지 않게 한다
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          onCommit(draft)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      rows={2}
      spellCheck={false}
      className="mt-1 w-full resize-none rounded-md border border-sky-400/45 bg-black/50 px-2 py-1.5 text-[13.5px] leading-relaxed text-slate-100 outline-none"
    />
  )
}
