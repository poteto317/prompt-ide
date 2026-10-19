import { vi } from 'vitest'
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  AgentChangesAttributionSummary,
  AgentChangesRun,
  AgentChangesState,
  AgentChangesUndoSummary
} from '@shared/types'
import { takeBaselineSnapshot } from '../../agentBaselineSnapshot'
import type {
  BaselineCheckpointBase,
  BaselineSnapshot,
  BaselineSnapshotResult
} from '../../agentBaselineSnapshot'
import type { BaselineGitLocation } from '../../agentBaselineGit'
import type { AgentChangesRecord, AgentChangesRecordRun } from '../../agentChangesRecord'
import type { AgentChangesProtectionGit } from '../../agentChangesProtectionRef'
import { protectionRefName } from '../../agentChangesProtectionRules'
import type {
  AgentBaselineProtectionDeps,
  AgentBaselineRegistryDeps
} from '../../agentBaselineRegistry'
import type { TrackingAttribution } from '../../agentChangesAttribution'
import type { AgentToolActivity, AgentToolActivitySignal } from '../../agentToolActivity'
import type { AgentRevertContext } from '../../agentChangesRevert'
import { AGENT_CHANGES_UNDO_MAX_BYTES } from '../../agentChangesUndo'
import { initRepo, runGit, stubGitCeiling, stubGitHome, stubIsolatedGitEnv } from './realGitRepo'

// エージェントの変更の記録(agentBaselineSnapshot)を実 git で試すテストの準備と偽物を 1 か所から作る。
// 「記録のインデックスの git を開発者の設定から切り離す方法」や「記録を取る関数の呼び方」が変わったときに、
// 各テストのファイルを同じように直さずに済むようにする(SRP L3-01・L3-02)。
// あわせて、registry を git なしで試すテストの偽物(記録の形・保護の ref の git と依存・区別の形と依存〈追跡の偽物を含む〉)もここから作る。
// 戻す・取り消しの統合テストが共有する戻す操作の文脈(makeRevertContext)と、ハンクを戻すテストの内容とパッチ(numberedLines・firstHunkPatch)も置く。
// realGitRepo.ts は記録に依存しない汎用の道具なので、記録に関わるものはこちらに置く

export interface AgentBaselineRepo {
  /** realpath 済みのリポジトリ(initRepo 済み)。記録・一覧は realpath のフォルダを前提にする */
  repo: string
  /** stubGitHome で HOME・XDG_CONFIG_HOME にした一時ディレクトリ */
  home: string
  /** 記録のインデックスを置く一時ディレクトリ(takeBaselineSnapshot の tempRoot) */
  tempRoot: string
}

// stubIsolatedGitEnv・一時ディレクトリ 3 つ・stubGitHome・initRepo。beforeEach で呼ぶ。
// 記録のインデックスで問い合わせる git は simple-git の env() の制限で GIT_CONFIG_GLOBAL を受け取れないため、
// stubIsolatedGitEnv に加えて stubGitHome で開発者の ~/.gitconfig から切り離す(両方が要る)。
// home・tempRoot には realpath をかけない(従来の各テストの準備のとおり)
export function createAgentBaselineRepo(prefix: string): AgentBaselineRepo {
  stubIsolatedGitEnv()
  const repo = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  const home = mkdtempSync(join(tmpdir(), `${prefix}home-`))
  const tempRoot = mkdtempSync(join(tmpdir(), `${prefix}temp-`))
  stubGitHome(home)
  initRepo(repo)
  return { repo, home, tempRoot }
}

