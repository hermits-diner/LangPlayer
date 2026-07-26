/**
 * 재생 계층 추상화.
 *
 * 로컬 영상/오디오와 YouTube는 API가 전혀 다르지만, 구간 반복에 필요한 동작은
 * 같다. 위쪽(LoopController·UI)이 이 인터페이스만 알게 해두면 나중에 Tauri
 * 네이티브 코덱이나 다른 소스를 붙일 때 어댑터 하나만 추가하면 된다.
 *
 * 주의: 현재 시각은 **이벤트가 아니라 폴링**으로 얻는다. HTMLMediaElement의
 * `timeupdate`는 초당 4회 정도만 발생해 구간 끝을 최대 250ms 넘겨버린다.
 */
export interface PlayerAdapter {
  readonly kind: 'html' | 'youtube'

  play(): Promise<void>
  pause(): void

  /** 탐색이 실제로 끝날 때까지 기다린다. 기다리지 않고 play하면 앞부분이 잘린다 */
  seek(seconds: number): Promise<void>

  getCurrentTime(): number
  getDuration(): number
  isPaused(): boolean

  /** 배속. 음높이는 유지한다 */
  setRate(rate: number): void
  setVolume(volume: number): void

  /**
   * 프레임 단위 콜백 등록. 영상은 requestVideoFrameCallback, 그 외는
   * requestAnimationFrame을 쓴다. 해제 함수를 돌려준다.
   */
  onTick(callback: (currentTime: number) => void): () => void

  destroy(): void
}
