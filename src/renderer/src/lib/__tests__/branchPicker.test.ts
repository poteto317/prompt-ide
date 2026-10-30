import { describe, it, expect } from 'vitest'
import type { GitBranch } from '@shared/types'
import {
  buildBranchPickerItems,
  initialBranchPickerSelection,
  moveBranchPickerSelection,
  resolveBranchPickerSelection
} from '../branchPicker'
import type { BranchPickerItem } from '../branchPicker'

const branch = (name: string, current = false): GitBranch => ({ name, current })

// getBranches が detached の HEAD に返す疑似項目。名前は simple-git の解析結果の形
// (`(HEAD detached at 4fd2759)` は 4fd2759、`git checkout --detach main` は refs/heads/main)
const detachedHead = (name: string): GitBranch => ({ name, current: true, isDetachedHead: true })

const item = (name: string, isCurrent = false): BranchPickerItem => ({ name, isCurrent })

describe('buildBranchPickerItems', () => {
  it('現在のブランチを先頭に置き、残りは branches の順に並べる', () => {
    const branches = [branch('dev'), branch('main', true), branch('feat/a')]

    expect(buildBranchPickerItems(branches, 'main', '')).toEqual([
      item('main', true),
      item('dev'),
      item('feat/a')
    ])
  })

  it('部分一致で絞り込む', () => {
    const branches = [
      branch('main', true),
      branch('feat/login'),
      branch('feat/logout'),
      branch('dev')
    ]

    expect(buildBranchPickerItems(branches, 'main', 'log')).toEqual([
      item('feat/login'),
      item('feat/logout')
    ])
  })

  it('絞り込みは現在のブランチにも適用する', () => {
    const branches = [branch('main', true), branch('dev')]

    expect(buildBranchPickerItems(branches, 'main', 'ma')).toEqual([item('main', true)])
    expect(buildBranchPickerItems(branches, 'main', 'de')).toEqual([item('dev')])
  })

  it('絞り込みは大文字小文字を区別しない', () => {
    const branches = [branch('main', true), branch('Feature/ABC'), branch('hotfix')]

    expect(buildBranchPickerItems(branches, 'main', 'feature/abc')).toEqual([item('Feature/ABC')])
    expect(buildBranchPickerItems(branches, 'main', 'HOT')).toEqual([item('hotfix')])
  })

  it('絞り込みの文字の前後の空白は無視する', () => {
    const branches = [branch('main', true), branch('dev')]

    expect(buildBranchPickerItems(branches, 'main', '  dev\t')).toEqual([item('dev')])
    expect(buildBranchPickerItems(branches, 'main', '   ')).toEqual([
      item('main', true),
      item('dev')
    ])
  })

  it('一致する候補が無ければ 0 件になる', () => {
    expect(buildBranchPickerItems([branch('main', true)], 'main', 'zzz')).toEqual([])
  })

  it('GitBranch.current が別のブランチを指していても、currentBranch だけで現在のブランチを決める', () => {
    // branches は履歴の再取得でしか更新されず、gitStatus より遅れることがある
    const branches = [branch('main', true), branch('dev')]

    expect(buildBranchPickerItems(branches, 'dev', '')).toEqual([item('dev', true), item('main')])
  })

  it('currentBranch が null のときは疑似項目を除く', () => {
    const branches = [detachedHead('4fd2759'), branch('main'), branch('dev')]

    expect(buildBranchPickerItems(branches, null, '')).toEqual([item('main'), item('dev')])
  })

  it('currentBranch が null で疑似項目しか無ければ 0 件になる', () => {
    expect(buildBranchPickerItems([detachedHead('4fd2759')], null, '')).toEqual([])
  })

  it.each(['4fd2759', 'refs/heads/main'])(
    'branches が古く currentBranch が非 null でも、疑似項目 %s は候補にも初期選択にもならない',
    (name) => {
      // detached のときに取得した branches が、ブランチへ戻った後も残っている状態
      const items = buildBranchPickerItems(
        [detachedHead(name), branch('main'), branch('dev')],
        'dev',
        ''
      )

      expect(items).toEqual([item('dev', true), item('main')])
      expect(initialBranchPickerSelection(items)).toBe('main')
    }
  )

  it('currentBranch が null でも、古い current: true の実在のブランチは候補に残す', () => {
    // ブランチ上で取得した branches が、端末で detached にした後も残っている状態
    const branches = [branch('main', true), branch('dev')]

    expect(buildBranchPickerItems(branches, null, '')).toEqual([item('main'), item('dev')])
  })

  it('branches が空でも現在のブランチを候補にする', () => {
    expect(buildBranchPickerItems([], 'main', '')).toEqual([item('main', true)])
  })

  it('currentBranch が branches に無ければ先頭に足す', () => {
    expect(buildBranchPickerItems([branch('dev')], 'main', '')).toEqual([
      item('main', true),
      item('dev')
    ])
  })
})

