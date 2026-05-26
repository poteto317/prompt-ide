import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import GitRepoView from '../GitRepoView'

const noFiles: GitFileStatus[] = []

const stagedFile: GitFileStatus = { path: 'staged.ts', index: 'A', workingDir: ' ' }
const changedFile: GitFileStatus = { path: 'changed.ts', index: ' ', workingDir: 'M' }

describe('GitRepoView', () => {
  it('branch 名が表示される', () => {
    render(<GitRepoView branch="main" ahead={0} behind={0} files={noFiles} />)
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('branch が null のとき "(no branch)" が表示される', () => {
    render(<GitRepoView branch={null} ahead={0} behind={0} files={noFiles} />)
    expect(screen.getByText('(no branch)')).toBeInTheDocument()
  })

  it('ahead > 0 のとき "↑N" が表示される', () => {
    render(<GitRepoView branch="main" ahead={3} behind={0} files={noFiles} />)
    expect(screen.getByText('↑3')).toBeInTheDocument()
  })

  it('behind > 0 のとき "↓N" が表示される', () => {
    render(<GitRepoView branch="main" ahead={0} behind={2} files={noFiles} />)
    expect(screen.getByText('↓2')).toBeInTheDocument()
  })

  it('ahead = 0 のとき ahead インジケーターが表示されない', () => {
    const { container } = render(<GitRepoView branch="main" ahead={0} behind={0} files={noFiles} />)
    expect(container.querySelector('.source-control-panel__ahead')).toBeNull()
  })

  it('behind = 0 のとき behind インジケーターが表示されない', () => {
    const { container } = render(<GitRepoView branch="main" ahead={0} behind={0} files={noFiles} />)
    expect(container.querySelector('.source-control-panel__behind')).toBeNull()
  })

  it('files が空のとき「変更はありません」が表示される', () => {
    render(<GitRepoView branch="main" ahead={0} behind={0} files={noFiles} />)
    expect(screen.getByText('変更はありません')).toBeInTheDocument()
  })

  it('files が空でないとき「変更はありません」は表示されない', () => {
    render(<GitRepoView branch="main" ahead={0} behind={0} files={[stagedFile]} />)
    expect(screen.queryByText('変更はありません')).not.toBeInTheDocument()
  })

  it('staged ファイルが StagedSection に委譲され「ステージ済み」セクションが表示される', () => {
    render(<GitRepoView branch="main" ahead={0} behind={0} files={[stagedFile]} />)
    expect(screen.getByText('ステージ済み (1)')).toBeInTheDocument()
    expect(screen.getByText('staged.ts')).toBeInTheDocument()
  })

  it('changed ファイルが ChangesSection に委譲され「変更」セクションが表示される', () => {
    render(<GitRepoView branch="main" ahead={0} behind={0} files={[changedFile]} />)
    expect(screen.getByText('変更 (1)')).toBeInTheDocument()
    expect(screen.getByText('changed.ts')).toBeInTheDocument()
  })
})
