import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.hoisted(() => vi.fn())
const mockOn = vi.hoisted(() => vi.fn())
const mockRemoveListener = vi.hoisted(() => vi.fn())
const mockSend = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: mockInvoke,
    on: mockOn,
    removeListener: mockRemoveListener,
    send: mockSend
  }
}))

import { api } from '../api'
import { AGENT_EXIT_REASONS } from '@shared/types'

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
    'stageFile は git:stage チャンネルに filePath を渡す',
    () => api.stageFile('src/a.ts'),
    ['git:stage', 'src/a.ts']
  ],
  [
    'unstageFile は git:unstage チャンネルに filePath と renamedFrom を渡す',
    () => api.unstageFile('src/a.ts', 'src/old.ts'),
    ['git:unstage', 'src/a.ts', 'src/old.ts']
  ],
  [
    'commitChanges は git:commit チャンネルに message を渡す',
    () => api.commitChanges('feat: test'),
    ['git:commit', 'feat: test']
  ],
  [
    'getDiff は git:getDiff チャンネルに引数を渡す',
    () => api.getDiff('src/a.ts', true, false, 'old.ts'),
    ['git:getDiff', 'src/a.ts', true, false, 'old.ts']
  ],
  [
    'stageHunk は git:stageHunk チャンネルに filePath と patch を渡す',
    () => api.stageHunk('src/a.ts', 'PATCH'),
    ['git:stageHunk', 'src/a.ts', 'PATCH']
  ],
  [
    'unstageHunk は git:unstageHunk チャンネルに filePath と patch を渡す',
    () => api.unstageHunk('src/a.ts', 'PATCH'),
    ['git:unstageHunk', 'src/a.ts', 'PATCH']
  ],
  [
    'getLog は git:getLog チャンネルに limit と skip を渡す',
    () => api.getLog(20, 0),
    ['git:getLog', 20, 0]
  ],
  [
    'getBranches は git:getBranches チャンネルを呼び出す',
    () => api.getBranches(),
    ['git:getBranches']
  ],
  ['getTags は git:getTags チャンネルを呼び出す', () => api.getTags(), ['git:getTags']],
  [
    'amendCommit は git:amendCommit チャンネルに message を渡す',
    () => api.amendCommit('fix: test'),
    ['git:amendCommit', 'fix: test']
  ],
  [
    'addToGitignore は fs:addToGitignore チャンネルに targetPath を渡す',
    () => api.addToGitignore('node_modules'),
    ['fs:addToGitignore', 'node_modules']
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
  [
    'getConflictFile は git:getConflictFile チャンネルに filePath を渡す',
    () => api.getConflictFile('a.txt'),
    ['git:getConflictFile', 'a.txt']
  ],
  [
    'resolveConflictBlocks は git:resolveConflictBlocks チャンネルに filePath・digests・choices を渡す',
    () => api.resolveConflictBlocks('a.txt', ['d'], { 0: 'ours' }),
    ['git:resolveConflictBlocks', 'a.txt', ['d'], { 0: 'ours' }]
  ],
  [
    'resolveConflictWholeFile は git:resolveConflictWholeFile チャンネルに filePath と side を渡す',
    () => api.resolveConflictWholeFile('a.txt', 'theirs'),
    ['git:resolveConflictWholeFile', 'a.txt', 'theirs']
  ],
  [
    'keepConflictFile は git:keepConflictFile チャンネルに filePath を渡す',
    () => api.keepConflictFile('a.txt'),
    ['git:keepConflictFile', 'a.txt']
  ],
  [
    'removeConflictFile は git:removeConflictFile チャンネルに filePath を渡す',
    () => api.removeConflictFile('a.txt'),
    ['git:removeConflictFile', 'a.txt']
  ],
  [
    'markConflictResolved は git:markConflictResolved チャンネルに filePath を渡す',
    () => api.markConflictResolved('a.txt'),
    ['git:markConflictResolved', 'a.txt']
  ],
  [
    'completeMerge は git:completeMerge チャンネルを呼び出す',
    () => api.completeMerge(),
    ['git:completeMerge']
  ],
  ['abortMerge は git:abortMerge チャンネルを呼び出す', () => api.abortMerge(), ['git:abortMerge']],
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
    'createTag は git:createTag チャンネルに要求を渡す',
    () => api.createTag({ name: 'v1', kind: 'annotated', message: 'm' }),
    ['git:createTag', { name: 'v1', kind: 'annotated', message: 'm' }]
  ],
  [
    'initRepository は git:init チャンネルにブランチ名を渡す',
    () => api.initRepository('main'),
    ['git:init', 'main']
  ],
  [
    'addOrigin は git:addOrigin チャンネルに URL を渡す',
    () => api.addOrigin('https://github.com/a/b.git'),
    ['git:addOrigin', 'https://github.com/a/b.git']
  ],
  [
    'pushSetUpstream は git:pushSetUpstream チャンネルを引数なしで呼び出す',
    () => api.pushSetUpstream(),
    ['git:pushSetUpstream']
  ],
  [
    'cloneRepository は git:cloneRepository チャンネルに URL とフォルダ名を渡す',
    () => api.cloneRepository('https://github.com/a/b.git', 'b'),
    ['git:cloneRepository', 'https://github.com/a/b.git', 'b']
  ],
  [
    'cancelCloneRepository は git:cancelCloneRepository チャンネルを引数なしで呼び出す',
    () => api.cancelCloneRepository(),
    ['git:cancelCloneRepository']
  ],
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

