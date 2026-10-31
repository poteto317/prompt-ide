import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import CommitSection from '../CommitSection'
import { commitMenuButton, toggleAmend } from '../../../__tests__/sourceControlMenu'

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
    expect(screen.getByRole('button', { name: 'コミット中...' })).toBeDisabled()
  })

  it('isCommitting が true のときメッセージ欄とamend の項目も無効化される', () => {
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
    expect(commitMenuButton()).toBeDisabled()
  })

  it('isBlockedByOtherOperation が true のとき amend の項目も無効(コミットボタンだけ揃えても、実行中に amend を仕込めてしまう)', () => {
    // コミットボタンの isDisabled には isBlockedByOtherOperation が入っているが、
    // amend の項目の disabled には入っていなかった。stage/unstage や
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
    expect(commitMenuButton()).toBeDisabled()
  })

  it('isLoadingFolder が true のとき amend の項目は無効(lastCommitMessage が別フォルダの古い値の可能性があるため)', () => {
    // フォルダを切り替えた直後、useGitHistory の headCommitMessage は新フォルダの取得が完了する
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
    expect(commitMenuButton()).toBeDisabled()
  })

  it('isLoadingFolder が true になったら amend チェックとメッセージ入力欄をリセットする(フォルダ切替時に前フォルダの内容を残さない)', async () => {
    // CommitSection はフォルダを切り替えても再マウントされない(App.tsx 側に
    // key 等の仕組みが無い)ため、isAmend/message をローカル state のまま
    // 放置すると、フォルダ A で amend にチェックしメッセージ欄に A の直前
    // コミットメッセージが入った状態のまま無関係な B へ切り替わり、
    // B でステージ済みファイルがあればそのままコミットボタンが有効になって
    // しまい、A の古いメッセージで B の直前コミットを誤って amend してしまう
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
    await toggleAmend()
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

    expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
    expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('')
  })

  describe('amend', () => {
    it('矢印のメニューに amend の menuitemcheckbox を出し、チェックボックスは出さない', async () => {
      render(
        <CommitSection
          stagedCount={1}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={vi.fn()}
        />
      )
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      await userEvent.click(commitMenuButton())
      expect(
        screen.getByRole('menuitemcheckbox', { name: '前回のコミットを修正 (amend)' })
      ).toHaveAttribute('aria-checked', 'false')
    })

    it('amend のときはメニューの項目がチェックされ、主ボタンの名前が コミット (amend) になる', async () => {
      render(
        <CommitSection
          stagedCount={0}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={vi.fn()}
        />
      )
      await toggleAmend()
      expect(screen.getByRole('button', { name: 'コミット (amend)' })).toBeInTheDocument()
      await userEvent.click(commitMenuButton())
      expect(
        screen.getByRole('menuitemcheckbox', { name: '前回のコミットを修正 (amend)' })
      ).toHaveAttribute('aria-checked', 'true')
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
      await toggleAmend()
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
      await toggleAmend()
      expect(screen.getByRole('button', { name: 'コミット (amend)' })).toBeEnabled()
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
      await toggleAmend()
      await userEvent.click(screen.getByRole('button', { name: 'コミット (amend)' }))
      expect(onAmend).toHaveBeenCalledWith('feat: 直前のコミット')
      expect(onCommit).not.toHaveBeenCalled()
    })

    it('amend成功後、amend の項目がオフに戻る', async () => {
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
      await toggleAmend()
      await userEvent.click(screen.getByRole('button', { name: 'コミット (amend)' }))
      expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
    })

    it('amend失敗時はamend の項目をオンのまま保持する', async () => {
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
      await toggleAmend()
      await userEvent.click(screen.getByRole('button', { name: 'コミット (amend)' }))
      expect(screen.getByRole('button', { name: 'コミット (amend)' })).toBeInTheDocument()
    })

    it('コミットが1件も無いリポジトリ(lastCommitMessage が null)では amend の項目を無効化する', () => {
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
      expect(commitMenuButton()).toBeDisabled()
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
      await toggleAmend()
      expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('feat: 直前のコミット')
      await toggleAmend()
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
      await toggleAmend()
      await userEvent.type(screen.getByLabelText('コミットメッセージ'), ' を修正')
      await toggleAmend()
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
      await toggleAmend()
      await toggleAmend()
      expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('feat: 新機能')
      expect(screen.getByRole('button', { name: 'コミット' })).toBeEnabled()
    })
  })

  describe('主ボタンの表示', () => {
    it('✓ は aria-hidden で、ボタンの名前は コミット になる', () => {
      render(
        <CommitSection
          stagedCount={1}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage={null}
          onAmend={vi.fn()}
        />
      )
      const button = screen.getByRole('button', { name: 'コミット' })
      expect(button).toHaveTextContent('✓ コミット')
      expect(screen.getByText('✓')).toHaveAttribute('aria-hidden', 'true')
    })

    it('コミットの実行中は ✓ を出さず コミット中... を出す', () => {
      render(
        <CommitSection
          stagedCount={1}
          isCommitting
          onCommit={vi.fn()}
          lastCommitMessage={null}
          onAmend={vi.fn()}
        />
      )
      expect(screen.getByRole('button', { name: 'コミット中...' })).toHaveTextContent(
        /^コミット中\.\.\.$/
      )
    })

    it('メッセージ欄が主ボタンより前にある', () => {
      render(
        <CommitSection
          stagedCount={1}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage={null}
          onAmend={vi.fn()}
        />
      )
      const input = screen.getByLabelText('コミットメッセージ')
      const button = screen.getByRole('button', { name: 'コミット' })
      expect(input.compareDocumentPosition(button)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })
  })

  describe('変更の同期', () => {
    const SYNC_NAME = '変更を同期(プル 1 件、プッシュ 2 件)'

    // 要件 10 の条件をすべて満たす既定の props
    const syncReadyProps = {
      stagedCount: 0,
      isCommitting: false,
      onCommit: vi.fn(),
      lastCommitMessage: 'feat: 直前のコミット',
      onAmend: vi.fn(),
      ahead: 2,
      behind: 1,
      onSync: vi.fn().mockResolvedValue(undefined)
    }

    const syncButton = (): HTMLElement => screen.getByRole('button', { name: SYNC_NAME })

    function createDeferred(): { promise: Promise<void>; resolve: () => void } {
      let resolve!: () => void
      const promise = new Promise<void>((res) => {
        resolve = res
      })
      return { promise, resolve }
    }

    it('条件をすべて満たすと主ボタンが 変更の同期 になる', () => {
      render(<CommitSection {...syncReadyProps} />)
      expect(syncButton()).toBeEnabled()
      expect(syncButton()).toHaveTextContent('↻ 変更の同期 ↓1 ↑2')
      expect(screen.getByText('↻')).toHaveAttribute('aria-hidden', 'true')
    })

    it('behind が 0 なら ↓ を出さない(aria-label はプル 0 件)', () => {
      render(<CommitSection {...syncReadyProps} ahead={3} behind={0} />)
      const button = screen.getByRole('button', { name: '変更を同期(プル 0 件、プッシュ 3 件)' })
      expect(button).toHaveTextContent('↻ 変更の同期 ↑3')
      expect(button).not.toHaveTextContent('↓')
    })

    it('ahead が 0 なら ↑ を出さない(aria-label はプッシュ 0 件)', () => {
      render(<CommitSection {...syncReadyProps} ahead={0} behind={3} />)
      const button = screen.getByRole('button', { name: '変更を同期(プル 3 件、プッシュ 0 件)' })
      expect(button).toHaveTextContent('↻ 変更の同期 ↓3')
      expect(button).not.toHaveTextContent('↑')
    })

    it('ahead も behind も 0 なら コミット のまま', () => {
      render(<CommitSection {...syncReadyProps} ahead={0} behind={0} />)
      expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
    })

    it('ステージ済みがあれば コミット のまま', () => {
      render(<CommitSection {...syncReadyProps} stagedCount={1} />)
      expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
    })

    it('メッセージがあれば コミット のまま。空白だけなら同期のまま', async () => {
      render(<CommitSection {...syncReadyProps} />)
      await userEvent.type(screen.getByLabelText('コミットメッセージ'), '   ')
      expect(syncButton()).toBeInTheDocument()
      await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'a')
      expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
    })

    it('amend のときは同期にしない', async () => {
      render(<CommitSection {...syncReadyProps} lastCommitMessage="" />)
      await toggleAmend()
      expect(screen.getByRole('button', { name: 'コミット (amend)' })).toBeInTheDocument()
    })

    it('マージ中は同期にしない', () => {
      render(<CommitSection {...syncReadyProps} mergeInProgress />)
      expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
    })

    it('押すと onSync を呼ぶ(コミットは呼ばない)', () => {
      const onSync = vi.fn().mockResolvedValue(undefined)
      const onCommit = vi.fn()
      render(<CommitSection {...syncReadyProps} onSync={onSync} onCommit={onCommit} />)
      fireEvent.click(syncButton(), { detail: 1 })
      expect(onSync).toHaveBeenCalledTimes(1)
      expect(onCommit).not.toHaveBeenCalled()
    })

    it('キーボードの click(detail 0)でも実行する', () => {
      const onSync = vi.fn().mockResolvedValue(undefined)
      render(<CommitSection {...syncReadyProps} onSync={onSync} />)
      fireEvent.click(syncButton(), { detail: 0 })
      expect(onSync).toHaveBeenCalledTimes(1)
    })

    it('isSyncing の間は要件の判定より先に 同期中... を出し、押せない', () => {
      const onSync = vi.fn().mockResolvedValue(undefined)
      render(<CommitSection {...syncReadyProps} ahead={0} behind={0} isSyncing onSync={onSync} />)
      const button = screen.getByRole('button', { name: '同期中...' })
      expect(button).toBeDisabled()
      expect(button).toHaveTextContent(/^同期中\.\.\.$/)
      fireEvent.click(button, { detail: 1 })
      expect(onSync).not.toHaveBeenCalled()
    })

    it('ステージ済みがあっても isSyncing の間は 同期中...', () => {
      render(<CommitSection {...syncReadyProps} stagedCount={1} isSyncing />)
      expect(screen.getByRole('button', { name: '同期中...' })).toBeDisabled()
    })

    it('同期できる状態のまま isSyncing になると、名前は 同期中... で押せない', () => {
      render(<CommitSection {...syncReadyProps} isSyncing />)
      expect(screen.getByRole('button', { name: '同期中...' })).toBeDisabled()
    })

    it('同期できる状態のまま isCommitting になると、名前は コミット中... で押せない', () => {
      render(<CommitSection {...syncReadyProps} isCommitting />)
      expect(screen.getByRole('button', { name: 'コミット中...' })).toBeDisabled()
    })

    it('isCommitting と isSyncing が両方 true なら 同期中... を出す', () => {
      render(<CommitSection {...syncReadyProps} isCommitting isSyncing />)
      expect(screen.getByRole('button', { name: '同期中...' })).toBeDisabled()
    })

    it('isSyncBlocked の間は押せない', () => {
      render(<CommitSection {...syncReadyProps} isSyncBlocked />)
      expect(syncButton()).toBeDisabled()
    })

    it('isSyncBlocked でも、コミットできる状態のコミットは押せる', async () => {
      render(<CommitSection {...syncReadyProps} stagedCount={1} isSyncBlocked />)
      await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
      expect(screen.getByRole('button', { name: 'コミット' })).toBeEnabled()
    })

    // コミットの直後に同じ位置のボタンが同期へ変わる。ダブルクリックの 2 回目で確認なしにプッシュしない
    it('コミットの直後のダブルクリックの 2 回目(detail 2)で同期しない', async () => {
      const onSync = vi.fn().mockResolvedValue(undefined)
      const onCommit = vi.fn().mockResolvedValue(true)
      const props = { ...syncReadyProps, onSync, onCommit }
      const { rerender } = render(<CommitSection {...props} stagedCount={1} />)
      await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
      const button = screen.getByRole('button', { name: 'コミット' })
      await act(async () => {
        fireEvent.click(button, { detail: 1 })
      })
      expect(onCommit).toHaveBeenCalledTimes(1)
      rerender(<CommitSection {...props} stagedCount={0} />)
      // 同じ要素のまま同期へ変わる
      expect(syncButton()).toBe(button)
      fireEvent.click(button, { detail: 2 })
      expect(onSync).not.toHaveBeenCalled()
      // 3 回目の連打も同じ
      fireEvent.click(button, { detail: 3 })
      expect(onSync).not.toHaveBeenCalled()
    })

    it('Enter のリピートは既定の動きを止める(同期)', () => {
      render(<CommitSection {...syncReadyProps} />)
      expect(fireEvent.keyDown(syncButton(), { key: 'Enter', repeat: true })).toBe(false)
    })

    it('Enter のリピートは既定の動きを止める(コミット)', () => {
      render(<CommitSection {...syncReadyProps} stagedCount={1} />)
      const button = screen.getByRole('button', { name: 'コミット' })
      expect(fireEvent.keyDown(button, { key: 'Enter', repeat: true })).toBe(false)
    })

    it('リピートでない Enter と、Enter 以外のリピートは止めない', () => {
      render(<CommitSection {...syncReadyProps} />)
      expect(fireEvent.keyDown(syncButton(), { key: 'Enter' })).toBe(true)
      expect(fireEvent.keyDown(syncButton(), { key: ' ', repeat: true })).toBe(true)
    })

    it('主ボタンから実行し、完了の時点でフォーカスが body ならメッセージ欄へ移す', async () => {
      const deferred = createDeferred()
      const onSync = vi.fn(() => deferred.promise)
      const { rerender } = render(<CommitSection {...syncReadyProps} onSync={onSync} />)
      const button = syncButton()
      button.focus()
      fireEvent.click(button, { detail: 1 })
      // 実行中はボタンが押せなくなり、フォーカスは body へ落ちる(jsdom は disabled の要素の blur を無視するので先に外す)
      act(() => button.blur())
      rerender(<CommitSection {...syncReadyProps} onSync={onSync} isSyncing />)
      expect(document.body).toHaveFocus()
      expect(screen.getByLabelText('コミットメッセージ')).not.toHaveFocus()

      rerender(<CommitSection {...syncReadyProps} onSync={onSync} ahead={0} behind={0} />)
      await act(async () => deferred.resolve())
      await waitFor(() => expect(screen.getByLabelText('コミットメッセージ')).toHaveFocus())
    })

    it('実行中に利用者が移したフォーカスは奪わない', async () => {
      const deferred = createDeferred()
      const onSync = vi.fn(() => deferred.promise)
      render(
        <>
          <button type="button">別のボタン</button>
          <CommitSection {...syncReadyProps} onSync={onSync} />
        </>
      )
      fireEvent.click(syncButton(), { detail: 1 })
      const other = screen.getByRole('button', { name: '別のボタン' })
      other.focus()
      await act(async () => deferred.resolve())
      expect(other).toHaveFocus()
    })

    it('別の場所から始まった同期の完了ではフォーカスを移さない(押した側だけが予約する)', () => {
      const { rerender } = render(<CommitSection {...syncReadyProps} isSyncing />)
      expect(document.body).toHaveFocus()
      rerender(<CommitSection {...syncReadyProps} ahead={0} behind={0} />)
      expect(document.body).toHaveFocus()
    })

    it('無視した 2 回目のクリックはフォーカスの戻しも予約しない', async () => {
      const onSync = vi.fn().mockResolvedValue(undefined)
      render(<CommitSection {...syncReadyProps} onSync={onSync} />)
      await act(async () => {
        fireEvent.click(syncButton(), { detail: 2 })
      })
      expect(document.body).toHaveFocus()
    })
  })
})
