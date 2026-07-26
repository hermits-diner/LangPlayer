import type { LoopSettings } from '../loop/LoopController'
import { DEFAULT_LOOP_SETTINGS } from '../loop/LoopController'

/**
 * 저장 계층의 순수 변환 함수들.
 *
 * IndexedDB에 넣기 전에 값이 왕복 가능한 형태인지 여기서 보장한다.
 * DB 접근이 없으므로 그대로 단위 테스트할 수 있다.
 */

/** 무한 반복을 나타내는 저장용 값. Infinity는 직렬화 경로마다 취급이 달라 숫자로 못 박는다 */
const INFINITE_SENTINEL = -1

export interface StoredLoopSettings {
  repeatCount: number
  gapMs: number
  padLeadMs: number
  padTailMs: number
  rate: number
}

export function serializeLoopSettings(settings: LoopSettings): StoredLoopSettings {
  return {
    ...settings,
    repeatCount: Number.isFinite(settings.repeatCount) ? settings.repeatCount : INFINITE_SENTINEL,
  }
}

export function deserializeLoopSettings(stored: Partial<StoredLoopSettings> | undefined): LoopSettings {
  if (!stored) return DEFAULT_LOOP_SETTINGS

  const merged = { ...DEFAULT_LOOP_SETTINGS, ...stored }
  return {
    ...merged,
    repeatCount:
      stored.repeatCount === INFINITE_SENTINEL
        ? Infinity
        : sanePositive(stored.repeatCount, DEFAULT_LOOP_SETTINGS.repeatCount),
    gapMs: saneRange(merged.gapMs, 0, 10_000, DEFAULT_LOOP_SETTINGS.gapMs),
    padLeadMs: saneRange(merged.padLeadMs, 0, 3_000, DEFAULT_LOOP_SETTINGS.padLeadMs),
    padTailMs: saneRange(merged.padTailMs, 0, 3_000, DEFAULT_LOOP_SETTINGS.padTailMs),
    rate: saneRange(merged.rate, 0.25, 4, DEFAULT_LOOP_SETTINGS.rate),
  }
}

function sanePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : fallback
}

function saneRange(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

/**
 * 로컬 파일의 지문.
 *
 * 브라우저는 파일 경로를 알려주지 않으므로 이름·크기·수정시각으로 식별한다.
 * 같은 영상을 다시 끌어다 놓으면 같은 키가 나와 학습 기록이 이어진다.
 */
export function mediaKeyForFile(file: { name: string; size: number; lastModified: number }): string {
  return `file:${file.name}:${file.size}:${file.lastModified}`
}

export function mediaKeyForYouTube(videoId: string): string {
  return `yt:${videoId}`
}

/**
 * 세션 키 = 미디어 + 자막 조합.
 *
 * 같은 영상에 다른 자막을 물리면 문장 경계도 받아쓰기 기록도 달라지므로
 * 별개의 학습 세션으로 다룬다.
 */
export function sessionKeyOf(mediaKey: string, subtitleName: string | null): string {
  return subtitleName ? `${mediaKey}::${subtitleName}` : mediaKey
}
