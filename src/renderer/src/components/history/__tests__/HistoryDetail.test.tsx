import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import HistoryDetail from '../HistoryDetail'
import type { HistoryEntry, HistoryEntryActions } from '../../../types'
import { rerunDisabledAgentEntryFolderMismatch } from '../../../lib/agentSendMessages'
import { agentResumeEntryFolderMismatch } from '../../../lib/agentSessionMessages'

const successEntry: HistoryEntry = {
  id: 'h1',
  promptId: 'p1',
  promptTitle: 'テストタイトル',
  promptContent: 'プロンプト内容',
  fileContent: null,
  toolId: 'copilot',
  status: 'success',
  resultText: '成功結果テキスト',
  errorMessage: null,
  executedAt: new Date('2024-01-01T00:00:00').getTime(),
  agent: null
}

const errorEntry: HistoryEntry = {
  ...successEntry,
  id: 'h2',
  status: 'error',
  resultText: null,
  errorMessage: 'エラーメッセージ本文'
}

const enabledActions: HistoryEntryActions = {
  rerun: { disabled: false, reason: null },
  resume: null
}

const defaultProps = {
  entry: successEntry,
  actions: enabledActions,
  onRerun: vi.fn(),
  onResume: vi.fn(),
  onDelete: vi.fn()
}

describe('HistoryDetail', () => {
  it('タイトル・ツール名を表示する', () => {
    render(<HistoryDetail {...defaultProps} />)
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
    expect(screen.getByText('GitHub Copilot')).toBeInTheDocument()
  })

  it('成功時は結果テキストを表示する', () => {
    render(<HistoryDetail {...defaultProps} />)
    expect(screen.getByText('成功結果テキスト')).toBeInTheDocument()
  })

  it('エラー時はエラーメッセージを表示する', () => {
    render(<HistoryDetail {...defaultProps} entry={errorEntry} />)
    expect(screen.getByText('エラーメッセージ本文')).toBeInTheDocument()
  })

  it('再実行ボタンで onRerun が entry とともに呼ばれる', async () => {
    const onRerun = vi.fn()
    render(<HistoryDetail {...defaultProps} onRerun={onRerun} />)
    await userEvent.click(screen.getByRole('button', { name: '再実行' }))
    expect(onRerun).toHaveBeenCalledWith(successEntry)
  })

  it('再実行を押せないとき再実行ボタンが無効化される', () => {
    render(
      <HistoryDetail
        {...defaultProps}
        actions={{ rerun: { disabled: true, reason: null }, resume: null }}
      />
    )
    expect(screen.getByRole('button', { name: '再実行' })).toBeDisabled()
  })

  it('削除ボタンで onDelete が id とともに呼ばれる', async () => {
    const onDelete = vi.fn()
    render(<HistoryDetail {...defaultProps} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'この履歴を削除' }))
    expect(onDelete).toHaveBeenCalledWith('h1')
  })

  it('実行日時が整形されて表示される', () => {
    render(<HistoryDetail {...defaultProps} />)
    expect(screen.getByText(new Date(successEntry.executedAt).toLocaleString())).toBeInTheDocument()
  })

  it('status が success でも resultText が null のときコンテンツ領域は空でクラッシュしない', () => {
    const entry: HistoryEntry = { ...successEntry, resultText: null }
    const { container } = render(<HistoryDetail {...defaultProps} entry={entry} />)
    expect(container.querySelector('.history-detail__content')).toBeEmptyDOMElement()
  })

  it('status が error でも errorMessage が null のときコンテンツ領域は空でクラッシュしない', () => {
    const entry: HistoryEntry = { ...errorEntry, errorMessage: null }
    const { container } = render(<HistoryDetail {...defaultProps} entry={entry} />)
    expect(container.querySelector('.history-detail__content')).toBeEmptyDOMElement()
  })
})

