import { create } from 'zustand'
import type { DictationResult } from '../core/dictation/score'
import { scoreDictation } from '../core/dictation/score'
import { DEFAULT_LOOP_SETTINGS, type LoopSettings, type LoopStatus } from '../core/loop/LoopController'
import { mergeWithNext, shiftSegments, splitSegment } from '../core/subtitle/segment'
import type { Cue, Segment } from '../core/subtitle/types'

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
  offsetSec: number
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

interface AppState {
  media: MediaSource | null
  subtitle: SubtitleInfo | null
  cues: Cue[]
  segments: Segment[]
  activeIndex: number
  offsetSec: number

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

  mergeActiveWithNext: () => void
  splitActive: () => void
  nudgeOffset: (deltaSec: number) => void

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
  offsetSec: 0,

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
      return { media, error: null, currentTime: 0 }
    }),

  setSubtitle: (subtitle, cues, segments) =>
    set({
      subtitle,
      cues,
      segments,
      activeIndex: segments.length > 0 ? 0 : -1,
      offsetSec: 0,
      inputs: {},
      results: {},
      error: null,
    }),

  restoreSession: (session) =>
    set({
      cues: session.cues,
      segments: session.segments,
      activeIndex: session.activeIndex,
      offsetSec: session.offsetSec,
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
        offsetSec: 0,
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
    set({ segments: mergeWithNext(segments, activeIndex) })
  },

  splitActive: () => {
    const { segments, activeIndex, cues, offsetSec } = get()
    if (activeIndex < 0) return

    // cues는 원본 시각이므로 현재 적용된 오프셋을 다시 입혀야 위치가 맞는다
    const shiftedCues =
      offsetSec === 0
        ? cues
        : cues.map((c) => ({ ...c, start: Math.max(0, c.start + offsetSec), end: Math.max(0, c.end + offsetSec) }))

    set({ segments: splitSegment(segments, activeIndex, shiftedCues) })
  },

  nudgeOffset: (deltaSec) =>
    set((state) => ({
      segments: shiftSegments(state.segments, deltaSec),
      offsetSec: Number((state.offsetSec + deltaSec).toFixed(3)),
    })),

  setError: (error) => set({ error }),
  setNotice: (notice) => set({ notice }),
}))
