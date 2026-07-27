import { beforeEach, describe, expect, it } from 'vitest'
import type { Segment } from '../core/subtitle/types'
import { IDENTITY_SYNC, useAppStore } from './useAppStore'

/**
 * 싱크 보정 합성 검증.
 *
 * segments는 이미 보정이 적용된 시각을 들고 있어서, 새 보정을 얹을 때 이전
 * 보정을 되돌리고 다시 입혀야 한다. 이 계산이 틀리면 자동 맞춤을 두 번 누를
 * 때마다 자막이 점점 밀려나는데, 눈으로는 알아채기 어렵다.
 */

const segment = (id: string, start: number, end: number, text = id): Segment => ({
  id,
  start,
  end,
  text,
  cueIds: [id],
})

const BASE: Segment[] = [segment('a', 10, 12), segment('b', 100, 104)]

beforeEach(() => {
  useAppStore.setState({ segments: BASE, cues: [], sync: IDENTITY_SYNC, activeIndex: 0 })
})

const times = () => useAppStore.getState().segments.map((s) => [s.start, s.end])

describe('splitActiveSmart', () => {
  /** 큐 두 개가 한 문장으로 묶인 상태 — 큐 경계로 되돌릴 여지가 있다 */
  const seedTwoCues = (text = 'One two three four five six.') => {
    useAppStore.setState({
      segments: [{ id: 'seg-0', start: 10, end: 20, text, cueIds: ['c0', 'c1'] }],
      cues: [
        { id: 'c0', start: 10, end: 15, text: 'One two three' },
        { id: 'c1', start: 15, end: 20, text: 'four five six.' },
      ],
      activeIndex: 0,
      currentTime: 0,
      sync: IDENTITY_SYNC,
    })
  }

  it('재생 위치가 쓸 만하면 거기서 나눈다', () => {
    seedTwoCues()
    useAppStore.setState({ currentTime: 17 })

    expect(useAppStore.getState().splitActiveSmart()).toBe('playhead')
    expect(times()).toEqual([
      [10, 17],
      [17, 20],
    ])
  })

  it('재생 위치가 가장자리에 붙어 있으면 문장 단위로 나눈다', () => {
    // 문장을 막 골랐을 때의 상태 — 재생 위치가 문장 첫머리에 있다
    seedTwoCues('First one. Second one.')
    useAppStore.setState({ currentTime: 10 })

    expect(useAppStore.getState().splitActiveSmart()).toBe('sentence')
    expect(useAppStore.getState().segments.map((s) => s.text)).toEqual(['First one.', 'Second one.'])
  })

  it('문장이 하나뿐이고 재생 위치도 못 쓰면 큐 경계로 되돌린다', () => {
    seedTwoCues('한 문장뿐인 자막')
    useAppStore.setState({ currentTime: 10 })

    expect(useAppStore.getState().splitActiveSmart()).toBe('cue')
    expect(times()).toEqual([
      [10, 15],
      [15, 20],
    ])
  })

  it('나눌 문장이 없으면 아무 일도 하지 않는다', () => {
    useAppStore.setState({ segments: [], cues: [], activeIndex: -1 })
    expect(useAppStore.getState().splitActiveSmart()).toBe('none')
  })
})

