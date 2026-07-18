import { describe, it, expect, vi } from 'vitest'
import type { FileTreeNode } from '../../types'
import { buildMenuItems } from '../explorerMenuItems'

const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
const dirNode: FileTreeNode = { name: 'src', path: '/project/src', type: 'directory', children: [] }

function makeActions() {
  return {
    onCreateFile: vi.fn(),
    onCreateDirectory: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn()
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

  it('node がディレクトリのとき4項目すべて返す', () => {
    const items = buildMenuItems('/project', dirNode, makeActions())
    expect(items.map((i) => i.label)).toEqual(['新規ファイル', '新規フォルダ', 'リネーム', '削除'])
  })

  it('node がファイルのときリネーム・削除のみ返す', () => {
    const items = buildMenuItems('/project', fileNode, makeActions())
    expect(items.map((i) => i.label)).toEqual(['リネーム', '削除'])
  })

  it('各項目が一意な id を持つ(React の key に使うため)', () => {
    const items = buildMenuItems('/project', dirNode, makeActions())
    const ids = items.map((i) => i.id)
    expect(ids).toEqual(['createFile', 'createDirectory', 'rename', 'delete'])
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
})
