import { describe, it, expect } from 'vitest'
import { classifyFolderChange } from '../folderChangeClassifier'
import type { FolderChangeKind } from '../folderChangeClassifier'
import { protectionRefName } from '../agentChangesProtectionRules'
import { MAX_DEPTH } from '../traversalPolicy'

// 段数の境界はツリー(readDirRecursive)と同じ MAX_DEPTH から作る(MAX_DEPTH が 5 なら 6 段が tree・7 段が git)
const TREE_DEEPEST = MAX_DEPTH + 1
const pathOfSegments = (count: number, separator: string): string =>
  Array.from({ length: count }, (_, i) => (i === count - 1 ? `f${i}.txt` : `d${i}`)).join(separator)

describe('classifyFolderChange', () => {
  it.each<[string, string | null, FolderChangeKind]>([
    ['名前が無い(null)は何が変わったか分からないので tree', null, 'tree'],
    ['空文字は tree', '', 'tree'],
    ['区切りだけ(分けた結果が空)は tree', '/', 'tree'],
    ['根の直下のファイルは tree', 'a.txt', 'tree'],
    ['先頭の区切りは捨てる', '/a.txt', 'tree'],
    [
      `${TREE_DEEPEST} 段(ツリーに出る最も深い段)は tree`,
      pathOfSegments(TREE_DEEPEST, '/'),
      'tree'
    ],
    [`${TREE_DEEPEST + 1} 段(ツリーに出ない)は git`, pathOfSegments(TREE_DEEPEST + 1, '/'), 'git'],
    ['node_modules の中は ignore', 'node_modules/x', 'ignore'],
    ['途中の dist の中は ignore', 'a/dist/x', 'ignore'],
    ['最後の要素が dist(その名前の項目そのもの)は段数で決める', 'dist', 'tree'],
    ['途中の最後の要素が dist でも段数で決める', 'a/dist', 'tree'],
    ['入れ子の .git の中は ignore', 'sub/.git/index', 'ignore'],
    ['.git そのもの(git init・削除・.git ファイルの作り直し)は tree', '.git', 'tree'],
    ['.git/index は git', '.git/index', 'git'],
    ['.git/HEAD は git', '.git/HEAD', 'git'],
    ['.git/MERGE_HEAD は git(外でのマージの中止)', '.git/MERGE_HEAD', 'git'],
    ['.git/packed-refs は git', '.git/packed-refs', 'git'],
    ['.git/refs/heads/main は git', '.git/refs/heads/main', 'git'],
    [
      '.git/refs/prompt-ide の下(アプリ自身の ref)は ignore',
      '.git/refs/prompt-ide/agent-changes/x',
      'ignore'
    ],
    [
      'エージェントの変更の記録を守る ref(protectionRefName の名前)は ignore',
      `.git/${protectionRefName('1-0123abcd', 1)}`,
      'ignore'
    ],
    ['.git/index.lock は ignore', '.git/index.lock', 'ignore'],
    ['.git/refs/heads/br.lock は ignore', '.git/refs/heads/br.lock', 'ignore'],
    ['.git/objects の下は ignore', '.git/objects/ab/cd', 'ignore'],
    ['.git/logs/HEAD は ignore', '.git/logs/HEAD', 'ignore'],
    ['.git/COMMIT_EDITMSG は ignore', '.git/COMMIT_EDITMSG', 'ignore'],
    ['.GIT/index は .git と区別する(ふつうの 2 段のファイル)', '.GIT/index', 'tree']
  ])('%s', (_label, relativePath, expected) => {
    expect(classifyFolderChange(relativePath, 'darwin')).toBe(expected)
  })

  it('win32 → \\ でも区切る(ツリーより深い段を git に数える)', () => {
    expect(classifyFolderChange(pathOfSegments(TREE_DEEPEST + 1, '\\'), 'win32')).toBe('git')
    expect(classifyFolderChange('node_modules\\x', 'win32')).toBe('ignore')
    expect(classifyFolderChange('.git\\index', 'win32')).toBe('git')
  })

  it('darwin → \\ は区切りではない(1 段の名前に数える)', () => {
    expect(classifyFolderChange(pathOfSegments(TREE_DEEPEST + 1, '\\'), 'darwin')).toBe('tree')
    expect(classifyFolderChange('node_modules\\x', 'darwin')).toBe('tree')
  })
})
