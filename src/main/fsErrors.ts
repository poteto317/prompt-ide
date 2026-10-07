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

// 「対象が無い」ことを表す fs エラーは ENOENT だけではない。祖先パスの
// コンポーネントがディレクトリではなくファイルに置き換わっていた場合
// (例: git checkout でディレクトリだった箇所が同名ファイルになった)、
// realpath は ENOENT ではなく ENOTDIR を投げる。削除済みパス向けの
// フォールバック判定(fileAccessGuard.ts の assertFileWithinFolder、
// handlers/gitPathResolver.ts の resolveCanonicalPath)がこのケースを isEnoentError だけで
// 判定すると、未変換の ENOTDIR がそのままユーザーへ伝播してしまう
export function isMissingPathError(err: unknown): err is NodeJS.ErrnoException {
  return isFsError(err, 'ENOENT') || isFsError(err, 'ENOTDIR')
}