// vi.unstubAllEnvs と 3 つのディレクトリの削除。afterEach で呼ぶ
export function disposeAgentBaselineRepo(dirs: AgentBaselineRepo): void {
  vi.unstubAllEnvs()
  for (const dir of [dirs.repo, dirs.home, dirs.tempRoot]) {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Git 管理外のフォルダ(realpath 済み。中身は空)と HOME・tempRoot。戻り値は AgentBaselineRepo と同じ形で、repo が Git 管理外のフォルダ
// (disposeAgentBaselineRepo でそのまま片付ける)。stubIsolatedGitEnv・stubGitHome は createAgentBaselineRepo と同じ。上の
// フォルダのリポジトリ(TMPDIR がリポジトリの中にある環境など)を拾わないよう、GIT_CEILING_DIRECTORIES をフォルダの親にする
// (git は作業中のフォルダと同じパスの GIT_CEILING_DIRECTORIES を無視して上へ探すため、フォルダ自身を指定しても効かない)
export function createAgentNonGitFolder(prefix: string): AgentBaselineRepo {
  stubIsolatedGitEnv()
  const repo = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  const home = mkdtempSync(join(tmpdir(), `${prefix}home-`))
  const tempRoot = mkdtempSync(join(tmpdir(), `${prefix}temp-`))
  stubGitHome(home)
  stubGitCeiling(dirname(repo))
  return { repo, home, tempRoot }
}

// フォルダの中のすべてのパス(相対。.git の中を含む)の種類・大きさ・更新時刻・モード。操作の前後で比べ、利用者のフォルダに
// 書かないこと(.git などを作らないこと)を確かめる(設計書「セキュリティ」)
export function folderEntries(folder: string): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(folder, dir))) {
      const rel = dir === '' ? name : `${dir}/${name}`
      const stat = lstatSync(join(folder, rel))
      const kind = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'dir' : 'file'
      result[rel] = `${kind} ${stat.size} ${stat.mtimeMs} ${(stat.mode & 0o7777).toString(8)}`
      if (kind === 'dir') walk(rel)
    }
  }
  walk('')
  return result
}

// folderEntries の前後の違いのうち、操作が変えたパス(changed)・その中・その祖先のフォルダ(中身が変わると更新時刻が変わる)を
// 除いたもの。空なら、操作が変えたもの以外は変わっていない
export function folderChangesExcept(
  before: Record<string, string>,
  after: Record<string, string>,
  changed: readonly string[]
): string[] {
  const touched = (rel: string): boolean =>
    changed.some((c) => rel === c || rel.startsWith(`${c}/`) || c.startsWith(`${rel}/`))
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((rel) => !touched(rel) && before[rel] !== after[rel])
    .sort()
}

// 記録の結果から snapshot を取り出す。recorded でなければ例外(準備の失敗をテストの失敗として見せる)
export function recordedSnapshot(result: BaselineSnapshotResult): BaselineSnapshot {
  if (result.kind !== 'recorded') throw new Error(`記録できなかった: ${JSON.stringify(result)}`)
  return result.snapshot
}

/** 偽物の起動ごとの ID(保護の ref の名前と、記録の一時ディレクトリの名前に使う。<pid>-<16 進 8 桁> の形) */
export const FAKE_INSTANCE_ID = '1-00000000'

// 記録を取る。recorded でなければ例外
export async function recordBaseline(repo: string, tempRoot: string): Promise<BaselineSnapshot> {
  return recordedSnapshot(
    await takeBaselineSnapshot(repo, { tempRoot, instanceId: FAKE_INSTANCE_ID })
  )
}

// 記録を写しの元にした区切りの base(記録のインデックスと隠れた git の場所。区切りの gitDir は累積の始点と同じ値を持つ)
export function snapshotBase(snapshot: BaselineSnapshot): BaselineCheckpointBase {
  return { indexPath: snapshot.indexPath, gitDir: snapshot.gitDir }
}

// 区切りを取る(写しの元は base の記録のインデックス)。recorded でなければ例外
export async function recordBaselineFrom(
  repo: string,
  tempRoot: string,
  base: BaselineSnapshot
): Promise<BaselineSnapshot> {
  return recordedSnapshot(
    await takeBaselineSnapshot(repo, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID,
      base: snapshotBase(base)
    })
  )
}

// 利用者の状態(index の更新時刻〈ナノ秒〉と内容・stash・ref・HEAD)。記録や戻す操作の前後で比べる
export function userRepoState(repo: string): unknown {
  return {
    indexMtimeNs: statSync(join(repo, '.git/index'), { bigint: true }).mtimeNs,
    index: readFileSync(join(repo, '.git/index')).toString('base64'),
    stash: runGit(repo, 'stash', 'list'),
    refs: runGit(repo, 'for-each-ref'),
    head: runGit(repo, 'rev-parse', 'HEAD')
  }
}

