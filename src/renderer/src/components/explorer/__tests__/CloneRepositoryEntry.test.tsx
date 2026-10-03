import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { CloneRepositoryPanelState } from '../../../types'
import CloneRepositoryEntry from '../CloneRepositoryEntry'
import { makeCloneRepositoryPanelState } from '../../../__tests__/makeCloneRepositoryPanelState'

// 「リポジトリを clone」の入口(ボタン・開閉・成功の判定・フォーカスの戻し)を単体で確かめる。ExplorerPanel での
// 配置(「フォルダを開く／変更」の隣)と、フォルダの切り替えをまたぐ挙動は ExplorerPanel.clone.test.tsx が見る

const cloneButton = (): HTMLElement => screen.getByRole('button', { name: 'リポジトリを clone' })

// 同じ clone を基に一部だけ変えて描き直す rerenderWith を返す
const renderEntry = (
  clone: CloneRepositoryPanelState
): { rerenderWith: (next: Partial<CloneRepositoryPanelState>) => void } => {
  const { rerender } = render(<CloneRepositoryEntry clone={clone} />)
  return {
    rerenderWith: (next) => rerender(<CloneRepositoryEntry clone={{ ...clone, ...next }} />)
  }
}

// ダイアログを開き、URL を入れて実行する(フォルダ名は URL から b になる)
const submitClone = async (): Promise<void> => {
  await userEvent.click(cloneButton())
  await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
  await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
}

describe('CloneRepositoryEntry', () => {
  it('ボタンだけを出し、ダイアログは閉じている', () => {
    renderEntry(makeCloneRepositoryPanelState())
    expect(cloneButton()).toBeEnabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['clone の実行中', { isCloning: true }],
    ['他の Git 操作の実行中', { isBlocked: true }]
  ])('%s はボタンを押せない', (_label, state) => {
    renderEntry(makeCloneRepositoryPanelState(state))
    expect(cloneButton()).toBeDisabled()
  })

  it('押すと前回の失敗を消してから、ダイアログを開く', async () => {
    const clone = makeCloneRepositoryPanelState()
    renderEntry(clone)
    await userEvent.click(cloneButton())
    expect(clone.clearError).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'リポジトリを clone' })).toBeInTheDocument()
  })

  it('キャンセルで閉じたら、ボタンへフォーカスを戻す', async () => {
    renderEntry(makeCloneRepositoryPanelState())
    await userEvent.click(cloneButton())
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(cloneButton()).toHaveFocus()
  })

  it('開けた(true)ら閉じて、ボタンへフォーカスを戻す', async () => {
    const cloneRepository = vi.fn<CloneRepositoryPanelState['cloneRepository']>()
    cloneRepository.mockResolvedValueOnce(true)
    renderEntry(makeCloneRepositoryPanelState({ cloneRepository }))
    await submitClone()
    expect(cloneRepository).toHaveBeenCalledWith('https://github.com/a/b.git', 'b')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // フォーカスを戻すのはダイアログが消えた描画の後の effect。消えたことを待った直後には間に合わないことがある
    await waitFor(() => expect(cloneButton()).toHaveFocus())
  })

  it('開けなかった(false)ときは閉じず、入力を保持する', async () => {
    const cloneRepository = vi.fn<CloneRepositoryPanelState['cloneRepository']>()
    cloneRepository.mockResolvedValueOnce(false)
    renderEntry(makeCloneRepositoryPanelState({ cloneRepository }))
    await submitClone()
    await waitFor(() => expect(cloneRepository).toHaveBeenCalledOnce())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'URL' })).toHaveValue('https://github.com/a/b.git')
  })

  it('clone の実行中に成功で閉じたら、実行中が解けてからボタンへフォーカスを戻す', async () => {
    let resolveClone!: (opened: boolean) => void
    const cloneRepository = vi.fn<CloneRepositoryPanelState['cloneRepository']>()
    cloneRepository.mockReturnValueOnce(new Promise((resolve) => (resolveClone = resolve)))
    const { rerenderWith } = renderEntry(makeCloneRepositoryPanelState({ cloneRepository }))
    await submitClone()
    rerenderWith({ cloneRepository, isCloning: true })
    resolveClone(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // disabled のボタンへは戻さない(フォーカスは body に落ちたまま)
    expect(cloneButton()).toBeDisabled()
    expect(cloneButton()).not.toHaveFocus()
    rerenderWith({ cloneRepository, isCloning: false })
    expect(cloneButton()).toHaveFocus()
  })
})
