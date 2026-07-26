import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOP_SETTINGS } from '../loop/LoopController'
import {
  deserializeLoopSettings,
  fingerprintCues,
  mediaKeyForFile,
  mediaKeyForYouTube,
  serializeLoopSettings,
  sessionKeyOf,
} from './serialize'

describe('loopSettings 직렬화', () => {
  it('일반 설정을 그대로 왕복시킨다', () => {
    const settings = { repeatCount: 5, gapMs: 2000, padLeadMs: 150, padTailMs: 250, rate: 0.75 }
    expect(deserializeLoopSettings(serializeLoopSettings(settings))).toEqual(settings)
  })

  it('무한 반복이 왕복 후에도 Infinity로 남는다', () => {
    const stored = serializeLoopSettings({ ...DEFAULT_LOOP_SETTINGS, repeatCount: Infinity })

    expect(Number.isFinite(stored.repeatCount)).toBe(true) // 저장은 유한한 숫자로
    expect(deserializeLoopSettings(stored).repeatCount).toBe(Infinity)
  })

  it('저장값이 없으면 기본 설정', () => {
    expect(deserializeLoopSettings(undefined)).toEqual(DEFAULT_LOOP_SETTINGS)
  })

  it('일부 필드만 있어도 나머지는 기본값으로 채운다', () => {
    const result = deserializeLoopSettings({ rate: 0.9 })

    expect(result.rate).toBe(0.9)
    expect(result.repeatCount).toBe(DEFAULT_LOOP_SETTINGS.repeatCount)
    expect(result.padLeadMs).toBe(DEFAULT_LOOP_SETTINGS.padLeadMs)
  })

  it('망가진 값은 안전한 범위로 되돌린다', () => {
    const result = deserializeLoopSettings({
      repeatCount: 0,
      rate: 99,
      gapMs: -500,
      padLeadMs: Number.NaN,
      padTailMs: 999_999,
    })

    expect(result.repeatCount).toBe(DEFAULT_LOOP_SETTINGS.repeatCount)
    expect(result.rate).toBe(4)
    expect(result.gapMs).toBe(0)
    expect(result.padLeadMs).toBe(DEFAULT_LOOP_SETTINGS.padLeadMs)
    expect(result.padTailMs).toBe(3000)
  })
})

describe('키 생성', () => {
  it('같은 파일은 같은 키를 낸다', () => {
    const file = { name: 'movie.mp4', size: 12345, lastModified: 1700000000000 }
    expect(mediaKeyForFile(file)).toBe(mediaKeyForFile({ ...file }))
  })

  it('내용이 바뀐 동명 파일은 다른 키를 낸다', () => {
    const a = mediaKeyForFile({ name: 'movie.mp4', size: 100, lastModified: 1 })
    const b = mediaKeyForFile({ name: 'movie.mp4', size: 200, lastModified: 1 })
    expect(a).not.toBe(b)
  })

  it('YouTube 키는 영상 id로 만든다', () => {
    expect(mediaKeyForYouTube('dQw4w9WgXcQ')).toBe('yt:dQw4w9WgXcQ')
  })

  it('자막이 다르면 별개 세션이 된다', () => {
    const media = 'yt:abc'
    expect(sessionKeyOf(media, 'en.srt')).not.toBe(sessionKeyOf(media, 'ko.srt'))
  })

  it('자막이 없으면 미디어 키를 그대로 쓴다', () => {
    expect(sessionKeyOf('yt:abc', null)).toBe('yt:abc')
  })
})

describe('fingerprintCues', () => {
  const cues = [
    { start: 1, end: 3, text: 'Hello there' },
    { start: 4, end: 6, text: 'General Kenobi' },
  ]

  it('같은 내용이면 같은 지문', () => {
    expect(fingerprintCues(cues)).toBe(fingerprintCues(cues.map((c) => ({ ...c }))))
  })

  it('텍스트가 다르면 지문이 달라진다', () => {
    const changed = [cues[0], { ...cues[1], text: 'Different line' }]
    expect(fingerprintCues(changed)).not.toBe(fingerprintCues(cues))
  })

  it('타이밍이 다르면 지문이 달라진다', () => {
    const shifted = cues.map((c) => ({ ...c, start: c.start + 2, end: c.end + 2 }))
    expect(fingerprintCues(shifted)).not.toBe(fingerprintCues(cues))
  })

  it('큐 개수가 다르면 지문이 달라진다', () => {
    expect(fingerprintCues(cues.slice(0, 1))).not.toBe(fingerprintCues(cues))
  })

  it('빈 자막도 지문을 낸다', () => {
    expect(fingerprintCues([])).toMatch(/^0-/)
  })
})

