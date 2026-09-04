import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import ChangesSection from '../ChangesSection'

describe('ChangesSection', () => {
  it('changed ファイルがない場合は何も描画しない', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: 'M', workingDir: ' ' }]
    const { container } = render(
      <ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('changed ファイルがある場合はセクションタイトルと件数を表示する', () => {
    const files: GitFileStatus[] = [
      { path: 'a.ts', index: ' ', workingDir: 'M' },
      { path: 'b.ts', index: ' ', workingDir: 'D' },
    ]
    render(<ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={vi.fn()} />)
    expect(screen.getByText('変更 (2)')).toBeInTheDocument()
  })

  it('changed ファイルのパスが表示される', () => {
    const files: GitFileStatus[] = [{ path: 'README.md', index: ' ', workingDir: 'M' }]
    render(<ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={vi.fn()} />)
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('未追跡ファイル（index="?"）は "U" で表示される', () => {
    const files: GitFileStatus[] = [{ path: 'new-file.ts', index: '?', workingDir: '?' }]
    render(<ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={vi.fn()} />)
    expect(screen.getByText('U')).toBeInTheDocument()
    expect(screen.getByText('new-file.ts')).toBeInTheDocument()
  })

  it('作業ツリー変更ファイルに statusChar が適用される', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: 'M' }]
    render(<ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={vi.fn()} />)
    expect(screen.getByText('M')).toBeInTheDocument()
  })

  it('index も workingDir も変更なし（" "）のときは何も描画しない', () => {
    // workingDir=' ' && index!='?' → フィルターで除外 → セクション非表示
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: ' ' }]
    const { container } = render(
      <ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  describe('ステージボタン', () => {
    it('各ファイルにステージボタンを表示する', () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      render(<ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={vi.fn()} />)
      expect(screen.getByLabelText('src/index.ts をステージ')).toBeInTheDocument()
    })

    it('ステージボタンをクリックすると onStage がそのパスで呼ばれる', async () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      const onStage = vi.fn()
      render(<ChangesSection files={files} stagingPaths={new Set()} onStage={onStage} onOpenDiff={vi.fn()} />)
      await userEvent.click(screen.getByLabelText('src/index.ts をステージ'))
      expect(onStage).toHaveBeenCalledWith('src/index.ts')
    })

    it('stagingPaths に含まれるファイルのステージボタンは無効化される', () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      render(
        <ChangesSection
          files={files}
          stagingPaths={new Set(['src/index.ts'])}
          onStage={vi.fn()}
          onOpenDiff={vi.fn()}
        />
      )
      expect(screen.getByLabelText('src/index.ts をステージ')).toBeDisabled()
    })
  })

  describe('diff表示', () => {
    it('ファイル行をクリックすると onOpenDiff がそのパスで呼ばれる', async () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      const onOpenDiff = vi.fn()
      render(
        <ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={onOpenDiff} />
      )
      await userEvent.click(screen.getByRole('button', { name: 'src/index.ts の差分を表示' }))
      expect(onOpenDiff).toHaveBeenCalledWith('src/index.ts')
    })

    it('ファイルパスがキーボードで到達可能なボタンとして表示される', () => {
      // <li onClick> だけでは支援技術・キーボード操作のみのユーザーが diff を
      // 開けないため、button + aria-label で到達可能にする
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      render(
        <ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={vi.fn()} />
      )
      expect(screen.getByRole('button', { name: 'src/index.ts の差分を表示' })).toBeInTheDocument()
    })

    it('ステージボタンをクリックしても onOpenDiff は呼ばれない', async () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      const onOpenDiff = vi.fn()
      render(
        <ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={onOpenDiff} />
      )
      await userEvent.click(screen.getByLabelText('src/index.ts をステージ'))
      expect(onOpenDiff).not.toHaveBeenCalled()
    })
  })
})
