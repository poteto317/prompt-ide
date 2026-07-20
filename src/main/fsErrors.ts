// fs 系エラー(NodeJS.ErrnoException)の型ガード。store 層(settingsFileStore 等)と
// handlers 層(fsErrorConverter 等)の両方から使うため、handlers 配下ではなく
// main 直下に置く(store 層 → handlers 層への依存はレイヤー逆転になるため)。

export function isFsError(err: unknown, code?: string): err is NodeJS.ErrnoException {
  if (!(err instanceof Error) || !('code' in err)) return false
  const errCode = (err as NodeJS.ErrnoException).code
  return code === undefined ? typeof errCode === 'string' : errCode === code
}

export function isEnoentError(err: unknown): err is NodeJS.ErrnoException {
  return isFsError(err, 'ENOENT')
}
