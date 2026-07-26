import { useCallback } from 'react'
import { classifyFiles, mediaKindOf } from '../core/files/match'
import { parseSubtitleFile } from '../core/subtitle/parse'
import { buildSegments } from '../core/subtitle/segment'
import { extractYouTubeId } from '../core/player/YouTubeAdapter'
import { useAppStore } from '../store/useAppStore'

/**
 * 드롭/선택된 파일을 읽어 스토어에 채운다.
 *
 * 자막 파싱이 실패해도 미디어는 이미 로드된 상태로 남긴다 — 자막만 다시
 * 떨어뜨려 고칠 수 있어야 하기 때문이다.
 */
export function useLoadFiles() {
  const setMedia = useAppStore((s) => s.setMedia)
  const setSubtitle = useAppStore((s) => s.setSubtitle)
  const setError = useAppStore((s) => s.setError)
  const setNotice = useAppStore((s) => s.setNotice)

  const loadFiles = useCallback(
    async (files: File[]) => {
      const { media, subtitle, warning } = classifyFiles(files)

      if (warning) setError(warning)
      else setError(null)

      if (media && mediaKindOf(media.name)) {
        setMedia({
          kind: mediaKindOf(media.name)!,
          src: URL.createObjectURL(media),
          name: media.name,
        })
      }

      if (!subtitle) {
        if (media && !warning) setNotice('자막 파일을 함께 올려주세요.')
        return
      }

      try {
        const buffer = await subtitle.arrayBuffer()
        const parsed = parseSubtitleFile(buffer, subtitle.name)
        const segments = buildSegments(parsed.cues)

        setSubtitle(
          { name: subtitle.name, format: parsed.format, encoding: parsed.encoding },
          parsed.cues,
          segments,
        )
        setNotice(
          `${segments.length}개 문장 · ${parsed.format.toUpperCase()} · ${parsed.encoding.toUpperCase()}`,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : '자막을 읽지 못했습니다.')
      }
    },
    [setError, setMedia, setNotice, setSubtitle],
  )

  const loadYouTube = useCallback(
    (url: string) => {
      const id = extractYouTubeId(url)
      if (!id) {
        setError('YouTube 주소를 인식하지 못했습니다.')
        return false
      }

      setMedia({ kind: 'youtube', src: id, name: url })
      setNotice('자막 파일(srt/vtt)을 올리면 문장 목록이 만들어집니다.')
      return true
    },
    [setError, setMedia, setNotice],
  )

  return { loadFiles, loadYouTube }
}
