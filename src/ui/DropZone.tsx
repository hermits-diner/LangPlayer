import { useEffect, useRef, useState } from 'react'
import { clearAllSessions, countSessions } from '../core/storage/db'
import { useAppStore } from '../store/useAppStore'
import { useLoadFiles } from './useLoadFiles'

/** 첫 화면. 파일 드롭 / 파일 선택 / YouTube 주소 세 가지 입구를 준다 */
export function DropZone({ isDragging }: { isDragging: boolean }) {
  const { loadFiles, loadYouTube } = useLoadFiles()
  const error = useAppStore((s) => s.error)
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [savedCount, setSavedCount] = useState(0)

  useEffect(() => {
    void countSessions().then(setSavedCount)
  }, [])

  const submitUrl = (e: React.FormEvent) => {
    e.preventDefault()
    if (loadYouTube(url)) setUrl('')
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-100">LangPlayer</h1>
        <p className="mt-2 text-sm text-slate-500">
          문장을 클릭하면 그 구간만 반복됩니다. 듣고, 받아쓰고, 바로 채점하세요.
        </p>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`flex w-full max-w-xl flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-12 transition ${
          isDragging
            ? 'border-sky-400 bg-sky-400/10'
            : 'border-white/15 hover:border-white/30 hover:bg-white/5'
        }`}
      >
        <span className="text-4xl">📼</span>
        <span className="text-slate-300">영상·오디오와 자막 파일을 함께 끌어다 놓으세요</span>
        <span className="text-xs text-slate-600">MP4 · WebM · MP3 · M4A + SRT · VTT · SMI · ASS</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,.srt,.vtt,.smi,.sami,.ass,.ssa"
        className="hidden"
        onChange={(e) => {
          void loadFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />

      <form onSubmit={submitUrl} className="flex w-full max-w-xl gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="또는 YouTube 주소 붙여넣기"
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none transition placeholder:text-slate-600 focus:border-sky-400/60"
        />
        <button
          type="submit"
          disabled={!url.trim()}
          className="rounded-lg bg-sky-500/90 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
        >
          불러오기
        </button>
      </form>

      {error && <p className="max-w-xl text-center text-sm text-rose-300">{error}</p>}

      <div className="flex flex-col items-center gap-1.5">
        <p className="max-w-md text-center text-xs leading-relaxed text-slate-600">
          파일은 브라우저 안에서만 처리되며 어디에도 업로드되지 않습니다.
        </p>

        {savedCount > 0 && (
          <p className="text-xs text-slate-600">
            학습 기록 {savedCount}개 저장됨 — 같은 파일을 다시 열면 이어집니다.{' '}
            <button
              type="button"
              onClick={() => {
                void clearAllSessions().then(() => setSavedCount(0))
              }}
              className="underline decoration-dotted underline-offset-2 transition hover:text-slate-400"
            >
              지우기
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
