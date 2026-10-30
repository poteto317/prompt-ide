import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ProgressPanel from '../ProgressPanel'
import { useProgressTasks } from '../../../hooks/useProgressTasks'
import { createTask } from '../../../lib/taskFactory'
import type { Task } from '../../../types'

// 進捗管理の「操作 → 状態の更新 → 表示 → 保存 → 読み込み」を通して確かめる結合テスト。
// 単体テストでは ProgressPanel は handler を偽物にし、useProgressTasks は永続化の hook をモックしているため、
// 画面の操作が useProgressTasks・useBufferedPersistence・progressApi(window.api)まで届き、保存した内容を
// 次のマウントで読み戻して表示できるかはここで固定する。window.api の loadTasks・saveTasks だけをメモリ上の保存先に差し替える

// Sidebar と同じつなぎ方(useAppState が useProgressTasks の戻り値を Sidebar 経由で ProgressPanel に渡す)
function ProgressHarness(): React.JSX.Element {
  const progress = useProgressTasks()
  return (
    <ProgressPanel
      tasks={progress.tasks}
      onAddTask={progress.addTask}
      onDeleteTask={progress.deleteTask}
      onRecordEvent={progress.recordEvent}
      onCompleteStage={progress.completeStage}
      onReopenStage={progress.reopenStage}
      onSkipStage={progress.skipStage}
      onAdvanceStage={progress.advanceStage}
    />
  )
}

// main のストアの代わり。保存のたびに JSON を通して控える(IPC の構造化複製と同じく参照を共有しない)
let stored: Task[]
let loadTasks: ReturnType<typeof vi.fn<() => Promise<Task[]>>>
let saveTasks: ReturnType<typeof vi.fn<(tasks: Task[]) => Promise<void>>>

