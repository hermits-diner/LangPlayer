import { sharpnessToConfidence } from './align'
import { findBestLag } from './correlate'
import { FRAME_SEC, subtitleSignal } from './vad'

/**
 * 구간별 정렬 — 자막을 몇 조각으로 나눠 각각 따로 밀어 맞춘다.
 *
 * 전체 정렬(`align.ts`)은 자막 전체에 `배율 · 시각 + 이동` 하나를 건다. 이건
 * 어긋남이 **처음부터 끝까지 한 가지 규칙**을 따를 때만 맞는다. 실제로 가장 흔한
 * 어긋남은 그렇지 않다.
 *
 *   - 광고가 빠진 방송본 vs 붙어 있는 자막
 *   - 감독판·확장판에서 중간에 장면이 더 들어간 경우
 *   - 인트로·리캡 유무가 다른 릴리즈
 *
 * 이런 파일은 **어느 지점을 경계로 이동값이 계단처럼 바뀐다.** 전체 이동은
 * 평균 자리에 걸쳐 앞뒤 모두 어긋나고, 문장별 맞춤은 탐색 범위(±0.6초)를 넘는
 * 어긋남에 손이 닿지 않는다. 자막 싱크 도구 중 실사용에서 가장 잘 맞는다고
 * 평가받는 alass가 푸는 문제가 정확히 이것이고, 그 핵심 착상이 **"쪼개되,
 * 쪼갤 때마다 벌점을 물린다"** 이다. 여기서도 같은 생각을 따른다.
 *
 * 1. 자막을 자연스러운 쉼에서 덩어리로 나눈다 (장면 전환은 침묵에서 일어난다)
 * 2. 덩어리마다 그 구간의 음성만 떼어 따로 상호상관을 돌린다
 * 3. 이동값이 비슷한 이웃끼리 도로 합친다
 * 4. 너무 짧게 살아남은 조각은 인정하지 않고 이웃에 흡수시킨다 — 이게 벌점이다
 * 5. 남은 경계는 자막 하나 단위까지 정확히 어디인지 다시 찾는다
 *
 * 4번이 없으면 대사가 적은 구간마다 가짜 경계가 생겨 자막이 너덜너덜해진다.
 *
 * **경계는 시각이 아니라 자막 번호로 잡는다.** 한쪽이 6초 밀린 파일에서는
 * 두 구간이 시간축에서 서로 겹친다 — "300초부터 뒤쪽 규칙"이라고 말하는 순간
 * 앞 구간의 꼬리가 뒤쪽 규칙에 잘못 걸린다. 자막 번호로 가르면 겹칠 수 없다.
 */

export interface PiecewiseOptions {
  frameSec: number
  /** 한 덩어리가 담아야 할 최소 자막 길이 — 짧으면 상관 봉우리를 믿을 수 없다 */
  minBlockSec: number
  /** 덩어리를 자를 수 있는 최소 침묵 */
  minGapSec: number
  /** 덩어리별로 찾아볼 최대 이동량 */
  maxLocalOffsetSec: number
  /** 이 차이 이하는 같은 이동으로 보고 합친다 */
  mergeToleranceSec: number
  /** 이 신뢰도 아래 덩어리는 스스로 판단하지 않고 이웃을 따른다 */
  minConfidence: number
  /** 이보다 짧게 살아남는 이동 변화는 인정하지 않는다 (분할 벌점) */
  minPieceSec: number
}

export const DEFAULT_PIECEWISE_OPTIONS: PiecewiseOptions = {
  frameSec: FRAME_SEC,
  minBlockSec: 60,
  minGapSec: 0.5,
  maxLocalOffsetSec: 10,
  mergeToleranceSec: 0.15,
  minConfidence: 0.35,
  minPieceSec: 45,
}

/** 자막 번호 구간 하나와 거기에 걸 이동값 */
export interface SyncPiece {
  /** 이 조각이 맡는 첫 자막 번호 */
  fromCue: number
  /** 마지막 자막 번호 (포함) */
  toCue: number
  offsetSec: number
  confidence: number
}

