import { describe, it, expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { FileTreeNode } from '../../types'
import { buildMenuItems } from '../explorerMenuItems'

const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
const dirNode: FileTreeNode = { name: 'src', path: '/project/src', type: 'directory', children: [] }

type BaseActionName =
  | 'onCreateFile'
  | 'onCreateDirectory'
  | 'onRename'
  | 'onDelete'
  | 'onAddToGitignore'

function makeActions(): Record<BaseActionName, Mock> {
  return {
    onCreateFile: vi.fn(),
    onCreateDirectory: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onAddToGitignore: vi.fn()
  }
}

describe('buildMenuItems', () => {
  it('folderPath が null のとき空配列を返す', () => {
    const items = buildMenuItems(null, fileNode, makeActions())
    expect(items).toEqual([])
  })

  it('node が null(ツリー空白領域)のとき新規作成2項目のみ返す', () => {
    const items = buildMenuItems('/project', null, makeActions())
    expect(items.map((i) => i.label)).toEqual(['新規ファイル', '新規フォルダ'])
  })

  it('node がディレクトリのとき5項目すべて返す', () => {
    const items = buildMenuItems('/project', dirNode, makeActions())
    expect(items.map((i) => i.label)).toEqual([
      '新規ファイル',
      '新規フォルダ',
      'リネーム',
      '削除',
      '.gitignore に追加'
    ])
  })

  it('node がファイルのときリネーム・削除・.gitignore に追加が返される', () => {
    const items = buildMenuItems('/project', fileNode, makeActions())
    expect(items.map((i) => i.label)).toEqual(['リネーム', '削除', '.gitignore に追加'])
  })

  it('各項目が一意な id を持つ(React の key に使うため)', () => {
    const items = buildMenuItems('/project', dirNode, makeActions())
    const ids = items.map((i) => i.id)
    expect(ids).toEqual(['createFile', 'createDirectory', 'rename', 'delete', 'addToGitignore'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('node が null のとき新規作成の parentPath は folderPath になる', () => {
    const actions = makeActions()
    const items = buildMenuItems('/project', null, actions)
    items.find((i) => i.label === '新規ファイル')?.onSelect()
    expect(actions.onCreateFile).toHaveBeenCalledWith('/project')
  })

  it('node がディレクトリのとき新規作成の parentPath は node.path になる', () => {
    const actions = makeActions()
    const items = buildMenuItems('/project', dirNode, actions)
    items.find((i) => i.label === '新規フォルダ')?.onSelect()
    expect(actions.onCreateDirectory).toHaveBeenCalledWith('/project/src')
  })

  it('リネームの onSelect は対象ノードを渡して onRename を呼ぶ', () => {
    const actions = makeActions()
    const items = buildMenuItems('/project', fileNode, actions)
    items.find((i) => i.label === 'リネーム')?.onSelect()
    expect(actions.onRename).toHaveBeenCalledWith(fileNode)
  })

  it('削除の onSelect は対象ノードを渡して onDelete を呼ぶ', () => {
    const actions = makeActions()
    const items = buildMenuItems('/project', dirNode, actions)
    items.find((i) => i.label === '削除')?.onSelect()
    expect(actions.onDelete).toHaveBeenCalledWith(dirNode)
  })

  describe('参照として添える(エージェント CLI 方式のときだけ onAddReference を渡す)', () => {
    it('onAddReference があれば、ファイルのメニューの末尾に出し、選ぶとそのノードを渡す', () => {
      const onAddReference = vi.fn()
      const items = buildMenuItems('/project', fileNode, { ...makeActions(), onAddReference })
      expect(items.map((i) => i.label)).toEqual([
        'リネーム',
        '削除',
        '.gitignore に追加',
        '参照として添える'
      ])
      expect(items.at(-1)?.id).toBe('addReference')
      items.at(-1)?.onSelect()
      expect(onAddReference).toHaveBeenCalledExactlyOnceWith(fileNode)
    })

    it('フォルダ・ツリーの空白には出さない', () => {
      const onAddReference = vi.fn()
      const actions = { ...makeActions(), onAddReference }
      expect(buildMenuItems('/project', dirNode, actions).map((i) => i.label)).not.toContain(
        '参照として添える'
      )
      expect(buildMenuItems('/project', null, actions).map((i) => i.label)).not.toContain(
        '参照として添える'
      )
    })

    it('onAddReference が無ければ出さない', () => {
      expect(buildMenuItems('/project', fileNode, makeActions()).map((i) => i.label)).not.toContain(
        '参照として添える'
      )
    })
  })
})

describe('.gitignoreに追加', () => {
  it('node が非nullのとき「.gitignore に追加」項目を含む', () => {
    const node: FileTreeNode = { name: 'dist', path: '/project/dist', type: 'directory' }
    const items = buildMenuItems('/project', node, {
      onCreateFile: vi.fn(),
      onCreateDirectory: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onAddToGitignore: vi.fn()
    })
    expect(items.some((item) => item.id === 'addToGitignore')).toBe(true)
  })

  it('「.gitignore に追加」を選択すると onAddToGitignore が node で呼ばれる', () => {
    const node: FileTreeNode = { name: 'dist', path: '/project/dist', type: 'directory' }
    const onAddToGitignore = vi.fn()
    const items = buildMenuItems('/project', node, {
      onCreateFile: vi.fn(),
      onCreateDirectory: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onAddToGitignore
    })
    items.find((item) => item.id === 'addToGitignore')?.onSelect()
    expect(onAddToGitignore).toHaveBeenCalledWith(node)
  })

  it('node が null のとき「.gitignore に追加」項目を含まない', () => {
    const items = buildMenuItems('/project', null, {
      onCreateFile: vi.fn(),
      onCreateDirectory: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onAddToGitignore: vi.fn()
    })
    expect(items.some((item) => item.id === 'addToGitignore')).toBe(false)
  })
})
