import { useEffect } from 'react'
import { analyzeAudio } from '../core/sync/audioAnalysis'
import { useAppStore } from '../store/useAppStore'

/**
 * 미디어가 바뀌면 파형(에너지 포락선)을 만들어 스토어에 올린다.
 *
 * 이 포락선은 음파창 렌더링과 자막 자동 맞춤이 함께 쓴다. 디코딩이 가장
 * 비싼 단계라 한 번만 하고 나눠 쓰는 게 맞다.
 *
 * 원본 파일은 스토어에 두지 않고 object URL을 다시 fetch해서 되찾는다.
 * 수백 MB짜리 File을 상태로 들고 다니지 않아도 되고 URL 수명과 정확히 같이 간다.
 */
export function useWaveform() {
  const media = useAppStore((s) => s.media)

  useEffect(() => {
    if (!media) return

    // YouTube는 iframe 안의 오디오에 접근할 수 없다
    if (media.kind === 'youtube') {
      useAppStore.getState().setWaveform(null, 'unavailable')
      return
    }

    const controller = new AbortController()
    useAppStore.getState().setWaveform(null, 'loading')

    void (async () => {
      try {
        const file = await fetch(media.src).then((r) => r.blob())
        const envelope = await analyzeAudio(file, { signal: controller.signal })
        if (controller.signal.aborted) return
        useAppStore.getState().setWaveform(envelope, 'ready')
      } catch (err) {
        if (controller.signal.aborted) return
        // 파형이 없어도 학습은 그대로 되므로 조용히 접는다
        console.warn('[LangPlayer] 파형을 만들지 못했습니다:', err)
        useAppStore.getState().setWaveform(null, 'unavailable')
      }
    })()

    return () => controller.abort()
  }, [media])
}
