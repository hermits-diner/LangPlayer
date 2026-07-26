import { describe, expect, it } from 'vitest'
import { decodeSubtitle } from './decode'
import { parseAss } from './parse/ass'
import { parseSmi } from './parse/smi'
import { parseSrt } from './parse/srt'
import { parseVtt } from './parse/vtt'
import { parseSubtitleFile, sniffFormat } from './parse'
import { buildSegments, findSegmentAt, mergeWithNext, splitSegment } from './segment'

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer
}

function utf8(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

describe('decodeSubtitle', () => {
  it('UTF-8 BOM을 벗겨낸다', () => {
    const result = decodeSubtitle(bytes(0xef, 0xbb, 0xbf, 0x41, 0x42))
    expect(result.text).toBe('AB')
    expect(result.encoding).toBe('utf-8')
  })

  it('BOM 없는 UTF-8 한글을 그대로 읽는다', () => {
    const result = decodeSubtitle(utf8('안녕하세요'))
    expect(result.text).toBe('안녕하세요')
    expect(result.encoding).toBe('utf-8')
  })

  it('EUC-KR 바이트를 UTF-8로 오독하지 않는다', () => {
    // '안녕' = BE C8 B3 E7 (EUC-KR). UTF-8로는 해석 불가능한 시퀀스다.
    const result = decodeSubtitle(bytes(0xbe, 0xc8, 0xb3, 0xe7))
    expect(result.encoding).toBe('euc-kr')
    expect(result.text).toBe('안녕')
  })
})

describe('parseSrt', () => {
  it('표준 SRT를 파싱한다', () => {
    const cues = parseSrt(
      ['1', '00:00:01,000 --> 00:00:04,500', 'Hello there', '', '2', '00:00:05,000 --> 00:00:07,000', 'General Kenobi'].join('\n'),
    )

    expect(cues).toHaveLength(2)
    expect(cues[0]).toMatchObject({ start: 1, end: 4.5, text: 'Hello there' })
    expect(cues[1].text).toBe('General Kenobi')
  })

  it('인덱스 줄이 없고 마침표를 쓰는 변종도 읽는다', () => {
    const cues = parseSrt('00:00:02.250 --> 00:00:03.000\nNo index here')
    expect(cues[0]).toMatchObject({ start: 2.25, end: 3, text: 'No index here' })
  })

  it('타임코드 뒤 좌표 정보를 무시한다', () => {
    const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,000  X1:0 X2:100 Y1:0 Y2:50\nPositioned')
    expect(cues[0].end).toBe(2)
    expect(cues[0].text).toBe('Positioned')
  })

  it('스타일 태그를 제거하고 여러 줄을 한 줄로 합친다', () => {
    const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,000\n<i>first</i>\n<font color="#fff">second</font>')
    expect(cues[0].text).toBe('first second')
  })

  it('<br>로 이어진 줄이 들러붙지 않는다', () => {
    const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nfirst<br>second')
    expect(cues[0].text).toBe('first second')
  })

  it('빈 큐는 버린다', () => {
    const cues = parseSrt(['1', '00:00:01,000 --> 00:00:02,000', '', '2', '00:00:03,000 --> 00:00:04,000', 'real'].join('\n'))
    expect(cues).toHaveLength(1)
    expect(cues[0].text).toBe('real')
  })

  it('큐가 하나도 없으면 예외', () => {
    expect(() => parseSrt('garbage without timings')).toThrow()
  })
})

describe('parseVtt', () => {
  it('헤더와 NOTE 블록을 건너뛴다', () => {
    const cues = parseVtt(
      ['WEBVTT', '', 'NOTE this is a comment', '', 'cue-1', '00:00:01.000 --> 00:00:02.000 line:0 position:20%', 'Hi'].join('\n'),
    )

    expect(cues).toHaveLength(1)
    expect(cues[0]).toMatchObject({ start: 1, end: 2, text: 'Hi' })
  })

  it('시간 단위가 생략된 MM:SS.mmm 형식을 읽는다', () => {
    const cues = parseVtt('WEBVTT\n\n01:30.500 --> 01:32.000\nShort form')
    expect(cues[0].start).toBe(90.5)
  })

  it('화자 태그와 인라인 타임스탬프를 제거한다', () => {
    const cues = parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Roger>Hello <00:00:01.500>world')
    expect(cues[0].text).toBe('Hello world')
  })
})

describe('parseSmi', () => {
  const sample = [
    '<SAMI>',
    '<BODY>',
    '<SYNC Start=1000><P Class=KRCC>첫 번째 문장',
    '<SYNC Start=3000><P Class=KRCC>&nbsp;',
    '<SYNC Start=5000><P Class=KRCC>두 번째 문장',
    '</BODY>',
    '</SAMI>',
  ].join('\n')

  it('SYNC 시작 시각과 다음 SYNC를 종료로 삼는다', () => {
    const cues = parseSmi(sample)

    expect(cues).toHaveLength(2)
    expect(cues[0]).toMatchObject({ start: 1, end: 3, text: '첫 번째 문장' })
    expect(cues[1].start).toBe(5)
  })

  it('빈 SYNC(&nbsp;)는 큐로 만들지 않는다', () => {
    const cues = parseSmi(sample)
    expect(cues.some((c) => c.text.trim() === '')).toBe(false)
  })

  it('이중언어 SMI에서 대사가 많은 Class를 고른다', () => {
    const cues = parseSmi(
      [
        '<SYNC Start=1000><P Class=ENCC>Hello<P Class=KRCC>안녕',
        '<SYNC Start=2000><P Class=ENCC>World<P Class=KRCC>세상',
        '<SYNC Start=3000><P Class=ENCC>Again',
        '<SYNC Start=4000><P Class=ENCC>&nbsp;',
      ].join('\n'),
    )

    // ENCC가 3개, KRCC가 2개 → ENCC 채택
    expect(cues.map((c) => c.text)).toEqual(['Hello', 'World', 'Again'])
  })
})

describe('parseAss', () => {
  it('Format 줄을 읽어 필드 위치를 잡는다', () => {
    const cues = parseAss(
      [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello world',
      ].join('\n'),
    )

    expect(cues[0]).toMatchObject({ start: 1, end: 3.5, text: 'Hello world' })
  })

  it('대사 안의 콤마를 보존한다', () => {
    const cues = parseAss(
      [
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Wait, what?',
      ].join('\n'),
    )

    expect(cues[0].text).toBe('Wait, what?')
  })

  it('오버라이드 블록과 \\N 줄바꿈을 정리한다', () => {
    const cues = parseAss(
      [
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an8}top\\Nline',
      ].join('\n'),
    )

    expect(cues[0].text).toBe('top line')
  })
})

