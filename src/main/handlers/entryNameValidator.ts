import { isSafeEntryName } from '@shared/entryName'

// 新規作成・リネームの名前を検証する(セキュリティ境界は renderer ではなく main 側)。
// パス区切りや '..' を含む名前は join でディレクトリを跨いでしまうため拒否する
export function assertValidEntryName(name: unknown): asserts name is string {
  if (typeof name !== 'string') {
    throw new Error('名前は文字列である必要があります')
  }
  if (!isSafeEntryName(name)) {
    throw new Error(`無効な名前です: ${name}`)
  }
}
