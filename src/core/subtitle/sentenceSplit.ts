import { endsSentence } from './segment'
import type { Segment } from './types'

/**
 * 문장 단위 쪼개기.
 *
 * 합치기의 역연산이다. 합치기가 흩어진 큐를 한 문장으로 모았다면, 쪼개기는
 * 여러 문장이 든 구간을 문장별로 되돌린다.
 *
 * 어려운 쪽은 텍스트가 아니라 **시각**이다. 자막에는 문장이 어디서 끝나는지
 * 시간 정보가 없다. 그래서 글자 수 비율로 자리를 어림한 뒤, 그 근처에서 더
 * 믿을 만한 단서로 당겨 붙인다.
 *
 *   1. **원래 큐 경계** — 자막 파일이 준 값이라 사실상 정답이다
 *   2. **파형에서 가장 조용한 지점** — 문장 사이에는 숨이 있다
 *   3. 둘 다 없으면 어림값 그대로
 */

export interface SentenceSplitOptions {
  /** 이 구간에 걸친 원래 큐 경계 시각들 (표시 시각 기준) */
  cueBoundaries: readonly number[]
  /** 에너지 포락선 — 조용한 지점을 찾는 데 쓴다 */
  envelope: Float32Array | null
  envelopeFrameSec: number
  /** 큐 경계가 이 거리 안에 있으면 그쪽을 쓴다 */
  cueSnapSec: number
  /** 조용한 지점을 찾을 때 어림값 좌우로 살펴볼 범위 */
  quietWindowSec: number
  /** 쪼갠 조각이 이보다 짧아지면 쪼개지 않는다 */
  minPieceSec: number
}

export const DEFAULT_SENTENCE_SPLIT_OPTIONS: SentenceSplitOptions = {
  cueBoundaries: [],
  envelope: null,
  envelopeFrameSec: 0.01,
  cueSnapSec: 0.6,
  quietWindowSec: 0.8,
  minPieceSec: 0.4,
}

/** 텍스트를 문장으로 나눈다. 종결 부호가 없는 꼬리는 앞 문장에 붙인다 */
export function splitSentences(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const sentences: string[] = []
  let current: string[] = []

  for (let i = 0; i < words.length; i++) {
    current.push(words[i])
    if (!endsSentence(words[i])) continue

    // 다음 단어가 소문자로 시작하면 문장이 끝나지 않은 것이다.
    // 대사 뒤에 붙는 인용구가 대표적이다 — `"Go away!" she said.`
    if (/^[a-z]/.test(words[i + 1] ?? '')) continue

    sentences.push(current.join(' '))
    current = []
  }

  // 종결 부호 없이 끝난 꼬리는 독립된 문장으로 보기 어렵다
  if (current.length > 0) {
    if (sentences.length > 0) sentences[sentences.length - 1] += ` ${current.join(' ')}`
    else sentences.push(current.join(' '))
  }

  return sentences
}

/**
 * 포락선에서 가장 조용한 지점을 찾는다.
 *
 * 한 프레임만 보면 성대 진동 사이의 순간적인 골에 걸린다. 짧은 구간의 평균
 * 에너지가 가장 낮은 자리를 골라야 진짜 쉼을 짚는다.
 */
export function findQuietestTime(
  envelope: Float32Array,
  frameSec: number,
  centerSec: number,
  windowSec: number,
): number {
  const span = Math.max(1, Math.round(windowSec / frameSec))
  const center = Math.round(centerSec / frameSec)
  const from = Math.max(0, center - span)
  const to = Math.min(envelope.length - 1, center + span)
  if (to <= from) return centerSec

  // 50ms 평균 — 순간적인 골 대신 실제 쉼을 잡는다
  const smooth = Math.max(1, Math.round(0.05 / frameSec))

  let bestFrame = center
  let bestEnergy = Infinity

  for (let f = from; f <= to; f++) {
    let sum = 0
    let counted = 0
    for (let i = f - smooth; i <= f + smooth; i++) {
      if (i < 0 || i >= envelope.length) continue
      sum += envelope[i]
      counted++
    }

    const energy = counted === 0 ? Infinity : sum / counted
    // 같은 값이면 어림값에 가까운 쪽을 남긴다
    if (energy < bestEnergy - 1e-9) {
      bestEnergy = energy
      bestFrame = f
    }
  }

  return bestFrame * frameSec
}

/** 어림한 경계를 더 믿을 만한 단서로 당긴다 */
function refineBoundary(estimate: number, cueSnapSec: number, options: SentenceSplitOptions): number {
  // 1순위: 자막이 알려준 큐 경계
  let nearestCue: number | null = null
  let nearestDistance = Infinity

  for (const boundary of options.cueBoundaries) {
    const distance = Math.abs(boundary - estimate)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestCue = boundary
    }
  }

  if (nearestCue !== null && nearestDistance <= cueSnapSec) return nearestCue

  // 2순위: 파형에서 가장 조용한 지점
  if (options.envelope && options.envelope.length > 0) {
    return findQuietestTime(options.envelope, options.envelopeFrameSec, estimate, options.quietWindowSec)
  }

  return estimate
}

/**
 * 세그먼트를 문장별로 쪼갠다. 문장이 하나뿐이면 null.
 *
 * 각 조각은 고유한 기록 키를 갖는다. 그러지 않으면 받아쓴 답이 엉뚱한 문장에
 * 붙는다.
 */
export function splitSegmentBySentence(
  segment: Segment,
  options: Partial<SentenceSplitOptions> = {},
): Segment[] | null {
  const opts = { ...DEFAULT_SENTENCE_SPLIT_OPTIONS, ...options }

  const sentences = splitSentences(segment.text)
  if (sentences.length < 2) return null

  const duration = segment.end - segment.start
  if (duration < opts.minPieceSec * sentences.length) return null

  // 글자 수 비율로 경계를 어림한다 — 말하는 시간은 대체로 글자 수를 따라간다
  const lengths = sentences.map((sentence) => sentence.replace(/\s/g, '').length || 1)
  const totalLength = lengths.reduce((sum, length) => sum + length, 0)

  // 글자 수로 어림한 값의 오차는 구간이 길수록 커진다. 큐 경계는 자막이 준
  // 사실이므로, 어림이 흐릿한 만큼 더 멀리까지 찾아가 붙잡는 게 맞다.
  const cueSnapSec = Math.max(opts.cueSnapSec, duration * 0.15)

  const boundaries: number[] = []
  let consumed = 0

  for (let i = 0; i < sentences.length - 1; i++) {
    consumed += lengths[i]
    const estimate = segment.start + duration * (consumed / totalLength)
    boundaries.push(refineBoundary(estimate, cueSnapSec, opts))
  }

  // 당기는 과정에서 순서가 뒤집히거나 조각이 뭉개질 수 있으니 바로잡는다
  const times = [segment.start, ...boundaries, segment.end]
  for (let i = 1; i < times.length - 1; i++) {
    const low = times[i - 1] + opts.minPieceSec
    const high = times[i + 1] - opts.minPieceSec * (times.length - 1 - i)
    if (low > high) return null
    times[i] = Math.min(Math.max(times[i], low), high)
  }

  const base = segment.cueIds[0] ?? segment.id

  return sentences.map((text, index) => ({
    id: `${segment.id}-s${index}`,
    start: times[index],
    end: times[index + 1],
    text,
    // 첫 조각은 원래 기록을 이어받고, 나머지는 새 키를 받는다
    cueIds: index === 0 ? [base] : [`${base}#s${index}`],
  }))
}
