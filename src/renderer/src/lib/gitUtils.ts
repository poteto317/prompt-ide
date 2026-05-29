export function statusChar(code: string): string {
  if (code === '?') return 'U'
  return code.trim() || '·'
}