describe('applySyncPieces', () => {
  const seed = () => {
    useAppStore.setState({
      segments: [segment('a', 10, 12), segment('b', 100, 104), segment('c', 200, 203)],
      cues: [
        { id: 'a', start: 10, end: 12, text: 'a' },
        { id: 'b', start: 100, end: 104, text: 'b' },
        { id: 'c', start: 200, end: 203, text: 'c' },
      ],
      snapUndo: null,
    })
  }

  it('자막 번호 구간마다 다른 이동값을 건다', () => {
    seed()

    const moved = useAppStore.getState().applySyncPieces([
      { fromCue: 0, toCue: 0, offsetSec: 0, confidence: 1 },
      { fromCue: 1, toCue: 2, offsetSec: 5, confidence: 1 },
    ])

    expect(moved).toBe(2)
    expect(times()).toEqual([
      [10, 12],
      [105, 109],
      [205, 208],
    ])
  })

  it('되돌릴 수 있게 직전 상태를 남긴다', () => {
    seed()
    useAppStore.getState().applySyncPieces([{ fromCue: 0, toCue: 2, offsetSec: 3, confidence: 1 }])

    expect(useAppStore.getState().undoSnap()).toBe(true)
    expect(times()).toEqual([
      [10, 12],
      [100, 104],
      [200, 203],
    ])
  })

  it('들리지 않을 만큼 작은 이동은 아예 건드리지 않는다', () => {
    seed()

    expect(
      useAppStore.getState().applySyncPieces([{ fromCue: 0, toCue: 2, offsetSec: 0.01, confidence: 1 }]),
    ).toBe(0)
    expect(useAppStore.getState().snapUndo).toBeNull()
  })

  it('시각이 음수로 내려가지 않는다', () => {
    seed()
    useAppStore.getState().applySyncPieces([{ fromCue: 0, toCue: 2, offsetSec: -999, confidence: 1 }])

    expect(times()[0]).toEqual([0, 0])
  })
})

describe('applySync', () => {
  it('원본 시각에 선형 변환을 적용한다', () => {
    useAppStore.getState().applySync({ scale: 2, offsetSec: 1 })

    expect(times()).toEqual([
      [21, 25],
      [201, 209],
    ])
    expect(useAppStore.getState().sync).toEqual({ scale: 2, offsetSec: 1 })
  })

  it('두 번 적용해도 원본 기준으로 계산된다 (누적되지 않는다)', () => {
    const store = useAppStore.getState()
    store.applySync({ scale: 2, offsetSec: 1 })
    store.applySync({ scale: 3, offsetSec: 5 })

    // 10 → 3·10+5 = 35 (2배 적용본 위에 다시 3배가 아니다)
    expect(times()).toEqual([
      [35, 41],
      [305, 317],
    ])
  })

  it('같은 보정을 반복 적용해도 자막이 밀리지 않는다', () => {
    const store = useAppStore.getState()
    store.applySync({ scale: 1, offsetSec: -2.5 })
    const once = times()

    store.applySync({ scale: 1, offsetSec: -2.5 })
    expect(times()).toEqual(once)
  })

  it('되돌리면 정확히 원래 시각으로 복귀한다', () => {
    const store = useAppStore.getState()
    store.applySync({ scale: 1.0427, offsetSec: -3.2 })
    store.resetSync()

    times().forEach(([start, end], i) => {
      expect(start).toBeCloseTo(BASE[i].start, 6)
      expect(end).toBeCloseTo(BASE[i].end, 6)
    })
    expect(useAppStore.getState().sync).toEqual(IDENTITY_SYNC)
  })

  it('시각이 음수로 내려가지 않는다', () => {
    useAppStore.getState().applySync({ scale: 1, offsetSec: -999 })
    expect(times()[0][0]).toBe(0)
  })
})

