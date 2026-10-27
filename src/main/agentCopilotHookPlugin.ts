import { randomBytes } from 'node:crypto'
import { rmSync as fsRmSync } from 'node:fs'
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AGENT_MAX_SESSIONS_PER_WINDOW } from '@shared/types'
import type { CopilotHookConfigJson } from './agentCopilotHookConfig'
import { currentAgentHookDirOwner, isOwnPrivateDirStat } from './agentHookSettings'
import type { AgentHookSettingsDirOwner } from './agentHookSettings'

// copilot に --plugin-dir で渡すプラグインのフォルダ(設計書 2026-10-26「渡す hooks」「プラグインのフォルダ」)。main 全体で 4 つの枠
// (<userData>/agent-hooks-copilot/slot-<1〜4>)を持ち、起動の準備で空いている一番小さい番号を貸して、その pty の終了で返す。
// フォルダのパスが枠ごとに固定なので、copilot が作る ~/.copilot/plugin-data/_direct/<ハッシュ>/ は 4 つまでで止まる。起動のたびに
// トークン入りの hooks/hooks.json(0600)を原子的に書き直す(トークンは起動の引数・環境変数に置かない。
// JSON の中身は agentCopilotHookConfig.ts)。フォルダは使うたびに lstat で持ち主・権限・シンボリックリンクを確かめる(L-016・L-437)。フォルダと plugin.json は消さない(_direct のハッシュの元が
// inode などだった場合に空のディレクトリが増えうるため)。アプリの終了では hooks.json だけを消す。利用者のリポジトリ・~/.copilot には書かない

export const COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME = 'agent-hooks-copilot'
/** 枠の数(ウィンドウのタブの上限と同じ) */
export const COPILOT_HOOK_PLUGIN_SLOT_COUNT = AGENT_MAX_SESSIONS_PER_WINDOW

/** ルートの plugin.json(記録の最小の形)。name は copilot の拒否の文言・/env に出るので、アプリのものと分かる名前にする */
export const COPILOT_HOOK_PLUGIN_MANIFEST = {
  name: 'prompt-ide-agent-hooks',
  version: '1.0.0',
  description:
    'prompt-ide がエージェントの変更の区別に使う hooks（アプリが起動した copilot だけに渡します）'
} as const

export interface CopilotHookPluginSlot {
  /** 1〜COPILOT_HOOK_PLUGIN_SLOT_COUNT */
  number: number
  /** --plugin-dir に渡す絶対パス(<rootDir>/slot-<番号>) */
  dir: string
}

export interface CopilotHookPluginSlots {
  /** 空いている一番小さい番号の枠を貸す。空きが無い・終了の後は null */
  acquire(): CopilotHookPluginSlot | null
  /** 枠を返す(その pty の終了・起動しなかったとき)。hooks.json は消さない(次の持ち主の書き直しと競るため) */
  release(slot: CopilotHookPluginSlot): void
  /**
   * 枠のフォルダを確かめ(親は作り直さない)、plugin.json を(無いか違うときだけ)、hooks/hooks.json を原子的に書き直す。
   * 失敗は例外(呼び出し側が hooks なしの起動に読み替える)。終了の後は reject、書き直しの最中の終了ではできた hooks.json を消して reject
   */
  write(slot: CopilotHookPluginSlot, config: CopilotHookConfigJson): Promise<void>
  /** will-quit: 以後の acquire を null、write を reject にし、すべての枠の hooks.json を同期で消す(失敗はパスだけをログに出して続ける) */
  removeTokenFilesSync(): void
}

export interface CopilotHookPluginSlotsDeps {
  /** <userData>/agent-hooks-copilot の絶対パス */
  rootDir: string
  /** テスト用。持ち主の確かめ(既定は今のプロセス) */
  owner?: AgentHookSettingsDirOwner
  /** テスト用。一時ファイルの名前(既定は .<16 進 16 桁>.tmp) */
  createTempName?: () => string
  /** テスト用。一時ファイルの置き換え(既定は fs.rename) */
  renameFile?: (from: string, to: string) => Promise<void>
  /** テスト用。終了の後始末の削除(既定は fs.rmSync) */
  rmSync?: (target: string, options: { force: true }) => void
  /** テスト用。フォルダの作成(既定は fs.mkdir。作成の競合〈EEXIST〉の再現に使う) */
  makeDir?: (target: string, options: { mode: number }) => Promise<unknown>
}

const PRIVATE_DIR_ERROR = 'copilot の hooks のフォルダの持ち主・権限が正しくありません'
const CLOSED_ERROR = 'copilot の hooks のフォルダは終了処理で閉じられています'
const MANIFEST_TEXT = `${JSON.stringify(COPILOT_HOOK_PLUGIN_MANIFEST, null, 2)}\n`

const createRandomTempName = (): string => `.${randomBytes(8).toString('hex')}.tmp`
const errnoOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException).code

