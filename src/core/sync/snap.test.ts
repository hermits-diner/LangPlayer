import { describe, expect, it } from 'vitest'
import type { Segment } from '../subtitle/types'
import { findSpeechEdges, nearestWithin, snapSegmentsToSpeech } from './snap'

const FRAME = 0.01

/** 지정한 구간에만 소리가 있는 포락선을 만든다 (10ms 프레임, 초 단위 입력) */
function envelopeWith(spans: [number, number][], durationSec: number): Float32Array {
  const env = new Float32Array(Math.round(durationSec / FRAME))
  // 침묵도 완전한 0이 아니라 잡음 바닥을 깔아 실제 오디오에 가깝게
  env.fill(0.01)
  for (const [start, end] of spans) {
    env.fill(1, Math.round(start / FRAME), Math.round(end / FRAME))
  }
  return env
}

const segment = (id: string, start: number, end: number): Segment => ({
  id,
  start,
  end,
  text: id,
  cueIds: [id],
})

describe('findSpeechEdges', () => {
  it('소리가 시작하고 끝나는 지점을 뽑는다', () => {
    const edges = findSpeechEdges(
      envelopeWith(
        [
          [1, 2],
          [3, 4.5],
        ],
        6,
      ).map((v) => (v > 0.5 ? 1 : 0)) as Float32Array,
      FRAME,
    )

    expect(edges.onsets).toEqual([1, 3])
    expect(edges.offsets).toEqual([2, 4.5])
  })

  it('아주 짧은 조각은 무시한다', () => {
    // 30ms짜리 튐은 경계가 아니다
    const speech = new Float32Array(600)
    speech.fill(1, 100, 103)
    speech.fill(1, 200, 300)

    const edges = findSpeechEdges(speech, FRAME, 0.08)
    expect(edges.onsets).toEqual([2])
  })

  it('끝까지 소리가 이어져도 닫아 준다', () => {
    const speech = new Float32Array(100)
    speech.fill(1, 50, 100)

    expect(findSpeechEdges(speech, FRAME).offsets).toEqual([1])
  })

  it('소리가 없으면 빈 배열', () => {
    expect(findSpeechEdges(new Float32Array(100), FRAME).onsets).toEqual([])
  })
})

describe('nearestWithin', () => {
  const values = [1, 3, 7, 12]

  it('가장 가까운 값을 고른다', () => {
    expect(nearestWithin(values, 3.2, 1)).toBe(3)
    expect(nearestWithin(values, 6.5, 1)).toBe(7)
  })

  it('범위 밖이면 null', () => {
    expect(nearestWithin(values, 9.5, 1)).toBeNull()
  })

  it('배열 양 끝에서도 동작한다', () => {
    expect(nearestWithin(values, 0.5, 1)).toBe(1)
    expect(nearestWithin(values, 12.4, 1)).toBe(12)
  })

  it('빈 배열은 null', () => {
    expect(nearestWithin([], 5, 10)).toBeNull()
  })
})

describe('snapSegmentsToSpeech', () => {
  // 소리: 1.0~2.0, 3.0~4.5, 6.0~7.0
  const envelope = envelopeWith(
    [
      [1, 2],
      [3, 4.5],
      [6, 7],
    ],
    9,
  )

  it('제각각 어긋난 문장을 소리 경계로 당긴다', () => {
    const result = snapSegmentsToSpeech(
      [segment('a', 1.25, 2.2), segment('b', 2.8, 4.2), segment('c', 6.3, 7.15)],
      envelope,
    )

    expect(result.segments.map((s) => [s.start, s.end])).toEqual([
      [1, 2],
      [3, 4.5],
      [6, 7],
    ])
    expect(result.movedCount).toBe(3)
  })

  it('이미 맞는 문장은 건드리지 않는다', () => {
    const result = snapSegmentsToSpeech([segment('a', 1, 2)], envelope)

    expect(result.movedCount).toBe(0)
    expect(result.segments[0]).toMatchObject({ start: 1, end: 2 })
  })

  it('창 밖으로 멀리 떨어진 문장은 그대로 둔다', () => {
    // 8.5초 근처에는 소리가 없다 — 6~7의 경계로 끌려가면 안 된다
    const result = snapSegmentsToSpeech([segment('a', 8.4, 8.9)], envelope, { windowSec: 0.6 })

    expect(result.segments[0]).toMatchObject({ start: 8.4, end: 8.9 })
    expect(result.movedCount).toBe(0)
  })

  it('앞뒤 문장이 겹치지 않는다', () => {
    const result = snapSegmentsToSpeech(
      [segment('a', 2.9, 4.4), segment('b', 4.4, 6.4)],
      envelope,
    )

    for (let i = 1; i < result.segments.length; i++) {
      expect(result.segments[i].start).toBeGreaterThanOrEqual(result.segments[i - 1].end)
    }
  })

  it('맞추다 문장이 뭉개지면 원래대로 둔다', () => {
    const result = snapSegmentsToSpeech([segment('a', 1.9, 2.1)], envelope, { minDurationSec: 0.5 })
    expect(result.segments[0]).toMatchObject({ start: 1.9, end: 2.1 })
  })

  it('평균 이동 거리를 알려준다', () => {
    const result = snapSegmentsToSpeech([segment('a', 1.2, 2.2), segment('b', 3.2, 4.6)], envelope)

    expect(result.averageShiftSec).toBeCloseTo(0.2, 2)
  })

  it('파형이 없으면 아무 일도 하지 않는다', () => {
    const result = snapSegmentsToSpeech([segment('a', 1, 2)], new Float32Array(0))
    expect(result.movedCount).toBe(0)
  })
})
