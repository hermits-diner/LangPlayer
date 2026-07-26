import { describe, expect, it } from 'vitest'
import { classifyFiles, isPlayableInBrowser, mediaKindOf } from './match'

const file = (name: string) => new File([''], name)

describe('mediaKindOf', () => {
  it('영상과 오디오를 구분한다', () => {
    expect(mediaKindOf('lecture.mp4')).toBe('video')
    expect(mediaKindOf('podcast.mp3')).toBe('audio')
    expect(mediaKindOf('notes.txt')).toBeNull()
  })
})

describe('isPlayableInBrowser', () => {
  it('MKV·AVI는 재생 불가로 표시한다', () => {
    expect(isPlayableInBrowser('movie.mkv')).toBe(false)
    expect(isPlayableInBrowser('movie.avi')).toBe(false)
    expect(isPlayableInBrowser('movie.mp4')).toBe(true)
  })
})

describe('classifyFiles', () => {
  it('같은 이름의 미디어와 자막을 짝짓는다', () => {
    const result = classifyFiles([file('friends-s01e01.srt'), file('friends-s01e01.mp4')])

    expect(result.media?.name).toBe('friends-s01e01.mp4')
    expect(result.subtitle?.name).toBe('friends-s01e01.srt')
    expect(result.warning).toBeNull()
  })

  it('언어 코드가 붙은 자막도 짝짓는다', () => {
    const result = classifyFiles([file('movie.mp4'), file('movie.en.srt')])
    expect(result.subtitle?.name).toBe('movie.en.srt')
  })

  it('이름이 달라도 자막이 하나뿐이면 연결한다', () => {
    const result = classifyFiles([file('video.mp4'), file('완전히다른이름.smi')])
    expect(result.subtitle?.name).toBe('완전히다른이름.smi')
  })

  it('이름이 다르고 자막이 여러 개면 자동 연결하지 않는다', () => {
    const result = classifyFiles([file('video.mp4'), file('a.srt'), file('b.srt')])
    expect(result.subtitle).toBeNull()
  })

  it('오디오만 있어도 처리한다', () => {
    const result = classifyFiles([file('ep12.mp3'), file('ep12.vtt')])

    expect(result.media?.name).toBe('ep12.mp3')
    expect(result.subtitle?.name).toBe('ep12.vtt')
  })

  it('재생 불가 형식이면 경고를 낸다', () => {
    const result = classifyFiles([file('movie.mkv')])
    expect(result.warning).toContain('MKV')
  })

  it('자막만 떨어뜨려도 받는다 (영상 교체용)', () => {
    const result = classifyFiles([file('only.srt')])
    expect(result.subtitle?.name).toBe('only.srt')
    expect(result.media).toBeNull()
  })

  it('알 수 없는 파일만 있으면 경고', () => {
    const result = classifyFiles([file('readme.txt')])
    expect(result.warning).toContain('인식할 수 있는')
  })
})
