import { useCallback, useEffect, useRef, useState } from 'react'
import {
  downloadTextFile,
  ensurePermission,
  forgetWorkspace,
  isFileSystemAccessSupported,
  loadTextFile,
  loadWorkspaceHandle,
  pickWorkspace,
  saveTextFile,
} from '../core/storage/workspace'
import { TEXT_KINDS, fileNameFor, type TextKind } from '../core/text/types'
import { useAppStore } from '../store/useAppStore'
import { useTextStore } from '../store/useTextStore'

/**
 * 작업 폴더 연결과 학습 자료 입출력.
 *
 * 폴더 권한이 있으면 `Drafts/dap1102-1.txt` 규칙대로 곧장 읽고 쓴다.
 * 없으면 다운로드와 파일 선택으로 대신한다 — 폴더 구조는 포기하되 파일명
 * 규칙은 지켜서, 나중에 폴더를 연결했을 때 그대로 들어맞게 한다.
 */
export function useWorkspace() {
  const workspaceName = useTextStore((s) => s.workspaceName)
  const setWorkspaceName = useTextStore((s) => s.setWorkspaceName)
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const [supported] = useState(isFileSystemAccessSupported)

  // 지난번에 지정한 폴더가 있으면 되살린다 (권한이 아직 살아 있을 때만)
  useEffect(() => {
    let cancelled = false

    void loadWorkspaceHandle().then(async (handle) => {
      if (!handle || cancelled) return
      if (!(await ensurePermission(handle, false))) return
      if (cancelled) return

      handleRef.current = handle
      setWorkspaceName(handle.name)
    })

    return () => {
      cancelled = true
    }
  }, [setWorkspaceName])

  const connect = useCallback(async () => {
    const handle = await pickWorkspace()
    if (!handle) return

    handleRef.current = handle
    setWorkspaceName(handle.name)
    useAppStore.getState().setNotice(`작업 폴더를 '${handle.name}'로 연결했습니다.`)
  }, [setWorkspaceName])

  const disconnect = useCallback(async () => {
    handleRef.current = null
    setWorkspaceName(null)
    await forgetWorkspace()
  }, [setWorkspaceName])

  /** 쓸 준비가 된 핸들을 돌려준다. 권한이 끊겼으면 한 번 다시 묻는다 */
  const readyHandle = useCallback(async () => {
    const handle = handleRef.current
    if (!handle) return null
    if (await ensurePermission(handle, true)) return handle

    handleRef.current = null
    setWorkspaceName(null)
    return null
  }, [setWorkspaceName])

  const save = useCallback(
    async (kind: TextKind) => {
      const app = useAppStore.getState()
      const mediaName = app.media?.name
      if (!mediaName) {
        app.setError('먼저 미디어 파일을 열어 주세요.')
        return
      }

      const content = useTextStore.getState().getText(kind)
      if (!content.trim()) {
        app.setNotice(`${TEXT_KINDS[kind].label}에 저장할 내용이 없습니다.`)
        return
      }

      const handle = await readyHandle()
      if (handle) {
        try {
          const path = await saveTextFile(handle, kind, mediaName, content)
          app.setNotice(`저장했습니다 — ${path}`)
          return
        } catch (err) {
          app.setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
          return
        }
      }

      const name = downloadTextFile(kind, mediaName, content)
      app.setNotice(`${name}으로 내려받았습니다. 작업 폴더를 연결하면 바로 저장됩니다.`)
    },
    [readyHandle],
  )

  const load = useCallback(
    async (kind: TextKind) => {
      const app = useAppStore.getState()
      const mediaName = app.media?.name
      if (!mediaName) {
        app.setError('먼저 미디어 파일을 열어 주세요.')
        return
      }

      const handle = await readyHandle()
      if (handle) {
        const content = await loadTextFile(handle, kind, mediaName)
        if (content === null) {
          app.setError(
            `${TEXT_KINDS[kind].folder}/${fileNameFor(kind, mediaName)} 파일이 없습니다.`,
          )
          return
        }

        useTextStore.getState().setText(kind, content)
        app.setNotice(`${TEXT_KINDS[kind].label}을 불러왔습니다.`)
        return
      }

      // 폴더 권한이 없으면 파일을 직접 고르게 한다
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.txt,text/plain'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        useTextStore.getState().setText(kind, await file.text())
        app.setNotice(`${TEXT_KINDS[kind].label}을 불러왔습니다 (${file.name}).`)
      }
      input.click()
    },
    [readyHandle],
  )

  return { supported, workspaceName, connect, disconnect, save, load }
}
