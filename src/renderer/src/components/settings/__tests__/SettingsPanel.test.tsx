import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { ModelSettings } from '@shared/types'
import SettingsPanel from '../SettingsPanel'

// main の設定ファイルの読み書きの例外には settings.json のパスや中身の断片が入りうる(L-017)
const LEAKY_SETTINGS_ERROR_TEXT =
  "Error: EACCES: permission denied, open '/Users/someone/Library/Application Support/prompt-ide/settings.json'"

let consoleSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  consoleSpy = null
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

const defaultProps = {
  hasKey: false,
  apiKeyLoaded: true,
  keyStoreError: null as string | null,
  onSave: vi.fn(),
  modelSettings: { modelId: 'claude-haiku-4-5' as const, maxTokens: 4096 },
  modelSettingsLoaded: true,
  onSaveModelSettings: vi.fn().mockResolvedValue(undefined),
  agentSendConfirm: { enabled: true, saveError: null, onChange: vi.fn() },
  agentCliKind: {
    kind: 'claude' as const,
    fallback: null,
    saveError: null,
    isLocked: false,
    isSwitching: false,
    lockedReason: null,
    onSelect: vi.fn()
  }
}

describe('SettingsPanel', () => {
  // 値・保存の失敗も見る(既定と同じ enabled: true・saveError: null だけでは、節へ渡し忘れても気付けない)
  it('送信前の確認の節へ agentSendConfirm の値・保存の失敗を渡し、変更を onChange へ渡す', async () => {
    const onChange = vi.fn()
    render(
      <SettingsPanel
        {...defaultProps}
        agentSendConfirm={{ enabled: false, saveError: '保存できませんでした', onChange }}
      />
    )
    expect(screen.getByRole('group', { name: '送信前の確認' })).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', {
      name: 'エージェントへ送る前に、送る内容を確認する'
    })
    expect(checkbox).not.toBeChecked()
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした')
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('API キー入力フィールドが表示される', () => {
    render(<SettingsPanel {...defaultProps} />)
    expect(screen.getByLabelText('API キー')).toBeInTheDocument()
  })

  it('apiKeyLoaded=false のとき input が disabled になる', () => {
    render(<SettingsPanel {...defaultProps} apiKeyLoaded={false} />)
    expect(screen.getByLabelText('API キー')).toBeDisabled()
  })

  it('apiKeyLoaded=false のとき保存ボタンが disabled になる', () => {
    render(<SettingsPanel {...defaultProps} apiKeyLoaded={false} />)
    expect(screen.getAllByRole('button', { name: '保存' })[0]).toBeDisabled()
  })

  it('入力が空のとき保存ボタンが disabled になる', () => {
    render(<SettingsPanel {...defaultProps} />)
    expect(screen.getAllByRole('button', { name: '保存' })[0]).toBeDisabled()
  })

  it('キーを入力して保存ボタンをクリックすると onSave が呼ばれる', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPanel {...defaultProps} onSave={onSave} />)
    await user.type(screen.getByLabelText('API キー'), 'sk-ant-test')
    await user.click(screen.getAllByRole('button', { name: '保存' })[0])
    expect(onSave).toHaveBeenCalledWith('sk-ant-test')
  })

  it('保存後に「保存しました」メッセージが表示される', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPanel {...defaultProps} onSave={onSave} />)
    await user.type(screen.getByLabelText('API キー'), 'sk-ant-test')
    await user.click(screen.getAllByRole('button', { name: '保存' })[0])
    expect(screen.getByText('保存しました')).toBeInTheDocument()
  })

  it('保存時に trim した値が onSave に渡される', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPanel {...defaultProps} onSave={onSave} />)
    await user.type(screen.getByLabelText('API キー'), '  sk-ant-test  ')
    await user.click(screen.getAllByRole('button', { name: '保存' })[0])
    expect(onSave).toHaveBeenCalledWith('sk-ant-test')
  })

  it('保存成功後に入力欄がクリアされる（レンダラー state にキーを残さない）', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPanel {...defaultProps} onSave={onSave} />)
    await user.type(screen.getByLabelText('API キー'), 'sk-ant-test')
    await user.click(screen.getAllByRole('button', { name: '保存' })[0])
    const input = screen.getByLabelText('API キー') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('onSave が reject したとき、例外の文言ではなく固定のエラーメッセージが表示される(L-017)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error(LEAKY_SETTINGS_ERROR_TEXT))
    render(<SettingsPanel {...defaultProps} onSave={onSave} />)
    await user.type(screen.getByLabelText('API キー'), 'sk-ant-test')
    await user.click(screen.getAllByRole('button', { name: '保存' })[0])
    expect(
      screen.getByText(
        'API キーを保存できませんでした: システムのキーストアまたは設定ファイルを使えませんでした'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/settings\.json/)).not.toBeInTheDocument()
    expect(screen.queryByText('保存しました')).not.toBeInTheDocument()
  })

  it('hasKey=true のとき「設定済み」インジケーターが表示される', () => {
    render(<SettingsPanel {...defaultProps} hasKey={true} />)
    expect(screen.getByText(/設定済み/)).toBeInTheDocument()
  })

  it('hasKey=false のとき「設定済み」インジケーターが表示されない', () => {
    render(<SettingsPanel {...defaultProps} hasKey={false} />)
    expect(screen.queryByText(/設定済み/)).not.toBeInTheDocument()
  })

  it('hasKey=true のとき placeholder が変わる', () => {
    render(<SettingsPanel {...defaultProps} hasKey={true} />)
    const input = screen.getByLabelText('API キー') as HTMLInputElement
    expect(input.placeholder).toBe('新しいキーを入力...')
  })

  it('hasKey=false のとき placeholder が sk-ant-... になる', () => {
    render(<SettingsPanel {...defaultProps} hasKey={false} />)
    const input = screen.getByLabelText('API キー') as HTMLInputElement
    expect(input.placeholder).toBe('sk-ant-...')
  })

  it('keyStoreError があるときエラーメッセージが表示される', () => {
    render(<SettingsPanel {...defaultProps} keyStoreError="システムのキーストアが利用できません" />)
    expect(screen.getByText('システムのキーストアが利用できません')).toBeInTheDocument()
  })

  it('keyStoreError があるとき input が disabled になる', () => {
    render(<SettingsPanel {...defaultProps} keyStoreError="キーストアエラー" />)
    expect(screen.getByLabelText('API キー')).toBeDisabled()
  })

  it('keyStoreError があるとき保存ボタンが disabled になる', () => {
    render(<SettingsPanel {...defaultProps} keyStoreError="キーストアエラー" />)
    expect(screen.getAllByRole('button', { name: '保存' })[0]).toBeDisabled()
  })

  it('keyStoreError があるとき「設定済み」インジケーターが表示されない', () => {
    render(<SettingsPanel {...defaultProps} hasKey={true} keyStoreError="キーストアエラー" />)
    expect(screen.queryByText(/設定済み/)).not.toBeInTheDocument()
  })

  it('keyStoreError が null のときエラーメッセージが表示されない', () => {
    render(<SettingsPanel {...defaultProps} keyStoreError={null} />)
    expect(screen.queryByText('システムのキーストアが利用できません')).not.toBeInTheDocument()
  })

  // モデル設定セクションの詳細な挙動(バリデーション・保存フローなど)は
  // ModelSettingsSection.test.tsx で個別にテスト済みのため、ここでは
  // 「SettingsPanel が正しく子として描画するか」の統合確認のみ行う。
  describe('モデル設定セクションの統合描画', () => {
    it('modelSettingsLoaded=true のとき ModelSettingsSection が描画される', () => {
      render(<SettingsPanel {...defaultProps} />)
      expect(screen.getByLabelText('モデル')).toBeInTheDocument()
      expect(screen.getByLabelText('max_tokens')).toBeInTheDocument()
    })

    it('modelSettingsLoaded=false のとき読み込み中表示になりモデル選択は表示されない', () => {
      render(<SettingsPanel {...defaultProps} modelSettingsLoaded={false} />)
      expect(screen.getByText('読み込み中...')).toBeInTheDocument()
      expect(screen.queryByLabelText('モデル')).not.toBeInTheDocument()
    })

    it('modelSettings の値が ModelSettingsSection に渡される', () => {
      render(
        <SettingsPanel
          {...defaultProps}
          modelSettings={{ modelId: 'claude-opus-4-8', maxTokens: 8000 }}
        />
      )
      expect(screen.getByLabelText('モデル')).toHaveValue('claude-opus-4-8')
      expect(screen.getByLabelText('max_tokens')).toHaveValue(8000)
    })

    it('モデル保存ボタンをクリックすると onSaveModelSettings が呼ばれる', async () => {
      const user = userEvent.setup()
      const onSaveModelSettings = vi.fn().mockResolvedValue(undefined)
      render(<SettingsPanel {...defaultProps} onSaveModelSettings={onSaveModelSettings} />)
      const buttons = screen.getAllByRole('button', { name: '保存' })
      await user.click(buttons[1])
      expect(onSaveModelSettings).toHaveBeenCalledWith({
        modelId: 'claude-haiku-4-5',
        maxTokens: 4096
      })
    })

    it('モデルの保存が reject したとき、例外の文言ではなく固定のエラーメッセージが表示される(L-017)', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const user = userEvent.setup()
      const onSaveModelSettings = vi.fn().mockRejectedValue(new Error(LEAKY_SETTINGS_ERROR_TEXT))
      render(<SettingsPanel {...defaultProps} onSaveModelSettings={onSaveModelSettings} />)
      await user.click(screen.getAllByRole('button', { name: '保存' })[1])
      expect(
        await screen.findByText(
          'モデルの設定を保存できませんでした: 設定ファイルを読み書きできませんでした'
        )
      ).toBeInTheDocument()
      expect(screen.queryByText(/settings\.json/)).not.toBeInTheDocument()
    })

    it('保存成功で modelSettings が更新され key が変わっても「保存しました」が表示される', async () => {
      // 実際の useAppState 経由の配線と同様に、保存が親の modelSettings state を
      // 更新するハーネス。保存成功 → key 変化 → ModelSettingsSection の remount が
      // 起きても保存完了メッセージ(親が保持)が失われないことを検証する。
      function Harness(): React.JSX.Element {
        const [modelSettings, setModelSettings] = useState<ModelSettings>({
          modelId: 'claude-haiku-4-5',
          maxTokens: 4096
        })
        return (
          <SettingsPanel
            {...defaultProps}
            modelSettings={modelSettings}
            onSaveModelSettings={async (settings) => {
              setModelSettings(settings)
            }}
          />
        )
      }
      const user = userEvent.setup()
      render(<Harness />)

      await user.selectOptions(screen.getByLabelText('モデル'), 'claude-opus-4-8')
      await user.click(screen.getAllByRole('button', { name: '保存' })[1])

      expect(await screen.findByText('保存しました')).toBeInTheDocument()
      // remount 後の ModelSettingsSection には保存後の値が反映されている
      expect(screen.getByLabelText('モデル')).toHaveValue('claude-opus-4-8')
    })
  })
})

