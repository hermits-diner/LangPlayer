/**
 * 드롭된 파일들을 미디어/자막으로 분류하고 서로 짝지어 준다.
 *
 * 사용자는 영상과 자막을 함께 던지는 게 자연스럽다. 파일 선택 대화상자를
 * 두 번 띄우게 만들면 그때부터 쓰기 싫어진다.
 */

export type MediaKind = 'video' | 'audio'

const VIDEO_EXT = ['mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'ts', 'mpg', 'mpeg']
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma']
const SUBTITLE_EXT = ['srt', 'vtt', 'smi', 'sami', 'ass', 'ssa']

/** 브라우저가 디코딩할 수 없는 컨테이너/코덱 — 미리 걸러 안내한다 */
const UNSUPPORTED_EXT = ['mkv', 'avi', 'wmv', 'flv', 'ts', 'mpg', 'mpeg', 'wma']

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

export function baseNameOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return (dot === -1 ? filename : filename.slice(0, dot)).toLowerCase()
}

export function isSubtitleFile(filename: string): boolean {
  return SUBTITLE_EXT.includes(extensionOf(filename))
}

export function mediaKindOf(filename: string): MediaKind | null {
  const ext = extensionOf(filename)
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  return null
}

export function isPlayableInBrowser(filename: string): boolean {
  return !UNSUPPORTED_EXT.includes(extensionOf(filename))
}

export interface ClassifiedFiles {
  media: File | null
  subtitle: File | null
  /** 브라우저가 재생할 수 없는 파일을 골랐을 때의 안내 */
  warning: string | null
}

/**
 * 자막 짝짓기 규칙:
 * 1. 미디어와 파일명(확장자 제외)이 같은 자막 우선 — `movie.mp4` + `movie.en.srt`도 접두 일치로 잡는다
 * 2. 없으면 자막이 하나뿐일 때 그것을 쓴다
 */
export function classifyFiles(files: File[]): ClassifiedFiles {
  const mediaFiles = files.filter((f) => mediaKindOf(f.name) !== null)
  const subtitleFiles = files.filter((f) => isSubtitleFile(f.name))

  const media = mediaFiles[0] ?? null
  const subtitle = media ? pickSubtitleFor(media, subtitleFiles) : (subtitleFiles[0] ?? null)

  let warning: string | null = null
  if (media && !isPlayableInBrowser(media.name)) {
    warning = `${extensionOf(media.name).toUpperCase()} 형식은 브라우저에서 재생할 수 없습니다. MP4(H.264)로 변환한 뒤 사용해 주세요.`
  } else if (!media && mediaFiles.length === 0 && subtitleFiles.length === 0 && files.length > 0) {
    warning = '인식할 수 있는 미디어나 자막 파일이 없습니다.'
  }

  return { media, subtitle, warning }
}

function pickSubtitleFor(media: File, subtitles: File[]): File | null {
  if (subtitles.length === 0) return null

  const mediaBase = baseNameOf(media.name)
  const exact = subtitles.find((s) => baseNameOf(s.name) === mediaBase)
  if (exact) return exact

  // `movie.mp4` ↔ `movie.en.srt` 처럼 언어 코드가 붙은 경우
  const prefixed = subtitles.find((s) => baseNameOf(s.name).startsWith(`${mediaBase}.`))
  if (prefixed) return prefixed

  return subtitles.length === 1 ? subtitles[0] : null
}
