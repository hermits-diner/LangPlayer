/**
 * 라딕스-2 Cooley-Tukey FFT (제자리 연산).
 *
 * 상호상관을 브루트포스로 하면 O(N·L)이라 2시간 영화에서 수십억 연산이 된다.
 * FFT를 거치면 O(N log N)으로 떨어져 체감 즉시 끝난다.
 */

export function nextPowerOfTwo(n: number): number {
  let size = 1
  while (size < n) size <<= 1
  return size
}

export function fftInPlace(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  if (n !== im.length || (n & (n - 1)) !== 0) {
    throw new Error('FFT 길이는 2의 거듭제곱이어야 합니다.')
  }
  if (n <= 1) return

  // 비트 반전 순열
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit

    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len
    const stepRe = Math.cos(angle)
    const stepIm = Math.sin(angle)
    const half = len >> 1

    for (let start = 0; start < n; start += len) {
      let wRe = 1
      let wIm = 0

      for (let k = 0; k < half; k++) {
        const a = start + k
        const b = a + half

        const vRe = re[b] * wRe - im[b] * wIm
        const vIm = re[b] * wIm + im[b] * wRe

        re[b] = re[a] - vRe
        im[b] = im[a] - vIm
        re[a] += vRe
        im[a] += vIm

        const nextRe = wRe * stepRe - wIm * stepIm
        wIm = wRe * stepIm + wIm * stepRe
        wRe = nextRe
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}