describe('エージェントの変更の API', () => {
  it.each<[string, () => unknown, unknown[]]>([
    [
      'beginAgentChanges は agentChanges:begin を呼ぶ',
      () => api.beginAgentChanges(),
      ['agentChanges:begin']
    ],
    [
      'getAgentChangesState は agentChanges:getState を呼ぶ',
      () => api.getAgentChangesState(),
      ['agentChanges:getState']
    ],
    [
      'listAgentChanges は agentChanges:list を呼ぶ',
      () => api.listAgentChanges(),
      ['agentChanges:list']
    ],
    [
      'getAgentChangeDiff は agentChanges:getDiff にパスを渡す',
      () => api.getAgentChangeDiff('a.txt'),
      ['agentChanges:getDiff', 'a.txt']
    ],
    [
      'revertAgentChange は agentChanges:revertFile にパスを渡す',
      () => api.revertAgentChange('a.txt'),
      ['agentChanges:revertFile', 'a.txt']
    ],
    [
      'revertAgentChangeHunk は agentChanges:revertHunk にパスとパッチを渡す',
      () => api.revertAgentChangeHunk('a.txt', 'patch'),
      ['agentChanges:revertHunk', 'a.txt', 'patch']
    ],
    [
      'revertAllAgentChanges は agentChanges:revertAll に確認の一覧を渡す',
      () => api.revertAllAgentChanges([{ path: 'a.txt', status: 'M' }]),
      ['agentChanges:revertAll', [{ path: 'a.txt', status: 'M' }]]
    ],
    [
      'clearAgentChanges は agentChanges:clear を呼ぶ',
      () => api.clearAgentChanges(),
      ['agentChanges:clear']
    ]
  ])('%s', (_name, call, expectedArgs) => {
    call()
    expect(mockInvoke).toHaveBeenCalledWith(...expectedArgs)
  })
})

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

