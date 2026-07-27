import Dexie, { type Table } from 'dexie'
import type { Cue, Segment } from '../subtitle/types'
import type { StoredLoopSettings } from './serialize'

/**
 * 학습 기록 저장소.
 *
 * 미디어는 저장하지 않는다. 자막·문장 경계·받아쓴 글만 남기므로 영화 한 편을
 * 전부 학습해도 1 MB 남짓이다.
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
  /**
   * 자막 내용의 지문. 세션 키는 파일 이름으로만 만들어지므로, 같은 이름의
   * 다른 자막을 올렸을 때 옛 기록을 되살리지 않으려면 내용까지 대조해야 한다.
   * 이 필드가 생기기 전 기록에는 없다.
   */
  cuesFingerprint?: string
  /** 수동 병합/분할이 반영된 문장 목록 */
  segments: Segment[]

  /** 문장별 받아쓰기 입력 (키는 segmentKey) */
  inputs: Record<string, string>
}

export interface SettingsRow {
  id: 'global'
  loopSettings: StoredLoopSettings
  hideSubtitles: boolean
  /** 영상 위 자막. 나중에 추가돼서 옛 기록에는 없다 (색인이 아니라 마이그레이션 불필요) */
  videoSubtitles?: boolean
  /** 화면 자막 글자 크기 배수 */
  videoSubtitleScale?: number
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
    // 작업 폴더 핸들을 보관하던 테이블. 지금은 쓰지 않지만, 선언을 지우면
    // 이미 버전 2로 올라간 브라우저에서 downgrade로 취급되므로 남겨 둔다.
    this.version(2).stores({
      handles: 'id',
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