export interface FakeTrash {
  trash: (absolutePath: string) => Promise<void>
  /** trash に渡されたパス(渡された順) */
  trashed: string[]
}

// ゴミ箱の偽物: 移したパスを控え、実際に作業ツリーから取り除く
export function createFakeTrash(): FakeTrash {
  const trashed: string[] = []
  return {
    trashed,
    trash: async (absolutePath) => {
      trashed.push(absolutePath)
      rmSync(absolutePath, { recursive: true, force: true })
    }
  }
}

// 戻す操作の文脈(記録・ゴミ箱・取り消しの控えの置き場と上限。author は付けない)。戻す・取り消しの統合テストが共有する。
// maxBytes の既定は本番の上限、gitOptions は渡したときだけ置く(AgentRevertContext の欄が増えても各テストを直さずに済むようにする)
export function makeRevertContext(
  snapshot: BaselineSnapshot,
  options: {
    trash: AgentRevertContext['trash']
    tempRoot: string
    maxBytes?: number
    gitOptions?: AgentRevertContext['gitOptions']
  }
): AgentRevertContext {
  const { trash, tempRoot, maxBytes = AGENT_CHANGES_UNDO_MAX_BYTES, gitOptions } = options
  return {
    snapshot,
    trash,
    undoCapture: { tempRoot, maxBytes },
    attributeEntries: async (entries) => entries,
    ...(gitOptions === undefined ? {} : { gitOptions })
  }
}

// l1〜ln の n 行(末尾に改行)。replace の行番号(1 始まり)の行だけ差し替える。ハンクを戻すテストの内容に使う
export function numberedLines(n: number, replace: Record<number, string> = {}): string {
  return Array.from({ length: n }, (_, i) => replace[i + 1] ?? `l${i + 1}`).join('\n') + '\n'
}

// diff の 1 つ目のハンクだけのパッチ(ヘッダーと 1 つ目の @@ の節)
export function firstHunkPatch(diff: string): string {
  const parts = diff.split(/(?=^@@ )/m)
  return parts[0] + parts[1]
}

/** 空の tree の ID(makeBaselineSnapshot の tree の既定値) */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

// 既定値で埋めた BaselineSnapshot。フィールドが増えても、そのフィールドに関係のないテストの偽物を直さずに済むようにする。
// indexPath は既定で `${tempDir}/index`(tempDir を上書きしたときも追従する)
export function makeBaselineSnapshot(overrides: Partial<BaselineSnapshot> = {}): BaselineSnapshot {
  const tempDir = overrides.tempDir ?? '/tmp/baseline'
  return {
    folderPath: '/repo',
    tempDir,
    indexPath: `${tempDir}/index`,
    gitDir: null,
    startedAt: 0,
    head: null,
    tree: EMPTY_TREE,
    excluded: [],
    skippedRepos: [],
    ignoredAtBaseline: [],
    ...overrides
  }
}

// リポジトリの方式の記録の git の場所(gitDir null)。記録の git を直接呼ぶテストで使う
export function repoLocation(folderPath: string, indexPath: string): BaselineGitLocation {
  return { folderPath, indexPath, gitDir: null }
}

// 区別を始めたばかりの記録の区別(idle・印なし・始点を区切りにする・区別は始点の時刻から)。記録の形のテストの既定値に使う
export function makeTrackingAttribution(
  baseline: BaselineSnapshot,
  overrides: Partial<TrackingAttribution> = {}
): TrackingAttribution {
  return {
    kind: 'tracking',
    phase: 'idle',
    periodUnassignable: false,
    timedOutPending: false,
    signalUnassignablePending: false,
    checkpoint: { snapshot: baseline, sharedWithBaseline: true },
    userPaths: new Set(),
    agentPaths: new Set(),
    trackingSince: baseline.startedAt,
    hadUnassignedSince: false,
    staleCheckpointDirs: [],
    ...overrides
  }
}

