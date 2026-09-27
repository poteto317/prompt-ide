import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import CommitSection from '../CommitSection'

describe('CommitSection', () => {
  it('メッセージ入力欄とコミットボタンを表示する', () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    expect(screen.getByLabelText('コミットメッセージ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
  })

  it('メッセージが空のときコミットボタンは無効', () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('メッセージが空白のみのときコミットボタンは無効', async () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), '   ')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('stagedCount が 0 のときコミットボタンは無効', async () => {
    render(
      <CommitSection
        stagedCount={0}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('メッセージ入力済み・ステージあり・実行中でないときコミットボタンは有効', async () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeEnabled()
  })

  it('isBlockedByOtherOperation が true のときコミットボタンは無効(stage/unstage やハンク操作の実行中)', async () => {
    // useGitOperations.ts の runCommitOperation は、stage/unstage(git add/reset)や
    // ハンク操作(git apply --cached)の実行中は .git/index の競合を避けて
    // サイレントに no-op する。ボタン側で disabled にしないと、押しても何も
    // 起きない(エラーも出ない)状態にユーザーには見えてしまう
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
        isBlockedByOtherOperation
      />
    )
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('isBlockedByOtherOperation を省略した場合は従来通りコミットボタンが有効になる', async () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeEnabled()
  })

  it('コミットボタンをクリックすると onCommit がメッセージで呼ばれる', async () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={onCommit}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(onCommit).toHaveBeenCalledWith('feat: 新機能')
  })

  it('コミット成功時にメッセージ入力欄をクリアする', async () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={onCommit}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    const input = screen.getByLabelText('コミットメッセージ') as HTMLTextAreaElement
    await userEvent.type(input, 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(input.value).toBe('')
  })

  it('コミット失敗時はメッセージ入力欄を保持する', async () => {
    const onCommit = vi.fn().mockResolvedValue(false)
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={onCommit}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    const input = screen.getByLabelText('コミットメッセージ') as HTMLTextAreaElement
    await userEvent.type(input, 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(input.value).toBe('feat: 新機能')
  })

  it('isCommitting が true のときコミットボタンは無効かつ実行中表示', async () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={true}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    expect(screen.getByRole('button', { name: /コミット/ })).toBeDisabled()
  })

  it('isCommitting が true のときメッセージ欄とamendチェックボックスも無効化される', () => {
    // 実行中も編集可能だと、完了時に無条件でメッセージ欄をクリアする処理と
    // 競合し、実行中に打ち直した入力が黙って消えてしまう
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={true}
        onCommit={vi.fn()}
        lastCommitMessage="feat: 直前のコミット"
        onAmend={vi.fn()}
      />
    )
    expect(screen.getByLabelText('コミットメッセージ')).toBeDisabled()
    expect(screen.getByLabelText('amend')).toBeDisabled()
  })

  it('isBlockedByOtherOperation が true のとき amend チェックボックスも無効(コミットボタンだけ揃えても、実行中に amend を仕込めてしまう)', () => {
    // コミットボタンの isDisabled には isBlockedByOtherOperation が入っているが、
    // amend チェックボックスの disabled には入っていなかった。stage/unstage や
    // ハンク操作の実行中でも amend をチェックできてしまい、直前コミットメッセージが
    // 自動入力される。その操作が完了して isBlockedByOtherOperation が false に
    // 戻った瞬間、amend チェック済みのままコミットボタンが有効になり、ユーザーが
    // 新規コミットのつもりで押すと直前コミットを意図せず書き換えてしまう
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage="feat: 直前のコミット"
        onAmend={vi.fn()}
        isBlockedByOtherOperation
      />
    )
    expect(screen.getByLabelText('amend')).toBeDisabled()
  })

  it('isLoadingFolder が true のとき amend チェックボックスは無効(lastCommitMessage が別フォルダの古い値の可能性があるため)', () => {
    // フォルダを切り替えた直後、useGitHistory の log は新フォルダの取得が完了する
    // まで前フォルダの値が残る。isLoadingFolder を見ずに lastCommitMessage だけで
    // 判定すると、この間に amend を実行してしまい、無関係な別リポジトリの
    // 直前コミットメッセージで意図しない amend が成立してしまう
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage="feat: 別フォルダの直前コミット"
        onAmend={vi.fn()}
        isLoadingFolder={true}
      />
    )
    expect(screen.getByLabelText('amend')).toBeDisabled()
  })

  it('isLoadingFolder が true になったら amend チェックとメッセージ入力欄をリセットする(フォルダ切替時に前フォルダの内容を残さない)', async () => {
    // CommitSection はフォルダを切り替えても再マウントされない(App.tsx 側に
    // key 等の仕組みが無い)ため、isAmend/message をローカル state のまま
    // 放置すると、フォルダ A で amend にチェックしメッセージ欄に A の直前
    // コミットメッセージが入った状態のまま無関係な B へ切り替わり、
    // B でステージ済みファイルがあればそのままコミットボタンが有効になって
    // しまい、A の古いメッセージで B の直前コミットを誤って amend してしまう
    const user = userEvent.setup()
    const { rerender } = render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage="feat: フォルダAの直前コミット"
        onAmend={vi.fn()}
        isLoadingFolder={false}
      />
    )
    await user.click(screen.getByLabelText('amend'))
    expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('feat: フォルダAの直前コミット')

    // フォルダ B への切替により isLoadingFolder が true になる
    rerender(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage="feat: フォルダAの直前コミット"
        onAmend={vi.fn()}
        isLoadingFolder={true}
      />
    )

    expect(screen.getByLabelText('amend')).not.toBeChecked()
    expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('')
  })

  describe('amend', () => {
    it('amendチェックボックスを表示する', () => {
      render(
        <CommitSection
          stagedCount={1}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage={null}
          onAmend={vi.fn()}
        />
      )
      expect(screen.getByLabelText('amend')).toBeInTheDocument()
    })

    it('amendチェック時、メッセージ欄が空なら lastCommitMessage を自動入力する', async () => {
      render(
        <CommitSection
          stagedCount={0}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={vi.fn()}
        />
      )
      await userEvent.click(screen.getByLabelText('amend'))
      expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('feat: 直前のコミット')
    })

    it('amendチェック時、stagedCount が 0 でもコミットボタンは有効', async () => {
      render(
        <CommitSection
          stagedCount={0}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={vi.fn()}
        />
      )
      await userEvent.click(screen.getByLabelText('amend'))
      expect(screen.getByRole('button', { name: /コミット/ })).toBeEnabled()
    })

    it('amendチェック時にボタンを押すと onCommit ではなく onAmend がメッセージで呼ばれる', async () => {
      const onCommit = vi.fn()
      const onAmend = vi.fn().mockResolvedValue(true)
      render(
        <CommitSection
          stagedCount={0}
          isCommitting={false}
          onCommit={onCommit}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={onAmend}
        />
      )
      await userEvent.click(screen.getByLabelText('amend'))
      await userEvent.click(screen.getByRole('button', { name: /コミット/ }))
      expect(onAmend).toHaveBeenCalledWith('feat: 直前のコミット')
      expect(onCommit).not.toHaveBeenCalled()
    })

    it('amend成功後、amendチェックボックスがオフに戻る', async () => {
      // オンのまま残ると、次に新しいメッセージで押したときにユーザーが新規コミットの
      // つもりで直前のコミットを再度 amend してしまう事故が起きる
      const onAmend = vi.fn().mockResolvedValue(true)
      render(
        <CommitSection
          stagedCount={0}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={onAmend}
        />
      )
      await userEvent.click(screen.getByLabelText('amend'))
      await userEvent.click(screen.getByRole('button', { name: /コミット/ }))
      expect(screen.getByLabelText('amend')).not.toBeChecked()
    })

    it('amend失敗時はamendチェックボックスをオンのまま保持する', async () => {
      const onAmend = vi.fn().mockResolvedValue(false)
      render(
        <CommitSection
          stagedCount={0}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={onAmend}
        />
      )
      await userEvent.click(screen.getByLabelText('amend'))
      await userEvent.click(screen.getByRole('button', { name: /コミット/ }))
      expect(screen.getByLabelText('amend')).toBeChecked()
    })

    it('コミットが1件も無いリポジトリ(lastCommitMessage が null)では amend チェックボックスを無効化する', () => {
      // amend の対象コミットが無い状態でチェックを入れられると、メッセージだけ
      // 入力してコミットボタンが有効化されてしまい、実行してから初めて
      // git の `fatal: you have nothing to amend` エラーに気づくことになる
      render(
        <CommitSection
          stagedCount={1}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage={null}
          onAmend={vi.fn()}
        />
      )
      expect(screen.getByLabelText('amend')).toBeDisabled()
    })

    it('amendチェックを外すと、amend 用にプリフィルした直前コミットのメッセージはクリアする', async () => {
      // 残したままにすると、ステージ済みファイルがある状態でそのままコミットを
      // 押せてしまい、「直前のコミットのメッセージ」を持つ新規コミットが
      // 意図せず作られる
      render(
        <CommitSection
          stagedCount={1}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={vi.fn()}
        />
      )
      const checkbox = screen.getByLabelText('amend')
      await userEvent.click(checkbox)
      expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('feat: 直前のコミット')
      await userEvent.click(checkbox)
      expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('')
    })

    it('プリフィル後にユーザーが編集した内容は、amendチェックを外しても残す', async () => {
      // 自分で書き足した内容まで消すと、ユーザーの作業を失わせてしまう
      render(
        <CommitSection
          stagedCount={1}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={vi.fn()}
        />
      )
      const checkbox = screen.getByLabelText('amend')
      await userEvent.click(checkbox)
      await userEvent.type(screen.getByLabelText('コミットメッセージ'), ' を修正')
      await userEvent.click(checkbox)
      expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('feat: 直前のコミット を修正')
    })

    it('自分で入力したメッセージは amendチェックの ON/OFF で消えない（引き続き通常コミット可）', async () => {
      render(
        <CommitSection
          stagedCount={1}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={vi.fn()}
        />
      )
      await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
      const checkbox = screen.getByLabelText('amend')
      await userEvent.click(checkbox)
      await userEvent.click(checkbox)
      expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('feat: 新機能')
      expect(screen.getByRole('button', { name: /コミット/ })).toBeEnabled()
    })
  })
})
