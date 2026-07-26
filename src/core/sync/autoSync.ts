import type { SyncResult } from './align'
import { ANALYSIS_SAMPLE_RATE, decodeToMono } from './audioSource'
import type { SyncRequest, SyncResponse } from './syncWorker'

/** 진행 단계 — 오래 걸리는 작업이라 뭘 하고 있는지 보여줘야 한다 */
export type SyncStage = 'decoding' | 'analyzing'

export interface AutoSyncOptions {
  onStage?: (stage: SyncStage) => void
  signal?: AbortSignal
}

/**
 * 미디어 파일과 자막을 자동 정렬한다.
 *
 * 디코딩은 `AudioContext`가 필요해 메인 스레드에서, 무거운 신호 처리는
 * 워커에서 한다. 샘플 배열은 전송 가능 객체라 복사 없이 넘어간다.
 */
export async function autoSync(
  file: Blob,
  cues: readonly { start: number; end: number }[],
  options: AutoSyncOptions = {},
): Promise<SyncResult> {
  options.onStage?.('decoding')
  const samples = await decodeToMono(file)

  if (options.signal?.aborted) throw new DOMException('중단됨', 'AbortError')
  options.onStage?.('analyzing')

  return runInWorker(samples, cues, options.signal)
}

function runInWorker(
  samples: Float32Array,
  cues: readonly { start: number; end: number }[],
  signal?: AbortSignal,
): Promise<SyncResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./syncWorker.ts', import.meta.url), { type: 'module' })

    const cleanup = () => {
      worker.terminate()
      signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      cleanup()
      reject(new DOMException('중단됨', 'AbortError'))
    }

    worker.onmessage = (event: MessageEvent<SyncResponse>) => {
      cleanup()
      if (event.data.ok) resolve(event.data.result)
      else reject(new Error(event.data.error))
    }

    worker.onerror = () => {
      cleanup()
      reject(new Error('정렬 작업을 실행하지 못했습니다.'))
    }

    signal?.addEventListener('abort', onAbort)

    const request: SyncRequest = {
      samples,
      sampleRate: ANALYSIS_SAMPLE_RATE,
      cues: cues.map((cue) => ({ start: cue.start, end: cue.end })),
    }

    // 샘플 배열은 수백 MB가 될 수 있으므로 복사하지 않고 소유권을 넘긴다
    worker.postMessage(request, [samples.buffer])
  })
}
