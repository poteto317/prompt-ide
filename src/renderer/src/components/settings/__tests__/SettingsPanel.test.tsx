import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ModelSettings } from '@shared/types'
import SettingsPanel from '../SettingsPanel'

const defaultProps = {
  hasKey: false,
  apiKeyLoaded: true,
  keyStoreError: null as string | null,
  onSave: vi.fn(),
  modelSettings: { modelId: 'claude-haiku-4-5' as const, maxTokens: 4096 },
  modelSettingsLoaded: true,
  onSaveModelSettings: vi.fn().mockResolvedValue(undefined)
}

describe('SettingsPanel', () => {
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

  it('onSave が reject したときエラーメッセージが表示される', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('キーストアが利用できません'))
    render(<SettingsPanel {...defaultProps} onSave={onSave} />)
    await user.type(screen.getByLabelText('API キー'), 'sk-ant-test')
    await user.click(screen.getAllByRole('button', { name: '保存' })[0])
    expect(screen.getByText('キーストアが利用できません')).toBeInTheDocument()
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
