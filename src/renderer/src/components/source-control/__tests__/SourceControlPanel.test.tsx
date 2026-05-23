import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import SourceControlPanel from '../SourceControlPanel'

const baseProps = {
  gitStatus: null as GitStatusResult | null,
  gitLoading: false,
  gitError: null as Error | null,
  onRefresh: vi.fn(),
}

const repoStatus: GitStatusResult = {
  isRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [],
}

describe('SourceControlPanel', () => {
  it('gitStatus が null のとき「フォルダを開いてください」が表示される', () => {
    render(<SourceControlPanel {...baseProps} />)
    expect(screen.getByText('フォルダを開いてください')).toBeInTheDocument()
  })

  it('gitLoading が true のとき「読み込み中...」が表示される', () => {
    render(<SourceControlPanel {...baseProps} gitLoading={true} />)
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('gitLoading が true のとき「フォルダを開いてください」は表示されない', () => {
    render(<SourceControlPanel {...baseProps} gitLoading={true} />)
    expect(screen.queryByText('フォルダを開いてください')).not.toBeInTheDocument()
  })

  it('isRepo: false のとき「Git リポジトリではありません」が表示される', () => {
    const notRepo: GitStatusResult = { isRepo: false, branch: null, ahead: 0, behind: 0, files: [] }
    render(<SourceControlPanel {...baseProps} gitStatus={notRepo} />)
    expect(screen.getByText('Git リポジトリではありません')).toBeInTheDocument()
  })

  it('files が空のときブランチ名と「変更はありません」が表示される', () => {
    render(<SourceControlPanel {...baseProps} gitStatus={repoStatus} />)
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('変更はありません')).toBeInTheDocument()
  })

  it('ステージ済みファイルが「ステージ済み」セクションに表示される', () => {
    const status: GitStatusResult = {
      ...repoStatus,
      files: [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }],
    }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('ステージ済み (1)')).toBeInTheDocument()
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
  })

  it('ステージ済みファイルのステータス文字が表示される（M）', () => {
    const status: GitStatusResult = {
      ...repoStatus,
      files: [{ path: 'file.ts', index: 'A', workingDir: ' ' }],
    }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('変更ファイルが「変更」セクションに表示される', () => {
    const status: GitStatusResult = {
      ...repoStatus,
      files: [{ path: 'README.md', index: ' ', workingDir: 'M' }],
    }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('変更 (1)')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('未追跡ファイル（index="?", workingDir="?"）が「変更」セクションに U で表示される', () => {
    const status: GitStatusResult = {
      ...repoStatus,
      files: [{ path: 'new-file.ts', index: '?', workingDir: '?' }],
    }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('変更 (1)')).toBeInTheDocument()
    expect(screen.getByText('U')).toBeInTheDocument()
    expect(screen.getByText('new-file.ts')).toBeInTheDocument()
  })

  it('ステージ済みと変更の両セクションが同時に表示される', () => {
    const status: GitStatusResult = {
      ...repoStatus,
      files: [
        { path: 'staged.ts', index: 'A', workingDir: ' ' },
        { path: 'changed.ts', index: ' ', workingDir: 'M' },
      ],
    }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('ステージ済み (1)')).toBeInTheDocument()
    expect(screen.getByText('変更 (1)')).toBeInTheDocument()
  })

  it('ahead が正のとき「↑N」が表示される', () => {
    const status: GitStatusResult = { ...repoStatus, ahead: 3 }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('↑3')).toBeInTheDocument()
  })

  it('behind が正のとき「↓N」が表示される', () => {
    const status: GitStatusResult = { ...repoStatus, behind: 2 }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('↓2')).toBeInTheDocument()
  })

  it('更新ボタンをクリックすると onRefresh が呼ばれる', async () => {
    const onRefresh = vi.fn()
    render(<SourceControlPanel {...baseProps} onRefresh={onRefresh} />)
    await userEvent.click(screen.getByRole('button', { name: '更新' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('gitLoading が true のとき更新ボタンが disabled になる', () => {
    render(<SourceControlPanel {...baseProps} gitLoading={true} />)
    expect(screen.getByRole('button', { name: '更新' })).toBeDisabled()
  })

  it('gitError が渡されたとき error.message が表示される', () => {
    render(<SourceControlPanel {...baseProps} gitError={new Error('git fatal error')} />)
    expect(screen.getByText('git fatal error')).toBeInTheDocument()
  })

  it('branch が null のとき "(no branch)" が表示される', () => {
    const status: GitStatusResult = { ...repoStatus, branch: null }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('(no branch)')).toBeInTheDocument()
  })
})
