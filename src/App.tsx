import { useCallback, useEffect, useRef, useState } from 'react'
import { LoopController } from './core/loop/LoopController'
import { HtmlMediaAdapter } from './core/player/HtmlMediaAdapter'
import type { PlayerAdapter } from './core/player/PlayerAdapter'
import { YouTubeAdapter } from './core/player/YouTubeAdapter'
import { useAppStore } from './store/useAppStore'
import { DictationPane } from './ui/DictationPane'
import { DropZone } from './ui/DropZone'
import { LoopControls } from './ui/LoopControls'
import { PlayerPane } from './ui/PlayerPane'
import { SegmentList } from './ui/SegmentList'
import { useKeyboardShortcuts } from './ui/useKeyboardShortcuts'
import { useLoadFiles } from './ui/useLoadFiles'

/** 재생 위치를 스토어에 반영하는 주기. 매 프레임 갱신하면 리렌더가 폭주한다 */
const TIME_UPDATE_INTERVAL_SEC = 0.2

export default function App() {
  const media = useAppStore((s) => s.media)
  const subtitle = useAppStore((s) => s.subtitle)
  const segments = useAppStore((s) => s.segments)
  const activeIndex = useAppStore((s) => s.activeIndex)
  const loopSettings = useAppStore((s) => s.loopSettings)
  const error = useAppStore((s) => s.error)
  const notice = useAppStore((s) => s.notice)
  const clearAll = useAppStore((s) => s.clearAll)

  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const youtubeRef = useRef<HTMLDivElement | null>(null)
  const loopRef = useRef<LoopController | null>(null)

  const [isDragging, setDragging] = useState(false)
  const { loadFiles } = useLoadFiles()

  // 어댑터 콜백은 오래 살아남으므로 스토어를 직접 읽어 stale closure를 피한다
  const setupToken = useRef(0)

  const playSegment = useCallback((index: number) => {
    const store = useAppStore.getState()
    const segment = store.segments[index]
    if (!segment) return

    store.setActiveIndex(index)
    loopRef.current?.start({ id: segment.id, start: segment.start, end: segment.end })
  }, [])

  const replay = useCallback(() => {
    playSegment(useAppStore.getState().activeIndex)
  }, [playSegment])

  const stop = useCallback(() => {
    loopRef.current?.stop()
  }, [])

  const move = useCallback(
    (delta: number) => {
      const store = useAppStore.getState()
      const next = store.activeIndex + delta
      if (next < 0 || next >= store.segments.length) return
      playSegment(next)
    },
    [playSegment],
  )

  useKeyboardShortcuts({ replay, stop, move })

  // ─── 어댑터 + 루프 컨트롤러 수명 관리 ───────────────────────────
  useEffect(() => {
    if (!media) return

    const token = ++setupToken.current
    let adapter: PlayerAdapter | null = null
    let unsubscribeTick: (() => void) | null = null
    let youtubeHost: HTMLElement | null = null

    const attach = async () => {
      try {
        if (media.kind === 'youtube') {
          if (!youtubeRef.current) return
          // YT.Player는 넘긴 요소를 iframe으로 교체한다. React가 관리하는 노드를
          // 직접 넘기면 언마운트 때 removeChild가 실패하므로 임시 노드를 만들어 준다.
          youtubeHost = document.createElement('div')
          youtubeHost.style.width = '100%'
          youtubeHost.style.height = '100%'
          youtubeRef.current.appendChild(youtubeHost)
          adapter = await YouTubeAdapter.create(youtubeHost, media.src)
        } else {
          if (!mediaRef.current) return
          adapter = new HtmlMediaAdapter(mediaRef.current)
        }

        if (token !== setupToken.current) {
          adapter.destroy()
          return
        }

        adapter.setRate(useAppStore.getState().loopSettings.rate)

        loopRef.current = new LoopController(adapter, useAppStore.getState().loopSettings, {
          onStatus: (status) => useAppStore.getState().setLoopStatus(status),
          onFinished: () => {
            const store = useAppStore.getState()
            if (store.autoAdvance) move(1)
          },
        })

        let lastReported = -1
        unsubscribeTick = adapter.onTick((time) => {
          if (Math.abs(time - lastReported) < TIME_UPDATE_INTERVAL_SEC) return
          lastReported = time
          useAppStore.getState().setCurrentTime(time)
        })
      } catch (err) {
        if (token === setupToken.current) {
          useAppStore.getState().setError(err instanceof Error ? err.message : '플레이어를 초기화하지 못했습니다.')
        }
      }
    }

    void attach()

    return () => {
      setupToken.current++
      unsubscribeTick?.()
      loopRef.current?.destroy()
      loopRef.current = null
      adapter?.destroy()
      if (youtubeHost?.parentElement) youtubeHost.remove()
    }
  }, [media, move])

  // 설정 변경을 실행 중인 루프에 반영
  useEffect(() => {
    loopRef.current?.updateSettings(loopSettings)
  }, [loopSettings])

  // ─── 전역 드래그앤드롭 ──────────────────────────────────────────
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length > 0) void loadFiles(files)
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)

    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [loadFiles])

  if (!media) {
    return (
      <div className="h-full">
        <DropZone isDragging={isDragging} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-2">
        <span className="text-sm font-semibold tracking-tight text-slate-200">LangPlayer</span>
        <span className="min-w-0 truncate text-xs text-slate-500">{media.name}</span>
        {subtitle && (
          <span className="shrink-0 text-xs text-slate-600">
            {subtitle.name} · {segments.length}문장
          </span>
        )}
        <button type="button" onClick={clearAll} className="ml-auto chip">
          다른 파일 열기
        </button>
      </header>

      {(error || notice) && (
        <div
          className={`px-4 py-1.5 text-xs ${
            error ? 'bg-rose-500/10 text-rose-300' : 'bg-sky-500/10 text-sky-300'
          }`}
        >
          {error ?? notice}
        </div>
      )}

      <main className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <PlayerPane mediaRef={mediaRef} youtubeRef={youtubeRef} />
          <LoopControls onStop={stop} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DictationPane onReplay={replay} />
          </div>
        </section>

        <aside className="flex w-96 shrink-0 flex-col border-l border-white/10">
          <div className="border-b border-white/10 px-3 py-2 text-xs text-slate-500">
            문장 {segments.length > 0 ? `${activeIndex + 1} / ${segments.length}` : '—'}
            <span className="ml-2 text-slate-700">↑↓ 이동 · Space 반복</span>
          </div>
          <div className="min-h-0 flex-1">
            <SegmentList onSelect={playSegment} />
          </div>
        </aside>
      </main>

      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-sky-500/10 backdrop-blur-sm">
          <p className="rounded-xl border-2 border-dashed border-sky-400 px-8 py-6 text-sky-200">
            여기에 놓으면 불러옵니다
          </p>
        </div>
      )}
    </div>
  )
}
