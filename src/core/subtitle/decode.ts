/**
 * 자막 파일 바이트 → 문자열.
 *
 * 국내에 유통되는 SRT/SMI는 EUC-KR(CP949)로 저장된 경우가 아직 많다.
 * UTF-8로 강제 디코딩하면 한글이 통째로 깨지므로 실제로 감지해야 한다.
 */

export type DetectedEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'euc-kr'

export interface DecodeResult {
  text: string
  encoding: DetectedEncoding
}

function hasBom(bytes: Uint8Array, ...sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b)
}

/** 해당 인코딩 디코더를 이 런타임이 지원하는지 확인 */
function canDecode(encoding: string): boolean {
  try {
    new TextDecoder(encoding)
    return true
  } catch {
    return false
  }
}

export function decodeSubtitle(buffer: ArrayBuffer): DecodeResult {
  const bytes = new Uint8Array(buffer)

  // 1. BOM이 있으면 그것이 정답이다
  if (hasBom(bytes, 0xef, 0xbb, 0xbf)) {
    return { text: stripBom(new TextDecoder('utf-8').decode(bytes)), encoding: 'utf-8' }
  }
  if (hasBom(bytes, 0xff, 0xfe)) {
    return { text: stripBom(new TextDecoder('utf-16le').decode(bytes)), encoding: 'utf-16le' }
  }
  if (hasBom(bytes, 0xfe, 0xff)) {
    return { text: stripBom(new TextDecoder('utf-16be').decode(bytes)), encoding: 'utf-16be' }
  }

  // 2. BOM 없음 → UTF-8로 엄격 디코딩 시도.
  //    유효한 UTF-8 시퀀스가 아니면 예외가 나므로 확실하게 판별된다.
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text: stripBom(text), encoding: 'utf-8' }
  } catch {
    // UTF-8이 아니다 → 3번으로
  }

  // 3. 국내 레거시 자막으로 간주하고 EUC-KR
  if (canDecode('euc-kr')) {
    return { text: stripBom(new TextDecoder('euc-kr').decode(bytes)), encoding: 'euc-kr' }
  }

  // 4. 런타임이 euc-kr을 모르면 손실을 감수하고 UTF-8 관대 모드
  return { text: stripBom(new TextDecoder('utf-8').decode(bytes)), encoding: 'utf-8' }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** CRLF/CR을 LF로 통일 — 이후 모든 파서가 LF만 가정한다 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}
