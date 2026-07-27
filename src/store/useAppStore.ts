import { create } from 'zustand'
import { DEFAULT_LOOP_SETTINGS, type LoopSettings, type LoopStatus } from '../core/loop/LoopController'
import { mergeWithNext, splitSegment, transformSegments } from '../core/subtitle/segment'
import { splitSegmentBySentence } from '../core/subtitle/sentenceSplit'
import { pieceForCue, type SyncPiece } from '../core/sync/piecewise'
import { snapSegmentsToSpeech } from '../core/sync/snap'
import { ENVELOPE_FRAME_SEC } from '../core/sync/audioAnalysis'
import type { Cue, Segment } from '../core/subtitle/types'

/**
 * 자막 시간축 보정: `표시시각 = scale · 원본시각 + offsetSec`
 *
 * 단순 이동뿐 아니라 프레임레이트 불일치로 생긴 드리프트까지 한 식으로 다룬다.
 */
export interface SyncTransform {
  scale: number
  offsetSec: number
}

export const IDENTITY_SYNC: SyncTransform = { scale: 1, offsetSec: 0 }

/** 파형 준비 상태. YouTube는 오디오에 접근할 수 없어 'unavailable'로 끝난다 */
export type WaveformState = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface MediaSource {
  kind: 'video' | 'audio' | 'youtube'
  /** object URL 또는 YouTube video id */
  src: string
  name: string
  /** 학습 기록을 이어붙이기 위한 지문 (파일명·크기·수정시각 또는 YouTube id) */
  key: string
}

/** 저장소에서 복원한 학습 상태 */
export interface RestoredSession {
  cues: Cue[]
  segments: Segment[]
  activeIndex: number
  sync: SyncTransform
  currentTime: number
  inputs: Record<string, string>
}

export interface SubtitleInfo {
  name: string
  format: string
  encoding: string
}

/**
 * 받아쓰기 기록의 키.
 *
 * Segment.id는 위치 기반이라 병합/분할 때마다 바뀐다. 첫 큐의 id를 키로 쓰면
 * 세그먼트 경계를 편집해도 이미 입력한 내용이 엉뚱한 문장에 붙지 않는다.
 */
export function segmentKey(segment: Segment): string {
  return segment.cueIds[0] ?? segment.id
}

/**
 * 나누기로 만들어질 조각이 이보다 짧으면 의미가 없다.
 *
 * 문장을 막 고른 직후에는 재생 위치가 문장 첫머리에 붙어 있다. 그 상태로
 * 나누면 0.1초짜리 부스러기가 생기는데, 사용자가 원한 결과일 리 없다.
 */
export const MIN_SPLIT_MARGIN_SEC = 0.5

/**
 * 재생 영역 높이의 기본값과 한계 (화면 높이 대비 %).
 *
 * 아래로는 영상이 형태를 잃지 않을 만큼, 위로는 반복 컨트롤과 받아쓰기 칸이
 * 화면에 남을 만큼만 허용한다. 더 키우고 싶으면 극장 모드(F9)가 있다.
 */
export const DEFAULT_PLAYER_HEIGHT_VH = 34
export const MIN_PLAYER_HEIGHT_VH = 15
export const MAX_PLAYER_HEIGHT_VH = 72

export function clampPlayerHeight(vh: number): number {
  return Math.min(MAX_PLAYER_HEIGHT_VH, Math.max(MIN_PLAYER_HEIGHT_VH, Math.round(vh * 10) / 10))
}

/** 이 지점에서 문장을 갈라도 양쪽이 쓸 만한 길이로 남는가 */
export function canSplitAt(segment: { start: number; end: number }, timeSec: number): boolean {
  return (
    timeSec >= segment.start + MIN_SPLIT_MARGIN_SEC && timeSec <= segment.end - MIN_SPLIT_MARGIN_SEC
  )
}

interface AppState {
  media: MediaSource | null
  subtitle: SubtitleInfo | null
  cues: Cue[]
  segments: Segment[]
  activeIndex: number
  sync: SyncTransform

  /** 다중 선택된 문장 번호들 (오름차순). 연속 재생 대상이 된다 */
  selection: number[]
  /** 파형 그리기와 자동 맞춤이 함께 쓰는 에너지 포락선 */
  waveform: Float32Array | null
  waveformState: WaveformState
  /** 문장별 미세 맞춤 직전 상태 (한 단계 되돌리기용) */
  snapUndo: Segment[] | null