export interface PiecewiseResult {
  pieces: SyncPiece[]
  /** 서로 다른 이동값 사이의 경계 수. 0이면 통짜 이동 */
  splitCount: number
}

interface Block {
  from: number
  to: number
  offsetSec: number | null
  confidence: number
}

interface Group {
  from: number
  to: number
  offsetSec: number
  confidence: number
  /** 신뢰도 가중 평균을 이어가기 위한 누적값 */
  weight: number
}

type TimeSpan = { start: number; end: number }

export function alignPiecewise(
  speech: Float32Array,
  cues: readonly TimeSpan[],
  options: Partial<PiecewiseOptions> = {},
): PiecewiseResult {
  const opts = { ...DEFAULT_PIECEWISE_OPTIONS, ...options }

  if (speech.length === 0 || cues.length === 0) return { pieces: [], splitCount: 0 }

  const blocks = buildBlocks(cues, opts)
  for (const block of blocks) measureBlock(block, speech, cues, opts)

  inheritFromNeighbours(blocks, cues)
  if (blocks.every((b) => b.offsetSec === null)) return { pieces: [], splitCount: 0 }

  const groups = absorbShortGroups(mergeSimilar(blocks, opts), cues, opts)
  refineBoundaries(groups, speech, cues, opts)

  return {
    pieces: groups.map((g) => ({
      fromCue: g.from,
      toCue: g.to,
      offsetSec: Number(g.offsetSec.toFixed(3)),
      confidence: g.confidence,
    })),
    splitCount: groups.length - 1,
  }
}

/** 이 자막 번호를 맡은 조각 */
export function pieceForCue(pieces: readonly SyncPiece[], cueIndex: number): SyncPiece | null {
  for (const piece of pieces) {
    if (cueIndex >= piece.fromCue && cueIndex <= piece.toCue) return piece
  }
  return pieces[pieces.length - 1] ?? null
}

/**
 * 자막을 덩어리로 나눈다.
 *
 * 길이만 보고 기계적으로 자르지 않고 **쉼에서** 자른다. 실제 경계(광고, 장면
 * 삽입)는 대사 중간이 아니라 침묵에서 생기므로, 쉼에서 자르면 덩어리 경계와
 * 진짜 경계가 맞아떨어질 확률이 높다. 쉼이 계속 없으면 두 배 길이에서 끊는다.
 */
function buildBlocks(cues: readonly TimeSpan[], opts: PiecewiseOptions): Block[] {
  const blocks: Block[] = []
  let from = 0

  for (let i = 0; i < cues.length; i++) {
    const span = cues[i].end - cues[from].start
    const gapAfter = i + 1 < cues.length ? cues[i + 1].start - cues[i].end : Infinity
    const last = i === cues.length - 1

    if (last || (span >= opts.minBlockSec && gapAfter >= opts.minGapSec) || span >= opts.minBlockSec * 2) {
      blocks.push({ from, to: i, offsetSec: null, confidence: 0 })
      from = i + 1
    }
  }

  // 꼬리가 너무 짧으면 앞 덩어리에 붙인다 — 혼자서는 판단 근거가 부족하다
  if (blocks.length >= 2) {
    const tail = blocks[blocks.length - 1]
    if (spanOf(cues, tail.from, tail.to) < opts.minBlockSec / 2) {
      blocks[blocks.length - 2].to = tail.to
      blocks.pop()
    }
  }

  return blocks
}

function spanOf(cues: readonly TimeSpan[], from: number, to: number): number {
  return cues[to].end - cues[from].start
}

/**
 * 덩어리 하나의 이동값을 잰다.
 *
 * 그 덩어리가 놓인 시간대의 음성만 떼어 상관을 돌린다. 전체 음성과 맞대면
 * 멀리 떨어진 엉뚱한 대사와 겹쳐 봉우리가 서는 일이 생긴다.
 */
