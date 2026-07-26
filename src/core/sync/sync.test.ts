import { describe, expect, it } from 'vitest'
import { alignSubtitles, decimate } from './align'
import { findBestLag } from './correlate'
import { fftInPlace, nextPowerOfTwo } from './fft'
import { approximatePercentile, buildEnvelope, detectSpeech, subtitleSignal } from './vad'

const FRAME = 0.01

/** 말하는 구간 목록으로 이진 신호를 만든다 */
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

describe('FFT', () => {
  it('2의 거듭제곱으로 올림한다', () => {
    expect(nextPowerOfTwo(1)).toBe(1)
    expect(nextPowerOfTwo(5)).toBe(8)
    expect(nextPowerOfTwo(1024)).toBe(1024)
  })

  it('변환 후 역변환하면 원래 신호로 돌아온다', () => {
    const re = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8])
    const im = new Float64Array(8)
    const original = [...re]

    fftInPlace(re, im)
    fftInPlace(re, im, true)

    re.forEach((v, i) => expect(v).toBeCloseTo(original[i], 10))
  })

  it('상수 신호는 DC 성분만 남는다', () => {
    const re = Float64Array.from([2, 2, 2, 2])
    const im = new Float64Array(4)

    fftInPlace(re, im)

    expect(re[0]).toBeCloseTo(8)
    expect(re[1]).toBeCloseTo(0)
    expect(re[2]).toBeCloseTo(0)
    expect(re[3]).toBeCloseTo(0)
  })

  it('길이가 2의 거듭제곱이 아니면 예외', () => {
    expect(() => fftInPlace(new Float64Array(3), new Float64Array(3))).toThrow()
  })
})

describe('VAD', () => {
  it('프레임별 RMS를 계산한다', () => {
    // 8000Hz에서 10ms = 80샘플. 앞 80개는 진폭 1, 뒤 80개는 0
    const samples = new Float32Array(160)
    samples.fill(1, 0, 80)

    const envelope = buildEnvelope(samples, 8000, 0.01)

    expect(envelope).toHaveLength(2)
    expect(envelope[0]).toBeCloseTo(1)
    expect(envelope[1]).toBeCloseTo(0)
  })

  it('백분위수를 근사한다', () => {
    const values = Float32Array.from({ length: 1000 }, (_, i) => i / 1000)

    expect(approximatePercentile(values, 0.5)).toBeCloseTo(0.5, 1)
    expect(approximatePercentile(values, 0.9)).toBeCloseTo(0.9, 1)
  })

  it('녹음 레벨이 달라도 같은 구간을 말함으로 잡는다', () => {
    const quiet = new Float32Array(400)
    const loud = new Float32Array(400)
    for (let i = 0; i < 400; i++) {
      const isSpeech = i % 100 < 40
      quiet[i] = isSpeech ? 0.02 : 0.001
      loud[i] = isSpeech ? 0.9 : 0.05
    }

    expect([...detectSpeech(quiet)]).toEqual([...detectSpeech(loud)])
  })

  it('자막 구간을 이진 신호로 바꾼다', () => {
    const signal = subtitleSignal([{ start: 0.05, end: 0.1 }], 20, 0.01)

    expect(signal[4]).toBe(0)
    expect(signal[5]).toBe(1)
    expect(signal[9]).toBe(1)
    expect(signal[10]).toBe(0)
  })
})

