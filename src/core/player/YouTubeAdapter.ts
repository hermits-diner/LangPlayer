import type { PlayerAdapter } from './PlayerAdapter'

/** IFrame API 중 실제로 쓰는 부분만 최소한으로 선언 */
interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  setPlaybackRate(rate: number): void
  setVolume(volume: number): void
  destroy(): void
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    config: {
      videoId: string
      playerVars?: Record<string, string | number>
      events?: { onReady?: () => void; onError?: (e: { data: number }) => void }
    },
  ) => YTPlayer
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number }
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api'
const SEEK_TOLERANCE_SEC = 0.35
const SEEK_TIMEOUT_MS = 4000

let apiPromise: Promise<YTNamespace> | null = null

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
      else reject(new Error('YouTube IFrame API가 로드되었지만 YT 전역이 없습니다.'))
    }

    const script = document.createElement('script')
    script.src = API_SRC
    script.async = true
    script.onerror = () => reject(new Error('YouTube IFrame API를 불러오지 못했습니다.'))
    document.head.appendChild(script)
  })

  return apiPromise
}

/** 다양한 형태의 YouTube URL에서 videoId 추출 */
export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed

  try {
    const url = new URL(trimmed)
    if (url.hostname === 'youtu.be') return url.pathname.slice(1, 12) || null
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(url.hostname)) return null

    const fromQuery = url.searchParams.get('v')
    if (fromQuery) return fromQuery

    const match = url.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * YouTube 어댑터.
 *
 * HTMLMediaElement와 달리 `seeked` 이벤트가 없고 탐색 정밀도도 떨어진다.
 * 그래서 탐색은 "목표 근처에 도달할 때까지 폴링"으로 확인하고, 현재 시각도
 * rAF로 폴링한다. 구간 반복 정확도는 로컬 파일보다 약간 무디지만 학습에는
 * 충분한 수준이다.
 */
export class YouTubeAdapter implements PlayerAdapter {
  readonly kind = 'youtube' as const

  private constructor(private readonly player: YTPlayer) {}

  static async create(container: HTMLElement, videoIdOrUrl: string): Promise<YouTubeAdapter> {
    const videoId = extractYouTubeId(videoIdOrUrl)
    if (!videoId) throw new Error('YouTube 주소에서 영상 ID를 찾지 못했습니다.')

    const YT = await loadYouTubeApi()

    return new Promise<YouTubeAdapter>((resolve, reject) => {
      const player = new YT.Player(container, {
        videoId,
        playerVars: {
          // 자막은 우리 UI로 보여주므로 유튜브 자체 캡션은 끈다
          cc_load_policy: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: () => resolve(new YouTubeAdapter(player)),
          onError: (e) => reject(new Error(`YouTube 재생 오류 (code ${e.data})`)),
        },
      })
    })
  }

  async play(): Promise<void> {
    this.player.playVideo()
  }

  pause(): void {
    this.player.pauseVideo()
  }

  async seek(seconds: number): Promise<void> {
    this.player.seekTo(Math.max(0, seconds), true)
    await this.waitUntilNear(seconds)
  }

  /** seeked 이벤트가 없으므로 목표 지점 근처에 올 때까지 폴링한다 */
  private waitUntilNear(target: number): Promise<void> {
    return new Promise((resolve) => {
      const startedAt = performance.now()

      const check = () => {
        const reached = Math.abs(this.player.getCurrentTime() - target) <= SEEK_TOLERANCE_SEC
        if (reached || performance.now() - startedAt > SEEK_TIMEOUT_MS) resolve()
        else requestAnimationFrame(check)
      }

      check()
    })
  }

  getCurrentTime(): number {
    return this.player.getCurrentTime()
  }

  getDuration(): number {
    return this.player.getDuration()
  }

  isPaused(): boolean {
    return this.player.getPlayerState() !== (window.YT?.PlayerState.PLAYING ?? 1)
  }

  setRate(rate: number): void {
    this.player.setPlaybackRate(rate)
  }

  setVolume(volume: number): void {
    // IFrame API는 0~100 스케일을 쓴다
    this.player.setVolume(Math.min(Math.max(volume, 0), 1) * 100)
  }

  onTick(callback: (currentTime: number) => void): () => void {
    let cancelled = false
    let handle = 0

    const step = () => {
      if (cancelled) return
      callback(this.player.getCurrentTime())
      handle = requestAnimationFrame(step)
    }

    handle = requestAnimationFrame(step)

    return () => {
      cancelled = true
      cancelAnimationFrame(handle)
    }
  }

  destroy(): void {
    this.player.destroy()
  }
}
