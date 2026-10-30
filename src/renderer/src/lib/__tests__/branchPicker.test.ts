import { describe, it, expect } from 'vitest'
import type { GitBranch } from '@shared/types'
import {
  BRANCH_PICKER_ARIA_KEYSHORTCUTS,
  CREATE_BRANCH_OPTION,
  buildBranchPickerItems,
  getBranchPickerShortcut,
  initialBranchPickerSelection,
  moveBranchPickerSelection,
  resolveBranchPickerSelection,
  withCreateBranchOption
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

  describe('作成の項目を含む候補', () => {
    const withCreate = withCreateBranchOption(items)

    it('作成の項目が選ばれていればそのまま返す', () => {
      expect(resolveBranchPickerSelection(withCreate, CREATE_BRANCH_OPTION)).toBe(
        CREATE_BRANCH_OPTION
      )
    })

    it('選択が消えたら、作成の項目ではなく先頭のブランチを返す', () => {
      expect(resolveBranchPickerSelection(withCreate, 'gone')).toBe('main')
      expect(resolveBranchPickerSelection(withCreate, null)).toBe('main')
    })

    it('ブランチの候補が無ければ作成の項目を返す', () => {
      expect(resolveBranchPickerSelection(withCreateBranchOption([]), null)).toBe(
        CREATE_BRANCH_OPTION
      )
    })
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

  it('作成の項目も循環に含む', () => {
    const withCreate = withCreateBranchOption(items)
    expect(moveBranchPickerSelection(withCreate, 'feat/a', 1)).toBe(CREATE_BRANCH_OPTION)
    expect(moveBranchPickerSelection(withCreate, CREATE_BRANCH_OPTION, 1)).toBe('main')
    expect(moveBranchPickerSelection(withCreate, 'main', -1)).toBe(CREATE_BRANCH_OPTION)
  })
})

describe('withCreateBranchOption', () => {
  it('候補の先頭に作成の項目を足す', () => {
    expect(withCreateBranchOption([item('main', true)])).toEqual([
      item(CREATE_BRANCH_OPTION),
      item('main', true)
    ])
  })

  // 実在のブランチと同じ名前にならないよう、Git のブランチ名に使えない文字を含める
  it('作成の項目の名前は Git のブランチ名に使えない制御文字を含む', () => {
    expect(CREATE_BRANCH_OPTION).toContain('\0')
  })
})

describe('getBranchPickerShortcut', () => {
  const key = (
    overrides: Partial<Parameters<typeof getBranchPickerShortcut>[0]>
  ): Parameters<typeof getBranchPickerShortcut>[0] => ({
    key: '',
    code: '',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides
  })

  // macOS の Option+M は e.key が µ になるため、物理キーで判定する
  it.each(['m', 'µ'])('Alt と M の物理キーは merge(e.key が %s でも)', (k) => {
    expect(getBranchPickerShortcut(key({ key: k, code: 'KeyM', altKey: true }))).toBe('merge')
  })

  it.each(['shiftKey', 'ctrlKey', 'metaKey'] as const)('Alt+M に %s が付くと null', (mod) => {
    expect(
      getBranchPickerShortcut(key({ key: 'm', code: 'KeyM', altKey: true, [mod]: true }))
    ).toBeNull()
  })

  it('修飾キーの無い M は null(絞り込みの入力)', () => {
    expect(getBranchPickerShortcut(key({ key: 'm', code: 'KeyM' }))).toBeNull()
  })

  it.each(['Delete', 'Backspace'])('Shift+%s は delete', (k) => {
    expect(getBranchPickerShortcut(key({ key: k, shiftKey: true }))).toBe('delete')
  })

  it.each(['Delete', 'Backspace'])('修飾キーの無い %s は null(絞り込みの入力)', (k) => {
    expect(getBranchPickerShortcut(key({ key: k }))).toBeNull()
  })

  it.each(['altKey', 'ctrlKey', 'metaKey'] as const)('Shift+Delete に %s が付くと null', (mod) => {
    expect(getBranchPickerShortcut(key({ key: 'Delete', shiftKey: true, [mod]: true }))).toBeNull()
    expect(
      getBranchPickerShortcut(key({ key: 'Backspace', shiftKey: true, [mod]: true }))
    ).toBeNull()
  })

  it.each(['Enter', 'ArrowDown', 'a', 'Escape'])('%s は null', (k) => {
    expect(getBranchPickerShortcut(key({ key: k }))).toBeNull()
  })

  // 告知(aria-keyshortcuts)と判定の食い違いを防ぐ
  it('告知の各トークンは、そのキーの組み合わせとして判定される', () => {
    expect(BRANCH_PICKER_ARIA_KEYSHORTCUTS).toBe('Alt+M Shift+Delete')
    expect(getBranchPickerShortcut(key({ key: 'µ', code: 'KeyM', altKey: true }))).toBe('merge')
    expect(getBranchPickerShortcut(key({ key: 'Delete', shiftKey: true }))).toBe('delete')
  })
})
