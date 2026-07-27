import { extensionOf, isOftenUnsupported } from '../core/files/match'
import { useAppStore } from '../store/useAppStore'
import { SubtitleOverlay } from './SubtitleOverlay'

interface Props {
  mediaRef: React.RefObject<HTMLMediaElement | null>
  youtubeRef: React.RefObject<HTMLDivElement | null>
  /** 극장 모드 — 영상이 남은 공간을 다 쓴다 */
  theater: boolean
}

/**
 * 재생 영역.
 *
 * 평소에는 화면 높이의 일정 비율로 묶어 둔다. 영상 원본 비율에 맡기면 와이드
 * 화면에서 영상이 세로를 다 먹어버려 정작 중요한 반복 컨트롤과 받아쓰기 창이
 * 화면 밖으로 밀린다. 받아쓰기를 쉬고 보기만 할 때는 극장 모드로 넓힌다.
 */
const NORMAL_HEIGHT = 'h-[34vh] min-h-44'
const THEATER_HEIGHT = 'min-h-0 flex-1'

export function PlayerPane({ mediaRef, youtubeRef, theater }: Props) {
  const media = useAppStore((s) => s.media)
  const setError = useAppStore((s) => s.setError)

  if (!media) return null

  const height = theater ? THEATER_HEIGHT : NORMAL_HEIGHT

  if (media.kind === 'youtube') {
    return (
      <div className={`relative flex w-full items-center justify-center bg-black ${height}`}>
        {/* YouTube IFrame API가 이 div를 iframe으로 교체한다 */}
        <div ref={youtubeRef} className="h-full w-full" />
        <SubtitleOverlay />
      </div>
    )
  }

  if (media.kind === 'audio') {
    return (
      <div
        className={`relative flex w-full flex-col items-center justify-center gap-7 overflow-hidden px-8 ${height}`}
      >
        {/* 오디오는 볼 것이 없다. 빈 화면을 그냥 두면 죽어 보이므로 은은한 빛을 깐다 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.035),transparent_65%)]"
        />

        <p className="relative max-w-md truncate text-center text-sm tracking-wide text-slate-500">
          {media.name}
        </p>

        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          src={media.src}
          controls
          className="relative w-full max-w-lg"
          onError={() => setError('오디오 파일을 재생할 수 없습니다. 형식을 확인해 주세요.')}
        />

        <SubtitleOverlay />
      </div>
    )
  }

  return (
    // 자막을 영상 위에 얹으려면 기준이 될 상자가 필요하다. 높이는 이 상자가 쥐고
    // 영상은 그 안을 채운다. overflow-hidden은 마지노선이다 — 글자를 아주 크게
    // 키운 채 긴 문장을 만나면 자막이 위로 자라 앱 화면을 침범한다
    <div className={`relative w-full overflow-hidden bg-black ${height}`}>
      <video
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        src={media.src}
        controls
        playsInline
        className="h-full w-full object-contain"
        onError={() =>
          setError(
            isOftenUnsupported(media.name)
              ? `이 영상을 재생하지 못했습니다. ${extensionOf(media.name).toUpperCase()}는 브라우저·OS 코덱에 따라 갈리는 형식입니다. MP4(H.264/AAC)로 변환하면 확실합니다.`
              : '이 영상을 재생하지 못했습니다. 파일이 손상되었거나 지원하지 않는 코덱일 수 있습니다.',
          )
        }
      />

      <SubtitleOverlay />
    </div>
  )
}