describe('mergeBranch の戻り値', () => {
  it.each([
    ['merged', { status: 'merged' }],
    [
      'conflict',
      {
        status: 'conflict',
        message: 'コンフリクトしました（a.txt）。解決するか、マージを中止してください'
      }
    ]
  ])(
    'git:mergeBranch の %s の結果をそのまま返す(作業ツリーが変わった結果を落とさない)',
    async (_label, result) => {
      mockInvoke.mockResolvedValue(result)
      await expect(api.mergeBranch('feature/x')).resolves.toBe(result)
    }
  )
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

describe('エージェントのターミナル・外部変更・実行方式・リンクの API', () => {
  it.each<[string, () => unknown, unknown[]]>([
    [
      'startAgentSession は agentTerminal:start に依頼を渡す',
      () =>
        api.startAgentSession({
          slotId: 'slot-1',
          folderPath: '/p',
          cols: 80,
          rows: 24,
          launch: { kind: 'new' }
        }),
      [
        'agentTerminal:start',
        { slotId: 'slot-1', folderPath: '/p', cols: 80, rows: 24, launch: { kind: 'new' } }
      ]
    ],
    [
      'stopAgentSession は agentTerminal:stop に sessionId を渡す',
      () => api.stopAgentSession('s'),
      ['agentTerminal:stop', 's']
    ],
    [
      'getAgentSessions は agentTerminal:getState を呼ぶ',
      () => api.getAgentSessions(),
      ['agentTerminal:getState']
    ],
    [
      'getLastAgentSession は agentTerminal:getLastSession にフォルダを渡す',
      () => api.getLastAgentSession('/p'),
      ['agentTerminal:getLastSession', '/p']
    ],
    [
      'writeFileChecked は fs:writeFileChecked に path・content・baseContent を渡す',
      () => api.writeFileChecked('/p/a', 'new', 'old'),
      ['fs:writeFileChecked', '/p/a', 'new', 'old']
    ],
    [
      'writeFileChecked は baseContent の null をそのまま渡す',
      () => api.writeFileChecked('/p/a', 'new', null),
      ['fs:writeFileChecked', '/p/a', 'new', null]
    ],
    [
      'setWatchedFiles は fs:setWatchedFiles にパスを渡す',
      () => api.setWatchedFiles(['/p/a']),
      ['fs:setWatchedFiles', ['/p/a']]
    ],
    [
      'getPromptExecutionMode は settings:getPromptExecutionMode を呼ぶ',
      () => api.getPromptExecutionMode(),
      ['settings:getPromptExecutionMode']
    ],
    [
      'setPromptExecutionMode は settings:setPromptExecutionMode に方式を渡す',
      () => api.setPromptExecutionMode('legacy'),
      ['settings:setPromptExecutionMode', 'legacy']
    ],
    [
      'getAgentNotificationsEnabled は settings:getAgentNotificationsEnabled を呼ぶ',
      () => api.getAgentNotificationsEnabled(),
      ['settings:getAgentNotificationsEnabled']
    ],
    [
      'setAgentNotificationsEnabled は settings:setAgentNotificationsEnabled に値を渡す',
      () => api.setAgentNotificationsEnabled(false),
      ['settings:setAgentNotificationsEnabled', false]
    ],
    [
      'getAgentSendConfirmEnabled は settings:getAgentSendConfirmEnabled を呼ぶ',
      () => api.getAgentSendConfirmEnabled(),
      ['settings:getAgentSendConfirmEnabled']
    ],
    [
      'setAgentSendConfirmEnabled は settings:setAgentSendConfirmEnabled に値を渡す',
      () => api.setAgentSendConfirmEnabled(false),
      ['settings:setAgentSendConfirmEnabled', false]
    ],
    [
      'openExternalLink は shell:openExternalLink に URL を渡す',
      () => api.openExternalLink('https://x'),
      ['shell:openExternalLink', 'https://x']
    ],
    [
      'showAgentNotification は agentNotification:show に依頼を渡す',
      () => api.showAgentNotification({ slotId: 's-1', tabNumber: 1, kind: 'done' }),
      ['agentNotification:show', { slotId: 's-1', tabNumber: 1, kind: 'done' }]
    ],
    [
      'setAgentNotificationBadge は agentNotification:setBadge に数を包んで渡す',
      () => api.setAgentNotificationBadge(2),
      ['agentNotification:setBadge', { count: 2 }]
    ],
    [
      'dismissAgentNotification は agentNotification:dismiss に依頼を渡す',
      () => api.dismissAgentNotification({ slotId: 's-1' }),
      ['agentNotification:dismiss', { slotId: 's-1' }]
    ]
  ])('%s', (_name, call, expectedArgs) => {
    call()
    expect(mockInvoke).toHaveBeenCalledWith(...expectedArgs)
  })

  it.each<[string, () => unknown, unknown[]]>([
    [
      'writeAgentSession は send で順序を保って送る',
      () => api.writeAgentSession('s', 'abc'),
      ['agentTerminal:write', 's', 'abc']
    ],
    [
      'resizeAgentSession は send で送る',
      () => api.resizeAgentSession('s', 100, 30),
      ['agentTerminal:resize', 's', 100, 30]
    ],
    [
      'setAgentTerminalFocused は send で送る',
      () => api.setAgentTerminalFocused(true),
      ['agentTerminal:focus', true]
    ]
  ])('%s', (_name, call, expectedArgs) => {
    call()
    expect(mockSend).toHaveBeenCalledWith(...expectedArgs)
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe.each([
  [
    'onAgentData',
    'agentTerminal:data',
    (l: (p: unknown) => void) => api.onAgentData(l),
    { sessionId: 's', data: 'x' },
    [null, { sessionId: 1, data: 'x' }, { sessionId: 's', data: 1 }]
  ],
  [
    'onAgentExit',
    'agentTerminal:exit',
    (l: (p: unknown) => void) => api.onAgentExit(l),
    { sessionId: 's', exitCode: 1, signal: null, reason: 'exited' },
    [null, { sessionId: 1, reason: 'exited' }, { sessionId: 's', reason: 'unknown' }]
  ],
  [
    'onExternalFileChange',
    'fs:externalChange',
    (l: (p: unknown) => void) => api.onExternalFileChange(l),
    { paths: ['/a'] },
    [null, { paths: '/a' }, { paths: [1] }]
  ],
  [
    'onAgentNotificationActivated',
    'agentNotification:activated',
    (l: (p: unknown) => void) => api.onAgentNotificationActivated(l),
    { slotId: 'slot-1' },
    [null, { slotId: 1 }, { slotId: 'a b' }, {}]
  ]
])('%s', (_name, channel, subscribe, valid, invalids) => {
  it(`${channel} を購読し、検証を通った payload で呼び、解除関数で removeListener する`, () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    const wrapped = mockOn.mock.calls.find(([ch]) => ch === channel)?.[1]
    wrapped({}, valid)
    for (const invalid of invalids) wrapped({}, invalid)
    expect(listener.mock.calls).toEqual([[valid]])
    unsubscribe()
    expect(mockRemoveListener).toHaveBeenCalledWith(channel, wrapped)
  })
})

describe('onAgentExit の正規化', () => {
  it.each(AGENT_EXIT_REASONS)('終了理由 %s は捨てずに通す', (reason) => {
    const listener = vi.fn()
    api.onAgentExit(listener)
    const wrapped = mockOn.mock.calls.find(([ch]) => ch === 'agentTerminal:exit')?.[1]
    wrapped({}, { sessionId: 's', exitCode: 0, signal: null, reason })
    expect(listener).toHaveBeenCalledWith({ sessionId: 's', exitCode: 0, signal: null, reason })
  })

  it('exitCode・signal が数でなければ null にする', () => {
    const listener = vi.fn()
    api.onAgentExit(listener)
    const wrapped = mockOn.mock.calls.find(([ch]) => ch === 'agentTerminal:exit')?.[1]
    wrapped({}, { sessionId: 's', reason: 'stopped' })
    expect(listener).toHaveBeenCalledWith({
      sessionId: 's',
      exitCode: null,
      signal: null,
      reason: 'stopped'
    })
  })
})