  loopSettings: LoopSettings
  loopStatus: LoopStatus
  currentTime: number

  hideSubtitles: boolean
  /**
   * 영상 위에 현재 문장을 자막처럼 띄운다.
   *
   * `hideSubtitles`가 켜져 있으면 이 값과 무관하게 보이지 않는다 — 숨김은
   * "정답을 보지 않겠다"는 선언이라 화면에만 예외를 둘 수 없다.
   */
  videoSubtitles: boolean
  /**
   * 화면 자막 글자 크기 배수 (1 = 보통).
   *
   * 화면에서 얼마나 떨어져 보는지가 사람마다 달라서 고정 크기로는 맞출 수 없다.
   * 노트북을 코앞에 두는 사람과 TV에 연결해 보는 사람의 요구가 정반대다.
   */
  videoSubtitleScale: number
  /** 재생 영역이 차지하는 화면 높이 비율(%). 영상과 음파창 사이 경계선을 끌어 정한다 */
  playerHeightVh: number
  /** 반복을 다 채우면 자동으로 다음 문장으로 넘어간다 */
  autoAdvance: boolean
  /**
   * 받아쓰기를 채점할지.
   *
   * 끄면 Enter가 곧장 다음 문장으로 넘어가고 점수 표시도 사라진다.
   * 이미 채점한 기록은 지우지 않으므로 다시 켜면 그대로 돌아온다.
   */
  inputs: Record<string, string>

  error: string | null
  notice: string | null

  setMedia: (media: MediaSource) => void
  setSubtitle: (info: SubtitleInfo, cues: Cue[], segments: Segment[]) => void
  restoreSession: (session: RestoredSession) => void
  applyStoredSettings: (settings: {
    loopSettings: LoopSettings
    hideSubtitles: boolean
    videoSubtitles: boolean
    videoSubtitleScale: number
    playerHeightVh: number
    autoAdvance: boolean
  }) => void
  clearAll: () => void

  setActiveIndex: (index: number) => void
  moveActive: (delta: number) => void

  setCurrentTime: (time: number) => void
  setLoopStatus: (status: LoopStatus) => void
  updateLoopSettings: (partial: Partial<LoopSettings>) => void

  toggleHideSubtitles: () => void
  toggleVideoSubtitles: () => void
  setVideoSubtitleScale: (scale: number) => void
  setPlayerHeightVh: (vh: number) => void
  toggleAutoAdvance: () => void
  setInput: (key: string, text: string) => void

  /** 개별 선택 토글 (오른쪽 클릭) */
  toggleSelection: (index: number) => void
  /** 두 지점 사이를 모두 선택 (Shift+클릭, 드래그) */
  selectRange: (from: number, to: number) => void
  clearSelection: () => void

  setWaveform: (envelope: Float32Array | null, state: WaveformState) => void

  /**
   * 자막 문장을 고친다.
   *
   * 자동생성 자막에는 오타가 흔하고, 재생 위치로 나눌 때 글자 수 비율로 가른
   * 텍스트도 어긋난다. 정답을 눈으로 대조하는 도구이므로 정답이 틀려 있으면
   * 곤란하다.
   */
  setSegmentText: (index: number, text: string) => void

  mergeActiveWithNext: () => void
  /** from~to 구간을 문장 하나로 접는다 (양끝 포함) */
  mergeRange: (from: number, to: number) => void
  splitActive: () => void
  splitActiveAt: (timeSec: number) => void
  /** 현재 문장을 문장 단위로 쪼갠다. 문장이 하나뿐이면 아무 일도 하지 않고 false */
  splitActiveBySentence: () => boolean
  /**
   * F4 — 나누기. 세 기준을 차례로 시도하고 어느 것으로 나눴는지 돌려준다.
   *
   * 1. **재생 위치** — 듣다가 "여기서 끊자" 싶은 순간에 누르는 것이 F4의 본래
   *    쓰임이다. 그래서 재생 위치가 쓸 만하면 그것을 가장 먼저 존중한다
   * 2. **문장 단위** — 재생 위치가 가장자리에 붙어 있으면(문장을 막 고른 직후)
   *    구간에 담긴 문장들로 가른다
   * 3. **큐 경계** — 둘 다 안 되면 원래 자막이 나눠 둔 대로 되돌린다
   */
  splitActiveSmart: () => 'playhead' | 'sentence' | 'cue' | 'none'
  /**
   * 문장별 미세 맞춤 — 각 문장을 파형의 소리 경계로 당긴다.
   * 되돌릴 수 있도록 직전 상태를 한 단계 보관한다.
   */
  snapToSpeech: () => { movedCount: number; averageShiftSec: number } | null
  undoSnap: () => boolean
  nudgeOffset: (deltaSec: number) => void
  /** 자동 맞춤 결과처럼 배율까지 포함한 보정을 통째로 적용 */
  applySync: (next: SyncTransform) => void
  /**
   * 구간별 정렬 결과를 문장에 입힌다.
   *
   * 전체 보정 하나로는 표현할 수 없는 어긋남(광고가 빠진 방송본, 감독판)을
   * 담당한다. 되돌릴 수 있도록 직전 상태를 보관한다. 옮긴 문장 수를 돌려준다.
   */
  applySyncPieces: (pieces: readonly SyncPiece[]) => number
  resetSync: () => void

  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
}

