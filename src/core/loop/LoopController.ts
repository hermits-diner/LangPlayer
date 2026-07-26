import type { PlayerAdapter } from '../player/PlayerAdapter'

export interface LoopSettings {
  /** 반복 횟수. Infinity면 무한 반복 */
  repeatCount: number
  /** 반복 사이 무음 구간 — 따라 말할 시간을 준다 */
  gapMs: number
  /** 구간 시작 앞쪽 여유. 없으면 첫 음소가 잘려 받아쓰기가 불가능해진다 */
  padLeadMs: number
  /** 구간 끝 뒤쪽 여유 */
  padTailMs: number
  rate: number
}

export const DEFAULT_LOOP_SETTINGS: LoopSettings = {
  repeatCount: 3,
  gapMs: 0,
  padLeadMs: 200,
  padTailMs: 300,
  rate: 1,
}

export interface LoopTarget {
  id: string
  start: number
  end: number
}

export interface LoopStatus {
  targetId: string | null
  /** 현재 몇 번째 반복인지 (1-based). 대기 중이면 0 */
  repeat: number
  /** 목표 반복 횟수 */
  total: number
  running: boolean
  /** 반복 사이 무음 구간 재생 중 */
  inGap: boolean
}

const IDLE: LoopStatus = { targetId: null, repeat: 0, total: 0, running: false, inGap: false }

export interface LoopCallbacks {
  onStatus?: (status: LoopStatus) => void
  /** 지정 횟수를 모두 채우고 정상 종료했을 때만 호출된다 (중간 취소 시 호출 안 됨) */
  onFinished?: (targetId: string) => void
}

/**
 * 구간 반복 엔진.
 *
 * 핵심은 두 가지다.
 *
 * 1. 구간 끝 감지를 `timeupdate`가 아니라 프레임 단위 폴링으로 한다.
 *    `timeupdate`는 초당 4회라 최대 250ms를 넘겨버리고, 그러면 다음 문장이
 *    새어 들어와 받아쓰기 문제가 망가진다.
 *
 * 2. 모든 비동기 단계가 취소 가능하다. 사용자가 반복 도중 다른 문장을 클릭하는
 *    것은 예외가 아니라 기본 사용 패턴이므로, 이전 루프의 `seek`/`play`/대기가
 *    뒤늦게 깨어나 방금 시작한 재생을 망치지 않아야 한다. 실행 토큰으로 막는다.
 */
export class LoopController {
  private settings: LoopSettings
  /**
   * 이번 실행에만 적용할 설정.
   *
   * 음파창에서 드래그한 구간이나 연속 재생은 "한 번만, 패딩 없이" 재생해야
   * 하는데, 그렇다고 사용자가 맞춰 둔 반복 횟수를 건드릴 수는 없다.
   */
  private overrides: Partial<LoopSettings> | null = null
  private token = 0
  private status: LoopStatus = IDLE

  /** 진행 중인 대기(구간 끝 대기 / 무음 간격)를 즉시 깨우는 함수 */
  private abortPending: (() => void) | null = null

  constructor(
    private adapter: PlayerAdapter,
    settings: Partial<LoopSettings> = {},
    private callbacks: LoopCallbacks = {},
  ) {
    this.settings = { ...DEFAULT_LOOP_SETTINGS, ...settings }
    this.adapter.setRate(this.settings.rate)
  }

  getStatus(): LoopStatus {
    return this.status
  }

  getSettings(): LoopSettings {
    return this.settings
  }

  /** 이번 실행에 실제로 적용되는 설정 */
  private get effective(): LoopSettings {
    return this.overrides ? { ...this.settings, ...this.overrides } : this.settings
  }

