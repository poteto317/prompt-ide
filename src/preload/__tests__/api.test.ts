import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.hoisted(() => vi.fn())
const mockOn = vi.hoisted(() => vi.fn())
const mockRemoveListener = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcRenderer: { invoke: mockInvoke, on: mockOn, removeListener: mockRemoveListener }
}))

import { api } from '../api'

beforeEach(() => {
  vi.clearAllMocks()
})

const invokeCases: Array<[string, () => unknown, unknown[]]> = [
  [
    'openFolder は dialog:openFolder チャンネルを呼び出す',
    () => api.openFolder(),
    ['dialog:openFolder']
  ],
  [
    'readDirectory は fs:readDirectory チャンネルに path を渡す',
    () => api.readDirectory('/project'),
    ['fs:readDirectory', '/project']
  ],
  [
    'readFile は fs:readFile チャンネルに path を渡す',
    () => api.readFile('/project/a.txt'),
    ['fs:readFile', '/project/a.txt']
  ],
  [
    'writeFile は fs:writeFile チャンネルに path と content を渡す',
    () => api.writeFile('/project/a.txt', 'hello'),
    ['fs:writeFile', '/project/a.txt', 'hello']
  ],
  [
    'createFile は fs:createFile チャンネルに parentPath と name を渡す',
    () => api.createFile('/project', 'a.txt'),
    ['fs:createFile', '/project', 'a.txt']
  ],
  [
    'createDirectory は fs:createDirectory チャンネルに parentPath と name を渡す',
    () => api.createDirectory('/project', 'sub'),
    ['fs:createDirectory', '/project', 'sub']
  ],
  [
    'renameEntry は fs:renameEntry チャンネルに path と newName を渡す',
    () => api.renameEntry('/project/a.txt', 'b.txt'),
    ['fs:renameEntry', '/project/a.txt', 'b.txt']
  ],
  [
    'deleteEntry は fs:deleteEntry チャンネルに path を渡す',
    () => api.deleteEntry('/project/a.txt'),
    ['fs:deleteEntry', '/project/a.txt']
  ],
  [
    'getGitStatus は git:getStatus チャンネルを呼び出す',
    () => api.getGitStatus(),
    ['git:getStatus']
  ],
  [
    'discardChanges は git:discardChanges チャンネルに filePath を渡す',
    () => api.discardChanges('src/a.ts'),
    ['git:discardChanges', 'src/a.ts']
  ],
  [
    'discardHunk は git:discardHunk チャンネルに filePath と patch を渡す',
    () => api.discardHunk('src/a.ts', 'PATCH'),
    ['git:discardHunk', 'src/a.ts', 'PATCH']
  ],
  [
    'discardAll は git:discardAll チャンネルに確認時の一覧を渡す',
    () => api.discardAll([{ path: 'a.txt', status: ' M' }]),
    ['git:discardAll', [{ path: 'a.txt', status: ' M' }]]
  ],
  ['push は git:push チャンネルを呼び出す', () => api.push(), ['git:push']],
  ['pull は git:pull チャンネルを呼び出す', () => api.pull(), ['git:pull']],
  ['fetchRemote は git:fetch チャンネルを呼び出す', () => api.fetchRemote(), ['git:fetch']],
  [
    'checkoutBranch は git:checkoutBranch チャンネルに branchName を渡す',
    () => api.checkoutBranch('feature/x'),
    ['git:checkoutBranch', 'feature/x']
  ],
  [
    'createBranch は git:createBranch チャンネルに branchName を渡す',
    () => api.createBranch('feature/new'),
    ['git:createBranch', 'feature/new']
  ],
  [
    'deleteBranch は git:deleteBranch チャンネルに branchName と force を渡す',
    () => api.deleteBranch('feature/x', true),
    ['git:deleteBranch', 'feature/x', true]
  ],
  [
    'mergeBranch は git:mergeBranch チャンネルに branchName を渡す',
    () => api.mergeBranch('feature/x'),
    ['git:mergeBranch', 'feature/x']
  ],
  ['getStashes は git:getStashes チャンネルを呼び出す', () => api.getStashes(), ['git:getStashes']],
  [
    'stashPush は git:stashPush チャンネルにメッセージを渡す',
    () => api.stashPush('msg'),
    ['git:stashPush', 'msg']
  ],
  [
    'stashPop は git:stashPop チャンネルに SHA を渡す',
    () => api.stashPop('a'.repeat(40)),
    ['git:stashPop', 'a'.repeat(40)]
  ],
  [
    'stashDrop は git:stashDrop チャンネルに SHA を渡す',
    () => api.stashDrop('a'.repeat(40)),
    ['git:stashDrop', 'a'.repeat(40)]
  ],
  [
    'hasApiKey は settings:hasApiKey チャンネルを呼び出す',
    () => api.hasApiKey(),
    ['settings:hasApiKey']
  ],
  [
    'setApiKey は settings:setApiKey チャンネルに apiKey を渡す',
    () => api.setApiKey('sk-xxx'),
    ['settings:setApiKey', 'sk-xxx']
  ],
  [
    'getModelSettings は settings:getModelSettings チャンネルを呼び出す',
    () => api.getModelSettings(),
    ['settings:getModelSettings']
  ],
  [
    'setModelSettings は settings:setModelSettings チャンネルに settings を渡す',
    () => api.setModelSettings({ modelId: 'claude-sonnet-5', maxTokens: 4096 }),
    ['settings:setModelSettings', { modelId: 'claude-sonnet-5', maxTokens: 4096 }]
  ],
  [
    'runPromptStream は claude:runPromptStream チャンネルに requestId・promptContent・fileContent をまとめて渡す',
    () => api.runPromptStream('req-1', 'prompt', 'file-content'),
    [
      'claude:runPromptStream',
      { requestId: 'req-1', promptContent: 'prompt', fileContent: 'file-content' }
    ]
  ],
  ['loadPrompts は prompts:load チャンネルを呼び出す', () => api.loadPrompts(), ['prompts:load']],
  [
    'savePrompts は prompts:save チャンネルに prompts を渡す',
    () => api.savePrompts([]),
    ['prompts:save', []]
  ],
  [
    'exportPrompts は prompts:export チャンネルに prompts を渡す',
    () => api.exportPrompts([]),
    ['prompts:export', []]
  ],
  [
    'importPrompts は prompts:import チャンネルを呼び出す',
    () => api.importPrompts(),
    ['prompts:import']
  ],
  ['loadTasks は progress:load チャンネルを呼び出す', () => api.loadTasks(), ['progress:load']],
  [
    'saveTasks は progress:save チャンネルに tasks を渡す',
    () => api.saveTasks([]),
    ['progress:save', []]
  ],
  [
    'runCLIPromptStream は cli:runPromptStream チャンネルに requestId・toolId・promptContent をまとめて渡す',
    () => api.runCLIPromptStream('req-1', 'claude', 'prompt'),
    ['cli:runPromptStream', { requestId: 'req-1', toolId: 'claude', promptContent: 'prompt' }]
  ],
  [
    'cancelPrompt は prompt:cancel チャンネルに requestId をまとめて渡す',
    () => api.cancelPrompt('req-1'),
    ['prompt:cancel', { requestId: 'req-1' }]
  ],
  ['loadHistory は history:load チャンネルを呼び出す', () => api.loadHistory(), ['history:load']],
  [
    'saveHistory は history:save チャンネルに entries を渡す',
    () => api.saveHistory([]),
    ['history:save', []]
  ]
]