beforeEach(() => {
  stored = []
  loadTasks = vi.fn(async () => JSON.parse(JSON.stringify(stored)) as Task[])
  saveTasks = vi.fn(async (tasks: Task[]) => {
    stored = JSON.parse(JSON.stringify(tasks)) as Task[]
  })
  vi.stubGlobal('api', { ...window.api, loadTasks, saveTasks })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// 読み込みが終わるまで待つ。入力欄などは読み込みの前から表示されているため、load の Promise の決着を act の中で待つ
async function renderLoaded(): Promise<ReturnType<typeof render>> {
  const callsBefore = loadTasks.mock.calls.length
  const view = render(<ProgressHarness />)
  await waitFor(() => expect(loadTasks).toHaveBeenCalledTimes(callsBefore + 1))
  await act(async () => {
    await (loadTasks.mock.results[callsBefore].value as Promise<unknown>).catch(() => undefined)
  })
  return view
}

function stageRow(label: string): HTMLElement {
  return screen.getByText(new RegExp(label)).closest('li') as HTMLElement
}

async function addTask(title: string): Promise<void> {
  await userEvent.type(screen.getByLabelText('タスク名'), title)
  await userEvent.click(screen.getByRole('button', { name: 'タスクを追加' }))
}

describe('進捗管理の操作と保存・読み込みの結合', () => {
  it('保存済みのタスクを読み込んで表示する', async () => {
    const task = createTask('保存済み')
    task.stages = task.stages.map((s) => (s.id === 'plan' ? { ...s, status: 'done' } : s))
    stored = [task]
    await renderLoaded()
    expect(await screen.findByText('保存済み')).toBeInTheDocument()
    expect(screen.getByLabelText('進捗')).toHaveTextContent('進捗 1/8')
  })

  it('フォームで追加したタスクを表示して保存し、開き直すと読み戻して表示する', async () => {
    const view = await renderLoaded()
    expect(screen.getByText('タスクがありません')).toBeInTheDocument()
    await addTask('新しいタスク')
    expect(screen.getByText('新しいタスク')).toBeInTheDocument()
    await waitFor(() => expect(stored.map((t) => t.title)).toEqual(['新しいタスク']))

    view.unmount()
    await renderLoaded()
    expect(await screen.findByText('新しいタスク')).toBeInTheDocument()
    expect(screen.getByLabelText('進捗')).toHaveTextContent('進捗 0/8')
  })

  it('ステージの操作(スキップ・完了)が表示に反映され、その状態が保存される', async () => {
    stored = [createTask('a')]
    await renderLoaded()
    await screen.findByText('a')

    await userEvent.click(
      within(stageRow('プラン作成')).getByRole('button', { name: 'このステージをスキップする' })
    )
    expect(within(stageRow('プラン作成')).getByLabelText('スキップ')).toBeInTheDocument()

    await userEvent.click(within(stageRow('PR 作成')).getByRole('button', { name: '完了にする' }))
    expect(within(stageRow('PR 作成')).getByLabelText('完了')).toBeInTheDocument()
    expect(screen.getByLabelText('進捗')).toHaveTextContent('進捗 1/8')

    await waitFor(() => {
      const stages = stored[0].stages
      expect(stages.find((s) => s.id === 'plan')?.status).toBe('skipped')
      expect(stages.find((s) => s.id === 'prCreate')?.status).toBe('done')
    })
  })

  it('実施の記録はメモ付きで保存され、開き直しても実施回数として表示される', async () => {
    stored = [createTask('a')]
    const view = await renderLoaded()
    await screen.findByText('a')
    const planRow = within(stageRow('プラン作成'))
    await userEvent.click(planRow.getByRole('button', { name: '履歴を開く' }))
    await userEvent.type(planRow.getByLabelText('実施メモ'), '初版')
    await userEvent.click(planRow.getByRole('button', { name: '実施を記録する' }))
    await waitFor(() =>
      expect(stored[0].stages.find((s) => s.id === 'plan')?.events.map((e) => e.note)).toEqual([
        '初版'
      ])
    )

    view.unmount()
    await renderLoaded()
    await screen.findByText('a')
    expect(within(stageRow('プラン作成')).getByLabelText('実施回数 1 回')).toBeInTheDocument()
  })

  it('タスクを削除すると表示から消え、保存先も空になる', async () => {
    stored = [createTask('消すタスク')]
    await renderLoaded()
    await screen.findByText('消すタスク')
    await userEvent.click(screen.getByRole('button', { name: 'タスクを削除' }))
    expect(screen.getByText('タスクがありません')).toBeInTheDocument()
    await waitFor(() => expect(stored).toEqual([]))
  })

  it('読み込みが終わる前に追加したタスクは、読み込んだタスクの後ろに足して保存する(保存済みを空で上書きしない)', async () => {
    const existing = createTask('既存')
    stored = [existing]
    let finishLoad = (): void => undefined
    loadTasks.mockImplementationOnce(
      () =>
        new Promise<Task[]>((resolve) => {
          finishLoad = () => resolve(JSON.parse(JSON.stringify(stored)) as Task[])
        })
    )
    render(<ProgressHarness />)
    await addTask('読み込み中に追加')
    // 読み込みの前は保存しない(保存すると既存のタスクが消える)
    expect(saveTasks).not.toHaveBeenCalled()
    expect(screen.getByText('読み込み中に追加')).toBeInTheDocument()

    finishLoad()
    await waitFor(() => expect(stored.map((t) => t.title)).toEqual(['既存', '読み込み中に追加']))
    expect(screen.getByLabelText('タスクを選択')).toBeInTheDocument()
  })

  it('保存に失敗しても画面の状態は保ち、エラーをログに出す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    saveTasks.mockRejectedValueOnce(new Error('disk full'))
    await renderLoaded()
    await addTask('保存に失敗')
    expect(screen.getByText('保存に失敗')).toBeInTheDocument()
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        '[useProgressTasksPersistence] save failed:',
        expect.any(Error)
      )
    )
  })

  it('読み込みに失敗したら空の一覧で表示し、追加した内容は保存する', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    loadTasks.mockRejectedValueOnce(new Error('broken'))
    await renderLoaded()
    expect(screen.getByText('タスクがありません')).toBeInTheDocument()
    expect(consoleError).toHaveBeenCalledWith(
      '[useProgressTasksPersistence] load failed:',
      expect.any(Error)
    )
    await addTask('後から追加')
    await waitFor(() => expect(stored.map((t) => t.title)).toEqual(['後から追加']))
  })
})
