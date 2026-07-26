import { decodeSubtitle, normalizeNewlines, type DetectedEncoding } from '../decode'
import type { Cue, SubtitleFormat } from '../types'
import { SubtitleParseError } from '../types'
import { parseSmi } from './smi'
import { parseSrt } from './srt'
import { looksLikeTranscript, parseTranscript } from './transcript'
import { parseVtt } from './vtt'

export interface ParsedSubtitle {
  cues: Cue[]
  format: SubtitleFormat
  encoding: DetectedEncoding
}

const BY_EXTENSION: Record<string, SubtitleFormat> = {
  srt: 'srt',
  vtt: 'vtt',
  webvtt: 'vtt',
  smi: 'smi',
  sami: 'smi',
}

export function formatFromFilename(filename: string): SubtitleFormat | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return BY_EXTENSION[ext] ?? null
}

/** 확장자가 틀렸거나 없을 때 내용으로 판별 */
export function sniffFormat(text: string): SubtitleFormat {
  const head = text.slice(0, 2000)
  if (/^﻿?WEBVTT/.test(head)) return 'vtt'
  if (/<sami|<sync\s/i.test(head)) return 'smi'
  // `-->`가 없는데 시각 줄이 반복되면 유튜브에서 복사한 스크립트다
  if (!head.includes('-->') && looksLikeTranscript(text)) return 'transcript'
  return 'srt'
}

const PARSERS: Record<SubtitleFormat, (text: string) => Cue[]> = {
  srt: parseSrt,
  vtt: parseVtt,
  smi: parseSmi,
  transcript: parseTranscript,
}

export function parseSubtitleText(text: string, format: SubtitleFormat): Cue[] {
  return PARSERS[format](normalizeNewlines(text))
}

/**
 * 자막 파일 바이트 → 큐 목록.
 *
 * 확장자를 1차 근거로 삼되, 파싱에 실패하면 내용 기반으로 다시 판별해
 * 한 번 더 시도한다 (확장자만 바꿔 저장한 파일이 흔하다).
 */
export function parseSubtitleFile(buffer: ArrayBuffer, filename: string): ParsedSubtitle {
  const { text, encoding } = decodeSubtitle(buffer)
  const normalized = normalizeNewlines(text)

  // 내용이 확장자보다 믿을 만하다. SRT 파서는 VTT도 그럭저럭 삼켜버리기 때문에
  // 확장자를 먼저 시도하면 잘못된 포맷으로 성공해버린다.
  const sniffed = sniffFormat(normalized)
  const declared = formatFromFilename(filename)
  const candidates: SubtitleFormat[] = declared && declared !== sniffed ? [sniffed, declared] : [sniffed]

  let lastError: unknown
  for (const format of candidates) {
    try {
      return { cues: PARSERS[format](normalized), format, encoding }
    } catch (err) {
      lastError = err
    }
  }

  throw lastError instanceof SubtitleParseError
    ? lastError
    : new SubtitleParseError(`자막을 해석할 수 없습니다: ${filename}`, candidates[0])
}
