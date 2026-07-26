import { useEffect, useRef } from 'react'
import {
  loadSession,
  loadSettings,
  saveSession,
  saveSettings,
  type SessionRow,
} from '../core/storage/db'
import { requestPersistence } from '../core/storage/quota'
import {
  deserializeLoopSettings,
  fingerprintCues,
  serializeLoopSettings,
  sessionKeyOf,
} from '../core/storage/serialize'
import { useAppStore } from '../store/useAppStore'

/** 저장 디바운스 — 타이핑 한 글자마다 IndexedDB를 두드리지 않는다 */
const SAVE_DEBOUNCE_MS = 800

/**
 * 학습 기록 저장/복원.
 *
 * 순서가 중요하다. `setSubtitle`은 입력과 채점을 초기화하므로, 복원은 자막이
 * 자리를 잡은 뒤에 일어나야 한다. 그리고 복원이 끝나기 전에 저장이 돌면 방금
 * 불러온 기록을 빈 값으로 덮어쓰므로, 세션마다 `restored` 플래그로 막는다.
 */
export function usePersistence() {
  const media = useAppStore((s) => s.media)
  const subtitle = useAppStore((s) => s.subtitle)

  const mediaKey = media?.key ?? null
  const subtitleName = subtitle?.name ?? null
  const sessionKey = mediaKey ? sessionKeyOf(mediaKey, subtitleName) : null

  /** 이 세션의 복원이 끝났는지 — 끝나기 전에는 저장하지 않는다 */
  const restoredKey = useRef<string | null>(null)
  /** 삭제 면제 등급은 지킬 기록이 생긴 뒤 한 번만 요청한다 */
  const persistenceAsked = useRef(false)

  // ─── 전역 설정 복원 (앱 시작 시 한 번) ───────────────────────────
  useEffect(() => {
    let cancelled = false

    void loadSettings().then((row) => {
      if (cancelled || !row) return
      useAppStore.getState().applyStoredSettings({
        loopSettings: deserializeLoopSettings(row.loopSettings),
        hideSubtitles: row.hideSubtitles,
        autoAdvance: row.autoAdvance,
      })
    })

    return () => {
      cancelled = true
    }
  }, [])

  // ─── 전역 설정 저장 ─────────────────────────────────────────────
  const loopSettings = useAppStore((s) => s.loopSettings)
  const hideSubtitles = useAppStore((s) => s.hideSubtitles)
  const autoAdvance = useAppStore((s) => s.autoAdvance)

  useEffect(() => {
    const timer = setTimeout(() => {
      void saveSettings({
        id: 'global',
        loopSettings: serializeLoopSettings(loopSettings),
        hideSubtitles,
        autoAdvance,
      })
    }, SAVE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [loopSettings, hideSubtitles, autoAdvance])

  // ─── 세션 복원 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionKey || !subtitle) return

    let cancelled = false
    restoredKey.current = null

    void loadSession(sessionKey).then((row) => {
      if (cancelled) return

      if (row && matchesLoadedSubtitle(row)) {
        useAppStore.getState().restoreSession({
          cues: row.cues,
          segments: row.segments,
          activeIndex: row.activeIndex,
          sync: { scale: row.scale ?? 1, offsetSec: row.offsetSec ?? 0 },
          currentTime: row.currentTime,
          inputs: row.inputs,
        })

        const written = Object.values(row.inputs).filter((text) => text.trim()).length
        useAppStore
          .getState()
          .setNotice(`이어서 학습합니다 — ${row.segments.length}문장 중 ${written}문장 받아씀`)
      }

      restoredKey.current = sessionKey
    })

    return () => {
      cancelled = true
    }
  }, [sessionKey, subtitle])

  // ─── 세션 저장 ──────────────────────────────────────────────────
  const cues = useAppStore((s) => s.cues)
  const segments = useAppStore((s) => s.segments)
  const activeIndex = useAppStore((s) => s.activeIndex)
  const sync = useAppStore((s) => s.sync)
  const inputs = useAppStore((s) => s.inputs)

  useEffect(() => {
    if (!sessionKey || !media || !subtitle) return
    if (restoredKey.current !== sessionKey) return // 복원 전에는 저장 금지
    if (segments.length === 0) return

    const timer = setTimeout(() => {
      const row: SessionRow = {
        key: sessionKey,
        mediaKey: media.key,
        mediaName: media.name,
        mediaKind: media.kind,
        subtitleName: subtitle.name,
        subtitleFormat: subtitle.format,
        subtitleEncoding: subtitle.encoding,
        updatedAt: Date.now(),
        // 재생 위치는 매 프레임 바뀌므로 저장 시점에 한 번만 읽는다
        currentTime: useAppStore.getState().currentTime,
        activeIndex,
        offsetSec: sync.offsetSec,
        scale: sync.scale,
        cues,
        cuesFingerprint: fingerprintCues(cues),
        segments,
        inputs,
      }

      void saveSession(row).then(() => {
        // 첫 저장이 성공한 시점 = 지킬 기록이 생긴 시점.
        // 페이지 로드 직후가 아니라 여기서 물어야 Firefox 프롬프트가 뜬금없지 않다.
        if (persistenceAsked.current) return
        persistenceAsked.current = true
        void requestPersistence()
      })
    }, SAVE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [sessionKey, media, subtitle, cues, segments, activeIndex, sync, inputs])
}

/**
 * 저장된 기록이 지금 화면에 올라온 자막과 같은 것인지 확인한다.
 *
 * 세션 키는 파일 이름으로만 만들어지므로, 같은 이름의 다른 자막을 올리면
 * 키가 겹친다. 내용 지문까지 맞을 때만 복원해야 방금 올린 자막이 옛 기록에
 * 덮이지 않는다.
 */
function matchesLoadedSubtitle(row: SessionRow): boolean {
  const loaded = useAppStore.getState().cues
  if (loaded.length === 0) return true // 자막 없이 미디어만 연 경우 — 저장본을 그대로 쓴다

  // 지문이 생기기 전 기록은 큐 개수로만 대조한다 (없는 것보다는 낫다)
  if (!row.cuesFingerprint) return row.cues.length === loaded.length

  return row.cuesFingerprint === fingerprintCues(loaded)
}

