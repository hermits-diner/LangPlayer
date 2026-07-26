import { create } from 'zustand'
import type { DictationResult } from '../core/dictation/score'
import { scoreDictation } from '../core/dictation/score'
import { DEFAULT_LOOP_SETTINGS, type LoopSettings, type LoopStatus } from '../core/loop/LoopController'
import { mergeWithNext, splitSegment, transformSegments } from '../core/subtitle/segment'
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
  results: Record<string, DictationResult>
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
  /** 임시로 한 덩어리처럼 다룰 구간 — Ctrl+G. Enter로 풀린다 */
  tempGroup: { from: number; to: number } | null
  /** 파형 그리기와 자동 맞춤이 함께 쓰는 에너지 포락선 */
  waveform: Float32Array | null
  waveformState: WaveformState

  loopSettings: LoopSettings
  loopStatus: LoopStatus
  currentTime: number

  hideSubtitles: boolean
  /** 반복을 다 채우면 자동으로 다음 문장으로 넘어간다 */
  autoAdvance: boolean
  inputs: Record<string, string>
  results: Record<string, DictationResult>

  error: string | null
  notice: string | null

  setMedia: (media: MediaSource) => void
  setSubtitle: (info: SubtitleInfo, cues: Cue[], segments: Segment[]) => void
  restoreSession: (session: RestoredSession) => void
  applyStoredSettings: (settings: {
    loopSettings: LoopSettings
    hideSubtitles: boolean
    autoAdvance: boolean
  }) => void
  clearAll: () => void

  setActiveIndex: (index: number) => void
  moveActive: (delta: number) => void

  setCurrentTime: (time: number) => void
  setLoopStatus: (status: LoopStatus) => void
  updateLoopSettings: (partial: Partial<LoopSettings>) => void

  toggleHideSubtitles: () => void
  toggleAutoAdvance: () => void
  setInput: (key: string, text: string) => void
  gradeActive: () => void
  clearActiveResult: () => void

  /** 개별 선택 토글 (오른쪽 클릭) */
  toggleSelection: (index: number) => void
  /** 두 지점 사이를 모두 선택 (Shift+클릭, 드래그) */
  selectRange: (from: number, to: number) => void
  clearSelection: () => void
  setTempGroup: (group: { from: number; to: number } | null) => void

  setWaveform: (envelope: Float32Array | null, state: WaveformState) => void

  mergeActiveWithNext: () => void
  splitActive: () => void
  splitActiveAt: (timeSec: number) => void
  nudgeOffset: (deltaSec: number) => void
  /** 자동 맞춤 결과처럼 배율까지 포함한 보정을 통째로 적용 */
  applySync: (next: SyncTransform) => void
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
  tempGroup: null,
  waveform: null,
  waveformState: 'idle',

  loopSettings: DEFAULT_LOOP_SETTINGS,
  loopStatus: IDLE_STATUS,
  currentTime: 0,

  hideSubtitles: true,
  autoAdvance: false,
  inputs: {},
  results: {},

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
      tempGroup: null,
      inputs: {},
      results: {},
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
      results: session.results,
    }),

  applyStoredSettings: ({ loopSettings, hideSubtitles, autoAdvance }) =>
    set({ loopSettings, hideSubtitles, autoAdvance }),

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
        tempGroup: null,
        waveform: null,
        waveformState: 'idle' as const,
        inputs: {},
        results: {},
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

  toggleAutoAdvance: () => set((state) => ({ autoAdvance: !state.autoAdvance })),

  setInput: (key, text) => set((state) => ({ inputs: { ...state.inputs, [key]: text } })),

  gradeActive: () => {
    const { segments, activeIndex, inputs } = get()
    const segment = segments[activeIndex]
    if (!segment) return

    const key = segmentKey(segment)
    const result = scoreDictation(segment.text, inputs[key] ?? '')
    set((state) => ({ results: { ...state.results, [key]: result } }))
  },

  clearActiveResult: () => {
    const { segments, activeIndex } = get()
    const segment = segments[activeIndex]
    if (!segment) return

    const key = segmentKey(segment)
    set((state) => {
      const { [key]: _removed, ...rest } = state.results
      return { results: rest }
    })
  },

  mergeActiveWithNext: () => {
    const { segments, activeIndex } = get()
    if (activeIndex < 0 || activeIndex >= segments.length - 1) return
    set({ segments: mergeWithNext(segments, activeIndex), selection: [] })
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

  clearSelection: () => set({ selection: [], tempGroup: null }),

  setTempGroup: (tempGroup) => set({ tempGroup }),

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

  resetSync: () => get().applySync(IDENTITY_SYNC),

  setError: (error) => set({ error }),
  setNotice: (notice) => set({ notice }),
}))
