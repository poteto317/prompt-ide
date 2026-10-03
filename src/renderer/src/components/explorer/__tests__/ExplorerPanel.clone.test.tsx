import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CloneRepositoryResult } from '@shared/types'
import type { FileTreeNode } from '../../../types'

vi.mock('../../../lib/gitApi')

import * as gitApi from '../../../lib/gitApi'
import ExplorerPanel from '../ExplorerPanel'
import {
  CLONE_BLOCKED_NOTICE,
  CLONE_OPENING_NOTICE,
  CLONE_RUNNING_NOTICE
} from '../CloneRepositoryDialog'
import { useCloneRepository } from '../../../hooks/useCloneRepository'
import type { UseCloneRepositoryOptions } from '../../../hooks/useCloneRepository'
import { useFileOperationLock } from '../../../hooks/useFileOperationLock'
import { makeCloneRepositoryPanelState } from '../../../__tests__/makeCloneRepositoryPanelState'

const mockCloneRepository = vi.mocked(gitApi.cloneRepository)
const mockCancelCloneRepository = vi.mocked(gitApi.cancelCloneRepository)

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const baseProps = {
  fileTree: [] as FileTreeNode[],
  openFilePath: null as string | null,
  onOpenFolder: vi.fn(),
  onSelectFile: vi.fn(),
  error: null as Error | null,
  gitignoreError: null as Error | null,
  onCreateFile: vi.fn(),
  onCreateDirectory: vi.fn(),
  onRenameEntry: vi.fn(),
  onDeleteEntry: vi.fn(),
  onAddToGitignore: vi.fn()
}

const cloneButton = (): HTMLElement => screen.getByRole('button', { name: 'リポジトリを clone' })

beforeEach(() => {
  vi.resetAllMocks()
  mockCancelCloneRepository.mockResolvedValue(undefined)
})

describe('ExplorerPanel の「リポジトリを clone」(状態はモック)', () => {
  it.each([
    ['フォルダが未選択', null, 'フォルダを開く'],
    ['フォルダを開いている', '/p', 'フォルダを変更']
  ])('%s のとき、%s の隣に置く', (_label, folderPath, folderButton) => {
    render(
      <ExplorerPanel
        {...baseProps}
        folderPath={folderPath}
        clone={makeCloneRepositoryPanelState()}
      />
    )
    expect(screen.getByRole('button', { name: folderButton })).toBeEnabled()
    expect(cloneButton()).toBeEnabled()
  })

  it('clone の実行中は、clone とフォルダの変更を押せない', () => {
    render(
      <ExplorerPanel
        {...baseProps}
        folderPath="/p"
        clone={makeCloneRepositoryPanelState({ isCloning: true })}
      />
    )
    expect(cloneButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeDisabled()
  })

  // clone のボタンが押せないことは CloneRepositoryEntry.test.tsx が見る。ここはフォルダのボタンへ波及しないことだけ
  it('他の Git 操作の実行中も、フォルダを開くは押せる', () => {
    render(
      <ExplorerPanel
        {...baseProps}
        folderPath={null}
        clone={makeCloneRepositoryPanelState({ isBlocked: true })}
      />
    )
    expect(screen.getByRole('button', { name: 'フォルダを開く' })).toBeEnabled()
  })
})

// 実物のフック(useCloneRepository・useFileOperationLock)と ExplorerPanel を組み合わせ、gitApi だけをモックする
// (保留 → 操作 → 解決の順序を作る。パターン 85)
function Harness({
  applyOpenedFolder,
  onLock
}: {
  applyOpenedFolder: UseCloneRepositoryOptions['applyOpenedFolder']
  onLock?: (locked: boolean) => void
}): React.JSX.Element {
  const lock = useFileOperationLock()
  const clone = useCloneRepository({
    captureDirtySnapshot: () => '[]',
    confirmDiscardAnyDirty: () => true,
    applyOpenedFolder,
    lock,
    isGitOperationRunning: false
  })
  onLock?.(lock.isAnyLocked())
  return <ExplorerPanel {...baseProps} folderPath="/p" clone={clone} />
}

describe('ExplorerPanel と useCloneRepository の結合', () => {
  it('clone 中は閉じられず、キャンセルで中止を依頼し、中止の後は入力を保持して開いたまま', async () => {
    const pending = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(pending.promise)
    const applyOpenedFolder = vi.fn<UseCloneRepositoryOptions['applyOpenedFolder']>()
    render(<Harness applyOpenedFolder={applyOpenedFolder} />)
    await userEvent.click(cloneButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
    await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
    expect(screen.getByRole('status')).toHaveTextContent(CLONE_RUNNING_NOTICE)
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeDisabled()
    expect(cloneButton()).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(mockCancelCloneRepository).toHaveBeenCalledOnce()
    pending.resolve({ status: 'canceled' })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'URL' })).toBeEnabled())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'URL' })).toHaveValue('https://github.com/a/b.git')
    expect(screen.getByRole('textbox', { name: 'URL' })).toHaveFocus()
    expect(applyOpenedFolder).not.toHaveBeenCalled()
  })

  it('失敗はダイアログ内に alert で出し、開き直すと消える', async () => {
    mockCloneRepository.mockRejectedValueOnce(new Error('リポジトリを clone できませんでした: x'))
    render(<Harness applyOpenedFolder={vi.fn()} />)
    await userEvent.click(cloneButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
    await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'リポジトリを clone できませんでした: x'
    )
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await userEvent.click(cloneButton())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('成功したら開き終わってからダイアログを閉じ、ロックを解き、「リポジトリを clone」へフォーカスを戻す', async () => {
    mockCloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    const opened = deferred<void>()
    const applyOpenedFolder = vi
      .fn<UseCloneRepositoryOptions['applyOpenedFolder']>()
      .mockReturnValueOnce(opened.promise)
    const locks: boolean[] = []
    render(<Harness applyOpenedFolder={applyOpenedFolder} onLock={(l) => locks.push(l)} />)
    await userEvent.click(cloneButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
    await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
    await waitFor(() =>
      expect(applyOpenedFolder).toHaveBeenCalledWith('/parent/b', { dirtySnapshotAtConfirm: '[]' })
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(locks.at(-1)).toBe(true)
    opened.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(cloneButton()).toHaveFocus())
    expect(locks.at(-1)).toBe(false)
  })

  it('clone の成功の後のフォルダの読み込み中は、案内が「フォルダを開いています…」になり、キャンセルを押せない', async () => {
    mockCloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    const opened = deferred<void>()
    const applyOpenedFolder = vi
      .fn<UseCloneRepositoryOptions['applyOpenedFolder']>()
      .mockReturnValueOnce(opened.promise)
    render(<Harness applyOpenedFolder={applyOpenedFolder} />)
    await userEvent.click(cloneButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
    await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(CLONE_OPENING_NOTICE))
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    opened.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockCancelCloneRepository).not.toHaveBeenCalled()
  })

  // 実行中の解除(useCloneRepository の finally)と閉じる操作(cloneRepository の戻りの後)が別々の描画になると、
  // useFocusOnRunningEnd が一度 URL の入力欄へフォーカスを移してから閉じ、フォーカスが body に落ちうる。
  // 成功の経路では URL の入力欄を経由しないことを、フォーカスの移動の記録で固定する
  it('成功したときは URL の入力欄を経由せずに「リポジトリを clone」へフォーカスを戻す', async () => {
    mockCloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    render(<Harness applyOpenedFolder={vi.fn(() => Promise.resolve())} />)
    await userEvent.click(cloneButton())
    const urlInput = screen.getByRole('textbox', { name: 'URL' })
    await userEvent.type(urlInput, 'https://github.com/a/b.git')
    const focused: Element[] = []
    const recordFocus = (e: FocusEvent): void => {
      if (e.target instanceof Element) focused.push(e.target)
    }
    document.addEventListener('focusin', recordFocus)
    try {
      await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(cloneButton()).toHaveFocus())
    } finally {
      document.removeEventListener('focusin', recordFocus)
    }
    expect(focused).not.toContain(urlInput)
  })

  it('失敗したら、ダイアログを開いたまま URL の入力欄へフォーカスを戻す', async () => {
    mockCloneRepository.mockRejectedValueOnce(new Error('リポジトリを clone できませんでした: x'))
    render(<Harness applyOpenedFolder={vi.fn()} />)
    await userEvent.click(cloneButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
    await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'URL' })).toHaveFocus())
  })
})

