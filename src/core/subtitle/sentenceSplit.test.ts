import { describe, expect, it } from 'vitest'
import { findQuietestTime, splitSegmentBySentence, splitSentences } from './sentenceSplit'
import type { Segment } from './types'

const segment = (text: string, start = 0, end = 10, cueIds = ['srt-0']): Segment => ({
  id: 'seg-0',
  start,
  end,
  text,
  cueIds,
})

describe('splitSentences', () => {
  it('종결 부호로 문장을 나눈다', () => {
    expect(splitSentences('First one. Second one! Third one?')).toEqual([
      'First one.',
      'Second one!',
      'Third one?',
    ])
  })

  it('약어의 마침표에서는 끊지 않는다', () => {
    expect(splitSentences('I met Mr. Smith today. He was late.')).toEqual([
      'I met Mr. Smith today.',
      'He was late.',
    ])
  })

  it('이니셜에서도 끊지 않는다', () => {
    expect(splitSentences('I read J. K. Rowling last night. It was good.')).toHaveLength(2)
  })

  it('닫는 따옴표가 붙어도 문장 끝으로 본다', () => {
    expect(splitSentences('"Go away!" she said. Then she left.')).toEqual([
      '"Go away!" she said.',
      'Then she left.',
    ])
  })

  it('종결 부호 없는 꼬리는 앞 문장에 붙인다', () => {
    expect(splitSentences('Complete sentence. dangling tail')).toEqual([
      'Complete sentence. dangling tail',
    ])
  })

  it('문장이 하나면 그대로 하나', () => {
    expect(splitSentences('Just one sentence here.')).toHaveLength(1)
  })

  it('빈 문자열은 빈 배열', () => {
    expect(splitSentences('   ')).toEqual([])
  })
})

describe('findQuietestTime', () => {
  it('조용한 구간의 한가운데를 짚는다', () => {
    // 10ms 프레임 100개 = 1초. 0.4~0.6초가 무음
    const envelope = new Float32Array(100).fill(1)
    envelope.fill(0, 40, 60)

    const found = findQuietestTime(envelope, 0.01, 0.5, 0.3)
    expect(found).toBeGreaterThanOrEqual(0.4)
    expect(found).toBeLessThanOrEqual(0.6)
  })

  it('탐색 범위 밖의 무음에는 끌려가지 않는다', () => {
    const envelope = new Float32Array(300).fill(1)
    envelope.fill(0, 0, 20) // 아주 앞쪽에만 무음

    const found = findQuietestTime(envelope, 0.01, 2.0, 0.3)
    expect(found).toBeGreaterThan(1.6)
  })
})

describe('splitSegmentBySentence', () => {
  it('문장이 하나면 쪼개지 않는다', () => {
    expect(splitSegmentBySentence(segment('Only one sentence here.'))).toBeNull()
  })

  it('문장 수만큼 조각을 만든다', () => {
    const pieces = splitSegmentBySentence(segment('Aaaa aaaa. Bbbb bbbb. Cccc cccc.'))
    expect(pieces).toHaveLength(3)
    expect(pieces!.map((p) => p.text)).toEqual(['Aaaa aaaa.', 'Bbbb bbbb.', 'Cccc cccc.'])
  })

  it('조각들이 원래 구간을 빈틈없이 덮는다', () => {
    const pieces = splitSegmentBySentence(segment('Aaaa aaaa. Bbbb bbbb.', 5, 15))!

    expect(pieces[0].start).toBe(5)
    expect(pieces.at(-1)!.end).toBe(15)
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i].start).toBe(pieces[i - 1].end)
    }
  })

  it('글자 수가 많은 문장이 더 긴 시간을 갖는다', () => {
    const pieces = splitSegmentBySentence(segment('Hi. This one is a great deal longer than that.', 0, 10))!
    const first = pieces[0].end - pieces[0].start
    const second = pieces[1].end - pieces[1].start

    expect(second).toBeGreaterThan(first)
  })

  it('원래 큐 경계가 가까이 있으면 그쪽으로 당긴다', () => {
    // 두 문장이 반반이면 어림 경계는 5초 언저리. 큐 경계 5.3초가 정답이다
    const pieces = splitSegmentBySentence(segment('Aaaa aaaa. Bbbb bbbb.', 0, 10), {
      cueBoundaries: [5.3],
      cueSnapSec: 0.6,
    })!

    expect(pieces[0].end).toBe(5.3)
  })

  it('멀리 있는 큐 경계에는 끌려가지 않는다', () => {
    const pieces = splitSegmentBySentence(segment('Aaaa aaaa. Bbbb bbbb.', 0, 10), {
      cueBoundaries: [9.5],
      cueSnapSec: 0.6,
    })!

    expect(pieces[0].end).toBeLessThan(6)
  })

  it('구간이 길수록 큐 경계를 더 멀리서도 붙잡는다', () => {
    // 어림값은 5초 언저리. 4.0초 큐 경계는 기본 창(0.6초) 밖이지만
    // 10초짜리 구간에서는 어림 자체가 그만큼 흐릿하므로 붙잡아야 한다
    const pieces = splitSegmentBySentence(segment('Aaaa aaaa. Bbbb bbbb.', 0, 10), {
      cueBoundaries: [4.0],
    })!

    expect(pieces[0].end).toBe(4.0)
  })

  it('짧은 구간에서는 창이 넓어지지 않는다', () => {
    // 2초짜리에서 어림값은 1초. 0.3초 큐 경계까지 끌려가면 안 된다
    const pieces = splitSegmentBySentence(segment('Aa. Bb.', 0, 2), {
      cueBoundaries: [0.3],
    })!

    expect(pieces[0].end).toBeGreaterThan(0.6)
  })

  it('큐 경계가 없으면 파형의 조용한 지점을 쓴다', () => {
    // 0~10초, 100Hz 포락선. 5.6초 언저리가 무음
    const envelope = new Float32Array(1000).fill(1)
    envelope.fill(0, 550, 570)

    const pieces = splitSegmentBySentence(segment('Aaaa aaaa. Bbbb bbbb.', 0, 10), {
      envelope,
      envelopeFrameSec: 0.01,
      quietWindowSec: 1,
    })!

    expect(pieces[0].end).toBeGreaterThanOrEqual(5.5)
    expect(pieces[0].end).toBeLessThanOrEqual(5.7)
  })

  it('구간이 너무 짧으면 쪼개지 않는다', () => {
    expect(splitSegmentBySentence(segment('A. B.', 0, 0.5), { minPieceSec: 0.4 })).toBeNull()
  })

  it('조각마다 다른 기록 키를 준다', () => {
    const pieces = splitSegmentBySentence(segment('Aaaa aaaa. Bbbb bbbb. Cccc cccc.'))!
    const keys = pieces.map((p) => p.cueIds[0])

    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe('srt-0') // 첫 조각은 원래 기록을 이어받는다
  })

  it('경계가 당겨져도 순서가 뒤집히지 않는다', () => {
    // 무음이 한 곳에 몰려 있어 두 경계가 같은 자리로 끌릴 수 있는 상황
    const envelope = new Float32Array(1000).fill(1)
    envelope.fill(0, 100, 120)

    const pieces = splitSegmentBySentence(segment('Aa. Bb. Cc.', 0, 10), {
      envelope,
      envelopeFrameSec: 0.01,
      quietWindowSec: 5,
      minPieceSec: 0.4,
    })!

    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i].start).toBeGreaterThanOrEqual(pieces[i - 1].start + 0.4)
    }
  })
})
