/**
 * File System Access API 중 표준 lib.dom에 아직 없는 부분.
 *
 * 권한 조회·요청(`queryPermission`/`requestPermission`)은 표준 문서에 들어가기
 * 전이라 타입 정의가 빠져 있다. 선택적 메서드로 선언해 미지원 브라우저에서
 * 없을 수 있다는 사실을 타입에도 남긴다.
 */
export {}

interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

declare global {
  interface FileSystemHandle {
    queryPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
    requestPermission?(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
  }

  interface Window {
    showDirectoryPicker?(options?: {
      mode?: 'read' | 'readwrite'
      id?: string
      startIn?: string
    }): Promise<FileSystemDirectoryHandle>
  }
}