const IDLE_STATUS: LoopStatus = {
  targetId: null,
  repeat: 0,
  total: 0,
  running: false,
  inGap: false,
}

export const useAppStore = create<AppState>()((set, get) => ({
  media: null,
  subtitle: null,
  cues: [],
  segments: [],
  activeIndex: -1,
  sync: IDENTITY_SYNC,

  selection: [],
  waveform: null,
  waveformState: 'idle',
  snapUndo: null,

  loopSettings: DEFAULT_LOOP_SETTINGS,
  loopStatus: IDLE_STATUS,
  currentTime: 0,

  hideSubtitles: true,
  videoSubtitles: false,
  videoSubtitleScale: 1,
  playerHeightVh: DEFAULT_PLAYER_HEIGHT_VH,
  autoAdvance: false,
  inputs: {},

  error: null,
  notice: null,

  setMedia: (media) =>
    set((state) => {
      // 이전 object URL을 해제하지 않으면 영상 하나당 수백 MB가 메모리에 남는다
      if (state.media?.kind !== 'youtube' && state.media?.src) {
        URL.revokeObjectURL(state.media.src)
      }
      return { media, error: null, currentTime: 0, waveform: null, waveformState: 'idle' }
    }),

  setSubtitle: (subtitle, cues, segments) =>
    set({
      subtitle,
      cues,
      segments,
      activeIndex: segments.length > 0 ? 0 : -1,
      sync: IDENTITY_SYNC,
      selection: [],
          inputs: {},
      error: null,
    }),

  restoreSession: (session) =>
    set({
      cues: session.cues,
      segments: session.segments,
      activeIndex: session.activeIndex,
      sync: session.sync,
      currentTime: session.currentTime,
      inputs: session.inputs,
    }),

  applyStoredSettings: ({
    loopSettings,
    hideSubtitles,
    videoSubtitles,
    videoSubtitleScale,
    playerHeightVh,
    autoAdvance,
  }) =>
    set({
      loopSettings,
      hideSubtitles,
      videoSubtitles,
      videoSubtitleScale,
      playerHeightVh: clampPlayerHeight(playerHeightVh),
      autoAdvance,
    }),

  clearAll: () =>
    set((state) => {
      if (state.media?.kind !== 'youtube' && state.media?.src) {
        URL.revokeObjectURL(state.media.src)
      }
      return {
        media: null,
        subtitle: null,
        cues: [],
        segments: [],
        activeIndex: -1,
        sync: IDENTITY_SYNC,
        selection: [],
              waveform: null,
        waveformState: 'idle' as const,
        snapUndo: null,
        inputs: {},
        loopStatus: IDLE_STATUS,
        currentTime: 0,
        error: null,
        notice: null,
      }
    }),

  setActiveIndex: (index) => {
    const { segments } = get()
    if (index < 0 || index >= segments.length) return
    set({ activeIndex: index })
  },

  moveActive: (delta) => {
    const { activeIndex, segments } = get()
    if (segments.length === 0) return
    const next = Math.min(Math.max(activeIndex + delta, 0), segments.length - 1)
    set({ activeIndex: next })
  },

  setCurrentTime: (currentTime) => set({ currentTime }),
  setLoopStatus: (loopStatus) => set({ loopStatus }),

  updateLoopSettings: (partial) =>
    set((state) => ({ loopSettings: { ...state.loopSettings, ...partial } })),

  toggleHideSubtitles: () => set((state) => ({ hideSubtitles: !state.hideSubtitles })),

  toggleVideoSubtitles: () => set((state) => ({ videoSubtitles: !state.videoSubtitles })),

  setVideoSubtitleScale: (videoSubtitleScale) => set({ videoSubtitleScale }),

  setPlayerHeightVh: (vh) => set({ playerHeightVh: clampPlayerHeight(vh) }),

  toggleAutoAdvance: () => set((state) => ({ autoAdvance: !state.autoAdvance })),

  setInput: (key, text) => set((state) => ({ inputs: { ...state.inputs, [key]: text } })),

  mergeActiveWithNext: () => {
    const { segments, activeIndex } = get()
    if (activeIndex < 0 || activeIndex >= segments.length - 1) return
    set({ segments: mergeWithNext(segments, activeIndex), selection: [] })
  },

  setSegmentText: (index, text) => {
    const { segments } = get()
    const target = segments[index]

    // 문장 하나가 한 줄이라는 규칙을 지킨다 — 줄바꿈은 공백으로 접는다
    const trimmed = text.replace(/\s*\n\s*/g, ' ').trim()
    if (!target || trimmed === target.text) return

    const next = [...segments]
    next[index] = { ...target, text: trimmed }
    set({ segments: next })
  },

  mergeRange: (from, to) => {
    const { segments } = get()
    if (from < 0 || to >= segments.length || to <= from) return

    // 한 번 합칠 때마다 뒤 문장이 앞으로 당겨지므로, 늘 같은 자리에서 반복하면 된다
    let merged = segments
    for (let i = from; i < to; i++) merged = mergeWithNext(merged, from)

    set({ segments: merged, activeIndex: from, selection: [] })
  },

  toggleSelection: (index) =>
    set((state) => ({
      selection: state.selection.includes(index)
        ? state.selection.filter((i) => i !== index)
        : [...state.selection, index].sort((a, b) => a - b),
    })),

  selectRange: (from, to) => {
    const low = Math.min(from, to)
    const high = Math.max(from, to)
    set({ selection: Array.from({ length: high - low + 1 }, (_, i) => low + i) })
  },

  clearSelection: () => set({ selection: [] }),

  setWaveform: (waveform, waveformState) => set({ waveform, waveformState }),

  /** 음파창에서 찍은 지점을 경계로 현재 문장을 둘로 가른다 */
  splitActiveAt: (timeSec) => {
    const { segments, activeIndex } = get()
    const target = segments[activeIndex]
    // 가장자리에 너무 붙으면 길이 0에 가까운 조각이 생겨 쓸모가 없다
    if (!target || !canSplitAt(target, timeSec)) return

    // 텍스트를 어디서 끊을지는 알 수 없으니 시간 비율에 맞춰 단어 경계로 가른다.
    // 완벽하진 않지만 양쪽에 전체 문장을 복제해 두는 것보다 훨씬 쓸모 있다.
    const words = target.text.split(/\s+/).filter(Boolean)
    const ratio = (timeSec - target.start) / (target.end - target.start)
    const cut = Math.max(1, Math.min(Math.max(1, words.length - 1), Math.round(ratio * words.length)))

    // 두 조각은 서로 다른 받아쓰기 기록을 가져야 한다
    const base = segmentKey(target)
    const left: Segment = {
      ...target,
      end: timeSec,
      text: words.slice(0, cut).join(' '),
      cueIds: [base],
    }
    const right: Segment = {
      ...target,
      start: timeSec,
      text: words.slice(cut).join(' '),
      cueIds: [`${base}#${timeSec.toFixed(2)}`],
    }

    const next = [...segments.slice(0, activeIndex), left, right, ...segments.slice(activeIndex + 1)]
    set({ segments: next.map((s, i) => ({ ...s, id: `seg-${i}` })), selection: [] })
  },

  splitActiveBySentence: () => {
    const { segments, activeIndex, cues, sync, waveform } = get()
    const target = segments[activeIndex]
    if (!target) return false

    // 이 구간에 걸친 원래 큐 경계들 — 자막이 준 값이라 가장 믿을 만하다
    const cueBoundaries = cues
      .map((cue) => cue.end * sync.scale + sync.offsetSec)
      .filter((time) => time > target.start && time < target.end)

    const pieces = splitSegmentBySentence(target, {
      cueBoundaries,
      envelope: waveform,
      envelopeFrameSec: ENVELOPE_FRAME_SEC,
    })
    if (!pieces) return false

    const next = [...segments.slice(0, activeIndex), ...pieces, ...segments.slice(activeIndex + 1)]
    set({ segments: next.map((s, i) => ({ ...s, id: `seg-${i}` })), selection: [] })
    return true
  },

  splitActiveSmart: () => {
    const state = get()
    const segment = state.segments[state.activeIndex]
    if (!segment) return 'none'

    if (canSplitAt(segment, state.currentTime)) {
      state.splitActiveAt(state.currentTime)
      return 'playhead'
    }

    if (state.splitActiveBySentence()) return 'sentence'

    const before = state.segments.length
    state.splitActive()
    return get().segments.length > before ? 'cue' : 'none'
  },

  splitActive: () => {
    const { segments, activeIndex, cues, sync } = get()
    if (activeIndex < 0) return

    // cues는 원본 시각이므로 현재 보정을 다시 입혀야 분할 위치가 맞는다
    const adjusted =
      sync.scale === 1 && sync.offsetSec === 0
        ? cues
        : cues.map((c) => ({
            ...c,
            start: Math.max(0, c.start * sync.scale + sync.offsetSec),
            end: Math.max(0, c.end * sync.scale + sync.offsetSec),
          }))

    set({ segments: splitSegment(segments, activeIndex, adjusted) })
  },

  snapToSpeech: () => {
    const { segments, waveform } = get()
    if (segments.length === 0 || !waveform) return null

    const result = snapSegmentsToSpeech(segments, waveform, { frameSec: ENVELOPE_FRAME_SEC })
    if (result.movedCount === 0) return result

    set({ segments: result.segments, snapUndo: segments })
    return result
  },

  undoSnap: () => {
    const { snapUndo } = get()
    if (!snapUndo) return false

    set({ segments: snapUndo, snapUndo: null })
    return true
  },

  nudgeOffset: (deltaSec) =>
    set((state) => ({
      segments: transformSegments(state.segments, 1, deltaSec),
      sync: {
        scale: state.sync.scale,
        offsetSec: Number((state.sync.offsetSec + deltaSec).toFixed(3)),
      },
    })),

  /**
   * 현재 보정 위에 목표 보정을 덧씌운다.
   *
   * segments는 이미 현재 보정이 적용된 시각을 담고 있으므로, 원본으로 되돌렸다
   * 다시 입히는 대신 두 변환의 차이만 계산해 한 번에 적용한다.
   *   현재: u = s·t + o    목표: u' = s'·t + o'
   *   ⇒ u' = (s'/s)·u + (o' − (s'/s)·o)
   */
  applySync: (next) =>
    set((state) => {
      const { scale, offsetSec } = state.sync
      const ratio = next.scale / scale
      const shift = next.offsetSec - ratio * offsetSec

      return {
        segments: transformSegments(state.segments, ratio, shift),
        sync: { scale: next.scale, offsetSec: Number(next.offsetSec.toFixed(3)) },
      }
    }),

  applySyncPieces: (pieces) => {
    const { segments, cues } = get()
    if (pieces.length === 0 || segments.length === 0) return 0

    // 조각은 자막 번호로 갈라져 있다 (시각으로 가르면 겹치는 구간에서 어긋난다)
    const cueIndex = new Map(cues.map((cue, index) => [cue.id, index]))

    let moved = 0
    let lastIndex = 0
    const next = segments.map((segment) => {
      // 나누기로 만든 조각은 원본 큐 id가 없다 — 앞 문장이 속한 자리를 따른다
      const index = cueIndex.get(segment.cueIds[0]) ?? lastIndex
      lastIndex = index

      const offset = pieceForCue(pieces, index)?.offsetSec ?? 0
      // 20ms 아래는 들어서 알 수 없다. 괜히 건드려 기록만 흔들 이유가 없다
      if (Math.abs(offset) < 0.02) return segment

      moved++
      return {
        ...segment,
        start: Math.max(0, segment.start + offset),
        end: Math.max(0, segment.end + offset),
      }
    })

    if (moved === 0) return 0

    set({ segments: next, snapUndo: segments })
    return moved
  },

  resetSync: () => get().applySync(IDENTITY_SYNC),

  setError: (error) => set({ error }),
  setNotice: (notice) => set({ notice }),
}))
