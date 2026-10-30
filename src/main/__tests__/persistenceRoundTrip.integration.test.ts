import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import type { Prompt, Task } from '@shared/types'

// 保存 → 読み込みの往復を、IPC ハンドラ(handlers/promptsHandlers・progressHandlers)→ ストア(promptStore・progressStore)→
// jsonCollectionStore → 実ファイル の順に通して確かめる結合テスト。単体テストはハンドラ側がストアを、ストア側が fs をモックしているため、
// 「ハンドラが受け付けた値が、そのままの形で読み戻せるか」「検証・移行・書き込みの直列化が組み合わさって働くか」はここで固定する。
// electron の app.getPath と保存・読み込みのダイアログだけを差し替え、ファイルは一時ディレクトリに実際に書く

const paths = vi.hoisted(() => ({
  userData: '',
  dialogFile: null as string | null
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => paths.userData) }
}))

vi.mock('../dialogService', () => ({
  saveJsonDialog: vi.fn(async () => paths.dialogFile),
  openJsonDialog: vi.fn(async () => paths.dialogFile)
}))

import { registerPromptsHandlers } from '../handlers/promptsHandlers'
import { registerProgressHandlers } from '../handlers/progressHandlers'

type Handler = (...args: unknown[]) => Promise<unknown>

// ipcMain.handle に登録された関数を、チャンネル名で呼べるようにする偽物
function createFakeIpcMain(): {
  ipcMain: never
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
} {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    }
  }
  return {
    ipcMain: ipcMain as never,
    invoke: (channel, payload) => {
      const handler = handlers.get(channel)
      if (handler === undefined) throw new Error(`handler not found: ${channel}`)
      return handler({ sender: { id: 1 } }, payload)
    }
  }
}

const STAGE_IDS = [
  'plan',
  'implement',
  'refactor',
  'localReview',
  'commit',
  'prCreate',
  'prReview',
  'prMerge'
] as const

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'タスク',
    createdAt: 1000,
    updatedAt: 2000,
    currentStageId: 'implement',
    stages: STAGE_IDS.map((id) =>
      id === 'plan'
        ? { id, status: 'done' as const, events: [{ id: 'e1', occurredAt: 500 }] }
        : { id, status: 'not_started' as const, events: [] }
    ),
    ...overrides
  }
}

let root: string
let ipc: ReturnType<typeof createFakeIpcMain>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'prompt-ide-persistence-'))
  // userData はまだ無いディレクトリ(初回起動)。保存で作られることも確かめる
  paths.userData = join(root, 'userData')
  paths.dialogFile = null
  ipc = createFakeIpcMain()
  registerPromptsHandlers(ipc.ipcMain)
  registerProgressHandlers(ipc.ipcMain)
})

afterEach(() => {
  removeTempPathSync(root)
})

const promptsFile = (): string => join(paths.userData, 'prompts.json')
const progressFile = (): string => join(paths.userData, 'progress.json')

describe('プロンプトの保存と読み込み(prompts:save → prompts:load)', () => {
  it('初回(ファイルも userData も無い)は空の一覧を読み、保存で userData を作ってから書く', async () => {
    expect(await ipc.invoke('prompts:load')).toEqual([])
    expect(existsSync(paths.userData)).toBe(false)
    await ipc.invoke('prompts:save', [])
    expect(existsSync(promptsFile())).toBe(true)
    expect(await ipc.invoke('prompts:load')).toEqual([])
  })

  it('保存したプロンプトを、ピン留め・タグ・並び順を含めてそのまま読み戻す', async () => {
    const prompts: Prompt[] = [
      { id: 'p2', title: '二', content: 'b', createdAt: 2, pinned: true, tags: ['x', 'y'] },
      { id: 'p1', title: '一', content: 'a\n{{name}}', createdAt: 1 }
    ]
    await ipc.invoke('prompts:save', prompts)
    expect(await ipc.invoke('prompts:load')).toEqual(prompts)
  })

  it('保存の時点でタグを整え(前後の空白・空・重複を除く)、未知のフィールドを落とした形で書き、その形で読み戻す', async () => {
    await ipc.invoke('prompts:save', [
      { id: 'p1', title: 't', content: 'c', createdAt: 1, tags: [' a ', '', 'a', 'b'], extra: 1 }
    ])
    const expected = [{ id: 'p1', title: 't', content: 'c', createdAt: 1, tags: ['a', 'b'] }]
    expect(JSON.parse(readFileSync(promptsFile(), 'utf-8'))).toEqual(expected)
    expect(await ipc.invoke('prompts:load')).toEqual(expected)
  })

  it('不正な要素を含む保存は拒否し、前に保存した内容を壊さない', async () => {
    const saved: Prompt[] = [{ id: 'p1', title: 't', content: 'c', createdAt: 1 }]
    await ipc.invoke('prompts:save', saved)
    await expect(
      ipc.invoke('prompts:save', [...saved, { id: 'p2', title: 't', content: 'c' }])
    ).rejects.toThrow('プロンプトの形式が不正です')
    await expect(ipc.invoke('prompts:save', { not: 'array' })).rejects.toThrow(
      '引数は配列である必要があります'
    )
    expect(await ipc.invoke('prompts:load')).toEqual(saved)
  })

  it('続けて保存したときは、最後に依頼した内容が残る(書き込みの直列化)', async () => {
    const versions = [1, 2, 3, 4, 5].map((n) => [
      { id: `p${n}`, title: `v${n}`, content: 'c', createdAt: n }
    ])
    await Promise.all(versions.map((version) => ipc.invoke('prompts:save', version)))
    expect(await ipc.invoke('prompts:load')).toEqual(versions[4])
  })

  it('ファイルが外から壊されていても、読める要素だけを読み、配列でなければ空の一覧にする', async () => {
    await ipc.invoke('prompts:save', [])
    writeFileSync(
      promptsFile(),
      JSON.stringify([{ id: 'ok', title: 't', content: 'c', createdAt: 1 }, { id: 'ng' }, null])
    )
    expect(await ipc.invoke('prompts:load')).toEqual([
      { id: 'ok', title: 't', content: 'c', createdAt: 1 }
    ])
    writeFileSync(promptsFile(), JSON.stringify({ prompts: [] }))
    expect(await ipc.invoke('prompts:load')).toEqual([])
  })

  it('JSON として読めないファイルは読み込みを失敗にする(空の一覧で上書きされないよう、黙って空にしない)', async () => {
    await ipc.invoke('prompts:save', [])
    writeFileSync(promptsFile(), '{not json')
    await expect(ipc.invoke('prompts:load')).rejects.toThrow()
  })
})

