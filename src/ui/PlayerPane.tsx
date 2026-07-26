import { useAppStore } from '../store/useAppStore'

interface Props {
  mediaRef: React.RefObject<HTMLMediaElement | null>
  youtubeRef: React.RefObject<HTMLDivElement | null>
}

/**
 * 재생 영역 높이를 화면 비율로 고정한다.
 * 영상 원본 비율에 맡기면 와이드 화면에서 영상이 세로를 다 먹어버려
 * 정작 중요한 반복 컨트롤과 받아쓰기 창이 화면 밖으로 밀린다.
 */
const PLAYER_HEIGHT = 'h-[34vh] min-h-44'

/**
 * 재생 영역.
 *
 * 어댑터 생성은 App이 맡고 여기서는 요소만 그린다. 소스 종류에 따라
 * `<video>` / `<audio>` / YouTube 컨테이너 중 하나가 렌더링된다.
 */
export function PlayerPane({ mediaRef, youtubeRef }: Props) {
  const media = useAppStore((s) => s.media)
  const setError = useAppStore((s) => s.setError)

  if (!media) return null

  if (media.kind === 'youtube') {
    return (
      <div className={`flex w-full items-center justify-center bg-black ${PLAYER_HEIGHT}`}>
        {/* YouTube IFrame API가 이 div를 iframe으로 교체한다 */}
        <div ref={youtubeRef} className="h-full w-full" />
      </div>
    )
  }

  if (media.kind === 'audio') {
    return (
      <div
        className={`flex w-full flex-col items-center justify-center gap-6 bg-gradient-to-b from-ink-800 to-ink-950 px-8 ${PLAYER_HEIGHT}`}
      >
        <div className="text-center">
          <div className="text-5xl">🎧</div>
          <p className="mt-3 max-w-md truncate text-sm text-slate-400">{media.name}</p>
        </div>
        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          src={media.src}
          controls
          className="w-full max-w-lg"
          onError={() => setError('오디오 파일을 재생할 수 없습니다. 형식을 확인해 주세요.')}
        />
      </div>
    )
  }

  return (
    <video
      ref={mediaRef as React.RefObject<HTMLVideoElement>}
      src={media.src}
      controls
      playsInline
      className={`w-full bg-black object-contain ${PLAYER_HEIGHT}`}
      onError={() =>
        setError('이 영상을 브라우저에서 재생할 수 없습니다. MP4(H.264/AAC)로 변환한 뒤 다시 시도해 주세요.')
      }
    />
  )
}