// 「フォルダを開く」と「フォルダを変更」の分岐は、どちらも同じ位置に入口(CloneRepositoryEntry)を置く。フォルダが
// 未選択の状態から clone に成功してフォルダが開いても、入口は作り直されず、閉じた後のフォーカスの戻しが保たれる
describe('ExplorerPanel のフォルダの切り替えをまたぐ clone', () => {
  it('フォルダが未選択の状態から成功してフォルダが開いたら、ダイアログを閉じて「リポジトリを clone」へフォーカスを戻す', async () => {
    const opened = deferred<boolean>()
    const cloneRepository = vi.fn<(url: string, name: string) => Promise<boolean>>()
    cloneRepository.mockReturnValueOnce(opened.promise)
    const clone = makeCloneRepositoryPanelState({ cloneRepository })
    const { rerender } = render(<ExplorerPanel {...baseProps} folderPath={null} clone={clone} />)
    await userEvent.click(cloneButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
    await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
    // 開き終わった(フォルダが切り替わった)描画の後に、cloneRepository が true で解決する
    rerender(<ExplorerPanel {...baseProps} folderPath="/p/b" clone={clone} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    opened.resolve(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
    expect(cloneButton()).toHaveFocus()
  })
})

// useAppState と同じく、Git 操作の実行中の合成にロックを含める(clone 自身の全体ロックで true になる)。clone の実行中も
// 「他の Git 操作の実行中」の案内は出さず、実行中の案内だけを出す(isBlocked は useCloneRepository が clone の実行中を除く)
function LockComposedHarness(): React.JSX.Element {
  const lock = useFileOperationLock()
  const clone = useCloneRepository({
    captureDirtySnapshot: () => '[]',
    confirmDiscardAnyDirty: () => true,
    applyOpenedFolder: vi.fn<UseCloneRepositoryOptions['applyOpenedFolder']>(),
    lock,
    isGitOperationRunning: lock.isAnyLocked()
  })
  return <ExplorerPanel {...baseProps} folderPath="/p" clone={clone} />
}

describe('ExplorerPanel と useCloneRepository の結合(実行中の合成にロックを含む)', () => {
  it('clone の実行中は、実行中の案内だけを出し、他の Git 操作の実行中の案内は出さない', async () => {
    const pending = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(pending.promise)
    render(<LockComposedHarness />)
    await userEvent.click(cloneButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), 'https://github.com/a/b.git')
    await userEvent.click(screen.getByRole('button', { name: '保存先を選んで clone' }))
    expect(screen.getByRole('status')).toHaveTextContent(CLONE_RUNNING_NOTICE)
    expect(screen.queryByText(CLONE_BLOCKED_NOTICE)).not.toBeInTheDocument()
    pending.resolve({ status: 'canceled' })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
