import { describe, it, expect } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import {
  statusChar,
  isStagedFile,
  isUntrackedFile,
  isIntentToAddFile,
  isUnstagedFile,
  isGitOperationDisabled,
  isConflictedFile
} from '../gitUtils'

describe('statusChar', () => {
  it('"?" → "U"（未追跡ファイル）', () => {
    expect(statusChar('?')).toBe('U')
  })

  it('"M" → "M"（変更）', () => {
    expect(statusChar('M')).toBe('M')
  })

  it('"A" → "A"（追加）', () => {
    expect(statusChar('A')).toBe('A')
  })

  it('"D" → "D"（削除）', () => {
    expect(statusChar('D')).toBe('D')
  })

  it('" "（スペース）→ "·"（変更なし）', () => {
    expect(statusChar(' ')).toBe('·')
  })

  it('""（空文字）→ "·"', () => {
    expect(statusChar('')).toBe('·')
  })
})

describe('isStagedFile', () => {
  // GitRepoView.tsx の stagedCount 計算(コミットボタンの有効/無効判定)と
  // StagedSection.tsx の一覧フィルタが、同じ「ステージ済みかどうか」の判定を
  // 別々に実装していた。片方だけ判定基準を変えると、コミットボタンの状態と
  // StagedSection の表示内容が食い違ってしまうため、共有ヘルパーに統一する
  it('index が "M"（変更あり・ステージ済み）は true を返す', () => {
    expect(isStagedFile({ path: 'a.ts', index: 'M', workingDir: ' ' })).toBe(true)
  })

  it('index が " "（未ステージ）は false を返す', () => {
    expect(isStagedFile({ path: 'a.ts', index: ' ', workingDir: 'M' })).toBe(false)
  })

  it('index が "?"（未追跡）は false を返す', () => {
    expect(isStagedFile({ path: 'a.ts', index: '?', workingDir: '?' })).toBe(false)
  })

  // マージコンフリクト(未解決)の porcelain コードは index/workingDir が
  // どちらも ' ' 以外・'?' 以外になるため、除外しないと isStagedFile が
  // true を返してしまう。実際には git add で「解決済み」と明示するまで
  // 通常の意味でのステージ済みではなく、この状態で commit すると git 自体は
  // 拒否するが、StagedSection/コミットボタンには「ステージ済み・コミット可能」
  // として表示されてしまい、未解決のコンフリクトを見落とす原因になる
  // (実機で 'UU' 'AA' 'DD' 'AU' 'UD' 'UA' 'DU' の組を確認済み)
  it.each([
    ['UU', 'U', 'U'],
    ['AA', 'A', 'A'],
    ['DD', 'D', 'D'],
    ['AU', 'A', 'U'],
    ['UD', 'U', 'D'],
    ['UA', 'U', 'A'],
    ['DU', 'D', 'U']
  ])('未解決のマージコンフリクト(%s)は false を返す', (_label, index, workingDir) => {
    expect(isStagedFile({ path: 'a.ts', index, workingDir })).toBe(false)
  })
})

describe('isUntrackedFile', () => {
  // 「未追跡かどうか」は ChangesSection.tsx の一覧フィルタ・ステータス文字の
  // 出し分けと、useDiffOperations.ts の「main 側で疑似diffを組み立てるか」の
  // 判定に必要で、それぞれが index === '?' を直接書いていた。この判定は
  // 「未追跡ファイルの diff が空表示になる」不具合の原因そのものだったため、
  // isStagedFile と同じ理由で共有ヘルパーに統一する
  it('index が "?"（未追跡）は true を返す', () => {
    expect(isUntrackedFile({ path: 'a.ts', index: '?', workingDir: '?' })).toBe(true)
  })

  it('index が " "（追跡済み・未ステージ）は false を返す', () => {
    expect(isUntrackedFile({ path: 'a.ts', index: ' ', workingDir: 'M' })).toBe(false)
  })

  it('index が "M"（追跡済み・ステージ済み）は false を返す', () => {
    expect(isUntrackedFile({ path: 'a.ts', index: 'M', workingDir: ' ' })).toBe(false)
  })
})

