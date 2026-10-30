import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CONFLICT_CHOICES, TAG_KINDS } from '@shared/types'
import type { ConflictChoice, CreateTagRequest, DiscardAllEntry } from '@shared/types'
import { isOneOf, isPlainObject } from '@shared/typeGuards'
import {
  getGitStatus,
  stageFile,
  unstageFile,
  commit,
  getDiff,
  getLog,
  getBranches,
  getTags,
  amendCommit,
  isStagedRenameDiff,
  push,
  pull,
  fetchRemote,
  checkoutBranch,
  createBranch,
  deleteBranch,
  mergeBranch
} from '../gitService'
import { discardFileChanges, discardHunk, discardAllChanges } from '../gitDiscardService'
import * as conflictService from '../gitConflictService'
import { getStashes, stashPush, stashPop, stashDrop } from '../gitStashService'
import { createTag } from '../gitTagService'
import { initRepository, addOrigin, pushSetUpstream } from '../gitRemoteSetupService'
import { stageHunk, unstageHunk } from '../gitApply'
import { moveToTrash } from '../trash'
import type { FolderAccessManager } from '../folderAccessManager'
import { getAllowedFolder } from './fileAccessGuard'
import { resolveAndAssertRelativePath, resolveAndAssertStatusRelativePath } from './gitPathResolver'

// IPC 境界は任意の値を受け付けるため、service 層(startsWith 等)が TypeError で落ちる
// 前に引数の型を検証する。値の中身(実在するブランチか等)の検証は service 層が行う
function assertBranchNameArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid branch name')
}

// force は厳密に boolean だけを受け付ける('true' 等の truthy な値で強制削除されないため)
function assertForceFlagArg(value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid force flag')
}

function assertStashMessageArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid stash message')
}

// 値の形式(40 桁の 16 進数)と、現在の一覧にあるかの検証は service 層が行う
function assertStashIdArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid stash id')
}

// パッチの中身(対象ファイルが 1 件だけか等)の検証は service 層が行う
function assertPatchArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid patch')
}

// 実行時の status との一致は service 層が確かめる。ここでは {path: string, status: 2 文字の文字列} の
// 配列であることだけを検証する
function assertDiscardEntriesArg(value: unknown): asserts value is DiscardAllEntry[] {
  const valid =
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.path === 'string' &&
        typeof entry.status === 'string' &&
        entry.status.length === 2
    )
  if (!valid) throw new Error('Invalid entries')
}

const MAX_CONFLICT_ENTRIES = 1000

// 値の一致(現在のブロックの構成と同じか)は service 層が確かめる。ここでは 40 桁の 16 進の
// 文字列の配列(最大 1000 件)であることだけを検証する
function assertConflictDigestsArg(value: unknown): asserts value is string[] {
  const valid =
    Array.isArray(value) &&
    value.length <= MAX_CONFLICT_ENTRIES &&
    value.every((v) => typeof v === 'string' && /^[0-9a-f]{40}$/i.test(v))
  if (!valid) throw new Error('Invalid digests')
}

// 整数の番号(文字列キー)→ 'ours' | 'theirs' | 'both' のオブジェクト(最大 1000 件)。
// 番号がブロック数の範囲内かは service 層が確かめる。キーは Object.keys で調べるため、
// __proto__ / constructor / prototype などの特殊キーは整数でないものとして拒否される。
// 値は Object.keys で得たキーから読むので、prototype チェーン上の値は見ない
function assertConflictChoicesArg(value: unknown): asserts value is Record<number, ConflictChoice> {
  if (!isPlainObject(value)) {
    throw new Error('Invalid choices')
  }
  const keys = Object.keys(value)
  const valid =
    keys.length <= MAX_CONFLICT_ENTRIES &&
    keys.every((key) => /^(0|[1-9]\d{0,8})$/.test(key) && isOneOf(CONFLICT_CHOICES, value[key]))
  if (!valid) throw new Error('Invalid choices')
}