/**
 * path が自分の持ち物の 0700 のディレクトリ(シンボリックリンクでない)であることを確かめ、無ければ 0700 で作る。外れたとき、
 * recreate なら消して(シンボリックリンクならリンクだけ。rm はリンク先を辿らない)作り直し、recreate でなければ投げる。
 * 作るときの EEXIST(別の prepare が先に作った)は、lstat し直して同じ確かめをする
 */
async function ensurePrivateDir(
  target: string,
  owner: AgentHookSettingsDirOwner,
  recreate: boolean,
  makeDir: (target: string, options: { mode: number }) => Promise<unknown>
): Promise<void> {
  const stateOf = async (): Promise<'usable' | 'missing' | 'unusable'> => {
    try {
      return isOwnPrivateDirStat(await lstat(target), owner) ? 'usable' : 'unusable'
    } catch (err) {
      if (errnoOf(err) === 'ENOENT') return 'missing'
      throw err
    }
  }
  const state = await stateOf()
  if (state === 'usable') return
  if (state === 'unusable') {
    if (!recreate) throw new Error(PRIVATE_DIR_ERROR)
    await rm(target, { recursive: true, force: true })
  }
  try {
    await makeDir(target, { mode: 0o700 })
  } catch (err) {
    if (errnoOf(err) !== 'EEXIST') throw err
  }
  if ((await stateOf()) !== 'usable') throw new Error(PRIVATE_DIR_ERROR)
}

/**
 * dir に一時ファイルを wx・0600 で作って書き、sync して閉じてから name へ rename する(原子的な置き換え。settingsFileStore.ts の
 * 書き込みと同じ手順。L-014・L-082)。途中で失敗したら自分が作った一時ファイルだけを消す(EEXIST のときは消さない。L-004)
 */
async function writeFileAtomically(
  dir: string,
  name: string,
  text: string,
  createTempName: () => string,
  renameFile: (from: string, to: string) => Promise<void>
): Promise<void> {
  const tempPath = join(dir, createTempName())
  try {
    await writeFile(tempPath, text, { flag: 'wx', mode: 0o600 })
    const handle = await open(tempPath, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(tempPath, 0o600)
    await renameFile(tempPath, join(dir, name))
  } catch (err) {
    if (errnoOf(err) !== 'EEXIST') await rm(tempPath, { force: true }).catch(() => undefined)
    throw err
  }
}

export function createCopilotHookPluginSlots({
  rootDir,
  owner = currentAgentHookDirOwner(),
  createTempName = createRandomTempName,
  renameFile = rename,
  rmSync = fsRmSync,
  makeDir = mkdir
}: CopilotHookPluginSlotsDeps): CopilotHookPluginSlots {
  const used = new Set<number>()
  let closed = false
  const slotOf = (number: number): CopilotHookPluginSlot => ({
    number,
    dir: join(rootDir, `slot-${number}`)
  })
  const hooksFileOf = (slot: CopilotHookPluginSlot): string => join(slot.dir, 'hooks', 'hooks.json')
  const removeQuietly = (target: string): void => {
    try {
      rmSync(target, { force: true })
    } catch {
      console.warn('[agent-hooks] copilot の hooks の設定のファイルを消せませんでした:', target)
    }
  }
  return {
    acquire() {
      if (closed) return null
      for (let number = 1; number <= COPILOT_HOOK_PLUGIN_SLOT_COUNT; number++) {
        if (!used.has(number)) {
          used.add(number)
          return slotOf(number)
        }
      }
      return null
    },
    release(slot) {
      used.delete(slot.number)
    },
    async write(slot, config) {
      if (closed) throw new Error(CLOSED_ERROR)
      // JSON は書き込みの前に作る(文字列の連結で作らない)
      const text = JSON.stringify(config)
      // 親を作り直すと、動いているほかの枠の hooks.json まで消すため、親は確かめに外れたら投げる(L-004)
      await ensurePrivateDir(rootDir, owner, false, makeDir)
      await ensurePrivateDir(slot.dir, owner, true, makeDir)
      const hooksDir = join(slot.dir, 'hooks')
      await ensurePrivateDir(hooksDir, owner, true, makeDir)
      const manifest = await readFile(join(slot.dir, 'plugin.json'), 'utf8').catch(() => null)
      if (manifest !== MANIFEST_TEXT) {
        await writeFileAtomically(
          slot.dir,
          'plugin.json',
          MANIFEST_TEXT,
          createTempName,
          renameFile
        )
      }
      if (closed) throw new Error(CLOSED_ERROR)
      await writeFileAtomically(hooksDir, 'hooks.json', text, createTempName, renameFile)
      // 書き直しの最中に終了の後始末が来た。誰にも使われないので、できた hooks.json をここで消す(L-435)
      if (closed) {
        removeQuietly(hooksFileOf(slot))
        throw new Error(CLOSED_ERROR)
      }
    },
    removeTokenFilesSync() {
      closed = true
      for (let number = 1; number <= COPILOT_HOOK_PLUGIN_SLOT_COUNT; number++) {
        removeQuietly(hooksFileOf(slotOf(number)))
      }
    }
  }
}