  updateSettings(partial: Partial<LoopSettings>): void {
    this.settings = { ...this.settings, ...partial }
    if (partial.rate !== undefined) this.adapter.setRate(partial.rate)

    // 반복 횟수를 줄여 이미 채운 상태가 되면 즉시 끝낸다
    if (this.status.running && this.status.repeat > this.effective.repeatCount) {
      this.stop()
    } else if (this.status.running) {
      this.emit({ ...this.status, total: this.effective.repeatCount })
    }
  }

  /**
   * 새 구간 반복 시작. 진행 중이던 루프는 즉시 취소된다.
   * `overrides`는 이번 실행에만 적용되고 사용자 설정을 바꾸지 않는다.
   */
  start(target: LoopTarget, overrides?: Partial<LoopSettings>): void {
    const token = this.cancelCurrent()
    this.overrides = overrides ?? null
    void this.run(token, target)
  }

  /** 반복을 멈추고 재생도 정지 */
  stop(): void {
    this.cancelCurrent()
    this.overrides = null
    this.adapter.pause()
    this.emit(IDLE)
  }

  destroy(): void {
    this.cancelCurrent()
  }

  /** 실행 토큰을 무효화하고 대기 중인 단계를 깨운다 */
  private cancelCurrent(): number {
    this.token += 1
    this.abortPending?.()
    this.abortPending = null
    return this.token
  }

  private isStale(token: number): boolean {
    return token !== this.token
  }

  private emit(status: LoopStatus): void {
    this.status = status
    this.callbacks.onStatus?.(status)
  }

  private async run(token: number, target: LoopTarget): Promise<void> {
    const { padLeadMs, padTailMs } = this.effective
    const from = Math.max(0, target.start - padLeadMs / 1000)
    const to = target.end + padTailMs / 1000

    for (let repeat = 1; repeat <= this.effective.repeatCount; repeat++) {
      if (this.isStale(token)) return

      this.emit({
        targetId: target.id,
        repeat,
        total: this.effective.repeatCount,
        running: true,
        inGap: false,
      })

      await this.adapter.seek(from)
      if (this.isStale(token)) return

      try {
        await this.adapter.play()
      } catch {
        // 자동재생 차단 등 — 루프를 조용히 접는다
        if (!this.isStale(token)) this.emit(IDLE)
        return
      }
      if (this.isStale(token)) return

      await this.waitUntil(token, to)
      if (this.isStale(token)) return

      const isLast = repeat >= this.effective.repeatCount
      if (isLast) break

      if (this.effective.gapMs > 0) {
        this.adapter.pause()
        this.emit({ ...this.status, inGap: true })
        await this.wait(token, this.effective.gapMs)
        if (this.isStale(token)) return
      }
    }

    if (this.isStale(token)) return

    this.overrides = null
    this.adapter.pause()
    this.emit(IDLE)
    this.callbacks.onFinished?.(target.id)
  }

  /** 재생 위치가 endTime을 넘을 때까지 대기 (프레임 단위 폴링) */
  private waitUntil(token: number, endTime: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const duration = this.adapter.getDuration()
      const limit = duration > 0 ? Math.min(endTime, duration) : endTime

      // onTick이 동기적으로 콜백을 부르는 어댑터가 있어도 안전하도록 finish를 먼저 정의한다
      let unsubscribe: (() => void) | null = null
      let done = false

      const finish = () => {
        if (done) return
        done = true
        unsubscribe?.()
        if (this.abortPending === finish) this.abortPending = null
        resolve()
      }

      this.abortPending = finish

      unsubscribe = this.adapter.onTick((currentTime) => {
        if (this.isStale(token) || currentTime >= limit) finish()
      })

      // 등록 직후 이미 조건을 만족했다면 (동기 콜백 어댑터) 구독을 정리한다
      if (done) unsubscribe()
    })
  }

  /** 취소 가능한 지연 */
  private wait(token: number, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        if (this.abortPending === finish) this.abortPending = null
        resolve()
      }

      const timer = setTimeout(() => {
        if (!this.isStale(token)) finish()
      }, ms)

      this.abortPending = finish
    })
  }
}
