import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoopController } from './core/loop/LoopController'
import { HtmlMediaAdapter } from './core/player/HtmlMediaAdapter'
import type { PlayerAdapter } from './core/player/PlayerAdapter'
import { YouTubeAdapter } from './core/player/YouTubeAdapter'
import { canSplitAt, useAppStore } from './store/useAppStore'
import { useTextStore } from './store/useTextStore'
import { AppMenu } from './ui/AppMenu'
import { DictationPane } from './ui/DictationPane'
import { HelpOverlay } from './ui/HelpOverlay'
import { PrintView } from './ui/PrintView'
import { TextWindow } from './ui/TextWindow'
import { TranscriptPaste } from './ui/TranscriptPaste'
import { DropZone } from './ui/DropZone'
import { LoopControls } from './ui/LoopControls'
import { PlayerPane } from './ui/PlayerPane'
import { SegmentList } from './ui/SegmentList'
import { Waveform, type WaveformView } from './ui/Waveform'
import { useKeyboardShortcuts, type PlayerCommands } from './ui/useKeyboardShortcuts'
import { useLoadFiles } from './ui/useLoadFiles'
import { usePersistence } from './ui/usePersistence'
import { useWaveform } from './ui/useWaveform'

/** 재생 위치를 스토어에 반영하는 주기. 매 프레임 갱신하면 리렌더가 폭주한다 */
const TIME_UPDATE_INTERVAL_SEC = 0.2

/** 탭 맞추기에서 문장 시작 몇 초 전부터 들려줄지 — 마음의 준비를 할 시간 */
const TAP_SYNC_LEAD_SEC = 3

/** F6로 일시정지한 뒤 다시 누르면 이만큼 되감아 재생한다 */
const PAUSE_REWIND_SEC = 3

/** 음파창 최소 확대 폭 */
const MIN_VIEW_SEC = 1

/** 알림이 스스로 물러나는 시간 */
const NOTICE_DISMISS_MS = 6000

/** 드래그 구간·연속 재생은 반복 없이 한 번, 패딩 없이 그대로 */
const PLAY_ONCE = { repeatCount: 1, padLeadMs: 0, padTailMs: 0, gapMs: 0 }