function assertConflictSideArg(value: unknown): asserts value is 'ours' | 'theirs' {
  if (value !== 'ours' && value !== 'theirs') throw new Error('Invalid side')
}

// { name: string, kind: 'lightweight' | 'annotated', message: string } のオブジェクトであることだけを検証する。
// 値の中身(名前の規則・重複・メッセージの空)は service 層が検証する。余分なキーは呼び出し側で
// 詰め直して service に渡さない
function assertCreateTagArg(value: unknown): asserts value is CreateTagRequest {
  if (!isPlainObject(value)) {
    throw new Error('Invalid tag request')
  }
  const { name, kind, message } = value
  const valid = typeof name === 'string' && typeof message === 'string' && isOneOf(TAG_KINDS, kind)
  if (!valid) throw new Error('Invalid tag request')
}

// 文字列であることだけを検証する。値の中身(許可リスト・長さ・制御文字)は service 層が検証する
function assertRemoteUrlArg(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid remote url')
}

export function registerGitHandlers(ipcMain: IpcMain, folderAccess: FolderAccessManager): void {
  ipcMain.handle('git:getStatus', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    return getGitStatus(allowedFolder)
  })

  ipcMain.handle('git:stage', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    // 絶対パスのまま stageFile(git add)に渡すと、失敗時の GitError に pathspec
    // として OS 絶対パス(ユーザー名やディレクトリ構造を含む)がそのまま乗り、
    // レンダラーへ伝播してしまう。git:getDiff/stageHunk/unstageHunk と同じ
    // 理由で相対パス化する
    const relativePath = await resolveAndAssertRelativePath(folderAccess, allowedFolder, filePath)
    await stageFile(allowedFolder, relativePath)
  })

  ipcMain.handle('git:discardChanges', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    // git:stage と同じ理由(失敗時のエラーに OS 絶対パスを乗せない)で相対パス化する。
    // ただし表記は index に合わせたまま渡す(resolveAndAssertStatusRelativePath 参照)
    const relativePath = await resolveAndAssertStatusRelativePath(
      folderAccess,
      allowedFolder,
      filePath
    )
    await discardFileChanges(allowedFolder, relativePath, moveToTrash)
  })

  ipcMain.handle(
    'git:discardHunk',
    async (event: IpcMainInvokeEvent, filePath: string, patch: unknown) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      assertPatchArg(patch)
      // git:discardChanges と同じく、index の表記のまま相対パス化する
      const relativePath = await resolveAndAssertStatusRelativePath(
        folderAccess,
        allowedFolder,
        filePath
      )
      await discardHunk(allowedFolder, relativePath, patch)
    }
  )

  ipcMain.handle('git:discardAll', async (event: IpcMainInvokeEvent, expected: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertDiscardEntriesArg(expected)
    return discardAllChanges(allowedFolder, expected, moveToTrash)
  })

  // コンフリクトの解決。順序は discard 系と同じ(許可フォルダ → 引数の型 → 相対パス化 → service)
  ipcMain.handle('git:getConflictFile', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    const relativePath = await resolveAndAssertStatusRelativePath(
      folderAccess,
      allowedFolder,
      filePath
    )
    return conflictService.getConflictFile(allowedFolder, relativePath)
  })

  ipcMain.handle(
    'git:resolveConflictBlocks',
    async (
      event: IpcMainInvokeEvent,
      filePath: string,
      expectedDigests: unknown,
      choices: unknown
    ) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      assertConflictDigestsArg(expectedDigests)
      assertConflictChoicesArg(choices)
      const relativePath = await resolveAndAssertStatusRelativePath(
        folderAccess,
        allowedFolder,
        filePath
      )
      await conflictService.resolveConflictBlocks(
        allowedFolder,
        relativePath,
        expectedDigests,
        choices
      )
    }
  )

  ipcMain.handle(
    'git:resolveConflictWholeFile',
    async (event: IpcMainInvokeEvent, filePath: string, side: unknown) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      assertConflictSideArg(side)
      const relativePath = await resolveAndAssertStatusRelativePath(
        folderAccess,
        allowedFolder,
        filePath
      )
      await conflictService.resolveConflictWholeFile(allowedFolder, relativePath, side)
    }
  )

  ipcMain.handle('git:keepConflictFile', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    const relativePath = await resolveAndAssertStatusRelativePath(
      folderAccess,
      allowedFolder,
      filePath
    )
    await conflictService.keepConflictFile(allowedFolder, relativePath)
  })

  ipcMain.handle('git:removeConflictFile', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    const relativePath = await resolveAndAssertStatusRelativePath(
      folderAccess,
      allowedFolder,
      filePath
    )
    await conflictService.removeConflictFile(allowedFolder, relativePath)
  })

  ipcMain.handle(
    'git:markConflictResolved',
    async (event: IpcMainInvokeEvent, filePath: string) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      const relativePath = await resolveAndAssertStatusRelativePath(
        folderAccess,
        allowedFolder,
        filePath
      )
      await conflictService.markConflictResolved(allowedFolder, relativePath)
    }
  )

  ipcMain.handle('git:completeMerge', async (event: IpcMainInvokeEvent) => {
    await conflictService.completeMerge(getAllowedFolder(folderAccess, event))
  })

  ipcMain.handle('git:abortMerge', async (event: IpcMainInvokeEvent) => {
    await conflictService.abortMerge(getAllowedFolder(folderAccess, event))
  })

  ipcMain.handle(
    'git:unstage',
    async (event: IpcMainInvokeEvent, filePath: string, renamedFrom?: string) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      const relativePath = await resolveAndAssertRelativePath(folderAccess, allowedFolder, filePath)
      // 新パスだけを reset すると、旧パスの削除だけが index に残ったまま
      // (D old.txt / ?? new.txt)になり、アンステージのつもりが壊れた状態を
      // 作ってしまう(実機で再現確認済み)。旧パスも境界チェック・相対パス化
      // した上で unstageFile へ渡し、リネーム全体を正しく取り消す
      const relativeRenamedFrom =
        renamedFrom === undefined
          ? undefined
          : await resolveAndAssertRelativePath(folderAccess, allowedFolder, renamedFrom)
      await unstageFile(allowedFolder, relativePath, relativeRenamedFrom)
    }
  )

  ipcMain.handle(
    'git:getDiff',
    async (
      event: IpcMainInvokeEvent,
      filePath: string,
      staged: boolean,
      isUntracked: boolean,
      renamedFrom?: string
    ) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      // gitService.getDiff は isStagedRenameDiff(staged, renamedFrom) が true の
      // ときだけ renamedFrom を実際に使う。renderer(useDiffOperations.ts)は
      // staged の値に関わらず gitStatusFiles の from を常に渡すため、staged: false
      // でも律儀に境界チェックすると、gitService 側では使われもしない値の
      // チェック失敗によって、本来成功するはずの未ステージ diff の取得ごと
      // 失敗しうる。旧パスの境界チェック自体は必要(renderer 由来の値をそのまま
      // pathspec へ渡すと、許可フォルダ外を指す文字列で diff を取られる余地が
      // 残るため)だが、実際に使われる場合に限る。gitService.ts 側の判定と
      // 同じ条件を独立に書くと、片方だけ見直されたときに認識がずれるため、
      // 同じ関数を共有する。
      // filePath/renamedFrom の境界チェックは互いに依存しない独立した非同期処理
      // (realpath ベースの fs アクセス)のため、直列に await せず並行して開始する
      const [relativePath, relativeRenamedFrom] = await Promise.all([
        resolveAndAssertRelativePath(folderAccess, allowedFolder, filePath),
        isStagedRenameDiff(staged, renamedFrom)
          ? resolveAndAssertRelativePath(folderAccess, allowedFolder, renamedFrom)
          : Promise.resolve(undefined)
      ])
      return getDiff(allowedFolder, relativePath, staged, isUntracked, relativeRenamedFrom)
    }
  )

  ipcMain.handle(
    'git:stageHunk',
    async (event: IpcMainInvokeEvent, filePath: string, patch: string) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      const relativePath = await resolveAndAssertRelativePath(folderAccess, allowedFolder, filePath)
      await stageHunk(allowedFolder, relativePath, patch)
    }
  )

  ipcMain.handle(
    'git:unstageHunk',
    async (event: IpcMainInvokeEvent, filePath: string, patch: string) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      const relativePath = await resolveAndAssertRelativePath(folderAccess, allowedFolder, filePath)
      await unstageHunk(allowedFolder, relativePath, patch)
    }
  )

  ipcMain.handle('git:commit', async (event: IpcMainInvokeEvent, message: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await commit(allowedFolder, message)
  })

  ipcMain.handle('git:getLog', async (event: IpcMainInvokeEvent, limit: number, skip: number) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    return getLog(allowedFolder, limit, skip)
  })

  ipcMain.handle('git:getBranches', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    return getBranches(allowedFolder)
  })

  ipcMain.handle('git:getTags', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    return getTags(allowedFolder)
  })

  ipcMain.handle('git:amendCommit', async (event: IpcMainInvokeEvent, message: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await amendCommit(allowedFolder, message)
  })

  ipcMain.handle('git:push', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await push(allowedFolder)
  })

  ipcMain.handle('git:pull', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await pull(allowedFolder)
  })

  ipcMain.handle('git:fetch', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await fetchRemote(allowedFolder)
  })

  ipcMain.handle('git:checkoutBranch', async (event: IpcMainInvokeEvent, branchName: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await checkoutBranch(allowedFolder, branchName)
  })

  ipcMain.handle('git:createBranch', async (event: IpcMainInvokeEvent, branchName: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertBranchNameArg(branchName)
    await createBranch(allowedFolder, branchName)
  })

  ipcMain.handle(
    'git:deleteBranch',
    async (event: IpcMainInvokeEvent, branchName: unknown, force: unknown) => {
      const allowedFolder = getAllowedFolder(folderAccess, event)
      assertBranchNameArg(branchName)
      assertForceFlagArg(force)
      return deleteBranch(allowedFolder, branchName, force)
    }
  )

  ipcMain.handle('git:mergeBranch', async (event: IpcMainInvokeEvent, branchName: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertBranchNameArg(branchName)
    return mergeBranch(allowedFolder, branchName)
  })

  ipcMain.handle('git:getStashes', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    return getStashes(allowedFolder)
  })

  ipcMain.handle('git:stashPush', async (event: IpcMainInvokeEvent, message: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertStashMessageArg(message)
    await stashPush(allowedFolder, message)
  })

  ipcMain.handle('git:stashPop', async (event: IpcMainInvokeEvent, sha: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertStashIdArg(sha)
    return stashPop(allowedFolder, sha)
  })

  ipcMain.handle('git:stashDrop', async (event: IpcMainInvokeEvent, sha: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertStashIdArg(sha)
    await stashDrop(allowedFolder, sha)
  })

  ipcMain.handle('git:createTag', async (event: IpcMainInvokeEvent, request: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertCreateTagArg(request)
    await createTag(allowedFolder, {
      name: request.name,
      kind: request.kind,
      message: request.message
    })
  })

  // service の第 3 引数以降(打ち切りの時間・windowsPaths)はテスト用。renderer から届いた余分な引数は渡さない
  ipcMain.handle('git:init', async (event: IpcMainInvokeEvent, branch: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertBranchNameArg(branch)
    await initRepository(allowedFolder, branch)
  })

  ipcMain.handle('git:addOrigin', async (event: IpcMainInvokeEvent, url: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    assertRemoteUrlArg(url)
    await addOrigin(allowedFolder, url)
  })

  ipcMain.handle('git:pushSetUpstream', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await pushSetUpstream(allowedFolder)
  })
}