describe('mergeRange', () => {
  const FIVE = [
    segment('a', 0, 2, 'one'),
    segment('b', 2, 4, 'two'),
    segment('c', 4, 6, 'three'),
    segment('d', 6, 8, 'four'),
    segment('e', 8, 10, 'five'),
  ]

  beforeEach(() => {
    useAppStore.setState({ segments: FIVE, activeIndex: 0, selection: [] })
  })

  it('범위를 문장 하나로 접는다', () => {
    useAppStore.getState().mergeRange(1, 3)
    const segments = useAppStore.getState().segments

    expect(segments).toHaveLength(3)
    expect(segments[1]).toMatchObject({ start: 2, end: 8, text: 'two three four' })
  })

  it('합친 문장이 선택되고 다중 선택은 풀린다', () => {
    useAppStore.setState({ selection: [1, 2, 3] })
    useAppStore.getState().mergeRange(1, 3)

    expect(useAppStore.getState().activeIndex).toBe(1)
    expect(useAppStore.getState().selection).toEqual([])
  })

  it('합친 구간이 원래 시각 범위를 그대로 덮는다', () => {
    useAppStore.getState().mergeRange(0, 4)
    const [only] = useAppStore.getState().segments

    expect(useAppStore.getState().segments).toHaveLength(1)
    expect([only.start, only.end]).toEqual([0, 10])
  })

  it('범위가 뒤집혔거나 벗어나면 무시한다', () => {
    const before = useAppStore.getState().segments

    useAppStore.getState().mergeRange(3, 1)
    expect(useAppStore.getState().segments).toBe(before)

    useAppStore.getState().mergeRange(2, 99)
    expect(useAppStore.getState().segments).toBe(before)
  })
})

describe('splitActiveAt', () => {
  it('찍은 지점에서 문장을 둘로 가른다', () => {
    useAppStore.getState().splitActiveAt(11)

    expect(useAppStore.getState().segments).toHaveLength(3)
    expect(times().slice(0, 2)).toEqual([
      [10, 11],
      [11, 12],
    ])
  })

  it('가장자리에 너무 붙으면 자르지 않는다 (부스러기 조각 방지)', () => {
    const before = useAppStore.getState().segments

    useAppStore.getState().splitActiveAt(10.3) // 시작점 코앞
    expect(useAppStore.getState().segments).toBe(before)

    useAppStore.getState().splitActiveAt(11.7) // 끝점 코앞
    expect(useAppStore.getState().segments).toBe(before)
  })

  it('텍스트를 시간 비율에 맞춰 단어 경계로 나눈다', () => {
    useAppStore.setState({ segments: [segment('a', 0, 10, 'one two three four five six')] })
    useAppStore.getState().splitActiveAt(5)

    const [left, right] = useAppStore.getState().segments
    expect(left.text).toBe('one two three')
    expect(right.text).toBe('four five six')
  })

  it('텍스트가 한쪽으로 몰리지 않는다 (양쪽 모두 최소 한 단어)', () => {
    useAppStore.setState({ segments: [segment('a', 0, 10, 'alpha beta gamma')] })
    useAppStore.getState().splitActiveAt(9.5)

    const [left, right] = useAppStore.getState().segments
    expect(left.text).not.toBe('')
    expect(right.text).not.toBe('')
  })

  it('구간 밖은 무시한다', () => {
    const before = useAppStore.getState().segments
    useAppStore.getState().splitActiveAt(50)
    expect(useAppStore.getState().segments).toBe(before)
  })

  it('나뉜 조각들이 서로 다른 기록 키를 갖는다', () => {
    useAppStore.getState().splitActiveAt(11)
    const [left, right] = useAppStore.getState().segments

    expect(left.cueIds[0]).not.toBe(right.cueIds[0])
  })
})

describe('nudgeOffset', () => {
  it('배율은 두고 오프셋만 누적한다', () => {
    const store = useAppStore.getState()
    store.applySync({ scale: 1.05, offsetSec: 0 })
    store.nudgeOffset(0.1)
    store.nudgeOffset(0.1)

    const sync = useAppStore.getState().sync
    expect(sync.scale).toBe(1.05)
    expect(sync.offsetSec).toBeCloseTo(0.2, 6)
    expect(times()[0][0]).toBeCloseTo(10 * 1.05 + 0.2, 6)
  })

  it('부동소수점 오차가 표시값에 쌓이지 않는다', () => {
    const store = useAppStore.getState()
    for (let i = 0; i < 10; i++) store.nudgeOffset(0.1)

    expect(useAppStore.getState().sync.offsetSec).toBe(1)
  })
})
