import Dexie, { type Table } from 'dexie'
import type { Cue, Segment } from '../subtitle/types'
import type { StoredLoopSettings } from './serialize'

/**
 * 학습 기록 저장소.
 *
 * 채점 결과는 저장하지 않는다. 입력 문자열과 "채점했는지" 여부만 남기고
 * 불러올 때 다시 채점한다. 채점은 순수 함수라 결과가 동일하고, 채점 로직을
 * 고쳐도 기록이 낡지 않으며, 저장 용량도 훨씬 작다.
 */

export interface SessionRow {
  /** 미디어 + 자막 조합 키 */
  key: string
  mediaKey: string
  mediaName: string
  mediaKind: 'video' | 'audio' | 'youtube'
  subtitleName: string
  subtitleFormat: string
  subtitleEncoding: string
  updatedAt: number

  currentTime: number
  activeIndex: number
  /** 자막 시간축 보정. scale은 나중에 추가돼서 옛 기록에는 없을 수 있다 */
  offsetSec: number
  scale?: number

  /** 원본 큐 — 자막 파일 없이 영상만 다시 열어도 복원된다 */
  cues: Cue[]
  /** 수동 병합/분할이 반영된 문장 목록 */
  segments: Segment[]

  /** 문장별 받아쓰기 입력 (키는 segmentKey) */
  inputs: Record<string, string>
  /** 실제로 채점까지 마친 문장들 */
  graded: string[]
}

export interface SettingsRow {
  id: 'global'
  loopSettings: StoredLoopSettings
  hideSubtitles: boolean
  autoAdvance: boolean
}

class LangPlayerDatabase extends Dexie {
  sessions!: Table<SessionRow, string>
  settings!: Table<SettingsRow, string>

  constructor() {
    super('langplayer')
    this.version(1).stores({
      sessions: 'key, mediaKey, updatedAt',
      settings: 'id',
    })
  }
}

export const db = new LangPlayerDatabase()

/**
 * 저장소 접근 실패가 학습을 막아서는 안 된다.
 * 시크릿 모드나 용량 초과에서는 조용히 메모리 전용으로 동작한다.
 */
async function safely<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation()
  } catch (err) {
    console.warn('[LangPlayer] 저장소 접근 실패:', err)
    return fallback
  }
}

export function loadSession(key: string): Promise<SessionRow | undefined> {
  return safely(() => db.sessions.get(key), undefined)
}

export function saveSession(row: SessionRow): Promise<unknown> {
  return safely(() => db.sessions.put(row), undefined)
}

export function deleteSession(key: string): Promise<unknown> {
  return safely(() => db.sessions.delete(key), undefined)
}

export function countSessions(): Promise<number> {
  return safely(() => db.sessions.count(), 0)
}

export function loadSettings(): Promise<SettingsRow | undefined> {
  return safely(() => db.settings.get('global'), undefined)
}

export function saveSettings(row: SettingsRow): Promise<unknown> {
  return safely(() => db.settings.put(row), undefined)
}

export function clearAllSessions(): Promise<unknown> {
  return safely(() => db.sessions.clear(), undefined)
}
