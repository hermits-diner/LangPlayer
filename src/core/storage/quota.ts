/**
 * 저장소 등급과 사용량.
 *
 * IndexedDB의 기본 등급은 `best-effort`다. 디스크가 부족해지면 브라우저가
 * 예고 없이 지운다. Safari는 더 공격적이어서 일정 기간 방문이 없으면 지운다.
 * 몇 달치 학습 기록이 사라지는 시나리오라, 실제 위험은 용량 부족이 아니라
 * 이 자동 삭제다. `persist()`로 삭제 면제 등급을 요청해 막는다.
 */

export interface StorageStatus {
  /** 이 브라우저가 관련 API를 지원하는지 */
  supported: boolean
  /** 삭제 면제 등급을 받았는지 */
  persisted: boolean
  usageBytes: number | null
  quotaBytes: number | null
}

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'storage' in navigator && 'estimate' in navigator.storage
}

export async function isPersisted(): Promise<boolean> {
  if (!isSupported() || typeof navigator.storage.persisted !== 'function') return false

  try {
    return await navigator.storage.persisted()
  } catch {
    return false
  }
}

/**
 * 삭제 면제 등급 요청.
 *
 * Chrome은 재방문·북마크 같은 참여도 신호를 보고 프롬프트 없이 자동으로
 * 승인하거나 거절한다. Firefox는 사용자에게 묻는다 — 그래서 페이지 로드 직후가
 * 아니라 **지킬 기록이 실제로 생긴 뒤**에 부르는 것이 맞다.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!isSupported() || typeof navigator.storage.persist !== 'function') return false

  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  if (!isSupported()) {
    return { supported: false, persisted: false, usageBytes: null, quotaBytes: null }
  }

  try {
    const estimate = await navigator.storage.estimate()
    return {
      supported: true,
      persisted: await isPersisted(),
      usageBytes: estimate.usage ?? null,
      quotaBytes: estimate.quota ?? null,
    }
  } catch {
    return { supported: false, persisted: false, usageBytes: null, quotaBytes: null }
  }
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`

  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }

  // 10 이상은 소수점이 의미 없다 (12.3 MB보다 12 MB가 읽기 쉽다)
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${UNITS[unit]}`
}