describe('parseSubtitleFile', () => {
  it('확장자가 틀려도 내용으로 판별해 파싱한다', () => {
    const vttText = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nMislabeled'
    const result = parseSubtitleFile(utf8(vttText), 'movie.srt')

    expect(result.format).toBe('vtt')
    expect(result.cues[0].text).toBe('Mislabeled')
  })

  it('sniffFormat이 각 포맷을 구분한다', () => {
    expect(sniffFormat('WEBVTT\n\n...')).toBe('vtt')
    expect(sniffFormat('<SAMI><BODY><SYNC Start=0>')).toBe('smi')
    expect(sniffFormat('[Script Info]\nTitle: x')).toBe('ass')
    expect(sniffFormat('1\n00:00:01,000 --> 00:00:02,000\nhi')).toBe('srt')
  })
})

describe('buildSegments', () => {
  const cue = (id: string, start: number, end: number, text: string) => ({ id, start, end, text })

  it('한 문장이 쪼개진 큐 3개를 하나로 합친다', () => {
    const segments = buildSegments([
      cue('a', 0, 1.5, 'I went to the store'),
      cue('b', 1.5, 3, 'because we had run out'),
      cue('c', 3, 4.5, 'of milk.'),
    ])

    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('I went to the store because we had run out of milk.')
    expect(segments[0]).toMatchObject({ start: 0, end: 4.5 })
    expect(segments[0].cueIds).toEqual(['a', 'b', 'c'])
  })

  it('문장이 끝나면 다음 큐와 합치지 않는다', () => {
    const segments = buildSegments([cue('a', 0, 2, 'First sentence.'), cue('b', 2, 4, 'Second sentence.')])
    expect(segments).toHaveLength(2)
  })

  it('대사 뒤 인용구를 한 문장으로 붙인다', () => {
    const segments = buildSegments([cue('a', 0, 2, '"Go away!"'), cue('b', 2, 4, 'she said quietly.')])

    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('"Go away!" she said quietly.')
  })

  it('약어 마침표에서는 끊지 않는다', () => {
    const segments = buildSegments([cue('a', 0, 2, 'I met Mr.'), cue('b', 2, 4, 'Smith yesterday.')])

    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('I met Mr. Smith yesterday.')
  })

  it('큐 간격이 maxGapSec를 넘으면 자른다', () => {
    const segments = buildSegments([cue('a', 0, 2, 'unfinished thought'), cue('b', 10, 12, 'new context')], {
      maxGapSec: 2,
    })

    expect(segments).toHaveLength(2)
  })

  it('maxDurationSec를 넘으면 문장이 안 끝나도 자른다', () => {
    const segments = buildSegments(
      [cue('a', 0, 10, 'a very long run on clause'), cue('b', 10, 20, 'that keeps going and going')],
      { maxDurationSec: 15 },
    )

    expect(segments).toHaveLength(2)
  })

  it('문장부호 없는 자막은 충분히 길어진 뒤 짧은 쉼에서 끊는다', () => {
    const segments = buildSegments(
      [
        cue('a', 0, 4, 'so anyway i was walking down the street'),
        cue('b', 4, 8.5, 'and then i saw this really strange thing'),
        cue('c', 9.2, 12, 'it was completely unexpected'),
      ],
      { softDurationSec: 8, softGapSec: 0.4 },
    )

    // a+b는 붙고(간격 0), c 앞의 0.7초 쉼에서 끊긴다
    expect(segments).toHaveLength(2)
    expect(segments[0].cueIds).toEqual(['a', 'b'])
    expect(segments[1].cueIds).toEqual(['c'])
  })

  it('세그먼트 id를 순서대로 매긴다', () => {
    const segments = buildSegments([cue('a', 0, 1, 'One.'), cue('b', 1, 2, 'Two.')])
    expect(segments.map((s) => s.id)).toEqual(['seg-0', 'seg-1'])
  })
})

