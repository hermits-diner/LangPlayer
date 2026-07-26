import { alignSubtitles, type SyncResult } from './align'
import { buildEnvelope, detectSpeech } from './vad'

/**
 * 정렬 계산을 메인 스레드 밖으로 뺀다.
 *
 * 2시간 영상이면 포락선 계산에 5천만 번, FFT에 수천만 번의 연산이 든다.
 * 메인 스레드에서 돌리면 그동안 화면이 얼어붙는다.
 */

export interface SyncRequest {
  samples: Float32Array
  sampleRate: number
  cues: { start: number; end: number }[]
}

export type SyncResponse = { ok: true; result: SyncResult } | { ok: false; error: string }

self.onmessage = (event: MessageEvent<SyncRequest>) => {
  try {
    const { samples, sampleRate, cues } = event.data

    const envelope = buildEnvelope(samples, sampleRate)
    const speech = detectSpeech(envelope)
    const result = alignSubtitles(speech, cues)

    self.postMessage({ ok: true, result } satisfies SyncResponse)
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : '정렬 계산에 실패했습니다.',
    } satisfies SyncResponse)
  }
}
