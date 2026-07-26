import type { Segment } from '../subtitle/types'
import { detectSpeech } from './vad'

/**
 * 문장별 미세 맞춤.
 *
 * 자동 맞춤은 자막 **전체**에 변환 하나를 걸어 평균적으로 가장 잘 맞는 자리를
 * 찾는다. 그런데 자막 제작 품질이 고르지 않으면 문장마다 조금씩 이르거나
 * 늦는다 — 전체를 아무리 잘 밀어도 각 문장은 여전히 어긋난 채로 남는다.
 *
 * 파형에는 소리가 **시작하고 끝나는 지점**이 이미 다 들어 있다. 각 문장의
 * 시작을 가장 가까운 소리 시작점으로, 끝을 가장 가까운 소리 끝점으로 당기면
 * 전체 변환으로는 닿지 않는 자리까지 맞출 수 있다.
 */

export interface SnapOptions {
  frameSec: number
  /** 경계를 옮길 수 있는 최대 거리. 이보다 멀면 다른 문장의 소리일 가능성이 크다 */
  windowSec: number
  /** 이보다 짧은 소리·침묵 조각은 잡음으로 보고 무시한다 */
  minRunSec: number
  /** 맞춘 뒤 문장이 이보다 짧아지면 건드리지 않는다 */
  minDurationSec: number
}

export const DEFAULT_SNAP_OPTIONS: SnapOptions = {
  frameSec: 0.01,
  windowSec: 0.6,
  minRunSec: 0.08,
  minDurationSec: 0.3,
}

export interface SpeechEdges {
  /** 소리가 시작되는 시각들 (오름차순) */
  onsets: number[]
  /** 소리가 끝나는 시각들 (오름차순) */
  offsets: number[]
}

/**
 * 말함/침묵 이진 신호에서 오르내리는 지점을 뽑는다.
 *
 * 짧은 조각을 걸러내는 것이 중요하다. 성대 진동 사이의 순간적인 골까지 경계로
 * 세면 한 문장 안에 수십 개의 가짜 시작점이 생겨 엉뚱한 곳으로 당겨진다.
 */
export function findSpeechEdges(
  speech: Float32Array,
  frameSec = DEFAULT_SNAP_OPTIONS.frameSec,
  minRunSec = DEFAULT_SNAP_OPTIONS.minRunSec,
): SpeechEdges {
  const minRun = Math.max(1, Math.round(minRunSec / frameSec))
  const onsets: number[] = []
  const offsets: number[] = []

  let runStart = 0
  let runValue = speech[0] ?? 0

  const closeRun = (end: number) => {
    if (end - runStart < minRun) return // 너무 짧은 구간은 없던 일로
    if (runValue > 0) {
      onsets.push(runStart * frameSec)
      offsets.push(end * frameSec)
    }
  }

  for (let i = 1; i <= speech.length; i++) {
    const value = i < speech.length ? speech[i] : -1 // 끝에서 강제로 닫는다
    if (value === runValue) continue

    closeRun(i)
    runStart = i
    runValue = value
  }

  return { onsets, offsets }
}

/** 정렬된 배열에서 target에 가장 가까운 값. window 밖이면 null */
export function nearestWithin(sorted: readonly number[], target: number, windowSec: number): number | null {
  if (sorted.length === 0) return null

  let low = 0
  let high = sorted.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (sorted[mid] < target) low = mid + 1
    else high = mid
  }

  // 이분 탐색이 멈춘 자리와 그 앞 항목 중 가까운 쪽
  let best = sorted[low]
  if (low > 0 && Math.abs(sorted[low - 1] - target) < Math.abs(best - target)) best = sorted[low - 1]

  return Math.abs(best - target) <= windowSec ? best : null
}

export interface SnapResult {
  segments: Segment[]
  /** 실제로 자리가 바뀐 문장 수 */
  movedCount: number
  /** 옮긴 거리의 평균 (초) */
  averageShiftSec: number
}

/**
 * 각 문장의 시작·끝을 가까운 소리 경계로 당긴다.
 *
 * 앞뒤 순서가 뒤집히거나 겹치지 않도록 앞에서부터 차례로 처리하며,
 * 마땅한 경계를 못 찾은 문장은 손대지 않는다.
 */
export function snapSegmentsToSpeech(
  segments: readonly Segment[],
  envelope: Float32Array,
  options: Partial<SnapOptions> = {},
): SnapResult {
  const opts = { ...DEFAULT_SNAP_OPTIONS, ...options }

  if (segments.length === 0 || envelope.length === 0) {
    return { segments: [...segments], movedCount: 0, averageShiftSec: 0 }
  }

  const { onsets, offsets } = findSpeechEdges(detectSpeech(envelope), opts.frameSec, opts.minRunSec)
  if (onsets.length === 0) {
    return { segments: [...segments], movedCount: 0, averageShiftSec: 0 }
  }

  const snapped: Segment[] = []
  let moved = 0
  let totalShift = 0

  segments.forEach((segment, index) => {
    const onset = nearestWithin(onsets, segment.start, opts.windowSec)
    const offset = nearestWithin(offsets, segment.end, opts.windowSec)

    let start = onset ?? segment.start
    let end = offset ?? segment.end

    // 앞 문장 뒤로만 갈 수 있다
    const previousEnd = snapped[index - 1]?.end
    if (previousEnd !== undefined && start < previousEnd) start = previousEnd

    // 다음 문장 시작을 넘지 않는다 (다음은 아직 안 옮겼으므로 원래 값 기준)
    const nextStart = segments[index + 1]?.start
    if (nextStart !== undefined && end > nextStart) end = Math.max(start, nextStart)

    // 뭉개졌으면 원래대로 둔다
    if (end - start < opts.minDurationSec) {
      snapped.push(segment)
      return
    }

    const shift = Math.abs(start - segment.start) + Math.abs(end - segment.end)
    if (shift > opts.frameSec) {
      moved++
      totalShift += Math.abs(start - segment.start)
    }

    snapped.push({ ...segment, start, end })
  })

  return {
    segments: snapped,
    movedCount: moved,
    averageShiftSec: moved === 0 ? 0 : totalShift / moved,
  }
}
