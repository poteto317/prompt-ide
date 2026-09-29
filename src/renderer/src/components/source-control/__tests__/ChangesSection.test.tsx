import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import ChangesSection from '../ChangesSection'

describe('ChangesSection', () => {
  it('changed ファイルがない場合は何も描画しない', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: 'M', workingDir: ' ' }]
    const { container } = render(
      <ChangesSection
        files={files}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('changed ファイルがある場合はセクションタイトルと件数を表示する', () => {
    const files: GitFileStatus[] = [
      { path: 'a.ts', index: ' ', workingDir: 'M' },
      { path: 'b.ts', index: ' ', workingDir: 'D' }
    ]
    render(
      <ChangesSection
        files={files}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(screen.getByText('変更 (2)')).toBeInTheDocument()
  })

  it('changed ファイルのパスが表示される', () => {
    const files: GitFileStatus[] = [{ path: 'README.md', index: ' ', workingDir: 'M' }]
    render(
      <ChangesSection
        files={files}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('未追跡ファイル（index="?"）は "U" で表示される', () => {
    const files: GitFileStatus[] = [{ path: 'new-file.ts', index: '?', workingDir: '?' }]
    render(
      <ChangesSection
        files={files}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(screen.getByText('U')).toBeInTheDocument()
    expect(screen.getByText('new-file.ts')).toBeInTheDocument()
  })

  it('作業ツリー変更ファイルに statusChar が適用される', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: 'M' }]
    render(
      <ChangesSection
        files={files}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(screen.getByText('M')).toBeInTheDocument()
  })

  it('index も workingDir も変更なし（" "）のときは何も描画しない', () => {
    // workingDir=' ' && index!='?' → フィルターで除外 → セクション非表示
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: ' ' }]
    const { container } = render(
      <ChangesSection
        files={files}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  describe('ステージボタン', () => {
    it('各ファイルにステージボタンを表示する', () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      render(
        <ChangesSection
          files={files}
          stagingPaths={new Set()}
          onStage={vi.fn()}
          onDiscard={vi.fn()}
          onOpenDiff={vi.fn()}
        />
      )
      expect(screen.getByLabelText('src/index.ts をステージ')).toBeInTheDocument()
    })

    it('ステージボタンをクリックすると onStage がそのパスで呼ばれる', async () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      const onStage = vi.fn()
      render(
        <ChangesSection
          files={files}
          stagingPaths={new Set()}
          onStage={onStage}
          onDiscard={vi.fn()}
          onOpenDiff={vi.fn()}
        />
      )
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
          onDiscard={vi.fn()}
          onOpenDiff={vi.fn()}
        />
      )
      expect(screen.getByLabelText('src/index.ts をステージ')).toBeDisabled()
    })

    it('isLocked が true を返すファイルのステージボタンは無効化される(同じファイルへのハンク操作との競合防止)', () => {
      // diff タブでの「このハンクをステージ」(git apply --cached)が同じファイルに
      // 対して実行中の間、ChangesSection のステージボタン(git add)まで押せると
      // 両方が同時に .git/index を書き換えてしまう。stagingPaths(このセクション
      // 自身の実行中状態)だけでなく、共有ロックの状態も見る必要がある
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      render(
        <ChangesSection
          files={files}
          stagingPaths={new Set()}
          onStage={vi.fn()}
          onDiscard={vi.fn()}
          onOpenDiff={vi.fn()}
          isLocked={(path) => path === 'src/index.ts'}
        />
      )
      expect(screen.getByLabelText('src/index.ts をステージ')).toBeDisabled()
    })

    it('isAnyLocked が true の場合、対象パス自身が isLocked でなくてもステージボタンを無効化する(別ファイルの stage/ハンク操作との競合防止)', () => {
      // useGitOperations.runStageOperation は、対象パス単独の isLocked(path) だけでなく
      // lock.isAnyLocked()(無関係な別ファイルの stage/ハンク操作が実行中か)も見て
      // 新規の stage をブロックする。ボタン側の disabled 判定がこれを見ていないと、
      // 別ファイルの操作中でもこのボタンは押せるように見え、押しても無言で
      // 弾かれるだけの状態になる
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      render(
        <ChangesSection
          files={files}
          stagingPaths={new Set()}
          onStage={vi.fn()}
          onDiscard={vi.fn()}
          onOpenDiff={vi.fn()}
          isLocked={() => false}
          isAnyLocked={() => true}
        />
      )
      expect(screen.getByLabelText('src/index.ts をステージ')).toBeDisabled()
    })

    it('stagingPaths に別ファイルが含まれる場合も、このファイル自身が含まれていなくてもステージボタンを無効化する(useGitOperations の全体直列化ガードとの整合)', () => {
      // useGitOperations.runStageOperation は stagingPathsRef.current.size > 0
      // (対象パスに関わらず、他のファイルの stage/unstage が実行中か)を見て
      // 新規の stage をブロックする(cycle 42 で対応済み)。ボタン側が
      // stagingPaths.has(f.path)(このファイル自身が含まれるか)しか見ないと、
      // 別ファイルが stagingPaths に入っている間もこのボタンは押せるように見え、
      // 押しても無言で弾かれるだけの状態になる
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      render(
        <ChangesSection
          files={files}
          stagingPaths={new Set(['other.ts'])}
          onStage={vi.fn()}
          onDiscard={vi.fn()}
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
        <ChangesSection
          files={files}
          stagingPaths={new Set()}
          onStage={vi.fn()}
          onDiscard={vi.fn()}
          onOpenDiff={onOpenDiff}
        />
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'src/index.ts の未ステージ差分を表示' })
      )
      expect(onOpenDiff).toHaveBeenCalledWith('src/index.ts')
    })

    it('ファイルパスがキーボードで到達可能なボタンとして表示される', () => {
      // <li onClick> だけでは支援技術・キーボード操作のみのユーザーが diff を
      // 開けないため、button + aria-label で到達可能にする
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      render(
        <ChangesSection
          files={files}
          stagingPaths={new Set()}
          onStage={vi.fn()}
          onDiscard={vi.fn()}
          onOpenDiff={vi.fn()}
        />
      )
      expect(
        screen.getByRole('button', { name: 'src/index.ts の未ステージ差分を表示' })
      ).toBeInTheDocument()
    })

    it('ステージボタンをクリックしても onOpenDiff は呼ばれない', async () => {
      const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
      const onOpenDiff = vi.fn()
      render(
        <ChangesSection
          files={files}
          stagingPaths={new Set()}
          onStage={vi.fn()}
          onDiscard={vi.fn()}
          onOpenDiff={onOpenDiff}
        />
      )
      await userEvent.click(screen.getByLabelText('src/index.ts をステージ'))
      expect(onOpenDiff).not.toHaveBeenCalled()
    })
  })

  describe('取り消しボタン', () => {
    // 取り消しボタンの表示条件(未追跡ファイル・コンフリクト時の非表示)は ChangesFileItem の
    // 責務のため ChangesFileItem.test.tsx で検証する。ここでは ChangesSection が
    // onDiscard を ChangesFileItem まで配線していることだけを確認する
    it('取り消しボタンを押すと onDiscard がパスで呼ばれる(配線の確認)', async () => {
      const onDiscard = vi.fn()
      render(
        <ChangesSection
          files={[{ path: 'src/a.ts', index: ' ', workingDir: 'M' }]}
          stagingPaths={new Set()}
          onStage={vi.fn()}
          onDiscard={onDiscard}
          onOpenDiff={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'src/a.ts の変更を取り消し' }))
      expect(onDiscard).toHaveBeenCalledWith('src/a.ts')
    })

    it.each([
      ['他の stage/unstage/取り消しの実行中', { stagingPaths: new Set(['other.ts']) }],
      ['他の操作がロック中', { isAnyLocked: () => true }],
      ['対象パスがロック中', { isLocked: (p: string) => p === 'src/a.ts' }]
    ] as const)('%s は disabled になる', (_label, props) => {
      render(
        <ChangesSection
          files={[{ path: 'src/a.ts', index: ' ', workingDir: 'M' }]}
          stagingPaths={new Set()}
          onStage={vi.fn()}
          onDiscard={vi.fn()}
          onOpenDiff={vi.fn()}
          {...props}
        />
      )
      expect(screen.getByRole('button', { name: 'src/a.ts の変更を取り消し' })).toBeDisabled()
    })
  })
})
