import { describe, expect, it } from 'vitest'
import { sniffFormat } from './index'
import { looksLikeTranscript, parseTranscript } from './transcript'

const YOUTUBE_COPY = [
  '0:15',
  'I was sitting with my friend Arthur Kornblum',
  '0:19',
  'It was the Horn and Hardart Cafeteria',
  '0:23',
  'And this beautiful girl walked in',
  '0:30',
  "I'm going to marry her.",
].join('\n')

describe('parseTranscript', () => {
  it('시각 줄과 텍스트 줄이 번갈아 오는 형식을 읽는다', () => {
    const cues = parseTranscript(YOUTUBE_COPY)

    expect(cues).toHaveLength(4)
    expect(cues[0]).toMatchObject({ start: 15, end: 19, text: 'I was sitting with my friend Arthur Kornblum' })
    expect(cues[1]).toMatchObject({ start: 19, end: 23 })
  })

  it('앞 항목의 끝은 다음 항목의 시작이다', () => {
    const cues = parseTranscript(YOUTUBE_COPY)
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i - 1].end).toBe(cues[i].start)
    }
  })

  it('마지막 항목에도 길이를 준다', () => {
    const cues = parseTranscript(YOUTUBE_COPY)
    expect(cues.at(-1)!.end).toBeGreaterThan(cues.at(-1)!.start)
  })

  it('시:분:초 형식을 읽는다', () => {
    const cues = parseTranscript('1:02:03\nlate in the film\n1:02:10\nnext line')
    expect(cues[0].start).toBe(3723)
  })

  it('한 줄에 시각과 텍스트가 함께 와도 읽는다', () => {
    const cues = parseTranscript(['0:05 first line here', '0:09 second line here', '0:14 third'].join('\n'))

    expect(cues).toHaveLength(3)
    expect(cues[0]).toMatchObject({ start: 5, end: 9, text: 'first line here' })
  })

  it('여러 줄로 접힌 문장을 앞 항목에 이어 붙인다', () => {
    const cues = parseTranscript(['0:05', 'first part', 'continued here', '0:12', 'next'].join('\n'))

    expect(cues[0].text).toBe('first part continued here')
  })

  it('빈 줄을 건너뛴다', () => {
    const cues = parseTranscript('0:05\n\nfirst\n\n\n0:09\n\nsecond')
    expect(cues).toHaveLength(2)
  })

  it('소수점 초도 읽는다', () => {
    expect(parseTranscript('0:05.500\nline\n0:09\nnext')[0].start).toBeCloseTo(5.5)
  })

  it('자막이 없으면 예외', () => {
    expect(() => parseTranscript('just some prose\nwith no timestamps')).toThrow()
  })
})

describe('looksLikeTranscript', () => {
  it('유튜브 복사본을 알아본다', () => {
    expect(looksLikeTranscript(YOUTUBE_COPY)).toBe(true)
  })

  it('평범한 글은 아니라고 본다', () => {
    expect(looksLikeTranscript('This is just a paragraph.\nAnd another line.\nAnd more.\nAnd more.')).toBe(false)
  })

  it('너무 짧으면 판단하지 않는다', () => {
    expect(looksLikeTranscript('0:05\nline')).toBe(false)
  })
})

describe('포맷 자동 판별', () => {
  it('유튜브 스크립트를 transcript로 본다', () => {
    expect(sniffFormat(YOUTUBE_COPY)).toBe('transcript')
  })

  it('SRT를 스크립트로 오인하지 않는다', () => {
    const srt = ['1', '00:00:01,000 --> 00:00:04,000', 'Hello there', '', '2', '00:00:05,000 --> 00:00:07,000', 'General Kenobi'].join('\n')
    expect(sniffFormat(srt)).toBe('srt')
  })

  it('VTT를 스크립트로 오인하지 않는다', () => {
    expect(sniffFormat('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi')).toBe('vtt')
  })
})
