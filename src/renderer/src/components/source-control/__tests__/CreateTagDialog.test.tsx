import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import CreateTagDialog from '../CreateTagDialog'

type Props = ComponentProps<typeof CreateTagDialog>

const renderDialog = (
  overrides: Partial<Props> = {}
): Props & { container: HTMLElement; rerenderWith: (next: Partial<Props>) => void } => {
  const props: Props = {
    tags: [],
    branchNames: ['main'],
    isCreating: false,
    isBlocked: false,
    error: null,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  }
  const { container, rerender } = render(<CreateTagDialog {...props} />)
  const rerenderWith = (next: Partial<Props>): void =>
    rerender(<CreateTagDialog {...props} {...next} />)
  return { ...props, container, rerenderWith }
}
const nameInput = (): HTMLElement => screen.getByRole('textbox', { name: 'タグ名' })
const createButton = (): HTMLElement => screen.getByRole('button', { name: '作成' })
const radio = (name: '軽量' | '注釈付き'): HTMLElement => screen.getByRole('radio', { name })

describe('CreateTagDialog', () => {
  it('開くとタグ名の入力欄にフォーカスがあり、種類は軽量で、メッセージ欄は無い', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'タグを作成' })).toHaveAccessibleDescription(
      '現在の HEAD にタグを付けます'
    )
    expect(nameInput()).toHaveFocus()
    expect(screen.getByRole('radiogroup', { name: '種類' })).toBeInTheDocument()
    expect(radio('軽量')).toHaveAttribute('aria-checked', 'true')
    expect(radio('注釈付き')).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('textbox', { name: 'メッセージ' })).not.toBeInTheDocument()
  })

  it('名前が空の間は作成ボタンが disabled で、理由を入力欄の説明として表示する', () => {
    renderDialog()
    expect(createButton()).toBeDisabled()
    expect(nameInput()).toHaveAccessibleDescription('名前を入力してください')
    expect(nameInput()).toHaveAttribute('aria-invalid', 'true')
  })

  it('前後の空白を除いた名前で、軽量タグ(メッセージは空)を送る', async () => {
    const props = renderDialog()
    await userEvent.type(nameInput(), '  v1.0.0  ')
    expect(nameInput()).toHaveAttribute('aria-invalid', 'false')
    await userEvent.click(createButton())
    expect(props.onSubmit).toHaveBeenCalledWith({
      name: 'v1.0.0',
      kind: 'lightweight',
      message: ''
    })
  })

  // main と同じ normalizeTagName(@shared/tagName)の結果を送る。macOS のペーストなどで NFD の名前が入る
  it('NFD の名前は前後の空白を除き NFC にそろえて送る', async () => {
    const props = renderDialog()
    fireEvent.change(nameInput(), { target: { value: '  v1-e\u0301 ' } })
    await userEvent.click(createButton())
    expect(props.onSubmit).toHaveBeenCalledWith({
      name: 'v1-\u00e9',
      kind: 'lightweight',
      message: ''
    })
  })

  it('NFD の名前は NFC の既存タグと同名として作成できない', () => {
    const props = renderDialog({ tags: ['\u00e9'] })
    fireEvent.change(nameInput(), { target: { value: 'e\u0301' } })
    expect(nameInput()).toHaveAccessibleDescription('同じ名前のタグが既に存在します')
    expect(createButton()).toBeDisabled()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('タグ名の入力欄で Enter を押しても送る', async () => {
    const props = renderDialog()
    await userEvent.type(nameInput(), 'v1{Enter}')
    expect(props.onSubmit).toHaveBeenCalledOnce()
  })

  it.each([
    ['-x', '`-` で始まる名前は使用できません'],
    ['HEAD', 'この名前は使用できません'],
    ['v1', '同じ名前のタグが既に存在します'],
    ['v1/x', '既存のタグ v1 と名前が衝突します'],
    ['Main', '同じ名前のブランチが存在するため、タグを作成できません']
  ])('名前 %s は「%s」を表示して作成できない', async (name, message) => {
    const props = renderDialog({ tags: ['v1'], branchNames: ['main'] })
    await userEvent.type(nameInput(), `${name}{Enter}`)
    expect(nameInput()).toHaveAccessibleDescription(message)
    expect(createButton()).toBeDisabled()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('注釈付きを選ぶとメッセージ欄が出て、メッセージが空白だけの間は作成できない', async () => {
    const props = renderDialog()
    await userEvent.type(nameInput(), 'v1')
    await userEvent.click(radio('注釈付き'))
    expect(radio('注釈付き')).toHaveAttribute('aria-checked', 'true')
    const messageInput = screen.getByRole('textbox', { name: 'メッセージ' })
    expect(messageInput).toHaveAccessibleDescription('メッセージを入力してください')
    expect(createButton()).toBeDisabled()
    await userEvent.type(messageInput, '   ')
    expect(createButton()).toBeDisabled()
    await userEvent.clear(messageInput)
    await userEvent.type(messageInput, 'リリース{Enter}2 行目')
    await userEvent.click(createButton())
    expect(props.onSubmit).toHaveBeenCalledWith({
      name: 'v1',
      kind: 'annotated',
      message: 'リリース\n2 行目'
    })
  })

  it('注釈付きから軽量に戻すと、メッセージ欄が消え、送るメッセージは空になる', async () => {
    const props = renderDialog()
    await userEvent.type(nameInput(), 'v1')
    await userEvent.click(radio('注釈付き'))
    await userEvent.type(screen.getByRole('textbox', { name: 'メッセージ' }), 'm')
    await userEvent.click(radio('軽量'))
    expect(screen.queryByRole('textbox', { name: 'メッセージ' })).not.toBeInTheDocument()
    await userEvent.click(createButton())
    expect(props.onSubmit).toHaveBeenCalledWith({ name: 'v1', kind: 'lightweight', message: '' })
  })

  // radiogroup の慣例(roving tabindex): Tab で止まるのは選択中の 1 つだけで、矢印キーで移る
  it('矢印キーで種類を切り替え、フォーカスも移る(両方向・端で折り返す)', async () => {
    renderDialog()
    expect(radio('軽量')).toHaveAttribute('tabindex', '0')
    expect(radio('注釈付き')).toHaveAttribute('tabindex', '-1')
    radio('軽量').focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(radio('注釈付き')).toHaveAttribute('aria-checked', 'true')
    expect(radio('注釈付き')).toHaveFocus()
    expect(radio('注釈付き')).toHaveAttribute('tabindex', '0')
    await userEvent.keyboard('{ArrowDown}')
    expect(radio('軽量')).toHaveAttribute('aria-checked', 'true')
    expect(radio('軽量')).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(radio('注釈付き')).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(radio('軽量')).toHaveFocus()
  })

  it('実行中は「作成中...」で、作成ボタン・入力・種類が disabled になり、送らない', async () => {
    const props = renderDialog({ isCreating: true })
    expect(screen.getByRole('button', { name: '作成中...' })).toBeDisabled()
    expect(nameInput()).toBeDisabled()
    expect(radio('軽量')).toBeDisabled()
    expect(radio('注釈付き')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '作成中...' }))
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  // 作成中は入力欄とボタンが disabled になりフォーカスが body に落ちるため、ボタンの「作成中...」だけでは
  // スクリーンリーダーに伝わらない。署名の入力待ちで最大 2 分(main の TAG_CREATE_TIMEOUT_MS)かかることも案内する
  describe('作成中の案内(role="status"・aria-busy)', () => {
    it('作成中は role="status" で最大 2 分かかりうることを案内し、ダイアログを aria-busy にする', () => {
      renderDialog({ isCreating: true })
      expect(screen.getByRole('status')).toHaveTextContent(
        '作成中です。署名の入力待ちなどで最大 2 分かかることがあります'
      )
      expect(screen.getByRole('status')).toHaveClass('create-tag-dialog__note')
      expect(screen.getByRole('dialog', { name: 'タグを作成' })).toHaveAttribute(
        'aria-busy',
        'true'
      )
    })

    it('作成中でなければ案内は出ず、aria-busy は true でない', () => {
      renderDialog()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'タグを作成' })).not.toHaveAttribute(
        'aria-busy',
        'true'
      )
    })

    it('失敗して作成中が解けると、案内は消えてエラーの alert が出る', () => {
      const { rerenderWith } = renderDialog({ isCreating: true })
      expect(screen.getByRole('status')).toBeInTheDocument()
      rerenderWith({ isCreating: false, error: new Error('タグを作成できませんでした: x') })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('タグを作成できませんでした: x')
      expect(screen.getByRole('dialog', { name: 'タグを作成' })).not.toHaveAttribute(
        'aria-busy',
        'true'
      )
    })
  })

  it('他の操作中(isBlocked)は、名前が正しくても作成ボタンが disabled', async () => {
    const props = renderDialog({ isBlocked: true })
    await userEvent.type(nameInput(), 'v1{Enter}')
    expect(createButton()).toBeDisabled()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('作成の失敗は role="alert" で表示する', () => {
    renderDialog({ error: new Error('コミットが無いため、タグを作成できません') })
    expect(screen.getByRole('alert')).toHaveTextContent('コミットが無いため、タグを作成できません')
  })

  it('キャンセル・Escape・オーバーレイのクリックで onCancel を呼ぶ', async () => {
    const props = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(props.container.querySelector('.name-input-dialog__overlay')!)
    expect(props.onCancel).toHaveBeenCalledTimes(3)
  })

  // 作成中に閉じると、遅れて届いた失敗がダイアログの外に出ず(開き直すと消える)、遅れて届いた成功が
  // 別の場所のフォーカスを奪う(パターン 73)。作成が終わるまで閉じさせない
  it('作成中(isCreating)は、キャンセルが disabled で、Escape・オーバーレイのクリックでも onCancel を呼ばない', async () => {
    const props = renderDialog({ isCreating: true })
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.keyDown(nameInput(), { key: 'Escape', isComposing: false })
    await userEvent.click(props.container.querySelector('.name-input-dialog__overlay')!)
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('作成が終わる(isCreating が false に戻る)と、キャンセル・Escape・オーバーレイのクリックで再び閉じられる', async () => {
    const props: Props = {
      tags: [],
      branchNames: ['main'],
      isCreating: true,
      isBlocked: false,
      error: null,
      onSubmit: vi.fn(),
      onCancel: vi.fn()
    }
    const { container, rerender } = render(<CreateTagDialog {...props} />)
    rerender(<CreateTagDialog {...props} isCreating={false} />)
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.keyDown(nameInput(), { key: 'Escape', isComposing: false })
    await userEvent.click(container.querySelector('.name-input-dialog__overlay')!)
    expect(props.onCancel).toHaveBeenCalledTimes(3)
  })

  // IME の変換を取り消す Escape でダイアログを閉じると、入力中の名前が消えてしまう
  it('IME の変換中の Escape では onCancel を呼ばず、変換中でない Escape では呼ぶ', () => {
    const props = renderDialog()
    fireEvent.keyDown(nameInput(), { key: 'Escape', isComposing: true })
    expect(props.onCancel).not.toHaveBeenCalled()
    fireEvent.keyDown(nameInput(), { key: 'Escape', isComposing: false })
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('ダイアログの中のクリックでは onCancel を呼ばない', async () => {
    const props = renderDialog()
    await userEvent.click(screen.getByRole('dialog', { name: 'タグを作成' }))
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  // ボタンの disabled を経由しない送信(フォームの submit イベントの直接発火)でも、二重送信・ブロック中の送信を防ぐ
  it.each([
    ['実行中(isCreating)', { isCreating: true }],
    ['他の操作中(isBlocked)', { isBlocked: true }]
  ] as Array<[string, Partial<Props>]>)(
    '%sは、submit イベントが直接来ても onSubmit を呼ばない',
    async (_label, overrides) => {
      const props = renderDialog(overrides)
      if (overrides.isBlocked === true) await userEvent.type(nameInput(), 'v1')
      fireEvent.submit(screen.getByRole('dialog', { name: 'タグを作成' }))
      expect(props.onSubmit).not.toHaveBeenCalled()
    }
  )

  // 作成中は入力欄が disabled になり、フォーカスが body に落ちる。失敗して作成中が解けたとき、
  // Escape がフォームに届くよう入力欄へ戻す(body かダイアログ内にフォーカスがある場合だけ)
  describe('作成が終わったときのフォーカス', () => {
    it('isCreating が true→false になったとき、フォーカスが body にあればタグ名の入力欄へ戻す', () => {
      const { rerenderWith } = renderDialog({ isCreating: true })
      ;(document.activeElement as HTMLElement | null)?.blur()
      expect(document.body).toHaveFocus()
      rerenderWith({ isCreating: false })
      expect(nameInput()).toHaveFocus()
    })

    it('isCreating が true→false になっても、ダイアログの外にあるフォーカスは奪わない', () => {
      const outside = document.createElement('button')
      outside.textContent = '外部'
      document.body.appendChild(outside)
      try {
        const { rerenderWith } = renderDialog({ isCreating: true })
        outside.focus()
        expect(outside).toHaveFocus()
        rerenderWith({ isCreating: false })
        expect(outside).toHaveFocus()
      } finally {
        outside.remove()
      }
    })
  })
})
