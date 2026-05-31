import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { Prompt } from '../../../types'
import { PREVIEW_MAX } from '../../../config/promptConfig'
import PromptItem from '../PromptItem'

const basePrompt: Prompt = {
  id: 'test-id-1',
  title: 'テストタイトル',
  content: 'テストコンテンツ',
  createdAt: 1000000,
}

const defaultProps = {
  prompt: basePrompt,
  onDelete: vi.fn(),
  onRun: vi.fn(),
  onEdit: vi.fn(),
}

describe('PromptItem', () => {
  it('タイトルが表示される', () => {
    render(<PromptItem {...defaultProps} />)
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
  })

  it(`コンテンツが ${PREVIEW_MAX} 文字以内のとき全文表示される`, () => {
    render(<PromptItem {...defaultProps} />)
    expect(screen.getByText('テストコンテンツ')).toBeInTheDocument()
  })

  it(`コンテンツが ${PREVIEW_MAX} 文字を超えるとき省略表示される`, () => {
    const longContent = 'あ'.repeat(PREVIEW_MAX + 1)
    render(
      <PromptItem {...defaultProps} prompt={{ ...basePrompt, content: longContent }} />
    )
    expect(screen.getByText('あ'.repeat(PREVIEW_MAX) + '…')).toBeInTheDocument()
  })

  it('削除ボタンが存在する', () => {
    render(<PromptItem {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'プロンプトを削除' })).toBeInTheDocument()
  })

  it('削除ボタンクリックで onDelete が prompt.id を引数に呼ばれる', async () => {
    const onDelete = vi.fn()
    render(<PromptItem {...defaultProps} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを削除' }))
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledWith('test-id-1')
  })

  it('実行ボタンが存在する', () => {
    render(<PromptItem {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'プロンプトを実行' })).toBeInTheDocument()
  })

  it('実行ボタンクリックで onRun がプロンプト内容とともに呼ばれる', async () => {
    const onRun = vi.fn()
    render(<PromptItem {...defaultProps} onRun={onRun} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを実行' }))
    expect(onRun).toHaveBeenCalledWith('テストコンテンツ')
  })

  it('isRunDisabled=true のとき実行ボタンが disabled になる', () => {
    render(<PromptItem {...defaultProps} isRunDisabled={true} />)
    expect(screen.getByRole('button', { name: 'プロンプトを実行' })).toBeDisabled()
  })

  it('編集ボタンが存在する', () => {
    render(<PromptItem {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'プロンプトを編集' })).toBeInTheDocument()
  })

  describe('インライン編集', () => {
    it('編集ボタンクリックでタイトル入力とコンテンツ入力が表示される', async () => {
      render(<PromptItem {...defaultProps} />)
      await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
      expect(screen.getByRole('textbox', { name: 'タイトルを編集' })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: '内容を編集' })).toBeInTheDocument()
    })

    it('編集モード開始時に既存の title と content が入力欄にセットされる', async () => {
      render(<PromptItem {...defaultProps} />)
      await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
      expect(screen.getByRole('textbox', { name: 'タイトルを編集' })).toHaveValue('テストタイトル')
      expect(screen.getByRole('textbox', { name: '内容を編集' })).toHaveValue('テストコンテンツ')
    })

    it('保存ボタンとキャンセルボタンが表示される', async () => {
      render(<PromptItem {...defaultProps} />)
      await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
      expect(screen.getByRole('button', { name: '変更を保存' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '編集をキャンセル' })).toBeInTheDocument()
    })

    it('編集モード中は実行・編集・削除ボタンが非表示になる', async () => {
      render(<PromptItem {...defaultProps} />)
      await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
      expect(screen.queryByRole('button', { name: 'プロンプトを実行' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'プロンプトを編集' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'プロンプトを削除' })).not.toBeInTheDocument()
    })

    it('タイトルと内容を変更して保存すると onEdit が呼ばれる', async () => {
      const onEdit = vi.fn()
      render(<PromptItem {...defaultProps} onEdit={onEdit} />)
      await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
      const titleInput = screen.getByRole('textbox', { name: 'タイトルを編集' })
      const contentInput = screen.getByRole('textbox', { name: '内容を編集' })
      await userEvent.clear(titleInput)
      await userEvent.type(titleInput, '新しいタイトル')
      await userEvent.clear(contentInput)
      await userEvent.type(contentInput, '新しい内容')
      await userEvent.click(screen.getByRole('button', { name: '変更を保存' }))
      expect(onEdit).toHaveBeenCalledWith('test-id-1', '新しいタイトル', '新しい内容')
    })

    it('保存後に編集モードが終了してビュー表示に戻る', async () => {
      const onEdit = vi.fn()
      render(<PromptItem {...defaultProps} onEdit={onEdit} />)
      await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
      await userEvent.click(screen.getByRole('button', { name: '変更を保存' }))
      expect(screen.getByRole('button', { name: 'プロンプトを編集' })).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'タイトルを編集' })).not.toBeInTheDocument()
    })

    it('キャンセルボタンクリックで onEdit が呼ばれずビュー表示に戻る', async () => {
      const onEdit = vi.fn()
      render(<PromptItem {...defaultProps} onEdit={onEdit} />)
      await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
      await userEvent.click(screen.getByRole('button', { name: '編集をキャンセル' }))
      expect(onEdit).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'プロンプトを編集' })).toBeInTheDocument()
    })

    describe('保存ボタンの disabled 制御（trim・空チェック）', () => {
      it('タイトルを空にすると保存ボタンが disabled になる', async () => {
        render(<PromptItem {...defaultProps} />)
        await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
        const titleInput = screen.getByRole('textbox', { name: 'タイトルを編集' })
        await userEvent.clear(titleInput)
        expect(screen.getByRole('button', { name: '変更を保存' })).toBeDisabled()
      })

      it('内容を空にすると保存ボタンが disabled になる', async () => {
        render(<PromptItem {...defaultProps} />)
        await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
        const contentInput = screen.getByRole('textbox', { name: '内容を編集' })
        await userEvent.clear(contentInput)
        expect(screen.getByRole('button', { name: '変更を保存' })).toBeDisabled()
      })

      it('タイトルが空白のみのとき保存ボタンが disabled になる', async () => {
        render(<PromptItem {...defaultProps} />)
        await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
        const titleInput = screen.getByRole('textbox', { name: 'タイトルを編集' })
        await userEvent.clear(titleInput)
        await userEvent.type(titleInput, '   ')
        expect(screen.getByRole('button', { name: '変更を保存' })).toBeDisabled()
      })

      it('内容が空白のみのとき保存ボタンが disabled になる', async () => {
        render(<PromptItem {...defaultProps} />)
        await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
        const contentInput = screen.getByRole('textbox', { name: '内容を編集' })
        await userEvent.clear(contentInput)
        await userEvent.type(contentInput, '   ')
        expect(screen.getByRole('button', { name: '変更を保存' })).toBeDisabled()
      })

      it('タイトルと内容が両方入力されているとき保存ボタンが enabled になる', async () => {
        render(<PromptItem {...defaultProps} />)
        await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
        expect(screen.getByRole('button', { name: '変更を保存' })).toBeEnabled()
      })

      it('前後に空白があるタイトル・内容で保存すると trim された値で onEdit が呼ばれる', async () => {
        const onEdit = vi.fn()
        render(<PromptItem {...defaultProps} onEdit={onEdit} />)
        await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
        const titleInput = screen.getByRole('textbox', { name: 'タイトルを編集' })
        const contentInput = screen.getByRole('textbox', { name: '内容を編集' })
        await userEvent.clear(titleInput)
        await userEvent.type(titleInput, '  trimされるタイトル  ')
        await userEvent.clear(contentInput)
        await userEvent.type(contentInput, '  trimされる内容  ')
        await userEvent.click(screen.getByRole('button', { name: '変更を保存' }))
        expect(onEdit).toHaveBeenCalledWith('test-id-1', 'trimされるタイトル', 'trimされる内容')
      })

      it('保存ボタンが disabled のとき onEdit が呼ばれない', async () => {
        const onEdit = vi.fn()
        render(<PromptItem {...defaultProps} onEdit={onEdit} />)
        await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
        const titleInput = screen.getByRole('textbox', { name: 'タイトルを編集' })
        await userEvent.clear(titleInput)
        await userEvent.click(screen.getByRole('button', { name: '変更を保存' }))
        expect(onEdit).not.toHaveBeenCalled()
      })
    })
  })
})
