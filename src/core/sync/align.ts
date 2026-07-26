import { findBestLag, type CorrelationPeak } from './correlate'
import { FRAME_SEC, subtitleSignal } from './vad'

/**
 * 자막 정렬.
 *
 * 어긋남에는 두 종류가 있다.
 *
 * - **상수 오프셋**: 다른 릴리즈(인트로 유무)에서 만든 자막. 처음부터 끝까지 일정하게 밀린다.
 * - **선형 드리프트**: 프레임레이트 불일치(23.976 ↔ 25fps). 초반은 맞다가 갈수록 벌어져
 *   2시간이면 5분 이상 어긋난다. 초반만 맞추고 끝에서 좌절하는 흔한 경우다.
 *
 * 드리프트는 임의의 값이 아니라 **표준 프레임레이트 사이의 비율**로만 생긴다.
 * 그래서 기울기를 연속적으로 추정하는 대신 후보 배율을 하나씩 대입해 본다.
 * 훨씬 안정적이고, 정답이 곧 실제 원인(24fps 자막을 25fps 영상에 씀)과 일치한다.
 */

/** 실제로 유통되는 프레임레이트 조합에서 나오는 배율들 */
export const CANDIDATE_SCALES: readonly number[] = [
  1,
  1.001, // 24 → 23.976 (NTSC 풀다운)
  1 / 1.001,
  25 / 24,
  24 / 25,
  25 / 23.976,
  23.976 / 25,
  30 / 25,
  25 / 30,
]

export interface SyncOptions {
  frameSec: number
  /** 탐색할 최대 오프셋 */
  maxOffsetSec: number
  /** 배율 탐색에 쓸 성긴 프레임 간격 — 드리프트는 수십 초라 거칠어도 충분하다 */
  coarseFrameSec: number
  /** 배율을 바꿔서 이만큼 나아지지 않으면 드리프트가 아니라고 본다 */
  scaleGainThreshold: number
}

export const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  frameSec: FRAME_SEC,
  maxOffsetSec: 120,
  coarseFrameSec: 0.1,
  scaleGainThreshold: 1.08,
}

export interface SyncResult {
  /** 시간 배율. 1이면 드리프트 없음 */
  scale: number
  offsetSec: number
  /** 0~1. 낮으면 사용자에게 실패를 알려야 한다 */
  confidence: number
  driftDetected: boolean
}

/** 봉우리 고립도를 0~1 신뢰도로 환산 */
export function sharpnessToConfidence(sharpness: number): number {
  return Math.min(1, Math.max(0, (sharpness - 1.1) / 0.6))
}

/** 프레임 신호를 factor배 성기게 만든다 (구간 내 최대값 유지) */
export function decimate(signal: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return signal

  const out = new Float32Array(Math.floor(signal.length / factor))
  for (let i = 0; i < out.length; i++) {
    let peak = 0
    for (let j = i * factor; j < (i + 1) * factor; j++) {
      if (signal[j] > peak) peak = signal[j]
    }
    out[i] = peak
  }

  return out
}

function scaleCues(
  cues: readonly { start: number; end: number }[],
  scale: number,
): { start: number; end: number }[] {
  return cues.map((cue) => ({ start: cue.start * scale, end: cue.end * scale }))
}

export function alignSubtitles(
  speech: Float32Array,
  cues: readonly { start: number; end: number }[],
  options: Partial<SyncOptions> = {},
): SyncResult {
  const opts = { ...DEFAULT_SYNC_OPTIONS, ...options }

  if (speech.length === 0 || cues.length === 0) {
    return { scale: 1, offsetSec: 0, confidence: 0, driftDetected: false }
  }

  const bestScale = searchScale(speech, cues, opts)

  // 배율을 정했으니 원래 해상도로 오프셋을 정밀하게 잡는다
  const fineCues = scaleCues(cues, bestScale)
  const fineSubs = subtitleSignal(fineCues, speech.length, opts.frameSec)
  const fine = findBestLag(
    speech,
    fineSubs,
    Math.round(opts.maxOffsetSec / opts.frameSec),
    Math.round(1 / opts.frameSec),
  )

  return {
    scale: bestScale,
    offsetSec: fine.lag * opts.frameSec,
    confidence: sharpnessToConfidence(fine.sharpness),
    driftDetected: bestScale !== 1,
  }
}

/**
 * 후보 배율을 성긴 해상도에서 하나씩 대입해 가장 잘 맞는 것을 고른다.
 *
 * 배율 1(드리프트 없음)에 유리하게 편향을 준다. 긴 영상에서는 살짝 어긋난
 * 배율도 우연히 점수가 조금 높게 나올 수 있는데, 근거 없이 시간축을 늘였다
 * 줄이면 오히려 더 나빠지기 때문이다.
 */
function searchScale(
  speech: Float32Array,
  cues: readonly { start: number; end: number }[],
  opts: SyncOptions,
): number {
  const factor = Math.max(1, Math.round(opts.coarseFrameSec / opts.frameSec))
  const coarse = decimate(speech, factor)
  const coarseFrameSec = opts.frameSec * factor

  const maxLag = Math.round(opts.maxOffsetSec / coarseFrameSec)
  const exclusion = Math.round(1 / coarseFrameSec)

  const evaluate = (scale: number) =>
    findBestLag(coarse, subtitleSignal(scaleCues(cues, scale), coarse.length, coarseFrameSec), maxLag, exclusion)
      .score

  const baseline = evaluate(1)
  let bestScale = 1
  let bestScore = baseline

  for (const scale of CANDIDATE_SCALES) {
    if (scale === 1) continue

    const score = evaluate(scale)
    // 드리프트를 인정하려면 기준선보다 뚜렷하게 나아야 한다
    if (score > bestScore && score > baseline * opts.scaleGainThreshold) {
      bestScore = score
      bestScale = scale
    }
  }

  return bestScale
}

export type { CorrelationPeak }
