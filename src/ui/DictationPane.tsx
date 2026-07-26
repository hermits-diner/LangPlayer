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
export function DictationPane({ onReplay, onNext }: { onReplay: () => void; onNext: () => void }) {
  const segments = useAppStore((s) => s.segments)
  const activeIndex = useAppStore((s) => s.activeIndex)
  const inputs = useAppStore((s) => s.inputs)
  const results = useAppStore((s) => s.results)
  const hideSubtitles = useAppStore((s) => s.hideSubtitles)
  const gradingEnabled = useAppStore((s) => s.gradingEnabled)
  const setInput = useAppStore((s) => s.setInput)
  const gradeActive = useAppStore((s) => s.gradeActive)
  const clearActiveResult = useAppStore((s) => s.clearActiveResult)
  const toggleHideSubtitles = useAppStore((s) => s.toggleHideSubtitles)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const segment = segments[activeIndex]
  const key = segment ? segmentKey(segment) : null
  const result = gradingEnabled && key ? results[key] : undefined

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
    // Enter는 언제나 '다음 문장'이다. 다 썼으면 Enter — 그게 전부다.
    // 채점을 켜 두었으면 넘어가면서 방금 문장을 함께 채점한다. 점수는 문장
    // 목록에 남으므로, 확인하고 싶으면 되돌아가서 보면 된다.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (gradingEnabled) gradeActive()
      onNext()
      return
    }

    // 입력 중에도 다시 듣기와 정답 보기는 손을 떼지 않고 쓸 수 있어야 한다
    if (e.key === 'Tab') {
      e.preventDefault()
      toggleHideSubtitles()
      return
    }

    // 전역 단축키가 F5를 이미 처리하므로 여기서는 Esc만 본다
    if (e.key === 'Escape') {
      e.preventDefault()
      onReplay()
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <kbd className="kbd">Enter</kbd> 다음 문장{gradingEnabled && ' (채점하며)'}
          <kbd className="kbd">F5</kbd> 구간 반복
          <kbd className="kbd">Tab</kbd> 정답 보기
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
        className="dictation-input min-h-28 w-full resize-none rounded-xl border border-white/[0.09] bg-black/40 px-4 py-3.5 text-[1.0625rem] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition duration-200 placeholder:text-slate-700 focus:border-sky-400/45 focus:bg-black/50 focus:shadow-[0_0_0_3px_rgba(210,167,71,0.10),inset_0_1px_0_rgba(255,255,255,0.04)]"
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
        <div className="rounded-xl border border-dashed border-white/[0.09] px-4 py-3.5">
          {hideSubtitles ? (
            <span className="text-sm text-slate-700">자막이 가려져 있습니다 · Tab으로 확인</span>
          ) : (
            <span className="text-[1.0625rem] leading-relaxed text-slate-300">{segment.text}</span>
          )}
        </div>
      )}
    </div>
  )
}
