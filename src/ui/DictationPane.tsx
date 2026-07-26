import { useEffect, useRef } from 'react'
import { segmentKey, useAppStore } from '../store/useAppStore'
import { DiffView } from './DiffView'

/**
 * 받아쓰기 입력창.
 *
 * 자막을 가린 채 듣고 타이핑 → Enter로 채점 → 색상 diff 확인이 한 화면에서
 * 끝나야 한다. 문장을 옮길 때마다 포커스가 따라오도록 해서 마우스를 쓰지
 * 않고도 계속 진행할 수 있게 한다.
 */
export function DictationPane({ onReplay }: { onReplay: () => void }) {
  const segments = useAppStore((s) => s.segments)
  const activeIndex = useAppStore((s) => s.activeIndex)
  const inputs = useAppStore((s) => s.inputs)
  const results = useAppStore((s) => s.results)
  const hideSubtitles = useAppStore((s) => s.hideSubtitles)
  const setInput = useAppStore((s) => s.setInput)
  const gradeActive = useAppStore((s) => s.gradeActive)
  const clearActiveResult = useAppStore((s) => s.clearActiveResult)
  const toggleHideSubtitles = useAppStore((s) => s.toggleHideSubtitles)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const segment = segments[activeIndex]
  const key = segment ? segmentKey(segment) : null
  const result = key ? results[key] : undefined

  // 문장을 옮기면 입력창으로 포커스를 넘겨 바로 타이핑할 수 있게 한다
  useEffect(() => {
    if (segment) textareaRef.current?.focus()
  }, [segment?.id])

  if (!segment || !key) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-600">
        오른쪽에서 문장을 선택하세요
      </div>
    )
  }

  const value = inputs[key] ?? ''

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      gradeActive()
      return
    }

    // 입력 중에도 다시 듣기와 정답 보기는 손을 떼지 않고 쓸 수 있어야 한다
    if (e.key === 'Tab') {
      e.preventDefault()
      toggleHideSubtitles()
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      onReplay()
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <kbd className="kbd">Enter</kbd> 채점
          <kbd className="kbd">Tab</kbd> 정답 보기
          <kbd className="kbd">Esc</kbd> 다시 듣기
        </div>
        {result && (
          <button
            type="button"
            onClick={clearActiveResult}
            className="text-xs text-slate-500 transition hover:text-slate-300"
          >
            채점 지우기
          </button>
        )}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setInput(key, e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="들은 대로 받아쓰세요"
        className="dictation-input min-h-24 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-3 text-lg text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/60 focus:ring-1 focus:ring-sky-400/30"
      />

      {result ? (
        <div className="rounded-lg border border-white/10 bg-black/20 p-4">
          <DiffView result={result} />
          {!result.isPerfect && (
            <p className="mt-3 border-t border-white/5 pt-3 text-sm text-slate-400">
              <span className="text-slate-600">정답 </span>
              {segment.text}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 p-4 text-sm">
          {hideSubtitles ? (
            <span className="text-slate-600">자막이 가려져 있습니다 · Tab으로 확인</span>
          ) : (
            <span className="text-slate-300">{segment.text}</span>
          )}
        </div>
      )}
    </div>
  )
}