describe('api', () => {
  it.each(invokeCases)('%s', (_name, call, expectedArgs) => {
    call()
    expect(mockInvoke).toHaveBeenCalledWith(...expectedArgs)
  })
})

describe('stashPop の戻り値', () => {
  it('git:stashPop の結果をそのまま返す(警告つきの結果を落とさない)', async () => {
    const result = { status: 'dropFailed', message: 'm' }
    mockInvoke.mockResolvedValue(result)
    await expect(api.stashPop('a'.repeat(40))).resolves.toBe(result)
  })
})

describe('onPromptStreamChunk', () => {
  it('prompt:streamChunk チャンネルにリスナーを登録する', () => {
    api.onPromptStreamChunk(vi.fn())
    expect(mockOn).toHaveBeenCalledWith('prompt:streamChunk', expect.any(Function))
  })

  it('requestId と chunk が共に文字列の payload でコールバックを呼び出す', () => {
    const listener = vi.fn()
    api.onPromptStreamChunk(listener)
    const wrapped = mockOn.mock.calls[0][1]

    wrapped({}, { requestId: 'req-1', chunk: 'hello' })

    expect(listener).toHaveBeenCalledWith('req-1', 'hello')
  })

  it.each([
    ['payload が null', null],
    ['payload がオブジェクトでない', 'not-an-object'],
    ['requestId が文字列でない', { requestId: 1, chunk: 'hello' }],
    ['chunk が文字列でない', { requestId: 'req-1', chunk: 1 }]
  ])('%s の場合コールバックを呼び出さない', (_label, payload) => {
    const listener = vi.fn()
    api.onPromptStreamChunk(listener)
    const wrapped = mockOn.mock.calls[0][1]

    wrapped({}, payload)

    expect(listener).not.toHaveBeenCalled()
  })

  it('返り値の解除関数を呼ぶと removeListener が呼ばれる', () => {
    const unsubscribe = api.onPromptStreamChunk(vi.fn())
    const wrapped = mockOn.mock.calls[0][1]

    unsubscribe()

    expect(mockRemoveListener).toHaveBeenCalledWith('prompt:streamChunk', wrapped)
  })
})