describe('상호상관', () => {
  it('밀린 신호의 지연을 정확히 찾는다', () => {
    const spans = speechSpans(120)
    const audio = signalFrom(spans, 120)
    const shifted = signalFrom(
      spans.map(([s, e]) => [s - 3.2, e - 3.2] as [number, number]).filter(([s]) => s >= 0),
      120,
    )

    const peak = findBestLag(audio, shifted, 6000)

    // 자막이 3.2초 앞서 있으므로 +3.2초(320프레임) 밀어야 맞는다
    expect(peak.lag).toBe(320)
    expect(peak.score).toBeGreaterThan(0.8)
    expect(peak.sharpness).toBeGreaterThan(3)
  })

  it('음수 지연도 찾는다', () => {
    const spans = speechSpans(120, 7)
    const audio = signalFrom(spans, 120)
    const shifted = signalFrom(
      spans.map(([s, e]) => [s + 2.5, e + 2.5] as [number, number]),
      120,
    )

    expect(findBestLag(audio, shifted, 6000).lag).toBe(-250)
  })

  it('맞는 신호는 차선 봉우리를 크게 앞선다', () => {
    const spans = speechSpans(120, 3)
    const audio = signalFrom(spans, 120)
    const matched = signalFrom(spans, 120)

    expect(findBestLag(audio, matched, 6000).sharpness).toBeGreaterThan(1.5)
  })

  it('무관한 신호는 차선 봉우리와 엇비슷하다', () => {
    const audio = signalFrom(speechSpans(120, 3), 120)
    const unrelated = signalFrom(speechSpans(120, 999), 120)

    expect(findBestLag(audio, unrelated, 6000).sharpness).toBeLessThan(1.4)
  })

  it('빈 신호는 0을 돌려준다', () => {
    const peak = findBestLag(new Float32Array(100), new Float32Array(100), 50)
    expect(peak).toMatchObject({ lag: 0, score: 0 })
  })
})

describe('decimate', () => {
  it('구간 최대값을 남기며 성기게 만든다', () => {
    const signal = Float32Array.from([0, 1, 0, 0, 0, 0, 1, 1])
    expect([...decimate(signal, 4)]).toEqual([1, 1])
  })

  it('말하는 구간이 성글게 만들어도 사라지지 않는다', () => {
    // 10ms 프레임에서 30ms짜리 짧은 발화 — 평균을 쓰면 묻히지만 최대값은 살아남는다
    const signal = new Float32Array(100)
    signal.fill(1, 50, 53)
    expect(decimate(signal, 10)[5]).toBe(1)
  })

  it('factor가 1 이하면 그대로 돌려준다', () => {
    const signal = Float32Array.from([1, 2, 3])
    expect(decimate(signal, 1)).toBe(signal)
  })
})

describe('alignSubtitles', () => {
  it('상수 오프셋을 찾아낸다', () => {
    const spans = speechSpans(300)
    const audio = signalFrom(spans, 300)
    const cues = spans.map(([s, e]) => ({ start: s - 4, end: e - 4 })).filter((c) => c.start >= 0)

    const result = alignSubtitles(audio, cues)

    expect(result.offsetSec).toBeCloseTo(4, 1)
    expect(result.scale).toBe(1)
    expect(result.driftDetected).toBe(false)
    expect(result.confidence).toBeGreaterThan(0.6)
  })

  it('프레임레이트 불일치로 인한 드리프트를 잡아낸다', () => {
    // 25fps용 자막을 23.976fps 영상에 쓰면 시간이 4.3%씩 벌어진다
    const ratio = 25 / 23.976
    const spans = speechSpans(1200)
    const audio = signalFrom(spans, 1200)
    const cues = spans.map(([s, e]) => ({ start: s / ratio, end: e / ratio }))

    const result = alignSubtitles(audio, cues)

    expect(result.driftDetected).toBe(true)
    expect(result.scale).toBeCloseTo(ratio, 2)

    // 복원한 선형식이 시작/중간/끝 어디서든 원래 시각을 되살리는지 확인
    for (const original of [100, 600, 1100]) {
      const distorted = original / ratio
      expect(result.scale * distorted + result.offsetSec).toBeCloseTo(original, 0)
    }
  })

  it('이미 맞는 자막은 건드리지 않는다', () => {
    const spans = speechSpans(300, 11)
    const audio = signalFrom(spans, 300)
    const cues = spans.map(([s, e]) => ({ start: s, end: e }))

    const result = alignSubtitles(audio, cues)

    expect(result.offsetSec).toBeCloseTo(0, 1)
    expect(result.scale).toBe(1)
  })

  it('전혀 다른 자막이면 신뢰도가 낮게 나온다', () => {
    const audio = signalFrom(speechSpans(300, 5), 300)
    const cues = speechSpans(300, 4242).map(([s, e]) => ({ start: s, end: e }))

    expect(alignSubtitles(audio, cues).confidence).toBeLessThan(0.5)
  })
})
