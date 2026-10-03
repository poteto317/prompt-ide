import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FileTreeNode } from '../../../types'
import ExplorerPanel from '../ExplorerPanel'
import { makeCloneRepositoryPanelState } from '../../../__tests__/makeCloneRepositoryPanelState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// 「リポジトリを clone」は、退避・マージ・リモートのバナーのボタンと 1 つのグループセレクタで宣言を共有する
// (パターン 30・77)。グループから外れると見た目が崩れるため固定する。jsdom は :hover を計算しない
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const baseProps = {
  fileTree: [] as FileTreeNode[],
  openFilePath: null as string | null,
  onOpenFolder: vi.fn(),
  onSelectFile: vi.fn(),
  error: null as Error | null,
  gitignoreError: null as Error | null,
  onCreateFile: vi.fn(),
  onCreateDirectory: vi.fn(),
  onRenameEntry: vi.fn(),
  onDeleteEntry: vi.fn(),
  onAddToGitignore: vi.fn()
}

describe('エクスプローラーの clone のボタンのスタイル(main.css)', () => {
  it('「リポジトリを clone」は 32px 四方以上の枠付きボタン', () => {
    render(
      <ExplorerPanel {...baseProps} folderPath={null} clone={makeCloneRepositoryPanelState()} />
    )
    const style = getComputedStyle(screen.getByRole('button', { name: 'リポジトリを clone' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.borderTopStyle).toBe('solid')
    expect(style.cursor).toBe('pointer')
  })

  it('clone 中は「リポジトリを clone」と「フォルダを変更」が半透明で、カーソルが既定に戻る', () => {
    render(
      <ExplorerPanel
        {...baseProps}
        folderPath="/p"
        clone={makeCloneRepositoryPanelState({ isCloning: true })}
      />
    )
    for (const name of ['リポジトリを clone', 'フォルダを変更']) {
      const style = getComputedStyle(screen.getByRole('button', { name }))
      expect(style.opacity).toBe('0.5')
      expect(style.cursor).toBe('default')
    }
  })

  it('フォルダが未選択で clone 中は「フォルダを開く」も半透明で、カーソルが既定に戻る', () => {
    render(
      <ExplorerPanel
        {...baseProps}
        folderPath={null}
        clone={makeCloneRepositoryPanelState({ isCloning: true })}
      />
    )
    const style = getComputedStyle(screen.getByRole('button', { name: 'フォルダを開く' }))
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('default')
  })

  it('「リポジトリを clone」は左寄せで、パネルの左右の余白をフォルダのボタンと揃える', () => {
    render(
      <ExplorerPanel {...baseProps} folderPath={null} clone={makeCloneRepositoryPanelState()} />
    )
    const style = getComputedStyle(screen.getByRole('button', { name: 'リポジトリを clone' }))
    expect(style.alignSelf).toBe('flex-start')
    expect(style.marginLeft).toBe('12px')
    expect(style.marginRight).toBe('12px')
    expect(style.marginBottom).toBe('6px')
  })
})
