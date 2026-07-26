import { alignSubtitles, type SyncResult } from './align'
import { buildEnvelope, detectSpeech } from './vad'

/**
 * 오디오 분석 워커.
 *
 * 파형 그리기와 자막 자동 맞춤은 같은 재료 — 에너지 포락선 — 을 쓴다.
 * 그래서 포락선 계산과 정렬을 한 워커에 두고, 포락선은 한 번만 만들어
 * 두 곳이 나눠 쓴다. 2시간 영상이면 포락선 계산에만 5천만 번의 연산이 들어
 * 메인 스레드에서 돌리면 화면이 얼어붙는다.
 */

export type AudioWorkerRequest =
  | { type: 'envelope'; samples: Float32Array; sampleRate: number }
  | { type: 'align'; envelope: Float32Array; cues: { start: number; end: number }[] }

export type AudioWorkerResponse =
  | { ok: true; type: 'envelope'; envelope: Float32Array }
  | { ok: true; type: 'align'; result: SyncResult }
  | { ok: false; error: string }

self.onmessage = (event: MessageEvent<AudioWorkerRequest>) => {
  try {
    const request = event.data

    if (request.type === 'envelope') {
      const envelope = buildEnvelope(request.samples, request.sampleRate)
      const response: AudioWorkerResponse = { ok: true, type: 'envelope', envelope }
      self.postMessage(response, { transfer: [envelope.buffer] })
      return
    }

    const result = alignSubtitles(detectSpeech(request.envelope), request.cues)
    self.postMessage({ ok: true, type: 'align', result } satisfies AudioWorkerResponse)
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : '오디오 분석에 실패했습니다.',
    } satisfies AudioWorkerResponse)
  }
}