function measureBlock(
  block: Block,
  speech: Float32Array,
  cues: readonly TimeSpan[],
  opts: PiecewiseOptions,
): void {
  const pad = opts.maxLocalOffsetSec
  const fromFrame = Math.max(0, Math.floor((cues[block.from].start - pad) / opts.frameSec))
  const toFrame = Math.min(speech.length, Math.ceil((cues[block.to].end + pad) / opts.frameSec))
  const length = toFrame - fromFrame
  if (length < Math.round(1 / opts.frameSec)) return

  const base = fromFrame * opts.frameSec
  const local = cues
    .slice(block.from, block.to + 1)
    .map((cue) => ({ start: cue.start - base, end: cue.end - base }))

  const peak = findBestLag(
    speech.subarray(fromFrame, toFrame),
    subtitleSignal(local, length, opts.frameSec),
    Math.round(opts.maxLocalOffsetSec / opts.frameSec),
    Math.round(0.5 / opts.frameSec),
  )

  const confidence = sharpnessToConfidence(peak.sharpness)
  if (confidence < opts.minConfidence) return

  block.offsetSec = Number((peak.lag * opts.frameSec).toFixed(3))
  block.confidence = confidence
}

/**
 * 판단하지 못한 덩어리는 가장 가까운 이웃의 값을 쓴다.
 *
 * 대사가 거의 없는 구간(음악, 액션)에서는 어떤 방법으로도 이동값을 알 수 없다.
 * 그럴 때 0으로 두면 "여긴 이동 없음"이라는 잘못된 주장이 되어 가짜 경계가
 * 생긴다. 모르면 이웃을 따르는 편이 언제나 낫다.
 */
function inheritFromNeighbours(blocks: Block[], cues: readonly TimeSpan[]): void {
  const known = blocks.filter((b) => b.offsetSec !== null)
  if (known.length === 0) return

  const centreOf = (block: Block) => (cues[block.from].start + cues[block.to].end) / 2

  for (const block of blocks) {
    if (block.offsetSec !== null) continue

    const middle = centreOf(block)
    let nearest = known[0]
    for (const candidate of known) {
      if (Math.abs(centreOf(candidate) - middle) < Math.abs(centreOf(nearest) - middle)) {
        nearest = candidate
      }
    }

    block.offsetSec = nearest.offsetSec
    block.confidence = 0 // 빌려온 값이므로 병합 때 발언권을 주지 않는다
  }
}

/** 이동값이 비슷한 이웃끼리 도로 합친다 */
function mergeSimilar(blocks: Block[], opts: PiecewiseOptions): Group[] {
  const groups: Group[] = []

  for (const block of blocks) {
    const offset = block.offsetSec ?? 0
    const previous = groups[groups.length - 1]

    if (previous && Math.abs(previous.offsetSec - offset) <= opts.mergeToleranceSec) {
      const weight = previous.weight + block.confidence
      // 신뢰도로 가중해 평균 낸다. 근거가 약한 덩어리가 값을 끌고 가면 안 된다
      if (weight > 0) {
        previous.offsetSec = (previous.offsetSec * previous.weight + offset * block.confidence) / weight
      }
      previous.weight = weight
      previous.confidence = Math.max(previous.confidence, block.confidence)
      previous.to = block.to
      continue
    }

    groups.push({
      from: block.from,
      to: block.to,
      offsetSec: offset,
      confidence: block.confidence,
      weight: block.confidence,
    })
  }

  return groups
}

/**
 * 짧은 조각을 이웃에 흡수시킨다 — 분할 벌점.
 *
 * 경계를 하나 만든다는 건 "여기서 편집이 일어났다"는 주장이다. 그 주장이
 * 몇십 초짜리 구간 하나에만 근거한다면 대개 잡음이다. 이동값이 더 가까운
 * 이웃에 붙여 없앤다.
 */
