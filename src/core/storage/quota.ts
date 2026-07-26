/**
 * 저장소 등급.
 *
 * IndexedDB의 기본 등급은 `best-effort`다. 디스크가 부족해지면 브라우저가
 * 예고 없이 지운다. Safari는 더 공격적이어서 일정 기간 방문이 없으면 지운다.
 * 학습 기록은 텍스트뿐이라 용량이 문제가 된 적은 없다 — 실제 위험은 이 자동
 * 삭제이므로, 남은 용량을 보여주는 대신 삭제 면제 등급을 받는 데 집중한다.
 */

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'storage' in navigator
}

export function isStorageApiSupported(): boolean {
  return isSupported() && typeof navigator.storage.persist === 'function'
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
  if (!isStorageApiSupported()) return false

  try {
    if (await isPersisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