describe('isIntentToAddFile', () => {
  // git add -N のファイルは status が ' A'(index ' '、workingDir 'A')になる。
  // 変更の取り消しで未追跡と同じ扱い(ゴミ箱へ移す)にするための判定(最終レビューで追加)
  it('index が " " で workingDir が "A"(intent-to-add)は true を返す', () => {
    expect(isIntentToAddFile({ path: 'x.txt', index: ' ', workingDir: 'A' })).toBe(true)
  })

  it.each([
    { index: 'A', workingDir: ' ' },
    { index: 'A', workingDir: 'M' },
    { index: 'A', workingDir: 'A' },
    { index: ' ', workingDir: 'M' },
    { index: '?', workingDir: '?' }
  ])('index "$index" / workingDir "$workingDir" は false を返す', ({ index, workingDir }) => {
    expect(isIntentToAddFile({ path: 'x.txt', index, workingDir })).toBe(false)
  })
})

describe('isUnstagedFile', () => {
  // 「未ステージの変更を持つか(ChangesSection の一覧に出すべきか)」の判定は
  // ChangesSection.tsx の一覧フィルタと useAppState.ts の diffTab 自動クローズ
  // 判定の両方が必要とし、それぞれが `f.workingDir !== ' ' || isUntrackedFile(f)`
  // を独立に書いていた(コメントでのみ「揃える」ことが保証されていた)。
  // isStagedFile/isUntrackedFile と同じ理由で共有ヘルパーに統一する
  it('workingDir が変更ありを示す場合 true を返す', () => {
    expect(isUnstagedFile({ path: 'a.ts', index: ' ', workingDir: 'M' })).toBe(true)
  })

  it('未追跡ファイルは true を返す(workingDir の値に関わらず)', () => {
    expect(isUnstagedFile({ path: 'a.ts', index: '?', workingDir: '?' })).toBe(true)
  })

  it('workingDir が変更なし(" ")かつ追跡済みの場合 false を返す(ステージ済みのみの変更)', () => {
    expect(isUnstagedFile({ path: 'a.ts', index: 'M', workingDir: ' ' })).toBe(false)
  })
})

describe('isGitOperationDisabled', () => {
  // 「リポジトリが無ければ Git 操作(push/pull/fetch/ブランチ切替等)は実行不可」
  // という判定は useGitRemoteOperations.ts と useGitBranchOperations.ts が
  // それぞれ独立に `gitStatus === null || !gitStatus.isRepo` と書いていた。
  // 将来この判定条件が変わったときに片方だけ直し忘れると、push/pull/fetch と
  // ブランチ切替とで disabled 判定が食い違ってしまうため共有ヘルパーに統一する
  const repoStatus: GitStatusResult = {
    isRepo: true,
    branch: 'main',
    ahead: 0,
    behind: 0,
    files: []
  }

  it('gitStatus が null のとき true を返す', () => {
    expect(isGitOperationDisabled(null)).toBe(true)
  })

  it('isRepo: false のとき true を返す', () => {
    expect(isGitOperationDisabled({ ...repoStatus, isRepo: false })).toBe(true)
  })

  it('isRepo: true のとき false を返す', () => {
    expect(isGitOperationDisabled(repoStatus)).toBe(false)
  })
})

describe('isConflictedFile', () => {
  it.each([
    ['U', 'U'],
    ['A', 'A'],
    ['D', 'D'],
    ['A', 'U'],
    ['U', 'A'],
    ['D', 'U'],
    ['U', 'D']
  ])('index=%s workingDir=%s はコンフリクト中', (index, workingDir) => {
    expect(isConflictedFile({ path: 'c.txt', index, workingDir })).toBe(true)
  })

  it.each([
    [' ', 'M'],
    ['M', 'M'],
    ['?', '?'],
    ['A', ' ']
  ])('index=%s workingDir=%s はコンフリクトではない', (index, workingDir) => {
    expect(isConflictedFile({ path: 'a.txt', index, workingDir })).toBe(false)
  })
})
