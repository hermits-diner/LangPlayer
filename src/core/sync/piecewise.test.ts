import { describe, expect, it } from 'vitest'
import { alignSubtitles } from './align'
import { alignPiecewise, pieceForCue } from './piecewise'
import { subtitleSignal } from './vad'

const FRAME = 0.01

function signalFrom(spans: [number, number][], durationSec: number): Float32Array {
  return subtitleSignal(
    spans.map(([start, end]) => ({ start, end })),
    Math.round(durationSec / FRAME),
    FRAME,
  )
}

/** 자연스러운 말 리듬을 흉내낸 구간 생성 (결정적) */
function speechSpans(durationSec: number, seed = 1): [number, number][] {
  const spans: [number, number][] = []
  let t = 0
  let state = seed

  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }

  while (t < durationSec) {
    const talk = 0.8 + next() * 2.5
    const pause = 0.3 + next() * 1.2
    if (t + talk > durationSec) break
    spans.push([t, t + talk])
    t += talk + pause
  }

  return spans
}

/**
 * 자막 시각에 구간별로 다른 어긋남을 입힌다.
 * 원래 시각(truth)을 함께 들고 있어야 복원 정확도를 잴 수 있다.
 */
function distort(spans: [number, number][], shiftAt: (timeSec: number) => number) {
  return spans
    .map(([start, end]) => ({ truth: start, start: start - shiftAt(start), end: end - shiftAt(start) }))
    .filter((cue) => cue.start >= 0)
}

describe('alignPiecewise', () => {
  it('중간에 편집이 들어가 이동값이 계단처럼 바뀌면 두 조각으로 나눈다', () => {
    // 광고가 빠진 방송본: 300초 지점부터 자막이 6초씩 이르다
    const spans = speechSpans(600, 3)
    const audio = signalFrom(spans, 600)
    const marked = distort(spans, (t) => (t < 300 ? 0 : 6))
    const cues = marked.map(({ start, end }) => ({ start, end }))

    const { pieces, splitCount } = alignPiecewise(audio, cues)

    expect(splitCount).toBe(1)
    expect(pieceForCue(pieces, 0)?.offsetSec).toBeCloseTo(0, 1)
    expect(pieceForCue(pieces, cues.length - 1)?.offsetSec).toBeCloseTo(6, 1)

    // 경계가 실제 편집 지점(300초) 근처에서 갈려야 한다
    const truth = marked.findIndex((cue) => cue.truth >= 300)
    expect(Math.abs(pieces[1].fromCue - truth)).toBeLessThanOrEqual(2)
  })

  it('처음부터 끝까지 같은 어긋남이면 쪼개지 않는다', () => {
    const spans = speechSpans(600, 7)
    const audio = signalFrom(spans, 600)
    const cues = distort(spans, () => 2.5)

    const { pieces, splitCount } = alignPiecewise(audio, cues)

    expect(splitCount).toBe(0)
    expect(pieces).toHaveLength(1)
    expect(pieces[0].offsetSec).toBeCloseTo(2.5, 1)
  })

  it('이미 맞는 자막은 이동값 0인 한 조각으로 둔다', () => {
    const spans = speechSpans(400, 11)
    const audio = signalFrom(spans, 400)
    const cues = spans.map(([start, end]) => ({ start, end }))

    const { pieces, splitCount } = alignPiecewise(audio, cues)

    expect(splitCount).toBe(0)
    expect(pieces[0].offsetSec).toBeCloseTo(0, 2)
  })

  it('짧게 스쳐가는 어긋남에는 경계를 만들지 않는다 (분할 벌점)', () => {
    // 20초 구간만 다르게 어긋난 경우 — 근거가 빈약하므로 인정하지 않는다
    const spans = speechSpans(600, 5)
    const audio = signalFrom(spans, 600)
    const cues = distort(spans, (t) => (t >= 300 && t < 320 ? 5 : 0))

    expect(alignPiecewise(audio, cues).splitCount).toBe(0)
  })

  it('조각들이 자막 번호를 빈틈없이 덮는다', () => {
    const spans = speechSpans(600, 3)
    const audio = signalFrom(spans, 600)
    const cues = distort(spans, (t) => (t < 300 ? 0 : 6))

    const { pieces } = alignPiecewise(audio, cues)

    expect(pieces[0].fromCue).toBe(0)
    expect(pieces[pieces.length - 1].toCue).toBe(cues.length - 1)
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i].fromCue).toBe(pieces[i - 1].toCue + 1)
    }
    for (let i = 0; i < cues.length; i++) expect(pieceForCue(pieces, i)).not.toBeNull()
  })

  it('전체 정렬과 함께 돌리면 계단형 어긋남이 실제로 사라진다', () => {
    // 앱이 자동 맞춤에서 하는 일을 그대로 재현한다: 전체 정렬 → 구간별 정렬
    const spans = speechSpans(600, 13)
    const audio = signalFrom(spans, 600)
    const marked = distort(spans, (t) => (t < 300 ? 2 : 8))
    const cues = marked.map(({ start, end }) => ({ start, end }))

    const global = alignSubtitles(audio, cues)
    const corrected = cues.map((cue) => ({
      start: cue.start * global.scale + global.offsetSec,
      end: cue.end * global.scale + global.offsetSec,
    }))
    const { pieces } = alignPiecewise(audio, corrected)

    const errorOf = (list: { start: number }[]) =>
      Math.max(...list.map((cue, i) => Math.abs(cue.start - marked[i].truth)))

    // 전체 정렬만으로는 앞뒤 어느 쪽도 맞출 수 없다 — 한쪽에 붙거나 평균에 걸친다
    expect(errorOf(corrected)).toBeGreaterThan(2)

    const final = corrected.map((cue, i) => ({
      start: cue.start + (pieceForCue(pieces, i)?.offsetSec ?? 0),
    }))
    expect(errorOf(final)).toBeLessThan(0.2)
  })

  it('빈 입력은 조용히 빈 결과를 돌려준다', () => {
    expect(alignPiecewise(new Float32Array(0), [])).toEqual({ pieces: [], splitCount: 0 })
    expect(alignPiecewise(new Float32Array(1000), [])).toEqual({ pieces: [], splitCount: 0 })
  })

  it('대사가 거의 없어 판단할 수 없는 구간은 이웃을 따른다', () => {
    // 뒤쪽 절반이 완전한 침묵 — 그 구간 자막의 이동값은 알 길이 없다
    const spans = speechSpans(300, 9)
    const audio = signalFrom(spans, 600)
    const cues = [
      ...distort(spans, () => 3).map(({ start, end }) => ({ start, end })),
      // 침묵 구간에 얹힌 자막들
      ...Array.from({ length: 40 }, (_, i) => ({ start: 320 + i * 6, end: 322 + i * 6 })),
    ]

    const { pieces, splitCount } = alignPiecewise(audio, cues)

    // 알 수 없는 구간 때문에 가짜 경계가 생기면 안 된다
    expect(splitCount).toBe(0)
    expect(pieces[0].offsetSec).toBeCloseTo(3, 1)
  })
})
