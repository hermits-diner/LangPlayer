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

const segment = (id: string, start: number, end: number): Segment => ({
  id,
  start,
  end,
  text: id,
  cueIds: [id],
})

const BASE: Segment[] = [segment('a', 10, 12), segment('b', 100, 104)]

beforeEach(() => {
  useAppStore.setState({ segments: BASE, cues: [], sync: IDENTITY_SYNC, activeIndex: 0 })
})

const times = () => useAppStore.getState().segments.map((s) => [s.start, s.end])

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
