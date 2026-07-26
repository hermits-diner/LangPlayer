import { useEffect, useRef } from 'react'
import { segmentKey, useAppStore } from '../store/useAppStore'

/**
 * 받아쓰기 입력창.
 *
 * 흐름은 하나다 — 듣고, 쓰고, `Tab`으로 정답을 열어 스스로 대조하고, `Enter`로
 * 다음 문장. 점수를 매기지 않으므로 어디서 막혔는지는 본인이 판단한다.
 */
export interface DictationPaneProps {
  onReplay: () => void
  onNext: () => void
  onPrev: () => void
}

export function DictationPane({ onReplay, onNext, onPrev }: DictationPaneProps) {
  const segments = useAppStore((s) => s.segments)
  const activeIndex = useAppStore((s) => s.activeIndex)
  const inputs = useAppStore((s) => s.inputs)
  const hideSubtitles = useAppStore((s) => s.hideSubtitles)
  const setInput = useAppStore((s) => s.setInput)
  const toggleHideSubtitles = useAppStore((s) => s.toggleHideSubtitles)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const segment = segments[activeIndex]
  const key = segment ? segmentKey(segment) : null

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onNext()
      return
    }

    // 이 칸에는 문장 하나만 담긴다. 커서를 위아래로 옮길 일이 거의 없으므로
    // ↑↓를 앞뒤 문장 이동에 내준다. (전체 문서를 다루는 텍스트창은 그대로 둔다)
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (e.key === 'ArrowDown') onNext()
      else onPrev()
      return
    }

    // 입력 중에도 정답 보기와 다시 듣기는 손을 떼지 않고 쓸 수 있어야 한다
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        <kbd className="kbd">Enter</kbd> 다음 문장
        <kbd className="kbd">↑</kbd>
        <kbd className="kbd">↓</kbd> 앞뒤 문장
        <kbd className="kbd">F5</kbd> 구간 반복
        <kbd className="kbd">Tab</kbd> 정답 보기
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

      <div className="rounded-xl border border-dashed border-white/[0.09] px-4 py-3.5">
        {hideSubtitles ? (
          <span className="text-sm text-slate-700">자막이 가려져 있습니다 · Tab으로 확인</span>
        ) : (
          <span className="text-[1.0625rem] leading-relaxed text-slate-300">{segment.text}</span>
        )}
      </div>
    </div>
  )
}