describe('プロンプトのエクスポートとインポート(prompts:export → prompts:import → prompts:save)', () => {
  it('書き出したファイルを読み込むと同じプロンプトが返り、それを保存すると読み戻せる', async () => {
    const prompts: Prompt[] = [
      { id: 'p1', title: '一', content: 'a', createdAt: 1, pinned: false, tags: ['t'] }
    ]
    paths.dialogFile = join(root, 'exported.json')
    expect(await ipc.invoke('prompts:export', prompts)).toBe(true)
    const imported = await ipc.invoke('prompts:import')
    expect(imported).toEqual(prompts)
    await ipc.invoke('prompts:save', imported)
    expect(await ipc.invoke('prompts:load')).toEqual(prompts)
  })

  it('書き出し・読み込みのダイアログをキャンセルしたら false・null を返し、ファイルを作らない', async () => {
    paths.dialogFile = null
    expect(await ipc.invoke('prompts:export', [])).toBe(false)
    expect(await ipc.invoke('prompts:import')).toBeNull()
    expect(readdirSync(root)).toEqual([])
  })

  it('保存の形式(素の配列)のファイルもインポートできる', async () => {
    const prompts: Prompt[] = [{ id: 'p1', title: '一', content: 'a', createdAt: 1 }]
    await ipc.invoke('prompts:save', prompts)
    paths.dialogFile = promptsFile()
    expect(await ipc.invoke('prompts:import')).toEqual(prompts)
  })
})

describe('進捗の保存と読み込み(progress:save → progress:load)', () => {
  it('保存したタスクを、ステージと記録を含めてそのまま読み戻す', async () => {
    const tasks = [makeTask(), makeTask({ id: 't2', title: '二つ目', currentStageId: 'plan' })]
    await ipc.invoke('progress:save', tasks)
    expect(await ipc.invoke('progress:load')).toEqual(tasks)
  })

  it('不正なタスクを含む保存は理由を添えて拒否し、前に保存した内容を壊さない', async () => {
    const saved = [makeTask()]
    await ipc.invoke('progress:save', saved)
    await expect(ipc.invoke('progress:save', [{ id: 'broken' }])).rejects.toThrow(
      /^タスクデータの形式が不正です: /
    )
    expect(await ipc.invoke('progress:load')).toEqual(saved)
  })

  it('ステージが足りない古いファイルは、読み込みで足りないステージを未着手として補う', async () => {
    const legacy = makeTask()
    const stored = { ...legacy, stages: legacy.stages.filter((s) => s.id !== 'prMerge') }
    await ipc.invoke('progress:save', [])
    writeFileSync(progressFile(), JSON.stringify([stored]))
    const [loaded] = (await ipc.invoke('progress:load')) as Task[]
    expect(loaded.stages.map((s) => s.id)).toEqual([...STAGE_IDS])
    expect(loaded.stages.at(-1)).toEqual({ id: 'prMerge', status: 'not_started', events: [] })
    // 補った形で保存し直すと、そのまま読み戻せる
    await ipc.invoke('progress:save', [loaded])
    expect(await ipc.invoke('progress:load')).toEqual([loaded])
  })

  it('プロンプトと進捗は別のファイルに保存され、互いに上書きしない', async () => {
    const prompts: Prompt[] = [{ id: 'p1', title: 't', content: 'c', createdAt: 1 }]
    const tasks = [makeTask()]
    await ipc.invoke('prompts:save', prompts)
    await ipc.invoke('progress:save', tasks)
    expect(await ipc.invoke('prompts:load')).toEqual(prompts)
    expect(await ipc.invoke('progress:load')).toEqual(tasks)
  })
})
