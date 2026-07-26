/** UTF-8 BOM. 소스에 보이지 않는 글자를 심지 않으려고 코드로 만든다 */
const BOM = String.fromCharCode(0xfeff)

/**
 * 만든 텍스트를 파일로 내려받기.
 *
 * File System Access API의 "저장 위치 선택" 창이 더 좋지만 Chrome 계열에만 있다.
 * 내려받기는 어디서나 되고, 결과를 브라우저 다운로드 목록에서 바로 찾을 수 있다.
 */
export function downloadText(fileName: string, text: string, options: { bom?: boolean } = {}): void {
  // BOM을 붙이는 이유: 윈도우 플레이어들은 BOM이 없는 자막 파일을 CP949로 읽어
  // 한글을 깨뜨린다. 이 앱의 디코더는 BOM을 가장 먼저 보므로 다시 올려도 맞는다.
  const body = options.bom ? BOM + text : text
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }))

  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()

  // 곧바로 해제하면 다운로드가 시작되기 전에 무효가 되는 브라우저가 있다
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 확장자를 뗀 이름 — 내보낼 파일 이름의 뿌리 */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