// 1 所有者の記録。累積の始点の既定は makeBaselineSnapshot()、次の実行の番号の既定は実行の数 + 1。
// 保護の ref の名前の既定は偽物の instanceId と記録の番号から作る(recordSerial を上書きしたときも追従する)。
// 記録の形が変わっても、範囲の解決・問い合わせのテストの偽物を個別に直さずに済むようにする
export function makeAgentChangesRecord(
  runs: AgentChangesRecordRun[],
  overrides: Partial<Omit<AgentChangesRecord, 'runs'>> = {}
): AgentChangesRecord {
  const recordSerial = overrides.recordSerial ?? 1
  const baseline = overrides.baseline ?? makeBaselineSnapshot()
  return {
    baseline,
    runs,
    nextNumber: overrides.nextNumber ?? runs.length + 1,
    recordSerial,
    protection: overrides.protection ?? {
      refName: protectionRefName(FAKE_INSTANCE_ID, recordSerial),
      value: null,
      swept: false
    },
    undo: overrides.undo ?? null,
    attribution: overrides.attribution ?? makeTrackingAttribution(baseline)
  }
}

export type FakeProtectionOp =
  | 'filter'
  | 'mktree'
  | 'create'
  | 'update'
  | 'remove'
  | 'removeSync'
  | 'read'
  | 'sweep'

export interface FakeProtectionGit extends AgentChangesProtectionGit {
  /** ref の名前 → 値(create・update・remove は compare-and-swap で書き換える) */
  refs: Map<string, string>
  /** 呼ばれた操作('create <ref>' など。filter・mktree・sweep は名前だけ) */
  calls: string[]
  /** object の DB に無いことにする tree */
  missingTrees: Set<string>
  /** 次のその操作を失敗させる(1 回で外れる) */
  failNext: Set<FakeProtectionOp>
  /** 次のその操作を待たせ、待ちを解く関数を返す */
  holdNext: (op: FakeProtectionOp) => () => void
  /** sweep に渡された keepSerials() の結果(昇順。呼ばれた順) */
  sweptKeeps: number[][]
}

// 保護の git の偽物。値は項目から決まる文字列(`tree(baseline=<tree>,run-2=<tree>)`)
export function createFakeProtectionGit(): FakeProtectionGit {
  const refs = new Map<string, string>()
  const calls: string[] = []
  const missingTrees = new Set<string>()
  const failNext = new Set<FakeProtectionOp>()
  const holds = new Map<FakeProtectionOp, Promise<void>>()
  const sweptKeeps: number[][] = []
  const enter = async (op: FakeProtectionOp, detail?: string): Promise<void> => {
    calls.push(detail === undefined ? op : `${op} ${detail}`)
    const hold = holds.get(op)
    if (hold !== undefined) {
      holds.delete(op)
      await hold
    }
    if (failNext.delete(op)) throw new Error(`偽物の ${op} の失敗`)
  }
  return {
    refs,
    calls,
    missingTrees,
    failNext,
    sweptKeeps,
    holdNext: (op) => {
      let release = (): void => undefined
      holds.set(
        op,
        new Promise<void>((resolve) => {
          release = resolve
        })
      )
      return () => release()
    },
    filterExistingTrees: async (_ctx, entries) => {
      await enter('filter')
      return entries.filter((entry) => !missingTrees.has(entry.tree))
    },
    makeTree: async (_ctx, entries) => {
      await enter('mktree')
      return `tree(${entries.map((entry) => `${entry.name}=${entry.tree}`).join(',')})`
    },
    create: async (_ctx, refName, value) => {
      await enter('create', refName)
      if (refs.has(refName)) throw new Error('reference already exists')
      refs.set(refName, value)
    },
    update: async (_ctx, refName, value, expected) => {
      await enter('update', refName)
      if (refs.get(refName) !== expected) throw new Error('is at another value')
      refs.set(refName, value)
    },
    remove: async (_ctx, refName, expected) => {
      await enter('remove', refName)
      if (refs.get(refName) !== expected) throw new Error('is at another value')
      refs.delete(refName)
    },
    removeSync: (_ctx, refName, expected) => {
      calls.push(`removeSync ${refName}`)
      if (failNext.delete('removeSync') || refs.get(refName) !== expected) return false
      refs.delete(refName)
      return true
    },
    read: async (_ctx, refName) => {
      await enter('read', refName)
      return refs.get(refName) ?? null
    },
    sweep: async (_ctx, options) => {
      await enter('sweep')
      sweptKeeps.push([...options.keepSerials()].sort((a, b) => a - b))
    }
  }
}

