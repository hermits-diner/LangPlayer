import { db } from './db'
import { fileNameFor, TEXT_KINDS, type TextKind } from '../text/types'

/**
 * 작업 폴더.
 *
 * 학습 자료는 종류별 폴더에 정해진 이름으로 쌓인다.
 *   `ap1102-1.mp3` → `Drafts/dap1102-1.txt`, `Patches/pap1102-1.txt` …
 *
 * 브라우저는 임의 경로에 쓸 수 없지만, File System Access API로 폴더를 한 번
 * 지정받으면 그 안에서는 자유롭게 읽고 쓸 수 있다. 권한은 IndexedDB에 핸들로
 * 저장돼 다음 방문에도 이어진다 (재확인 클릭 한 번은 필요하다).
 *
 * Chrome·Edge 전용이다. 지원하지 않는 브라우저에서는 다운로드/파일 선택으로
 * 대신한다 — 폴더 규약은 포기하되 파일명 규칙은 지킨다.
 */

const HANDLE_KEY = 'workspace'

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

interface HandleRow {
  id: string
  handle: FileSystemDirectoryHandle
}

/** 핸들은 구조화 복제가 되므로 IndexedDB에 그대로 넣을 수 있다 */
function handleTable() {
  return db.table<HandleRow, string>('handles')
}

export async function loadWorkspaceHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const row = await handleTable().get(HANDLE_KEY)
    return row?.handle ?? null
  } catch {
    return null
  }
}

async function storeWorkspaceHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await handleTable().put({ id: HANDLE_KEY, handle })
  } catch {
    // 저장 못 해도 이번 세션 동안은 쓸 수 있다
  }
}

export async function forgetWorkspace(): Promise<void> {
  try {
    await handleTable().delete(HANDLE_KEY)
  } catch {
    // 무시
  }
}

/** 사용자에게 작업 폴더를 고르게 한다 */
export async function pickWorkspace(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null

  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await storeWorkspaceHandle(handle)
    return handle
  } catch {
    // 사용자가 취소한 경우
    return null
  }
}

/**
 * 저장해 둔 핸들이 아직 쓸 수 있는지 확인한다.
 * 브라우저를 다시 켜면 권한이 'prompt'로 돌아가므로 한 번 물어야 한다.
 */
export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  interactive: boolean,
): Promise<boolean> {
  const options = { mode: 'readwrite' } as const

  try {
    // 권한 API가 없는 브라우저라면 일단 쓸 수 있다고 보고 실제 접근에서 판단한다
    if (!handle.queryPermission) return true

    if ((await handle.queryPermission(options)) === 'granted') return true
    if (!interactive || !handle.requestPermission) return false
    return (await handle.requestPermission(options)) === 'granted'
  } catch {
    return false
  }
}

async function subfolder(
  workspace: FileSystemDirectoryHandle,
  kind: TextKind,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await workspace.getDirectoryHandle(TEXT_KINDS[kind].folder, { create })
  } catch {
    return null
  }
}

export async function saveTextFile(
  workspace: FileSystemDirectoryHandle,
  kind: TextKind,
  mediaName: string,
  content: string,
): Promise<string> {
  const folder = await subfolder(workspace, kind, true)
  if (!folder) throw new Error(`${TEXT_KINDS[kind].folder} 폴더를 만들지 못했습니다.`)

  const name = fileNameFor(kind, mediaName)
  const file = await folder.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  await writable.write(content)
  await writable.close()

  return `${TEXT_KINDS[kind].folder}/${name}`
}

export async function loadTextFile(
  workspace: FileSystemDirectoryHandle,
  kind: TextKind,
  mediaName: string,
): Promise<string | null> {
  const folder = await subfolder(workspace, kind, false)
  if (!folder) return null

  try {
    const file = await folder.getFileHandle(fileNameFor(kind, mediaName))
    return await (await file.getFile()).text()
  } catch {
    // 아직 저장한 적 없는 종류
    return null
  }
}

/** 폴더 권한이 없을 때의 대체 수단 — 파일명 규칙만은 지킨다 */
export function downloadTextFile(kind: TextKind, mediaName: string, content: string): string {
  const name = fileNameFor(kind, mediaName)
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))

  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()

  // 클릭이 처리될 틈을 준 뒤 회수한다
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return name
}