function absorbShortGroups(
  groups: Group[],
  cues: readonly TimeSpan[],
  opts: PiecewiseOptions,
): Group[] {
  const merged = [...groups]

  for (;;) {
    if (merged.length <= 1) break

    let shortest = -1
    for (let i = 0; i < merged.length; i++) {
      if (spanOf(cues, merged[i].from, merged[i].to) >= opts.minPieceSec) continue
      if (shortest === -1 || spanOf(cues, merged[i].from, merged[i].to) < spanOf(cues, merged[shortest].from, merged[shortest].to)) {
        shortest = i
      }
    }
    if (shortest === -1) break

    const left = merged[shortest - 1]
    const right = merged[shortest + 1]
    const target =
      !left ? shortest + 1
      : !right ? shortest - 1
      : Math.abs(left.offsetSec - merged[shortest].offsetSec) <=
          Math.abs(right.offsetSec - merged[shortest].offsetSec)
        ? shortest - 1
        : shortest + 1

    const host = merged[target]
    host.from = Math.min(host.from, merged[shortest].from)
    host.to = Math.max(host.to, merged[shortest].to)
    merged.splice(shortest, 1)
  }

  return merged
}

/**
 * 경계가 정확히 몇 번 자막에서 갈리는지 다시 찾는다.
 *
 * 덩어리는 1분 단위라, 경계를 덩어리 단위로 두면 최대 1분어치 자막이 엉뚱한
 * 이동값을 뒤집어쓴다. 경계 근처 자막을 하나씩 옮겨 보며 "앞쪽 값으로 맞는
 * 자막"과 "뒤쪽 값으로 맞는 자막"이 갈리는 지점을 찾는다.
 *
 * 자막 하나가 이동값 o에서 얼마나 잘 맞는지는 **그 시간대에 실제로 소리가 나는
 * 비율**로 잰다. 말하는 구간에 자막이 얹히면 1에 가깝고, 침묵에 얹히면 0이다.
 */
function refineBoundaries(
  groups: Group[],
  speech: Float32Array,
  cues: readonly TimeSpan[],
  opts: PiecewiseOptions,
): void {
  if (groups.length < 2) return

  const prefix = speechPrefix(speech)
  const fit = (index: number, offsetSec: number) =>
    speechRatio(prefix, cues[index].start + offsetSec, cues[index].end + offsetSec, opts.frameSec)

  for (let i = 0; i < groups.length - 1; i++) {
    const before = groups[i]
    const after = groups[i + 1]
    if (before.offsetSec === after.offsetSec) continue

    // 경계 근처만 본다 — 멀리 있는 자막은 어느 쪽에 속하는지 이미 분명하다
    const lo = Math.max(before.from, before.to - BOUNDARY_SEARCH_CUES)
    const hi = Math.min(after.to, after.from + BOUNDARY_SEARCH_CUES)

    let best = before.to + 1
    let bestScore = -Infinity
    let runningBefore = 0

    // k = 뒤쪽 조각이 시작하는 자막 번호
    for (let k = lo; k <= hi + 1; k++) {
      let score = runningBefore
      for (let j = k; j <= hi; j++) score += fit(j, after.offsetSec)

      if (score > bestScore) {
        bestScore = score
        best = k
      }
      if (k <= hi) runningBefore += fit(k, before.offsetSec)
    }

    before.to = best - 1
    after.from = best
  }
}

/** 경계를 이 개수만큼의 자막 안에서 찾는다 (덩어리 하나가 대략 이 정도다) */
const BOUNDARY_SEARCH_CUES = 40

/** 말함/침묵 신호의 누적합 — 임의 구간의 소리 비율을 O(1)로 얻는다 */
function speechPrefix(speech: Float32Array): Float64Array {
  const prefix = new Float64Array(speech.length + 1)
  for (let i = 0; i < speech.length; i++) prefix[i + 1] = prefix[i] + speech[i]
  return prefix
}

function speechRatio(prefix: Float64Array, startSec: number, endSec: number, frameSec: number): number {
  const last = prefix.length - 1
  const from = Math.min(last, Math.max(0, Math.round(startSec / frameSec)))
  const to = Math.min(last, Math.max(from, Math.round(endSec / frameSec)))
  if (to === from) return 0
  return (prefix[to] - prefix[from]) / (to - from)
}
