import { describe, expect, it, vi } from 'vitest'
import type { PlayerAdapter } from '../player/PlayerAdapter'
import { LoopController, type LoopStatus } from './LoopController'

/** 재생 시각을 테스트가 직접 밀어주는 가짜 어댑터 */
class FakeAdapter implements PlayerAdapter {
  readonly kind = 'html' as const

  currentTime = 0
  paused = true
  duration = 100
  rate = 1
  seekLog: number[] = []
  playCount = 0
  pauseCount = 0

  private ticks = new Set<(t: number) => void>()

  async play(): Promise<void> {
    this.paused = false
    this.playCount++
  }

  pause(): void {
    this.paused = true
    this.pauseCount++
  }

  async seek(seconds: number): Promise<void> {
    this.currentTime = seconds
    this.seekLog.push(Number(seconds.toFixed(4)))
  }

  getCurrentTime(): number {
    return this.currentTime
  }

  getDuration(): number {
    return this.duration
  }

  isPaused(): boolean {
    return this.paused
  }

  setRate(rate: number): void {
    this.rate = rate
  }

  setVolume(): void {}

  onTick(callback: (t: number) => void): () => void {
    this.ticks.add(callback)
    return () => this.ticks.delete(callback)
  }

  destroy(): void {}

  /** 테스트 헬퍼: 재생 위치를 옮기고 tick을 발사한다 */
  advanceTo(seconds: number): void {
    this.currentTime = seconds
    for (const tick of [...this.ticks]) tick(seconds)
  }

  get tickCount(): number {
    return this.ticks.size
  }
}

/** 대기 중인 마이크로태스크를 모두 흘려보낸다 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const SEGMENT = { id: 's1', start: 10, end: 12 }
const OTHER = { id: 's2', start: 20, end: 22 }

function setup(settings = {}) {
  const adapter = new FakeAdapter()
  const statuses: LoopStatus[] = []
  const finished: string[] = []

  const loop = new LoopController(
    adapter,
    { repeatCount: 2, gapMs: 0, padLeadMs: 200, padTailMs: 300, rate: 1, ...settings },
    {
      onStatus: (s) => statuses.push(s),
      onFinished: (id) => finished.push(id),
    },
  )

  return { adapter, loop, statuses, finished }
}

describe('LoopController', () => {
  it('앞쪽 패딩만큼 당겨서 탐색하고 재생한다', async () => {
    const { adapter, loop } = setup()

    loop.start(SEGMENT)
    await flush()

    expect(adapter.seekLog).toEqual([9.8]) // 10 - 0.2
    expect(adapter.paused).toBe(false)
  })

  it('뒤쪽 패딩을 넘어서야 한 회차가 끝난다', async () => {
    const { adapter, loop } = setup()

    loop.start(SEGMENT)
    await flush()

    // 12.0은 아직 padTail(0.3s) 안쪽 — 반복하면 안 된다
    adapter.advanceTo(12.0)
    await flush()
    expect(adapter.seekLog).toEqual([9.8])

    adapter.advanceTo(12.3)
    await flush()
    expect(adapter.seekLog).toEqual([9.8, 9.8])
  })

  it('지정 횟수를 채우면 정지하고 onFinished를 부른다', async () => {
    const { adapter, loop, finished } = setup({ repeatCount: 2 })

    loop.start(SEGMENT)
    await flush()
    adapter.advanceTo(12.3) // 1회차 끝
    await flush()
    adapter.advanceTo(12.3) // 2회차 끝
    await flush()

    expect(adapter.seekLog).toHaveLength(2)
    expect(adapter.paused).toBe(true)
    expect(finished).toEqual(['s1'])
    expect(loop.getStatus().running).toBe(false)
  })

  it('반복 도중 다른 구간을 시작하면 이전 루프가 즉시 취소된다', async () => {
    const { adapter, loop, finished } = setup()

    loop.start(SEGMENT)
    await flush()
    loop.start(OTHER)
    await flush()

    expect(adapter.seekLog).toEqual([9.8, 19.8])

    // 이전 구간의 종료 시각을 지나가도 옛 루프는 반응하지 않아야 한다
    adapter.advanceTo(12.3)
    await flush()
    expect(adapter.seekLog).toEqual([9.8, 19.8])
    expect(finished).toEqual([])

    // 새 구간은 정상 동작
    adapter.advanceTo(22.3)
    await flush()
    expect(adapter.seekLog).toEqual([9.8, 19.8, 19.8])
  })

  it('취소된 루프의 tick 구독이 남지 않는다', async () => {
    const { adapter, loop } = setup()

    loop.start(SEGMENT)
    await flush()
    loop.start(OTHER)
    await flush()

    expect(adapter.tickCount).toBe(1)
  })

  it('stop()은 재생을 멈추고 idle 상태로 되돌린다', async () => {
    const { adapter, loop, finished } = setup()

    loop.start(SEGMENT)
    await flush()
    loop.stop()
    await flush()

    expect(adapter.paused).toBe(true)
    expect(loop.getStatus()).toMatchObject({ running: false, targetId: null })

    // 정상 종료가 아니므로 onFinished는 불리지 않는다
    adapter.advanceTo(12.3)
    await flush()
    expect(finished).toEqual([])
  })

  it('반복 사이에 무음 간격을 둔다', async () => {
    vi.useFakeTimers()
    try {
      const { adapter, loop, statuses } = setup({ repeatCount: 2, gapMs: 500 })

      loop.start(SEGMENT)
      await vi.advanceTimersByTimeAsync(0)
      adapter.advanceTo(12.3)
      await vi.advanceTimersByTimeAsync(0)

      // 간격 동안에는 멈춰 있어야 한다
      expect(adapter.paused).toBe(true)
      expect(statuses.at(-1)?.inGap).toBe(true)
      expect(adapter.seekLog).toEqual([9.8])

      await vi.advanceTimersByTimeAsync(500)
      expect(adapter.seekLog).toEqual([9.8, 9.8])
      expect(adapter.paused).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('무한 반복은 횟수를 채워도 멈추지 않는다', async () => {
    const { adapter, loop, finished } = setup({ repeatCount: Infinity })

    loop.start(SEGMENT)
    await flush()

    for (let i = 0; i < 4; i++) {
      adapter.advanceTo(12.3)
      await flush()
    }

    expect(adapter.seekLog).toHaveLength(5)
    expect(finished).toEqual([])
    expect(loop.getStatus().running).toBe(true)

    loop.stop()
  })

  it('상태에 현재 회차와 목표 횟수가 실린다', async () => {
    const { adapter, loop, statuses } = setup({ repeatCount: 3 })

    loop.start(SEGMENT)
    await flush()
    expect(statuses.at(-1)).toMatchObject({ targetId: 's1', repeat: 1, total: 3, running: true })

    adapter.advanceTo(12.3)
    await flush()
    expect(statuses.at(-1)).toMatchObject({ repeat: 2, total: 3 })
  })

  it('배속 변경이 어댑터에 전달된다', async () => {
    const { adapter, loop } = setup()

    loop.updateSettings({ rate: 0.75 })
    expect(adapter.rate).toBe(0.75)
  })

  it('구간 끝이 영상 길이를 넘으면 영상 끝에서 회차를 마감한다', async () => {
    const { adapter, loop } = setup({ repeatCount: 2 })
    adapter.duration = 12.1

    loop.start(SEGMENT)
    await flush()

    // padTail을 더하면 12.3이지만 영상은 12.1에서 끝난다
    adapter.advanceTo(12.1)
    await flush()

    expect(adapter.seekLog).toEqual([9.8, 9.8])
  })
})