describe('수동 교정', () => {
  const cues = [
    { id: 'a', start: 0, end: 1, text: 'One.' },
    { id: 'b', start: 1, end: 2, text: 'Two.' },
    { id: 'c', start: 2, end: 3, text: 'Three.' },
  ]

  it('mergeWithNext가 두 세그먼트를 합치고 id를 다시 매긴다', () => {
    const merged = mergeWithNext(buildSegments(cues), 0)

    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ id: 'seg-0', start: 0, end: 2, text: 'One. Two.' })
    expect(merged[1].id).toBe('seg-1')
  })

  it('splitSegment가 원래 큐 단위로 되돌린다', () => {
    const merged = mergeWithNext(buildSegments(cues), 0)
    const split = splitSegment(merged, 0, cues)

    expect(split).toHaveLength(3)
    expect(split.map((s) => s.text)).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('큐가 하나뿐인 세그먼트는 분할하지 않는다', () => {
    const segments = buildSegments(cues)
    expect(splitSegment(segments, 0, cues)).toBe(segments)
  })
})

describe('findSegmentAt', () => {
  const segments = buildSegments([
    { id: 'a', start: 0, end: 2, text: 'One.' },
    { id: 'b', start: 5, end: 7, text: 'Two.' },
  ])

  it('구간 안이면 해당 index', () => {
    expect(findSegmentAt(segments, 1)).toBe(0)
    expect(findSegmentAt(segments, 6)).toBe(1)
  })

  it('구간 사이 공백이면 -1', () => {
    expect(findSegmentAt(segments, 3)).toBe(-1)
  })
})