describe('HistoryDetail: 再実行を押せない理由', () => {
  it('理由があれば表示し、無効の再実行ボタンの aria-describedby から参照する', () => {
    render(
      <HistoryDetail
        {...defaultProps}
        actions={{
          rerun: {
            disabled: true,
            reason:
              'エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）'
          },
          resume: null
        }}
      />
    )
    const rerun = screen.getByRole('button', { name: '再実行' })
    expect(rerun).toBeDisabled()
    expect(document.getElementById(rerun.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'エージェント CLI 方式では再実行できません'
    )
  })

  it('理由が無ければ表示しない(従来の方式の実行中)', () => {
    render(
      <HistoryDetail
        {...defaultProps}
        actions={{ rerun: { disabled: true, reason: null }, resume: null }}
      />
    )
    expect(screen.getByRole('button', { name: '再実行' })).not.toHaveAttribute('aria-describedby')
  })
})

describe('HistoryDetail: エージェントのエントリ', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  const agentEntry: HistoryEntry = {
    ...successEntry,
    id: 'h-agent',
    toolId: 'claude',
    promptContent: '送った全文\n\n参照:\n- @src/app.ts',
    status: 'sent',
    resultText: null,
    agent: { claudeSessionId: ID, cliKind: 'claude', tabLabel: 'claude 2', folderPath: '/w' }
  }
  const actions = (
    rerun: HistoryEntryActions['rerun'],
    resume: HistoryEntryActions['resume']
  ): HistoryEntryActions => ({ rerun, resume })

  it('メタ情報にタブ名(ツールの欄)とセッション ID を、本文に送った全文を読むだけの領域で出す', () => {
    render(
      <HistoryDetail
        {...defaultProps}
        entry={agentEntry}
        actions={actions({ disabled: false, reason: null }, { disabled: false, reason: null })}
      />
    )
    expect(screen.getByText('エージェント（claude 2）')).toBeInTheDocument()
    expect(screen.getByText(`セッション: ${ID}`)).toBeInTheDocument()
    const sent = screen.getByRole('region', { name: '送った内容' })
    expect(sent.textContent).toBe('送った全文\n\n参照:\n- @src/app.ts')
    expect(sent).toHaveAttribute('tabindex', '0')
  })

  it('このセッションで再開 を押すと onResume にエントリを渡す', async () => {
    const onResume = vi.fn()
    render(
      <HistoryDetail
        {...defaultProps}
        entry={agentEntry}
        onResume={onResume}
        actions={actions({ disabled: false, reason: null }, { disabled: false, reason: null })}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'このセッションで再開' }))
    expect(onResume).toHaveBeenCalledExactlyOnceWith(agentEntry)
  })

  it('2 つのボタンの押せない理由を、別の段落・別の id で見える文字にして結ぶ(L-057)', async () => {
    const onResume = vi.fn()
    render(
      <HistoryDetail
        {...defaultProps}
        entry={agentEntry}
        onResume={onResume}
        actions={actions(
          {
            disabled: true,
            reason: 'エージェントが起動していません（ターミナルの「起動」を押してください）'
          },
          { disabled: true, reason: 'このセッションは claude 2 で動いています' }
        )}
      />
    )
    const rerun = screen.getByRole('button', { name: '再実行' })
    const resume = screen.getByRole('button', { name: 'このセッションで再開' })
    expect(rerun).toBeDisabled()
    expect(resume).toBeDisabled()
    const rerunReason = rerun.getAttribute('aria-describedby')
    const resumeReason = resume.getAttribute('aria-describedby')
    expect(rerunReason).not.toBe(resumeReason)
    expect(document.getElementById(rerunReason ?? '')).toHaveTextContent(
      'エージェントが起動していません'
    )
    expect(document.getElementById(resumeReason ?? '')).toHaveTextContent(
      'このセッションは claude 2 で動いています'
    )
    await userEvent.click(resume)
    expect(onResume).not.toHaveBeenCalled()
  })

  it('記録したフォルダと違うときは、再実行・このセッションで再開 のどちらにもフォルダ違いの理由を見える文字で結ぶ', () => {
    render(
      <HistoryDetail
        {...defaultProps}
        entry={agentEntry}
        actions={actions(
          { disabled: true, reason: rerunDisabledAgentEntryFolderMismatch('/w') },
          { disabled: true, reason: agentResumeEntryFolderMismatch('/w') }
        )}
      />
    )
    const rerun = screen.getByRole('button', { name: '再実行' })
    const resume = screen.getByRole('button', { name: 'このセッションで再開' })
    expect(rerun).toBeDisabled()
    expect(resume).toBeDisabled()
    expect(document.getElementById(rerun.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      '記録したフォルダ（/w）を開いているときだけ再実行できます'
    )
    expect(
      document.getElementById(resume.getAttribute('aria-describedby') ?? '')
    ).toHaveTextContent('記録したフォルダ（/w）を開いているときだけ再開できます')
  })

  it('従来のエントリ(resume が null)には このセッションで再開 を出さない', () => {
    render(<HistoryDetail {...defaultProps} />)
    expect(screen.queryByRole('button', { name: 'このセッションで再開' })).toBeNull()
    expect(screen.queryByText(/^セッション: /)).toBeNull()
  })
})
