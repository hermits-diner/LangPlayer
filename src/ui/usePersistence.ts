import { useEffect, useRef } from 'react'
import { scoreDictation } from '../core/dictation/score'
import type { DictationResult } from '../core/dictation/score'
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

      if (row) {
        const results = rescore(row)

        useAppStore.getState().restoreSession({
          cues: row.cues,
          segments: row.segments,
          activeIndex: row.activeIndex,
          sync: { scale: row.scale ?? 1, offsetSec: row.offsetSec ?? 0 },
          currentTime: row.currentTime,
          inputs: row.inputs,
          results,
        })

        const done = Object.keys(results).length
        const average = done > 0 ? ` · 평균 ${Math.round(averageAccuracy(results) * 100)}%` : ''
        useAppStore
          .getState()
          .setNotice(`이어서 학습합니다 — ${row.segments.length}문장 중 ${done}문장 완료${average}`)
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
  const results = useAppStore((s) => s.results)

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
        segments,
        inputs,
        graded: Object.keys(results),
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
  }, [sessionKey, media, subtitle, cues, segments, activeIndex, sync, inputs, results])
}

/**
 * 채점 결과는 저장하지 않고 입력에서 다시 계산한다.
 * 채점이 순수 함수라 결과가 같고, 채점 로직을 고쳐도 기록이 낡지 않는다.
 */
function rescore(row: SessionRow): Record<string, DictationResult> {
  const byKey = new Map(row.segments.map((s) => [s.cueIds[0] ?? s.id, s.text]))
  const results: Record<string, DictationResult> = {}

  for (const key of row.graded) {
    const reference = byKey.get(key)
    if (reference === undefined) continue // 세그먼트 경계가 바뀌어 사라진 기록
    results[key] = scoreDictation(reference, row.inputs[key] ?? '')
  }

  return results
}

function averageAccuracy(results: Record<string, DictationResult>): number {
  const values = Object.values(results)
  if (values.length === 0) return 0
  return values.reduce((sum, r) => sum + r.accuracy, 0) / values.length
}
