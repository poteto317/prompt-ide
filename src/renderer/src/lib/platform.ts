/** macOS で動いているか(キー操作の振り分けに使う。Cmd と Ctrl の役割が違う) */
export function isMacPlatform(userAgent: string = navigator.userAgent): boolean {
  return /Mac/i.test(userAgent)
}
