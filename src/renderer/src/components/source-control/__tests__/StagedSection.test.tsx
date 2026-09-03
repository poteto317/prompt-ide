import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import StagedSection from '../StagedSection'

describe('StagedSection', () => {
  it('staged ファイルがない場合は何も描画しない', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: 'M' }]
    const { container } = render(
      <StagedSection files={files} stagingPaths={new Set()} onUnstage={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('index="?" のファイルは staged に含まない', () => {
    const files: GitFileStatus[] = [{ path: 'new.ts', index: '?', workingDir: '?' }]
    const { container } = render(
      <StagedSection files={files} stagingPaths={new Set()} onUnstage={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('staged ファイルがある場合はセクションタイトルと件数を表示する', () => {
    const files: GitFileStatus[] = [
      { path: 'a.ts', index: 'M', workingDir: ' ' },
      { path: 'b.ts', index: 'A', workingDir: ' ' },
    ]
    render(<StagedSection files={files} stagingPaths={new Set()} onUnstage={vi.fn()} />)
    expect(screen.getByText('ステージ済み (2)')).toBeInTheDocument()
  })

  it('staged ファイルのパスが表示される', () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
    render(<StagedSection files={files} stagingPaths={new Set()} onUnstage={vi.fn()} />)
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
  })

  it('staged ファイルのステータス文字（index）が表示される', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: 'A', workingDir: ' ' }]
    render(<StagedSection files={files} stagingPaths={new Set()} onUnstage={vi.fn()} />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('index が " " のとき staged フィルタで除外され何も描画しない', () => {
    // staged フィルタは index !== ' ' && index !== '?' なので ' ' は除外される
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: ' ' }]
    const { container } = render(
      <StagedSection files={files} stagingPaths={new Set()} onUnstage={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  describe('アンステージボタン', () => {
    it('各ファイルにアンステージボタンを表示する', () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      render(<StagedSection files={files} stagingPaths={new Set()} onUnstage={vi.fn()} />)
      expect(screen.getByLabelText('src/index.ts をアンステージ')).toBeInTheDocument()
    })

    it('アンステージボタンをクリックすると onUnstage がそのパスで呼ばれる', async () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      const onUnstage = vi.fn()
      render(<StagedSection files={files} stagingPaths={new Set()} onUnstage={onUnstage} />)
      await userEvent.click(screen.getByLabelText('src/index.ts をアンステージ'))
      expect(onUnstage).toHaveBeenCalledWith('src/index.ts')
    })

    it('stagingPaths に含まれるファイルのアンステージボタンは無効化される', () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      render(
        <StagedSection
          files={files}
          stagingPaths={new Set(['src/index.ts'])}
          onUnstage={vi.fn()}
        />
      )
      expect(screen.getByLabelText('src/index.ts をアンステージ')).toBeDisabled()
    })
  })
})
