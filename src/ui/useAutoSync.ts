import { useCallback, useRef, useState } from 'react'
import { alignWithEnvelope } from '../core/sync/audioAnalysis'
import { useAppStore } from '../store/useAppStore'

/** 이 아래로는 자동 맞춤 결과를 믿지 않고 사용자에게 실패를 알린다 */
const MIN_CONFIDENCE = 0.35

/**
 * 자동 싱크 맞춤 실행부.
 *
 * 무거운 디코딩은 파형을 만들면서 이미 끝나 있으므로, 여기서는 그 포락선을
 * 정렬에 재사용하기만 한다. 버튼을 누르는 순간 거의 즉시 결과가 나온다.
 */
export function useAutoSync() {
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setRunning(false)
  }, [])

  const run = useCallback(async () => {
    const store = useAppStore.getState()
    const { waveform, waveformState, cues, sync, media } = store

    if (cues.length === 0) return

    if (media?.kind === 'youtube') {
      store.setError('YouTube는 오디오에 접근할 수 없어 자동 맞춤을 쓸 수 없습니다. 탭 맞추기를 써 주세요.')
      return
    }
    if (waveformState === 'loading') {
      store.setNotice('오디오를 아직 읽는 중입니다. 잠시 후 다시 눌러 주세요.')
      return
    }
    if (!waveform) {
      store.setError('오디오를 읽지 못해 자동 맞춤을 쓸 수 없습니다. 탭 맞추기를 써 주세요.')
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    store.setError(null)

    try {
      const { result, pieces, splitCount } = await alignWithEnvelope(waveform, cues, controller.signal)
      if (controller.signal.aborted) return

      if (result.confidence < MIN_CONFIDENCE) {
        store.setError(
          '자동으로 맞추지 못했습니다. 자막이 이 영상의 것이 아니거나 대사가 적은 구간일 수 있습니다. 탭 맞추기를 써 주세요.',
        )
        return
      }

      store.applySync(result)

      // 전체 보정으로 안 잡히는 구간별 어긋남을 이어서 입힌다.
      // 광고가 빠진 방송본처럼 중간부터 이동값이 달라지는 파일이 여기서 잡힌다.
      const movedByPiece = useAppStore.getState().applySyncPieces(pieces)

      const shift = result.offsetSec - sync.offsetSec
      const drift = result.driftDetected ? ` · 재생속도 차이 보정 ${(result.scale * 100 - 100).toFixed(1)}%` : ''
      const split =
        splitCount > 0 && movedByPiece > 0 ? ` · ${splitCount + 1}개 구간을 따로 맞춤` : ''
      store.setNotice(
        `자동 맞춤 완료 — ${shift >= 0 ? '+' : ''}${shift.toFixed(2)}초 이동${drift}${split} (신뢰도 ${Math.round(result.confidence * 100)}%)`,
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      store.setError(err instanceof Error ? err.message : '자동 맞춤에 실패했습니다.')
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }, [])

  return { running, run, cancel }
}
