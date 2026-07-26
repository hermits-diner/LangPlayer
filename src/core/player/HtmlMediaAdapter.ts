import type { PlayerAdapter } from './PlayerAdapter'

type VideoFrameCallback = (now: number, metadata: { mediaTime: number }) => void

/** 표준 lib에 없는 비표준/영상 전용 API만 덧붙인다 */
interface MediaElementWithExtras extends HTMLMediaElement {
  webkitPreservesPitch?: boolean
  requestVideoFrameCallback?: (callback: VideoFrameCallback) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/** seeked 이벤트가 끝내 오지 않는 경우를 대비한 안전장치 */
const SEEK_TIMEOUT_MS = 2000

/**
 * 로컬 영상/오디오 어댑터.
 *
 * `<video>`와 `<audio>`는 둘 다 HTMLMediaElement라 코드가 완전히 같다.
 * 팟캐스트(오디오)도 같은 어댑터로 처리된다.
 */
export class HtmlMediaAdapter implements PlayerAdapter {
  readonly kind = 'html' as const

  constructor(private readonly el: MediaElementWithExtras) {}

  async play(): Promise<void> {
    await this.el.play()
  }

  pause(): void {
    this.el.pause()
  }

  seek(seconds: number): Promise<void> {
    const duration = this.getDuration()
    const target = Math.min(Math.max(seconds, 0), duration > 0 ? duration : seconds)

    // 이미 그 자리에 있고 디코딩된 데이터가 있으면 seeked가 안 올 수 있다
    if (Math.abs(this.el.currentTime - target) < 0.005 && this.el.readyState >= 2) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      const finish = () => {
        this.el.removeEventListener('seeked', finish)
        clearTimeout(timer)
        resolve()
      }

      const timer = setTimeout(finish, SEEK_TIMEOUT_MS)
      this.el.addEventListener('seeked', finish)
      this.el.currentTime = target
    })
  }

  getCurrentTime(): number {
    return this.el.currentTime
  }

  getDuration(): number {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0
  }

  isPaused(): boolean {
    return this.el.paused
  }

  setRate(rate: number): void {
    // 배속을 낮춰 듣는 게 이 앱의 기본 사용법이라 음높이 유지는 필수다
    this.el.preservesPitch = true
    this.el.webkitPreservesPitch = true
    this.el.playbackRate = rate
  }

  setVolume(volume: number): void {
    this.el.volume = Math.min(Math.max(volume, 0), 1)
  }

  /**
   * 영상이면 requestVideoFrameCallback, 아니면 requestAnimationFrame.
   *
   * 두 API 모두 백그라운드 탭에서는 멈추거나 크게 느려지므로, 초당 4회쯤
   * 발생하는 `timeupdate`를 백업으로 함께 건다. 탭을 옮겨도 루프가 구간 끝을
   * 한없이 넘어가지 않게 하는 최소한의 안전장치다.
   */
  onTick(callback: (currentTime: number) => void): () => void {
    let cancelled = false
    let frameHandle = 0

    const emit = () => {
      if (!cancelled) callback(this.el.currentTime)
    }

    const useVideoFrames =
      typeof this.el.requestVideoFrameCallback === 'function' &&
      typeof this.el.cancelVideoFrameCallback === 'function'

    const schedule = () => {
      if (cancelled) return
      frameHandle = useVideoFrames
        ? this.el.requestVideoFrameCallback!(step)
        : requestAnimationFrame(step)
    }

    const step = () => {
      if (cancelled) return
      emit()
      schedule()
    }

    schedule()
    this.el.addEventListener('timeupdate', emit)

    return () => {
      cancelled = true
      if (useVideoFrames) this.el.cancelVideoFrameCallback!(frameHandle)
      else cancelAnimationFrame(frameHandle)
      this.el.removeEventListener('timeupdate', emit)
    }
  }

  destroy(): void {
    this.el.pause()
  }
}
