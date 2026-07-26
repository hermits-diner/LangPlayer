import type { SyncResult } from './align'
import { ANALYSIS_SAMPLE_RATE, decodeToMono } from './audioSource'
import type { AudioWorkerRequest, AudioWorkerResponse } from './audioWorker'
import type { SyncPiece } from './piecewise'
import { FRAME_SEC } from './vad'

/** 포락선 한 칸이 나타내는 시간 — 파형 좌표 계산에 쓴다 */
export const ENVELOPE_FRAME_SEC = FRAME_SEC

export type AnalysisStage = 'decoding' | 'analyzing'

export interface AnalysisOptions {
  onStage?: (stage: AnalysisStage) => void
  signal?: AbortSignal
}

function runWorker(request: AudioWorkerRequest, transfer: Transferable[], signal?: AbortSignal): Promise<AudioWorkerResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./audioWorker.ts', import.meta.url), { type: 'module' })

    const cleanup = () => {
      worker.terminate()
      signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      cleanup()
      reject(new DOMException('중단됨', 'AbortError'))
    }

    worker.onmessage = (event: MessageEvent<AudioWorkerResponse>) => {
      cleanup()
      if (event.data.ok) resolve(event.data)
      else reject(new Error(event.data.error))
    }

    worker.onerror = () => {
      cleanup()
      reject(new Error('오디오 분석 작업을 실행하지 못했습니다.'))
    }

    signal?.addEventListener('abort', onAbort)
    worker.postMessage(request, transfer)
  })
}

/**
 * 미디어 파일 → 에너지 포락선.
 *
 * 디코딩은 `AudioContext`가 필요해 메인 스레드에서, 포락선 계산은 워커에서.
 * 샘플 배열은 수백 MB가 될 수 있어 소유권을 넘겨 복사를 피한다.
 */
export async function analyzeAudio(file: Blob, options: AnalysisOptions = {}): Promise<Float32Array> {
  options.onStage?.('decoding')
  const samples = await decodeToMono(file)

  if (options.signal?.aborted) throw new DOMException('중단됨', 'AbortError')
  options.onStage?.('analyzing')

  const response = await runWorker(
    { type: 'envelope', samples, sampleRate: ANALYSIS_SAMPLE_RATE },
    [samples.buffer],
    options.signal,
  )

  if (response.ok && response.type === 'envelope') return response.envelope
  throw new Error('포락선을 만들지 못했습니다.')
}

export interface AlignmentReport {
  /** 자막 전체에 거는 배율 + 이동 */
  result: SyncResult
  /** 전체 정렬 뒤에도 남는 구간별 어긋남 */
  pieces: SyncPiece[]
  /** 서로 다른 이동값 사이의 경계 수 */
  splitCount: number
}

/**
 * 이미 만들어 둔 포락선으로 자막을 정렬한다.
 *
 * 포락선은 파형 그리기에도 쓰이므로 소유권을 넘기지 않고 복사해서 보낸다.
 * 2시간 영상도 3 MB 남짓이라 복사 비용이 문제되지 않는다.
 */
export async function alignWithEnvelope(
  envelope: Float32Array,
  cues: readonly { start: number; end: number }[],
  signal?: AbortSignal,
): Promise<AlignmentReport> {
  const response = await runWorker(
    { type: 'align', envelope, cues: cues.map((c) => ({ start: c.start, end: c.end })) },
    [],
    signal,
  )

  if (response.ok && response.type === 'align') {
    return { result: response.result, pieces: response.pieces, splitCount: response.splitCount }
  }
  throw new Error('자막을 정렬하지 못했습니다.')
}