export default function App() {
  const media = useAppStore((s) => s.media)
  const subtitle = useAppStore((s) => s.subtitle)
  const segments = useAppStore((s) => s.segments)
  const activeIndex = useAppStore((s) => s.activeIndex)
  const selection = useAppStore((s) => s.selection)
  const loopSettings = useAppStore((s) => s.loopSettings)
  const error = useAppStore((s) => s.error)
  const notice = useAppStore((s) => s.notice)
  const clearAll = useAppStore((s) => s.clearAll)
  const textWindowOpen = useTextStore((s) => s.open)

  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const youtubeRef = useRef<HTMLDivElement | null>(null)
  const loopRef = useRef<LoopController | null>(null)
  const adapterRef = useRef<PlayerAdapter | null>(null)
  const setupToken = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [isDragging, setDragging] = useState(false)
  const [tapMode, setTapMode] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [volume, setVolumeState] = useState(1)
  const [durationSec, setDurationSec] = useState(0)
  const [view, setView] = useState<WaveformView>({ startSec: 0, endSec: 60 })

  const { loadFiles } = useLoadFiles()
  useWaveform()
  usePersistence()

  const totalSec = durationSec || segments.at(-1)?.end || 0

  // ─── 재생 명령 ─────────────────────────────────────────────────
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

  const gotoFirst = useCallback(() => playSegment(0), [playSegment])
  const gotoLast = useCallback(
    () => playSegment(useAppStore.getState().segments.length - 1),
    [playSegment],
  )

  /** F8 — 재생 중이면 멈추고, 멈춰 있으면 조금 되감아 다시 재생 */
  const togglePause = useCallback(() => {
    const adapter = adapterRef.current
    if (!adapter) return

    if (!adapter.isPaused()) {
      loopRef.current?.stop()
      return
    }

    const from = Math.max(0, adapter.getCurrentTime() - PAUSE_REWIND_SEC)
    void adapter.seek(from).then(() => adapter.play())
  }, [])

  const playRange = useCallback((startSec: number, endSec: number) => {
    loopRef.current?.start({ id: `range-${startSec.toFixed(2)}`, start: startSec, end: endSec }, PLAY_ONCE)
  }, [])

  /** F11 — 선택 구간을 이어서, 선택이 없으면 현재 문장부터 끝까지 */
  const playContinuous = useCallback(() => {
    const store = useAppStore.getState()
    const { segments: list, selection: picked, activeIndex: current } = store
    if (list.length === 0) return

    const from = picked.length > 0 ? picked[0] : Math.max(0, current)
    const to = picked.length > 0 ? picked[picked.length - 1] : list.length - 1

    store.setActiveIndex(from)
    loopRef.current?.start(
      { id: `continuous-${from}-${to}`, start: list[from].start, end: list[to].end },
      PLAY_ONCE,
    )
  }, [])

  const togglePlay = useCallback(() => {
    if (useAppStore.getState().loopStatus.running) stop()
    else replay()
  }, [replay, stop])

  // ─── 섹션 편집 ─────────────────────────────────────────────────
  /**
   * 섹션 편집 뒤에는 바뀐 구간을 곧바로 들려준다.
   *
   * 재생 중이던 루프는 편집 전 시각을 붙들고 있어서, 그대로 두면 자막은 합쳐졌는데
   * 소리는 옛 경계에서 끊긴다. 새 경계로 다시 걸어 주면 귀로 바로 확인이 된다.
   */
  const mergeSections = useCallback(() => {
    const store = useAppStore.getState()
    const picked = store.selection

    // 여러 개를 골라 뒀으면 그 범위를 통째로, 아니면 현재 문장과 다음 문장을
    const from = picked.length > 1 ? picked[0] : store.activeIndex
    const to = picked.length > 1 ? picked[picked.length - 1] : store.activeIndex + 1
    if (from < 0 || to >= store.segments.length) return

    store.mergeRange(from, to)
    playSegment(from)
  }, [playSegment])

  /**
   * 쪼개기는 세 가지 기준을 차례로 시도한다.
   *
   *   1. **문장 단위** — 구간에 문장이 여럿이면 문장별로 가른다. 경계는 원래 큐
   *      경계나 파형의 쉼에 맞춘다. 이 앱의 학습 단위가 문장이므로 이게 기본이다.
   *   2. **재생 위치** — 문장이 하나뿐인데 사용자가 어딘가를 짚어 뒀다면 거기서
   *   3. **큐 경계** — 둘 다 아니면 원래 자막이 나눠 둔 대로 되돌린다
   */
  const splitSection = useCallback(() => {
    const store = useAppStore.getState()
    const segment = store.segments[store.activeIndex]
    const index = store.activeIndex

    if (!store.splitActiveBySentence()) {
      if (segment && canSplitAt(segment, store.currentTime)) store.splitActiveAt(store.currentTime)
      else store.splitActive()
    }

    playSegment(index)
  }, [playSegment])

  /** 음파창에서 찍은 지점으로 나누고, 앞쪽 조각을 들려준다 */
  const splitAt = useCallback(
    (timeSec: number) => {
      const index = useAppStore.getState().activeIndex
      useAppStore.getState().splitActiveAt(timeSec)
      playSegment(index)
    },
    [playSegment],
  )

  // ─── 음파창 조작 ───────────────────────────────────────────────
  const zoomBy = useCallback(
    (factor: number) => {
      setView((current) => {
        const span = current.endSec - current.startSec
        const nextSpan = Math.min(Math.max(MIN_VIEW_SEC, span * factor), Math.max(MIN_VIEW_SEC, totalSec))
        const center = (current.startSec + current.endSec) / 2
        const start = Math.min(Math.max(0, center - nextSpan / 2), Math.max(0, totalSec - nextSpan))
        return { startSec: start, endSec: start + nextSpan }
      })
    },
    [totalSec],
  )

  /**
   * PageUp/PageDown — 자막 목록을 한 화면씩 넘긴다.
   *
   * 앞뒤 자막을 훑어보려고 매번 휠을 굴리는 게 번거롭다는 요구다. 그래서
   * **현재 문장은 건드리지 않고 목록만** 움직인다 — 공부하던 자리를 잃지 않고
   * 둘러볼 수 있어야 한다. 한 화면을 통째로 넘기면 맥락이 끊기므로 조금 겹쳐 둔다.
   */
  const scrollSegments = useCallback((direction: 1 | -1) => {
    const list = document.querySelector<HTMLElement>('[data-segment-list]')
    if (!list) return
    list.scrollBy({ top: direction * list.clientHeight * 0.85, behavior: 'smooth' })
  }, [])

  const zoomToAll = useCallback(() => {
    setView({ startSec: 0, endSec: Math.max(MIN_VIEW_SEC, totalSec) })
  }, [totalSec])

  const adjustVolume = useCallback((delta: number) => {
    setVolumeState((current) => {
      const next = Math.min(1, Math.max(0, Number((current + delta).toFixed(2))))
      adapterRef.current?.setVolume(next)
      useAppStore.getState().setNotice(`음량 ${Math.round(next * 100)}%`)
      return next
    })
  }, [])

  const selectFromWaveform = useCallback(
    (index: number, modifiers: { shift: boolean; ctrl: boolean }) => {
      const store = useAppStore.getState()
      if (modifiers.shift) store.selectRange(store.activeIndex, index)
      else if (modifiers.ctrl) store.toggleSelection(index)
      else store.clearSelection()
      playSegment(index)
    },
    [playSegment],
  )

  // ─── 텍스트창 연동 ─────────────────────────────────────────────

  /** 텍스트창에서 커서가 옮겨간 줄을 현재 문장으로 삼는다 */
  const focusLine = useCallback(
    (line: number, play: boolean) => {
      const store = useAppStore.getState()
      if (line < 0 || line >= store.segments.length) return

      if (play) playSegment(line)
      else store.setActiveIndex(line)
    },
    [playSegment],
  )

  const openFiles = useCallback(() => fileInputRef.current?.click(), [])

  /** Ctrl+P — 자막 스크립트만 인쇄한다 (인쇄용 문서는 CSS가 갈아끼운다) */
  const print = useCallback(() => {
    if (useAppStore.getState().segments.length === 0) {
      useAppStore.getState().setNotice('인쇄할 자막이 없습니다.')
      return
    }
    window.print()
  }, [])

  /** Ctrl+S — 받아쓰기 전문을 텍스트 파일로 */
  const saveDraft = useCallback(() => {
    const store = useAppStore.getState()
    const transcript = useTextStore.getState().getTranscript()

    if (!transcript.trim()) {
      store.setNotice('저장할 내용이 없습니다.')
      return
    }

    const name = store.media?.name ?? 'transcript'
    const base = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name
    const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' }))

    const link = document.createElement('a')
    link.href = url
    link.download = `${base}.txt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)

    store.setNotice(`${link.download}으로 내려받았습니다.`)
  }, [])

  const selectFromList = useCallback(
    (index: number, modifiers: { shift: boolean; ctrl: boolean }) => {
      const store = useAppStore.getState()
      if (modifiers.shift) {
        store.selectRange(store.activeIndex, index)
        store.setActiveIndex(index)
        return
      }
      if (modifiers.ctrl) {
        store.toggleSelection(index)
        return
      }
      store.clearSelection()
      playSegment(index)
    },
    [playSegment],
  )

  // ─── 탭 맞추기 ─────────────────────────────────────────────────
  const startTapSync = useCallback(() => {
    const store = useAppStore.getState()
    const segment = store.segments[store.activeIndex]
    const adapter = adapterRef.current
    if (!segment || !adapter) return

    loopRef.current?.stop()
    setTapMode(true)
    store.setNotice('소리가 시작되는 순간에 "지금!"을 누르세요.')
    void adapter.seek(Math.max(0, segment.start - TAP_SYNC_LEAD_SEC)).then(() => adapter.play())
  }, [])

  const markTapSync = useCallback(() => {
    const store = useAppStore.getState()
    const segment = store.segments[store.activeIndex]
    const adapter = adapterRef.current
    setTapMode(false)
    if (!segment || !adapter) return

    adapter.pause()
    const delta = Number((adapter.getCurrentTime() - segment.start).toFixed(3))
    store.nudgeOffset(delta)
    store.setNotice(`탭 맞추기 — 자막을 ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}초 이동했습니다.`)
  }, [])

  const commands = useMemo<PlayerCommands>(
    () => ({
      replay,
      stop,
      move,
      gotoFirst,
      gotoLast,
      togglePause,
      playContinuous,
      mergeSections,
      splitSection,
      zoomIn: () => zoomBy(0.6),
      zoomOut: () => zoomBy(1 / 0.6),
      zoomToAll,
      scrollSegments,
      adjustVolume,
      openFiles,
      saveDraft,
      toggleHelp: () => setHelpOpen((v) => !v),
      toggleMenu: () => setMenuOpen((v) => !v),
      print,
    }),
    [
      replay,
      stop,
      move,
      gotoFirst,
      gotoLast,
      togglePause,
      playContinuous,
      mergeSections,
      splitSection,
      zoomBy,
      zoomToAll,
      scrollSegments,
      adjustVolume,
      openFiles,
      saveDraft,
      print,
    ],
  )

  useKeyboardShortcuts(commands)

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

        adapterRef.current = adapter
        adapter.setRate(useAppStore.getState().loopSettings.rate)
        adapter.setVolume(volume)

        loopRef.current = new LoopController(adapter, useAppStore.getState().loopSettings, {
          onStatus: (status) => useAppStore.getState().setLoopStatus(status),
          onFinished: () => {
            if (useAppStore.getState().autoAdvance) move(1)
          },
        })

        let lastReported = -1
        let lastDuration = -1
        unsubscribeTick = adapter.onTick((time) => {
          const duration = adapter?.getDuration() ?? 0
          if (duration > 0 && duration !== lastDuration) {
            lastDuration = duration
            setDurationSec(duration)
          }

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
      adapterRef.current = null
      adapter?.destroy()
      if (youtubeHost?.parentElement) youtubeHost.remove()
    }
    // volume은 별도 효과로 반영하므로 의존성에서 뺀다 (넣으면 어댑터가 재생성된다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, move])

  useEffect(() => {
    loopRef.current?.updateSettings(loopSettings)
  }, [loopSettings])

  // 새 미디어가 준비되면 전체 파형이 보이도록 맞춘다
  useEffect(() => {
    if (totalSec > 0) setView({ startSec: 0, endSec: totalSec })
  }, [totalSec])

  // 알림은 알렸으면 물러나야 한다. 오류는 사용자가 조치할 때까지 남긴다
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => useAppStore.getState().setNotice(null), NOTICE_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [notice])

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

  const menuItems = [
    { label: '파일 열기', hint: 'Ctrl+O', onSelect: openFiles },
    { label: '받아쓰기 전문 저장', hint: 'Ctrl+S', onSelect: saveDraft },
    { label: '자막 스크립트 인쇄', hint: 'Ctrl+P', onSelect: print },
    { label: '텍스트창', hint: 'Ctrl+T', onSelect: () => useTextStore.getState().toggleOpen() },
    { label: '단축키 도움말', hint: 'F1', onSelect: () => setHelpOpen(true) },
    { label: '다른 파일 열기', onSelect: clearAll },
  ]

  return (
    <div className="flex h-full flex-col">
      <PrintView />

      <div className="no-print flex h-full min-h-0 flex-col">
      <header className="relative flex items-center gap-3 border-b border-white/10 bg-black/20 px-4 py-2.5">
        <span className="text-[13px] font-semibold tracking-tight text-slate-200">LangPlayer</span>
        <span className="h-3.5 w-px bg-white/[0.08]" />
        <span className="min-w-0 truncate text-xs text-slate-500">{media.name}</span>
        {subtitle && (
          <span className="shrink-0 text-xs text-slate-600">
            {subtitle.name} · {segments.length}문장
          </span>
        )}
        {selection.length > 0 && (
          <span className="shrink-0 text-xs text-sky-400">{selection.length}개 선택</span>
        )}
        <button
          type="button"
          onClick={() => useTextStore.getState().toggleOpen()}
          className={`ml-auto chip ${textWindowOpen ? 'chip-active' : ''}`}
          title="받아쓰기 전체를 한 문서로 놓고 고칩니다 (Ctrl+T)"
        >
          텍스트창 <kbd className="kbd ml-0.5">Ctrl+T</kbd>
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className={`chip ${menuOpen ? 'chip-active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          메뉴 <kbd className="kbd ml-0.5">F10</kbd>
        </button>

        <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
      </header>

      {(error || notice) && (
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-1.5 text-xs">
          <span
            aria-hidden
            className={`h-1 w-1 shrink-0 rounded-full ${error ? 'bg-rose-400' : 'bg-sky-400'}`}
          />
          <span className={error ? 'text-rose-300' : 'text-slate-400'}>{error ?? notice}</span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,.srt,.vtt,.smi,.sami"
        className="hidden"
        onChange={(e) => {
          void loadFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />

      <main className="flex min-h-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          <PlayerPane mediaRef={mediaRef} youtubeRef={youtubeRef} />

          <div className="h-24 shrink-0 border-y border-white/10">
            <Waveform
              onPlayRange={playRange}
              onTogglePlay={togglePlay}
              onSplitAt={splitAt}
              onSelectSegment={selectFromWaveform}
              view={view}
              onViewChange={setView}
              durationSec={totalSec}
            />
          </div>

          <LoopControls
            onStop={stop}
            onTapSyncStart={startTapSync}
            onTapSyncMark={markTapSync}
            tapMode={tapMode}
          />

          <div className="min-h-0 flex-1 overflow-y-auto">
            <DictationPane onReplay={replay} onNext={() => move(1)} onPrev={() => move(-1)} />
          </div>

          <TextWindow onFocusLine={focusLine} />
        </section>

        <aside className="flex w-96 shrink-0 flex-col border-l border-white/10">
          <div className="flex items-baseline gap-2 border-b border-white/10 bg-black/20 px-3 py-2.5">
            <span className="text-xs tabular-nums text-slate-400">
              {segments.length > 0 ? (
                <>
                  <span className="text-slate-100">{activeIndex + 1}</span>
                  <span className="text-slate-600"> / {segments.length}</span>
                </>
              ) : (
                '—'
              )}
            </span>
            <span className="text-[10.5px] tracking-wide text-slate-700">
              F6·F7 이동 · F5 반복 · F11 연속
            </span>
          </div>
          <div className="min-h-0 flex-1">
            {segments.length === 0 ? (
              <TranscriptPaste />
            ) : (
              <SegmentList onSelect={selectFromList} onMerge={mergeSections} onSplit={splitSection} />
            )}
          </div>
        </aside>
      </main>

      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-sky-400/[0.07] backdrop-blur-sm">
          <p className="rounded-xl border border-dashed border-sky-400/70 px-8 py-6 text-sm text-sky-200">
            여기에 놓으면 불러옵니다
          </p>
        </div>
      )}

      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  )
}
