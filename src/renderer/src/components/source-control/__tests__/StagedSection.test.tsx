import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import StagedSection from '../StagedSection'

describe('StagedSection', () => {
  it('staged ファイルがない場合は何も描画しない', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: 'M' }]
    const { container } = render(
      <StagedSection
        files={files}
        stagingPaths={new Set()}
        onUnstage={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('index="?" のファイルは staged に含まない', () => {
    const files: GitFileStatus[] = [{ path: 'new.ts', index: '?', workingDir: '?' }]
    const { container } = render(
      <StagedSection
        files={files}
        stagingPaths={new Set()}
        onUnstage={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('staged ファイルがある場合はセクションタイトルと件数を表示する', () => {
    const files: GitFileStatus[] = [
      { path: 'a.ts', index: 'M', workingDir: ' ' },
      { path: 'b.ts', index: 'A', workingDir: ' ' }
    ]
    render(
      <StagedSection
        files={files}
        stagingPaths={new Set()}
        onUnstage={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(screen.getByRole('heading', { name: 'ステージされている変更 2' })).toBeInTheDocument()
  })

  it('行は「変更」セクションと同じ形(差分のボタン、操作の枠、状態の文字)で並ぶ', () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
    render(
      <StagedSection
        files={files}
        stagingPaths={new Set()}
        onUnstage={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    const open = screen.getByRole('button', { name: 'src/index.ts のステージ済み差分を表示' })
    const row = open.parentElement as HTMLElement
    expect(row.tagName).toBe('LI')
    expect(row.children).toHaveLength(3)
    expect(open).toHaveAttribute('title', 'src/index.ts')
    expect(row.children[1]).toContainElement(screen.getByLabelText('src/index.ts をアンステージ'))
    expect(row.lastElementChild).toHaveTextContent('M')
  })

  it('閉じても一覧はアンマウントせず、hidden の本体に残る', async () => {
    const files: GitFileStatus[] = [{ path: 'index.ts', index: 'M', workingDir: ' ' }]
    render(
      <StagedSection
        files={files}
        stagingPaths={new Set()}
        onUnstage={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'ステージされている変更' }))
    expect(screen.getByText('index.ts')).not.toBeVisible()
  })

  it('staged ファイルのパスが表示される', () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
    render(
      <StagedSection
        files={files}
        stagingPaths={new Set()}
        onUnstage={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(screen.getByText('index.ts')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
  })

  it('staged ファイルのステータス文字（index）が表示される', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: 'A', workingDir: ' ' }]
    render(
      <StagedSection
        files={files}
        stagingPaths={new Set()}
        onUnstage={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('index が " " のとき staged フィルタで除外され何も描画しない', () => {
    // staged フィルタは index !== ' ' && index !== '?' なので ' ' は除外される
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: ' ' }]
    const { container } = render(
      <StagedSection
        files={files}
        stagingPaths={new Set()}
        onUnstage={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  describe('アンステージボタン', () => {
    it('各ファイルにアンステージボタンを表示する', () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      render(
        <StagedSection
          files={files}
          stagingPaths={new Set()}
          onUnstage={vi.fn()}
          onOpenDiff={vi.fn()}
        />
      )
      expect(screen.getByLabelText('src/index.ts をアンステージ')).toBeInTheDocument()
    })

    it('アンステージボタンをクリックすると onUnstage がそのパスで呼ばれる', async () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      const onUnstage = vi.fn()
      render(
        <StagedSection
          files={files}
          stagingPaths={new Set()}
          onUnstage={onUnstage}
          onOpenDiff={vi.fn()}
        />
      )
      await userEvent.click(screen.getByLabelText('src/index.ts をアンステージ'))
      expect(onUnstage).toHaveBeenCalledWith('src/index.ts', undefined)
    })

    it('リネームされたファイルのアンステージボタンをクリックすると onUnstage が旧パス(from)も添えて呼ばれる', async () => {
      // 新パスだけを渡してアンステージすると、旧パスの削除だけが index に残ったまま
      // (D old.txt / ?? new.txt)になり、壊れた状態を作ってしまう
      // (main/gitService.ts で実機再現確認済み)。from を渡し忘れると
      // useGitOperations.unstageFile が renamedFrom 無しで呼ばれてしまう
      const files: GitFileStatus[] = [
        { path: 'new.txt', index: 'R', workingDir: ' ', from: 'old.txt' }
      ]
      const onUnstage = vi.fn()
      render(
        <StagedSection
          files={files}
          stagingPaths={new Set()}
          onUnstage={onUnstage}
          onOpenDiff={vi.fn()}
        />
      )
      await userEvent.click(screen.getByLabelText('new.txt をアンステージ'))
      expect(onUnstage).toHaveBeenCalledWith('new.txt', 'old.txt')
    })

    it('stagingPaths に含まれるファイルのアンステージボタンは無効化される', () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      render(
        <StagedSection
          files={files}
          stagingPaths={new Set(['src/index.ts'])}
          onUnstage={vi.fn()}
          onOpenDiff={vi.fn()}
        />
      )
      expect(screen.getByLabelText('src/index.ts をアンステージ')).toBeDisabled()
    })

    it('isLocked が true を返すファイルのアンステージボタンは無効化される(同じファイルへのハンク操作との競合防止)', () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      render(
        <StagedSection
          files={files}
          stagingPaths={new Set()}
          onUnstage={vi.fn()}
          onOpenDiff={vi.fn()}
          isLocked={(path) => path === 'src/index.ts'}
        />
      )
      expect(screen.getByLabelText('src/index.ts をアンステージ')).toBeDisabled()
    })

    it('isAnyLocked が true の場合、対象パス自身が isLocked でなくてもアンステージボタンを無効化する(別ファイルの stage/ハンク操作との競合防止)', () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      render(
        <StagedSection
          files={files}
          stagingPaths={new Set()}
          onUnstage={vi.fn()}
          onOpenDiff={vi.fn()}
          isLocked={() => false}
          isAnyLocked={() => true}
        />
      )
      expect(screen.getByLabelText('src/index.ts をアンステージ')).toBeDisabled()
    })

    it('stagingPaths に別ファイルが含まれる場合も、このファイル自身が含まれていなくてもアンステージボタンを無効化する(useGitOperations の全体直列化ガードとの整合)', () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      render(
        <StagedSection
          files={files}
          stagingPaths={new Set(['other.ts'])}
          onUnstage={vi.fn()}
          onOpenDiff={vi.fn()}
        />
      )
      expect(screen.getByLabelText('src/index.ts をアンステージ')).toBeDisabled()
    })
  })

  describe('diff表示', () => {
    it('ファイル行をクリックすると onOpenDiff がそのパスで呼ばれる', async () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      const onOpenDiff = vi.fn()
      render(
        <StagedSection
          files={files}
          stagingPaths={new Set()}
          onUnstage={vi.fn()}
          onOpenDiff={onOpenDiff}
        />
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'src/index.ts のステージ済み差分を表示' })
      )
      expect(onOpenDiff).toHaveBeenCalledWith('src/index.ts')
    })

    it('ファイルパスがキーボードで到達可能なボタンとして表示される', () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      render(
        <StagedSection
          files={files}
          stagingPaths={new Set()}
          onUnstage={vi.fn()}
          onOpenDiff={vi.fn()}
        />
      )
      expect(
        screen.getByRole('button', { name: 'src/index.ts のステージ済み差分を表示' })
      ).toBeInTheDocument()
    })

    it('アンステージボタンをクリックしても onOpenDiff は呼ばれない', async () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
      const onOpenDiff = vi.fn()
      render(
        <StagedSection
          files={files}
          stagingPaths={new Set()}
          onUnstage={vi.fn()}
          onOpenDiff={onOpenDiff}
        />
      )
      await userEvent.click(screen.getByLabelText('src/index.ts をアンステージ'))
      expect(onOpenDiff).not.toHaveBeenCalled()
    })
  })
})
