import { useCallback, useRef, useState } from 'react'
import { autoSync, type SyncStage } from '../core/sync/autoSync'
import { isLargeFile } from '../core/sync/audioSource'
import { useAppStore } from '../store/useAppStore'

/** 이 아래로는 자동 맞춤 결과를 믿지 않고 사용자에게 실패를 알린다 */
const MIN_CONFIDENCE = 0.35

export interface AutoSyncState {
  running: boolean
  stage: SyncStage | null
}

const STAGE_LABEL: Record<SyncStage, string> = {
  decoding: '오디오 읽는 중',
  analyzing: '음성 구간 분석 중',
}

export function stageLabel(stage: SyncStage | null): string {
  return stage ? STAGE_LABEL[stage] : ''
}

/**
 * 자동 싱크 맞춤 실행부.
 *
 * 원본 파일은 스토어에 두지 않고 object URL을 다시 fetch해서 되찾는다.
 * 수백 MB짜리 File을 상태로 들고 다니지 않아도 되고, URL 수명과 정확히 같이 간다.
 */
export function useAutoSync() {
  const [state, setState] = useState<AutoSyncState>({ running: false, stage: null })
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState({ running: false, stage: null })
  }, [])

  const run = useCallback(async () => {
    const store = useAppStore.getState()
    const { media, cues, sync } = store

    if (!media || cues.length === 0) return
    if (media.kind === 'youtube') {
      store.setError('YouTube는 오디오에 접근할 수 없어 자동 맞춤을 쓸 수 없습니다. 탭 맞추기를 써 주세요.')
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setState({ running: true, stage: 'decoding' })
    store.setError(null)

    try {
      const file = await fetch(media.src).then((r) => r.blob())

      if (isLargeFile(file)) {
        store.setNotice('파일이 커서 오디오를 읽는 데 시간이 걸립니다.')
      }

      const result = await autoSync(file, cues, {
        signal: controller.signal,
        onStage: (stage) => setState({ running: true, stage }),
      })

      if (controller.signal.aborted) return

      if (result.confidence < MIN_CONFIDENCE) {
        store.setError(
          '자동으로 맞추지 못했습니다. 자막이 이 영상의 것이 아니거나 대사가 적은 구간일 수 있습니다. 탭 맞추기를 써 주세요.',
        )
        return
      }

      store.applySync(result)

      const shift = result.offsetSec - sync.offsetSec
      const drift = result.driftDetected ? ` · 재생속도 차이 보정 ${(result.scale * 100 - 100).toFixed(1)}%` : ''
      store.setNotice(
        `자동 맞춤 완료 — ${shift >= 0 ? '+' : ''}${shift.toFixed(2)}초 이동${drift} (신뢰도 ${Math.round(result.confidence * 100)}%)`,
      )
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      store.setError(err instanceof Error ? err.message : '자동 맞춤에 실패했습니다.')
    } finally {
      abortRef.current = null
      setState({ running: false, stage: null })
    }
  }, [])

  return { ...state, run, cancel }
}
