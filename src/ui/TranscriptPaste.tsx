import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useLoadFiles } from './useLoadFiles'

/**
 * 자막이 아직 없을 때 사이드바에 뜨는 붙여넣기 상자.
 *
 * 특히 YouTube를 위한 것이다. 유튜브는 자막 텍스트를 API로 주지 않고 자막
 * 엔드포인트도 CORS로 막혀 있어서, 사용자가 '스크립트 표시'에서 복사해 오는
 * 것이 온전하고 안전한 유일한 경로다. 복사 한 번이면 나머지는 파일로 받은
 * 자막과 똑같이 흘러간다.
 */
export function TranscriptPaste() {
  const media = useAppStore((s) => s.media)
  const { loadSubtitleText } = useLoadFiles()
  const [text, setText] = useState('')

  const isYouTube = media?.kind === 'youtube'

  const submit = () => {
    if (loadSubtitleText(text, isYouTube ? 'YouTube 스크립트' : '붙여넣은 자막')) setText('')
  }

  const pasteFromClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText()
      if (clip.trim() && loadSubtitleText(clip, isYouTube ? 'YouTube 스크립트' : '붙여넣은 자막')) {
        setText('')
        return
      }
      setText(clip)
    } catch {
      useAppStore.getState().setError('클립보드를 읽지 못했습니다. 아래 칸에 직접 붙여넣어 주세요.')
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="text-xs leading-relaxed text-slate-500">
        {isYouTube ? (
          <>
            <p className="mb-1.5 text-slate-400">YouTube 자막 가져오기</p>
            <ol className="list-inside list-decimal space-y-0.5 text-slate-600">
              <li>영상 설명란의 <span className="text-slate-400">···</span> → <span className="text-slate-400">스크립트 표시</span></li>
              <li>스크립트 전체를 선택해 복사</li>
              <li>아래에 붙여넣기</li>
            </ol>
          </>
        ) : (
          <p>자막 파일을 끌어다 놓거나, 스크립트를 아래에 붙여넣으세요.</p>
        )}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          // 붙여넣는 즉시 알아서 처리한다 — 버튼을 한 번 더 누르게 할 이유가 없다
          const clip = e.clipboardData.getData('text')
          if (!clip.trim()) return
          e.preventDefault()
          if (loadSubtitleText(clip, isYouTube ? 'YouTube 스크립트' : '붙여넣은 자막')) setText('')
          else setText(clip)
        }}
        spellCheck={false}
        placeholder={'0:15\nI was sitting with my friend\n0:19\nIt was the Horn and Hardart'}
        className="dictation-input min-h-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/30 p-2.5 text-xs text-slate-200 outline-none transition placeholder:text-slate-700 focus:border-sky-400/60"
      />

      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={!text.trim()} className="chip flex-1 disabled:opacity-40">
          자막으로 사용
        </button>
        <button type="button" onClick={() => void pasteFromClipboard()} className="chip">
          클립보드에서
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-600">
        SRT·VTT를 붙여넣어도 됩니다. 형식은 내용을 보고 알아서 판별합니다.
      </p>
    </div>
  )
}