describe('SettingsPanel: 実行方式', () => {
  it('最上部に実行方式を出し、選ぶと onSelect を呼ぶ', async () => {
    const onSelect = vi.fn()
    render(
      <SettingsPanel
        {...defaultProps}
        executionMode={{
          mode: 'agent-cli',
          saveError: null,
          isLocked: false,
          isSwitching: false,
          onSelect
        }}
      />
    )
    expect(screen.getByRole('radiogroup', { name: 'プロンプトの実行方式' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /^従来の方式/ }))
    expect(onSelect).toHaveBeenCalledWith('legacy')
  })

  it('実行方式を選べない理由を渡す', () => {
    render(
      <SettingsPanel
        {...defaultProps}
        executionMode={{
          mode: 'legacy',
          saveError: null,
          isLocked: true,
          isSwitching: false,
          lockedReason: '従来の方式で実行している間は、実行方式を切り替えられません',
          onSelect: vi.fn()
        }}
      />
    )
    expect(screen.getByRole('radio', { name: /^従来の方式/ })).toHaveAccessibleDescription(
      '従来の方式で実行している間は、実行方式を切り替えられません'
    )
  })

  it('API キーとモデルに「従来の方式で使います」を添える', () => {
    render(<SettingsPanel {...defaultProps} />)
    expect(screen.getAllByText('従来の方式で使います')).toHaveLength(2)
  })

  it('executionMode を渡さなければ実行方式を出さない', () => {
    render(<SettingsPanel {...defaultProps} />)
    expect(screen.queryByRole('radiogroup', { name: 'プロンプトの実行方式' })).toBeNull()
  })

  // 送信前の確認(defaultProps はオン・失敗なし)と違う値を与え、通知の節へ送信前の確認の値を渡し違えても気付けるようにする
  it('agentNotification を渡すとエージェントの通知の節へ値・保存の失敗を渡し、変更を onChange へ渡す', async () => {
    const onChange = vi.fn()
    render(
      <SettingsPanel
        {...defaultProps}
        agentNotification={{
          enabled: false,
          saveError: '通知の設定を保存できませんでした',
          onChange,
          unsupportedNote: null
        }}
      />
    )
    const checkbox = screen.getByRole('checkbox', {
      name: 'ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する'
    })
    expect(checkbox).not.toBeChecked()
    expect(screen.getByRole('alert')).toHaveTextContent('通知の設定を保存できませんでした')
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('agentNotification を省略すると節を出さない', () => {
    render(<SettingsPanel {...defaultProps} />)
    expect(screen.queryByText('エージェントの通知')).toBeNull()
  })

  it('プロンプトの実行方式の直後に使うエージェント CLI を出し、6 つの節が並ぶ', () => {
    const { container } = render(
      <SettingsPanel
        {...defaultProps}
        executionMode={{
          mode: 'agent-cli',
          saveError: null,
          isLocked: false,
          isSwitching: false,
          onSelect: vi.fn()
        }}
        agentNotification={{
          enabled: true,
          saveError: null,
          onChange: vi.fn(),
          unsupportedNote: null
        }}
      />
    )
    expect(
      // 節の見出しは <p>。ModelSettingsSection の max_tokens の <label> も同じクラスなので p に限る
      Array.from(
        container.querySelectorAll('p.settings-panel__label'),
        (label) => label.textContent
      )
    ).toEqual([
      'プロンプトの実行方式',
      '使うエージェント CLI',
      'エージェントの通知',
      '送信前の確認',
      'Anthropic API キー',
      'モデル'
    ])
  })

  it('使うエージェント CLI の節へ agentCliKind の値を渡し、選んだ値を onSelect へ渡す', async () => {
    const onSelect = vi.fn()
    render(
      <SettingsPanel
        {...defaultProps}
        agentCliKind={{ ...defaultProps.agentCliKind, kind: 'copilot', onSelect }}
      />
    )
    expect(screen.getByRole('radio', { name: 'GitHub Copilot CLI（copilot）' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Claude Code（claude）' }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('claude')
  })

  it('通知の項目に、選んだ CLI で通知を出せない旨の注記を出す', () => {
    const note =
      'copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）'
    render(
      <SettingsPanel
        {...defaultProps}
        agentNotification={{
          enabled: true,
          saveError: null,
          onChange: vi.fn(),
          unsupportedNote: note
        }}
      />
    )
    expect(screen.getByText(note)).toHaveClass('settings-panel__note')
  })

  // 同じ画面に BooleanSettingSection が 2 つ並ぶ(エージェントの通知・送信前の確認)。説明・注記の id が重なると、
  // 片方のチェックボックスがもう片方の説明を読んでしまう
  it('エージェントの通知と送信前の確認のチェックボックスは、それぞれ自分の節の説明・注記だけを参照する', () => {
    const note =
      'copilot では、完了・許可待ちの通知を出しません（作業中・入力待ちを判定しないため）'
    render(
      <SettingsPanel
        {...defaultProps}
        agentNotification={{
          enabled: true,
          saveError: null,
          onChange: vi.fn(),
          unsupportedNote: note
        }}
      />
    )
    expect(
      screen.getByRole('checkbox', { name: /^ウィンドウが背面のとき/ })
    ).toHaveAccessibleDescription(new RegExp(`${note}$`))
    expect(
      screen.getByRole('checkbox', { name: 'エージェントへ送る前に、送る内容を確認する' })
    ).toHaveAccessibleDescription('変数を差し込んだ後の全文と送り先のタブを確かめてから送ります')
  })
})
