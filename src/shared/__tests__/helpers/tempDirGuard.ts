import { realpathSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'

// テストの再帰削除の安全装置(同期の removeTempPathSync・非同期の removeTempPath)。空・相対・一時ディレクトリ(os.tmpdir())の外のパスは消さずに投げる。
// 2026-10-26 に、テストの rmSync(dirname(''), { recursive: true }) が「.」(リポジトリのフォルダ)を消した事故の再発防止

const tempRoots = (): string[] => {
  const raw = resolve(tmpdir())
  const roots = [raw]
  try {
    roots.push(realpathSync(raw))
  } catch {
    // realpath を取れなければ、そのままのパスだけで比べる
  }
  return roots
}

/** 一時ディレクトリの中(一時ディレクトリそのものは含まない)の絶対パスなら、正規化したパスを返す。そうでなければ投げる */
export function assertInsideTempDir(target: string | null | undefined): string {
  if (typeof target !== 'string' || target === '' || !isAbsolute(target)) {
    throw new Error(`一時ディレクトリの中の絶対パスではないので消しません: ${String(target)}`)
  }
  const resolved = resolve(target)
  const inside = tempRoots().some((root) => {
    const rel = relative(root, resolved)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
  if (!inside) throw new Error(`一時ディレクトリの外なので消しません: ${resolved}`)
  return resolved
}

/** 一時ディレクトリの中であることを確かめてから、再帰で消す */
export function removeTempPathSync(target: string | null | undefined): void {
  rmSync(assertInsideTempDir(target), { recursive: true, force: true })
}

/** 一時ディレクトリの中であることを確かめてから、再帰で消す(非同期)。確かめの失敗も、同期の throw ではなく reject で返す */
export async function removeTempPath(target: string | null | undefined): Promise<void> {
  await rm(assertInsideTempDir(target), { recursive: true, force: true })
}
