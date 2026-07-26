import { useCallback, useEffect, useRef, useState } from 'react'
import { clearAllSessions, countSessions } from '../core/storage/db'
import { isPersisted, isStorageApiSupported, requestPersistence } from '../core/storage/quota'
import { useAppStore } from '../store/useAppStore'
import { useLoadFiles } from './useLoadFiles'

/** 첫 화면. 파일 드롭 / 파일 선택 / YouTube 주소 세 가지 입구를 준다 */
export function DropZone({ isDragging }: { isDragging: boolean }) {
  const { loadFiles, loadYouTube } = useLoadFiles()
  const error = useAppStore((s) => s.error)
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [savedCount, setSavedCount] = useState(0)
  const [persisted, setPersisted] = useState(true)

  const refreshStorage = useCallback(() => {
    void countSessions().then(setSavedCount)
    void isPersisted().then(setPersisted)
  }, [])

  useEffect(refreshStorage, [refreshStorage])

  const submitUrl = (e: React.FormEvent) => {
    e.preventDefault()
    if (loadYouTube(url)) setUrl('')
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-9 px-6">
      {/* 빈 첫 화면에 은은한 빛을 깔아 평평함을 깬다 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_38%,rgba(210,167,71,0.06),transparent_70%)]"
      />

      <div className="relative text-center">
        <h1 className="text-[2.5rem] font-semibold leading-none tracking-[-0.03em] text-slate-100">
          LangPlayer
        </h1>
        <p className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-slate-500">
          문장을 클릭하면 그 구간만 반복됩니다. 듣고, 받아쓰고, 바로 대조하세요.
        </p>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`relative flex w-full max-w-xl flex-col items-center gap-2.5 rounded-2xl border border-dashed px-12 py-14 transition duration-200 ${
          isDragging
            ? 'border-sky-400/70 bg-sky-400/[0.07]'
            : 'border-white/[0.14] hover:border-white/25 hover:bg-white/[0.025]'
        }`}
      >
        <span className="text-sm text-slate-300">영상·오디오와 자막 파일을 함께 끌어다 놓으세요</span>
        <span className="text-xs tracking-wide text-slate-600">
          MP4 · WebM · MP3 · M4A &nbsp;+&nbsp; SRT · VTT · SMI
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,.srt,.vtt,.smi,.sami"
        className="hidden"
        onChange={(e) => {
          void loadFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />

      <form onSubmit={submitUrl} className="relative flex w-full max-w-xl gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="또는 YouTube 주소 붙여넣기"
          className="flex-1 rounded-lg border border-white/[0.09] bg-black/40 px-3.5 py-2.5 text-sm text-slate-200 outline-none transition duration-200 placeholder:text-slate-700 focus:border-sky-400/45 focus:bg-black/50"
        />
        <button
          type="submit"
          disabled={!url.trim()}
          className="rounded-lg bg-sky-400 px-4 py-2.5 text-sm font-medium text-ink-950 transition duration-150 hover:bg-sky-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/[0.05] disabled:text-slate-700"
        >
          불러오기
        </button>
      </form>

      {error && <p className="relative max-w-xl text-center text-sm text-rose-300">{error}</p>}

      <div className="relative flex flex-col items-center gap-1.5">
        <p className="max-w-md text-center text-xs leading-relaxed text-slate-600">
          파일은 브라우저 안에서만 처리되며 어디에도 업로드되지 않습니다.
        </p>

        {savedCount > 0 && (
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-slate-600">
            <span>학습 기록 {savedCount}개 — 같은 파일을 다시 열면 이어집니다.</span>

            {isStorageApiSupported() && !persisted && (
              <button
                type="button"
                onClick={() => {
                  void requestPersistence().then(refreshStorage)
                }}
                title="디스크가 부족하면 브라우저가 학습 기록을 지울 수 있습니다"
                className="text-amber-500/80 underline decoration-dotted underline-offset-2 transition hover:text-amber-400"
              >
                삭제될 수 있음 · 영구 보관 요청
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                void clearAllSessions().then(refreshStorage)
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