describe('initialBranchPickerSelection', () => {
  it('現在のブランチの次の候補を選ぶ', () => {
    expect(initialBranchPickerSelection([item('main', true), item('dev'), item('feat/a')])).toBe(
      'dev'
    )
  })

  it('別の候補が無ければ現在のブランチを選ぶ', () => {
    expect(initialBranchPickerSelection([item('main', true)])).toBe('main')
  })

  it('現在のブランチが無ければ先頭を選ぶ', () => {
    expect(initialBranchPickerSelection([item('main'), item('dev')])).toBe('main')
  })

  it('候補が 0 件なら null を返す', () => {
    expect(initialBranchPickerSelection([])).toBeNull()
  })
})

describe('resolveBranchPickerSelection', () => {
  const items = [item('main', true), item('dev'), item('feat/a')]

  it('選択中の名前が候補にあればそのまま返す', () => {
    expect(resolveBranchPickerSelection(items, 'feat/a')).toBe('feat/a')
  })

  it('選択中の名前が候補から消えていたら先頭を返す', () => {
    expect(resolveBranchPickerSelection(items, 'gone')).toBe('main')
  })

  it('選択が null でも候補があれば先頭を返す', () => {
    expect(resolveBranchPickerSelection(items, null)).toBe('main')
  })

  it('候補が 0 件なら null を返す', () => {
    expect(resolveBranchPickerSelection([], 'main')).toBeNull()
    expect(resolveBranchPickerSelection([], null)).toBeNull()
  })
})

describe('moveBranchPickerSelection', () => {
  const items = [item('main', true), item('dev'), item('feat/a')]

  it('delta の分だけ選択を動かす', () => {
    expect(moveBranchPickerSelection(items, 'main', 1)).toBe('dev')
    expect(moveBranchPickerSelection(items, 'feat/a', -1)).toBe('dev')
  })

  it('末尾から下へ動かすと先頭へ循環する', () => {
    expect(moveBranchPickerSelection(items, 'feat/a', 1)).toBe('main')
  })

  it('先頭から上へ動かすと末尾へ循環する', () => {
    expect(moveBranchPickerSelection(items, 'main', -1)).toBe('feat/a')
  })

  it('候補が 1 件なら同じ候補のまま', () => {
    expect(moveBranchPickerSelection([item('main', true)], 'main', 1)).toBe('main')
    expect(moveBranchPickerSelection([item('main', true)], 'main', -1)).toBe('main')
  })

  it('選択が候補に無いときは、先頭が選ばれている扱いで動かす', () => {
    // 画面では resolveBranchPickerSelection により先頭が選択として見えているため、そこから動かす
    expect(moveBranchPickerSelection(items, 'gone', 1)).toBe('dev')
    expect(moveBranchPickerSelection(items, null, -1)).toBe('feat/a')
  })

  it('候補が 0 件なら null を返す', () => {
    expect(moveBranchPickerSelection([], 'main', 1)).toBeNull()
    expect(moveBranchPickerSelection([], null, -1)).toBeNull()
  })
})