/** registry の保護の依存(偽物の git・すべての pid を生きているとみなす) */
export function makeFakeProtectionDeps(
  git: FakeProtectionGit = createFakeProtectionGit()
): AgentBaselineProtectionDeps {
  return {
    instanceId: FAKE_INSTANCE_ID,
    noHooksDir: '/nohooks',
    git,
    isProcessAlive: () => true
  }
}

/** registry の依存 attributionSource の偽物(追跡の合図と通し番号)。値を書き換えても registry には知らせない(知らせるのはテスト) */
export interface FakeAttributionSource extends Pick<
  AgentToolActivity,
  'activityOf' | 'toolStartSeqOf'
> {
  signal: AgentToolActivitySignal
  seq: number
  set(next: Partial<AgentToolActivitySignal>): void
}

// 既定は paused・合図なし・通し番号 0
export function createFakeAttributionSource(
  initial: Partial<AgentToolActivitySignal> = {}
): FakeAttributionSource {
  const source: FakeAttributionSource = {
    signal: { phase: 'paused', lost: null, unassignable: false, ...initial },
    seq: 0,
    set: (next) => {
      source.signal = { ...source.signal, ...next }
    },
    activityOf: () => source.signal,
    toolStartSeqOf: () => source.seq
  }
  return source
}

/** registry の区別の依存(区切りの差分・今の区間の比較・追跡・開発版のログ・失敗のログ) */
export type AttributionRegistryDeps = Pick<
  AgentBaselineRegistryDeps,
  | 'collectBetween'
  | 'collectCurrent'
  | 'attributionSource'
  | 'attributionDevLog'
  | 'attributionWarn'
>

// 区別を試さないテストの registry の区別の依存。区別をやめた記録(lost)で始め、同期・吸収の区切りを取らない
// (区別は agentBaselineRegistry.attribution.test.ts で見る)。区別の依存が増えても、区別を試さない各テストを直さずに済むようにする
export function makeAttributionOffDeps(): AttributionRegistryDeps {
  return {
    collectBetween: vi.fn<AgentBaselineRegistryDeps['collectBetween']>(async () => []),
    collectCurrent: vi.fn<AgentBaselineRegistryDeps['collectCurrent']>(async () => []),
    attributionSource: createFakeAttributionSource({ lost: 'receiver-unavailable' }),
    attributionDevLog: null,
    attributionWarn: () => undefined
  }
}

// makeAttributionOffDeps の registry が返す記録の区別の要約(区別をやめた記録〈receiver-unavailable〉。lostAt は始点の時刻、集合なし)。
// 区別を試さないテストの recording の状態・一覧の結果の期待値に使う
export function attributionOffSummary(startedAt: number): AgentChangesAttributionSummary {
  return {
    kind: 'lost',
    reason: 'receiver-unavailable',
    lostAt: startedAt,
    hadMarks: false,
    since: null,
    hadUnassignedSince: false
  }
}

// makeAttributionOffDeps の registry が返す記録中の状態(begin・getState の応答)。実行の既定はなし、取り消しの控えの既定はなし、記録の置き場はリポジトリ。
// 区別を試さないテストが、状態の型に欄が増えるたびに期待値を直さずに済むようにする(SRP L3-03)
export function attributionOffRecordingState(
  startedAt: number,
  overrides: { runs?: AgentChangesRun[]; undo?: AgentChangesUndoSummary | null } = {}
): Extract<AgentChangesState, { kind: 'recording' }> {
  const { runs = [], undo = null } = overrides
  return {
    kind: 'recording',
    startedAt,
    runs,
    undo,
    attribution: attributionOffSummary(startedAt),
    storage: 'repository'
  }
}
