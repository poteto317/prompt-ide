# 利用者の全体のエージェントの指示ファイル 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エクスプローラーの「エージェントの指示ファイル」の節に、小見出し `全体(すべてのプロジェクト)` と、利用者の全体の指示ファイル（claude: `~/.claude/CLAUDE.md`、copilot: `~/.copilot/copilot-instructions.md`）の行を足し、開く・作成するをできるようにする。

**Architecture:** main が起動時に環境変数（`CLAUDE_CONFIG_DIR`・`COPILOT_HOME`）とホームから全体の指示ファイルの場所を決める。読む・保存する・監視するの 4 つの入口（`fs:readFile`・`fs:writeFile`・`fs:writeFileChecked`・`fs:setWatchedFiles`）は、新しい `fileAccessScope.ts` の 1 つの関数で規則を選ぶ。main が作ったパスと文字列が完全に一致したときだけ「realpath がホームの中か」で確かめ、それ以外は今の許可フォルダの規則のまま。有無の問い合わせと作成は新しい IPC 2 つで、renderer は CLI の種類だけを送る。renderer の hook が問い合わせの結果を行の状態にし、節の部品が状態ごとに出し分ける。

**Tech Stack:** Electron + React + TypeScript、Vitest + Testing Library

**設計書:** `docs/superpowers/specs/2026-11-07-agent-instruction-files-global-design.md`（各タスクの前に、そのタスクが挙げる節を読む）

## Global Constraints

- **コミットしない。** このプランの手順にコミット・プッシュは無い。コミットは利用者の明示の指示があるときだけ行う（プロジェクトの CLAUDE.md の規則）
- `git add -A` を使わない（使う場面が来ても `git add -u` か、パスを指定する）
- 型だけの import は `import type`。関数には戻り値の型を書く（テストを含む）
- コメント・テストの名前・画面の文言は日本語。テストの名前（`it` の文字列）は「条件 → 期待する結果」
- テストは `NODE_ENV=test` を付けて走らせる（シェルの `NODE_ENV=production` で大量に落ちるため）。例: `NODE_ENV=test npx vitest run <パス>`
- テストの中の再帰的な削除は、必ず `src/shared/__tests__/helpers/tempDirGuard.ts` の `removeTempPath`・`removeTempPathSync` を通す（`rm(…, { recursive: true })` を直接書かない。2026-10-26 にリポジトリが消えたことがある。L-618）。偽のホームは `mkdtemp(join(tmpdir(), …))` を `realpath` したものの下に作る
- `act(...).then(...)` の形で書かない。hook の非同期は `await act(async () => { ... })` で待つ
- 画面に出すパスは main が作った `~/…` の形（`displayPath`）だけ。絶対パス・環境変数の値・例外の文言は画面に出さない（L-017）。main の全体の指示ファイルの失敗の文言も固定にする
- renderer から main へ送るのは CLI の種類（と既存の IPC のパス）だけ。全体の指示ファイルのパスは main が作った文字列と `===` で比べ、正規化しない（L-018・L-019）
- 不正な IPC の引数は例外にし、既定に読み替えない（L-044）
- 「無い」（`missing`）と「確かめられない」（`failed`・`queryFailed`）を取り違えない（L-002）
- 作ったフォルダは失敗しても消さない（L-004）。作成は `wx`、フォルダの作成は recursive なし・`mode: 0o700`
- リストの `key` に表示文言を使わない。全体の行の key は表の `id`
- 押した結果として押せなくなるボタンは `disabled` ではなく `aria-disabled="true"` にし、押しても何もしない（L-157）。多重の実行は ref で止める（L-653）
- 新しい props・hook の引数・登録関数の引数は省略できないものにする（L-060）
- 各タスクの終わりに、そのタスクで変えたファイルへ `npx eslint <パス...> --max-warnings 0` と `npm run typecheck` を通す。整形の崩れは `npx prettier --write <パス>` で直す（変えたファイルだけに。L-199）
- 気をつける知見の ID（`$DEV_FLOW_KIT/lessons/review-lessons.md`。設計書の 6 章）: L-002, L-004, L-016, L-017, L-018, L-019, L-037, L-040, L-044, L-049, L-059, L-060, L-061, L-072, L-157, L-199, L-203, L-249, L-466, L-469, L-618, L-653, L-693, L-694

## ファイルの構成

| ファイル | 役割 |
| --- | --- |
| `src/shared/agentInstructionFiles.ts` | 全体の指示ファイルの表 `AGENT_GLOBAL_INSTRUCTION_FILES` |
| `src/shared/types/agentInstructions.ts` | 問い合わせ・作成の結果の型 |
| `src/main/globalAgentInstructionLocations.ts`（新規） | 環境変数とホームから場所を決める（純粋） |
| `src/main/globalAgentInstructionAccess.ts`（新規） | パスの一致・ホームの中かの検査・拒否の例外 |
| `src/main/globalAgentInstructionStatus.ts`（新規） | 有無の問い合わせ |
| `src/main/globalAgentInstructionFileCreator.ts`（新規） | 作成 |
| `src/main/fileAccessScope.ts`（新規） | 4 つの入口の規則の振り分けと、失敗の文言の変換 |
| `src/main/checkedFileWrite.ts` | scope を受け取る |
| `src/main/handlers/fileSystemHandlers.ts` | `fs:readFile`・`fs:writeFile` を scope に通す |
| `src/main/handlers/externalChangeHandlers.ts` | `fs:writeFileChecked`・`fs:setWatchedFiles` を scope に通す |
| `src/main/handlers/agentInstructionsHandlers.ts` | `agentInstructions:getGlobalStatus`・`agentInstructions:createGlobal` |
| `src/main/ipcHandlers.ts` | 起動時に場所を決め、3 つの登録関数に渡す |
| `src/main/__tests__/helpers/globalAgentInstructionContext.ts`（新規） | テスト用の「全体の指示ファイルが無い」文脈 |
| `src/preload/api.ts`・`src/preload/index.d.ts` | 2 つの API |
| `src/renderer/src/lib/agentInstructionsApi.ts` | 2 つの包み |
| `src/renderer/src/lib/agentInstructionMessages.ts` | 全体の指示ファイルの文言・`更新` の `title` |
| `src/renderer/src/lib/agentGlobalInstructionRow.ts`（新規） | 問い合わせの状態から表示用の行を作る（純粋） |
| `src/renderer/src/types.ts` | `AgentGlobalInstructionRow`・`AgentInstructionsPanelState` の追加 |
| `src/renderer/src/hooks/useAgentInstructionFiles.ts` | 問い合わせ・`openGlobal`・`createGlobal`・`refresh` |
| `src/renderer/src/hooks/useAppState.ts` | 2 つの API を hook に渡す |
| `src/renderer/src/components/explorer/AgentInstructionGlobalList.tsx`（新規） | 小見出しと全体の行 |
| `src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx` | 全体の一覧の配置と、失敗の文言の位置 |
| `src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts`・`__tests__/setup.ts` | テストの既定値・`window.api` の stub |
| 文書 | `docs/manual-test-spec.md`・`ROADMAP.md`・`README.md`・`docs/developer-guide.md` |

---

### Task 1: 全体の指示ファイルの表と結果の型（shared）

設計書: 3 章「表」・「有無の問い合わせ」・「作成」の戻り値。

**Files:**
- Modify: `src/shared/agentInstructionFiles.ts`（末尾に足す）
- Modify: `src/shared/types/agentInstructions.ts`（末尾に足す）
- Test: `src/shared/__tests__/agentInstructionFiles.test.ts`（末尾に `describe` を足す）

**Interfaces:**
- Consumes: 既存の `AgentCliKind`・`AGENT_INSTRUCTION_FILES`・`TEMPLATE_SECTIONS`（同じファイルの中の定数）
- Produces:
  - `type AgentGlobalInstructionFileId = 'claude-global' | 'copilot-global'`
  - `interface AgentGlobalInstructionFile { id; envName: 'CLAUDE_CONFIG_DIR' | 'COPILOT_HOME'; defaultDirName: '.claude' | '.copilot'; emptyEnvMeansDefault: boolean; fileName: string; description: string; template: string }`
  - `const AGENT_GLOBAL_INSTRUCTION_FILES: Record<AgentCliKind, AgentGlobalInstructionFile>`
  - `type GlobalAgentInstructionUnavailableReason = 'envNotAbsolute' | 'envOutsideHome'`
  - `type GlobalAgentInstructionStatus`（下のコード）
  - `type GlobalAgentInstructionCreateFailureReason = 'exists' | 'outside' | 'failed' | 'unavailable'`
  - `type GlobalAgentInstructionCreateResult = { ok: true } | { ok: false; reason: GlobalAgentInstructionCreateFailureReason }`

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/__tests__/agentInstructionFiles.test.ts` の import に `AGENT_GLOBAL_INSTRUCTION_FILES` を足し、末尾に足す:

```ts
describe('AGENT_GLOBAL_INSTRUCTION_FILES', () => {
  it('CLI ごとに 1 つ → id が今の表の id と重ならない', () => {
    const projectIds = [...AGENT_INSTRUCTION_FILES.claude, ...AGENT_INSTRUCTION_FILES.copilot].map(
      (f) => f.id as string
    )
    const globalIds = Object.values(AGENT_GLOBAL_INSTRUCTION_FILES).map((f) => f.id as string)
    expect(globalIds).toEqual(['claude-global', 'copilot-global'])
    expect(globalIds.filter((id) => projectIds.includes(id))).toEqual([])
  })

  it('claude → CLAUDE_CONFIG_DIR・.claude・CLAUDE.md、空の値は既定にしない', () => {
    expect(AGENT_GLOBAL_INSTRUCTION_FILES.claude).toMatchObject({
      envName: 'CLAUDE_CONFIG_DIR',
      defaultDirName: '.claude',
      emptyEnvMeansDefault: false,
      fileName: 'CLAUDE.md'
    })
  })

  it('copilot → COPILOT_HOME・.copilot・copilot-instructions.md、空の値は既定', () => {
    expect(AGENT_GLOBAL_INSTRUCTION_FILES.copilot).toMatchObject({
      envName: 'COPILOT_HOME',
      defaultDirName: '.copilot',
      emptyEnvMeansDefault: true,
      fileName: 'copilot-instructions.md'
    })
  })

  it.each(['claude', 'copilot'] as const)('%s → 名前に区切りが無く、雛形は # 全体の指示 で始まり改行で終わる', (kind) => {
    const file = AGENT_GLOBAL_INSTRUCTION_FILES[kind]
    expect(file.fileName).not.toMatch(/[/\\]/)
    expect(file.template.startsWith('# 全体の指示\n')).toBe(true)
    expect(file.template.endsWith('\n')).toBe(true)
    expect(file.description).toBe('個人の指示(全部のプロジェクトに効きます)')
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/shared/__tests__/agentInstructionFiles.test.ts`
Expected: FAIL（`AGENT_GLOBAL_INSTRUCTION_FILES` が無い）

- [ ] **Step 3: 表を足す**

`src/shared/agentInstructionFiles.ts` の末尾に足す:

```ts
/** 利用者の全体の指示ファイル(設計書 2026-11-07 global「表」)。場所と雛形は main だけが使い、renderer は説明だけを読む */
export type AgentGlobalInstructionFileId = 'claude-global' | 'copilot-global'

export interface AgentGlobalInstructionFile {
  id: AgentGlobalInstructionFileId
  /** 設定のフォルダを変える環境変数 */
  envName: 'CLAUDE_CONFIG_DIR' | 'COPILOT_HOME'
  /** 環境変数が無いときの、ホームの直下のフォルダの名前 */
  defaultDirName: '.claude' | '.copilot'
  /** 環境変数が空の文字列のとき、既定のフォルダとして扱うか(copilot は実物で確かめた。claude は決められない) */
  emptyEnvMeansDefault: boolean
  /** 設定のフォルダの中のファイル名 */
  fileName: string
  description: string
  template: string
}

const GLOBAL_TEMPLATE = `# 全体の指示\n${TEMPLATE_SECTIONS}`
const GLOBAL_DESCRIPTION = '個人の指示(全部のプロジェクトに効きます)'

export const AGENT_GLOBAL_INSTRUCTION_FILES: Record<AgentCliKind, AgentGlobalInstructionFile> = {
  claude: {
    id: 'claude-global',
    envName: 'CLAUDE_CONFIG_DIR',
    defaultDirName: '.claude',
    // Claude Code 2.1.291 は空の値を場所によって既定(||)にも空のまま(??)にも使う
    emptyEnvMeansDefault: false,
    fileName: 'CLAUDE.md',
    description: GLOBAL_DESCRIPTION,
    template: GLOBAL_TEMPLATE
  },
  copilot: {
    id: 'copilot-global',
    envName: 'COPILOT_HOME',
    defaultDirName: '.copilot',
    // copilot 1.0.106 は COPILOT_HOME||join(HOME, '.copilot')。空の値で既定と同じ結果になることを確かめた
    emptyEnvMeansDefault: true,
    fileName: 'copilot-instructions.md',
    description: GLOBAL_DESCRIPTION,
    template: GLOBAL_TEMPLATE
  }
}
```

`src/shared/types/agentInstructions.ts` の末尾に足す:

```ts
/** 全体の指示ファイルの場所を決められない理由(環境変数) */
export type GlobalAgentInstructionUnavailableReason = 'envNotAbsolute' | 'envOutsideHome'

/** agentInstructions:getGlobalStatus の結果。絶対パス(filePath)は exists のときだけ返す(開くためのノードに使う。画面には出さない) */
export type GlobalAgentInstructionStatus =
  | { kind: 'exists'; filePath: string; displayPath: string }
  | { kind: 'missing'; displayPath: string }
  | { kind: 'linkOutsideHome'; displayPath: string }
  | { kind: 'failed'; displayPath: string }
  | { kind: 'unavailable'; reason: GlobalAgentInstructionUnavailableReason }

/** agentInstructions:createGlobal の失敗の理由 */
export type GlobalAgentInstructionCreateFailureReason = 'exists' | 'outside' | 'failed' | 'unavailable'

/** agentInstructions:createGlobal の結果。ok: true は「新しく作った」ことだけを意味する */
export type GlobalAgentInstructionCreateResult =
  | { ok: true }
  | { ok: false; reason: GlobalAgentInstructionCreateFailureReason }
```

- [ ] **Step 4: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/shared/__tests__/agentInstructionFiles.test.ts`
Expected: PASS

- [ ] **Step 5: lint と型**

Run: `npx eslint src/shared/agentInstructionFiles.ts src/shared/types/agentInstructions.ts src/shared/__tests__/agentInstructionFiles.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 2: 場所を決める（main・純粋）

設計書: 3 章「場所を決める」、2 章「環境変数」。

**Files:**
- Create: `src/main/globalAgentInstructionLocations.ts`
- Create: `src/main/__tests__/helpers/globalAgentInstructionContext.ts`
- Test: `src/main/__tests__/globalAgentInstructionLocations.test.ts`

**Interfaces:**
- Consumes: `AGENT_GLOBAL_INSTRUCTION_FILES`・`AgentGlobalInstructionFile`（Task 1）、`GlobalAgentInstructionUnavailableReason`（Task 1）
- Produces:
  - `type ResolvedGlobalAgentInstructionLocation = { kind: 'resolved'; file: AgentGlobalInstructionFile; dirPath: string; filePath: string; displayPath: string }`
  - `type GlobalAgentInstructionLocation = ResolvedGlobalAgentInstructionLocation | { kind: 'unavailable'; file: AgentGlobalInstructionFile; reason: GlobalAgentInstructionUnavailableReason }`
  - `type GlobalAgentInstructionLocations = Record<AgentCliKind, GlobalAgentInstructionLocation>`
  - `interface GlobalAgentInstructionContext { locations: GlobalAgentInstructionLocations; homeDir: string }`
  - `function resolveGlobalAgentInstructionLocations(args: { env: NodeJS.ProcessEnv; homeDir: string }): GlobalAgentInstructionLocations`
  - `function resolveGlobalAgentInstructionContext(args: { env: NodeJS.ProcessEnv; homeDir: string }): GlobalAgentInstructionContext`
  - `function isLexicallyInsideHome(homeDir: string, path: string): boolean`
  - テスト用: `NO_GLOBAL_INSTRUCTIONS: GlobalAgentInstructionContext`（`src/main/__tests__/helpers/globalAgentInstructionContext.ts`）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/globalAgentInstructionLocations.test.ts`（POSIX のパスで書くので Windows では飛ばす）:

```ts
import { describe, expect, it } from 'vitest'
import {
  isLexicallyInsideHome,
  resolveGlobalAgentInstructionLocations
} from '../globalAgentInstructionLocations'

const HOME = '/home/u'
const describePosix = describe.skipIf(process.platform === 'win32')
const resolveWith = (env: NodeJS.ProcessEnv): ReturnType<typeof resolveGlobalAgentInstructionLocations> =>
  resolveGlobalAgentInstructionLocations({ env, homeDir: HOME })

describePosix('resolveGlobalAgentInstructionLocations', () => {
  it('環境変数が無い → ~/.claude/CLAUDE.md と ~/.copilot/copilot-instructions.md', () => {
    const locations = resolveWith({})
    expect(locations.claude).toMatchObject({
      kind: 'resolved',
      dirPath: '/home/u/.claude',
      filePath: '/home/u/.claude/CLAUDE.md',
      displayPath: '~/.claude/CLAUDE.md'
    })
    expect(locations.copilot).toMatchObject({
      kind: 'resolved',
      dirPath: '/home/u/.copilot',
      filePath: '/home/u/.copilot/copilot-instructions.md',
      displayPath: '~/.copilot/copilot-instructions.md'
    })
  })

  it('絶対パスの環境変数 → そのフォルダの下', () => {
    const locations = resolveWith({ CLAUDE_CONFIG_DIR: '/home/u/work/cc', COPILOT_HOME: '/home/u/ch' })
    expect(locations.claude).toMatchObject({ filePath: '/home/u/work/cc/CLAUDE.md', displayPath: '~/work/cc/CLAUDE.md' })
    expect(locations.copilot).toMatchObject({ filePath: '/home/u/ch/copilot-instructions.md' })
  })

  it('.. を含む絶対パス → 畳んでから決める', () => {
    expect(resolveWith({ CLAUDE_CONFIG_DIR: '/home/u/a/../cc' }).claude).toMatchObject({
      dirPath: '/home/u/cc'
    })
  })

  it.each([
    ['相対パス', 'rel'],
    ['空の文字列', '']
  ])('claude で %s → envNotAbsolute', (_label, value) => {
    expect(resolveWith({ CLAUDE_CONFIG_DIR: value }).claude).toMatchObject({
      kind: 'unavailable',
      reason: 'envNotAbsolute'
    })
  })

  it('copilot で空の文字列 → 既定の ~/.copilot', () => {
    expect(resolveWith({ COPILOT_HOME: '' }).copilot).toMatchObject({
      kind: 'resolved',
      dirPath: '/home/u/.copilot'
    })
  })

  it('copilot で相対パス → envNotAbsolute', () => {
    expect(resolveWith({ COPILOT_HOME: 'rel' }).copilot).toMatchObject({
      kind: 'unavailable',
      reason: 'envNotAbsolute'
    })
  })

  it.each([
    ['ホームの外', '/tmp/cc'],
    ['.. でホームの外', '/home/u/../other']
  ])('%s → envOutsideHome', (_label, value) => {
    expect(resolveWith({ CLAUDE_CONFIG_DIR: value }).claude).toMatchObject({
      kind: 'unavailable',
      reason: 'envOutsideHome'
    })
  })

  it('ホームそのもの → ~/CLAUDE.md', () => {
    expect(resolveWith({ CLAUDE_CONFIG_DIR: '/home/u' }).claude).toMatchObject({
      kind: 'resolved',
      dirPath: '/home/u',
      displayPath: '~/CLAUDE.md'
    })
  })

  it('.. で始まる名前のフォルダ(~/..x) → 中として扱う', () => {
    expect(resolveWith({ CLAUDE_CONFIG_DIR: '/home/u/..x' }).claude).toMatchObject({
      kind: 'resolved',
      displayPath: '~/..x/CLAUDE.md'
    })
  })
})

describePosix('isLexicallyInsideHome', () => {
  it.each([
    ['/home/u', true],
    ['/home/u/.claude', true],
    ['/home/u/..x', true],
    ['/home', false],
    ['/home/other', false],
    ['/tmp', false]
  ])('%s → %s', (path, expected) => {
    expect(isLexicallyInsideHome(HOME, path)).toBe(expected)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/globalAgentInstructionLocations.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/main/globalAgentInstructionLocations.ts`:

```ts
// 全体の指示ファイルの場所(設計書 2026-11-07 global「場所を決める」)。main の起動時の process.env で 1 回だけ決める。
// このアプリから起動する CLI は同じ process.env を受け取る(agentCommand.ts の buildAgentEnv)ので、節に出す場所と CLI が読む場所が一致する
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { AGENT_GLOBAL_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'
import type { AgentGlobalInstructionFile } from '@shared/agentInstructionFiles'
import type { GlobalAgentInstructionUnavailableReason } from '@shared/types'

export interface ResolvedGlobalAgentInstructionLocation {
  kind: 'resolved'
  file: AgentGlobalInstructionFile
  /** 設定のフォルダ(正規化した絶対パス。realpath はしない) */
  dirPath: string
  /** 全体の指示ファイルの絶対パス。renderer に渡し、境界で文字列として比べる */
  filePath: string
  /** 画面に出す `~/…` の形(区切りは /) */
  displayPath: string
}

export type GlobalAgentInstructionLocation =
  | ResolvedGlobalAgentInstructionLocation
  | { kind: 'unavailable'; file: AgentGlobalInstructionFile; reason: GlobalAgentInstructionUnavailableReason }

export type GlobalAgentInstructionLocations = Record<AgentCliKind, GlobalAgentInstructionLocation>

/** 受け口の登録に渡す文脈(場所と、ホームの検査に使うホーム) */
export interface GlobalAgentInstructionContext {
  locations: GlobalAgentInstructionLocations
  homeDir: string
}

/** 字面でホームの中か(ホームそのものを含む)。rel が '..'・'../' で始まる・絶対パス(Windows の別のドライブ)なら外 */
export function isLexicallyInsideHome(homeDir: string, path: string): boolean {
  const rel = relative(homeDir, path)
  return !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
}

function resolveLocation(
  file: AgentGlobalInstructionFile,
  env: NodeJS.ProcessEnv,
  homeDir: string
): GlobalAgentInstructionLocation {
  const value = env[file.envName]
  let dirPath: string
  if (value === undefined || (value === '' && file.emptyEnvMeansDefault)) {
    dirPath = join(homeDir, file.defaultDirName)
  } else if (value === '' || !isAbsolute(value)) {
    // 既定に読み替えない(CLI がどこを読むか決められない。L-044)
    return { kind: 'unavailable', file, reason: 'envNotAbsolute' }
  } else {
    dirPath = resolve(value)
  }
  if (!isLexicallyInsideHome(homeDir, dirPath)) {
    return { kind: 'unavailable', file, reason: 'envOutsideHome' }
  }
  const filePath = join(dirPath, file.fileName)
  const displayPath = `~/${relative(homeDir, filePath).split(sep).join('/')}`
  return { kind: 'resolved', file, dirPath, filePath, displayPath }
}

export function resolveGlobalAgentInstructionLocations({
  env,
  homeDir
}: {
  env: NodeJS.ProcessEnv
  homeDir: string
}): GlobalAgentInstructionLocations {
  // CLI の種類ごとに書き下す(Object.fromEntries とキャストで型を偽らない。開発者ガイド 4)
  return {
    claude: resolveLocation(AGENT_GLOBAL_INSTRUCTION_FILES.claude, env, homeDir),
    copilot: resolveLocation(AGENT_GLOBAL_INSTRUCTION_FILES.copilot, env, homeDir)
  }
}

export function resolveGlobalAgentInstructionContext(args: {
  env: NodeJS.ProcessEnv
  homeDir: string
}): GlobalAgentInstructionContext {
  return { locations: resolveGlobalAgentInstructionLocations(args), homeDir: args.homeDir }
}
```



`src/main/__tests__/helpers/globalAgentInstructionContext.ts`（既存の受け口のテストが、新しい必須の引数に渡す既定）:

```ts
import { resolveGlobalAgentInstructionContext } from '../../globalAgentInstructionLocations'
import type { GlobalAgentInstructionContext } from '../../globalAgentInstructionLocations'

/** 既存のテスト用。全体の指示ファイルは存在しないホーム(/nonexistent-home)の下にあり、テストのパスとは一致しない */
export const NO_GLOBAL_INSTRUCTIONS: GlobalAgentInstructionContext =
  resolveGlobalAgentInstructionContext({ env: {}, homeDir: '/nonexistent-home' })
```

- [ ] **Step 4: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/globalAgentInstructionLocations.test.ts`
Expected: PASS

- [ ] **Step 5: lint と型**

Run: `npx eslint src/main/globalAgentInstructionLocations.ts src/main/__tests__/globalAgentInstructionLocations.test.ts src/main/__tests__/helpers/globalAgentInstructionContext.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 3: パスの一致とホームの中かの検査（main）

設計書: 3 章「境界」。

**Files:**
- Create: `src/main/globalAgentInstructionAccess.ts`
- Test: `src/main/__tests__/globalAgentInstructionAccess.test.ts`

**Interfaces:**
- Consumes: `GlobalAgentInstructionLocations`・`ResolvedGlobalAgentInstructionLocation`・`resolveGlobalAgentInstructionLocations`（Task 2）
- Produces:
  - `class GlobalAgentInstructionAccessDeniedError extends Error`（文言は `Access denied: 全体の指示ファイル`。パスを入れない）
  - `function matchGlobalAgentInstructionPath(locations: GlobalAgentInstructionLocations, filePath: unknown): ResolvedGlobalAgentInstructionLocation | null`
  - `async function assertResolvedWithinHome(homeDir: string, path: string): Promise<string>`（解決した先を返す。realpath の失敗はそのまま投げる）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/globalAgentInstructionAccess.test.ts`（実ファイル。リンクは Windows では飛ばす）:

```ts
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { resolveGlobalAgentInstructionLocations } from '../globalAgentInstructionLocations'
import {
  GlobalAgentInstructionAccessDeniedError,
  assertResolvedWithinHome,
  matchGlobalAgentInstructionPath
} from '../globalAgentInstructionAccess'

const itSymlink = it.skipIf(process.platform === 'win32')
let root: string
let home: string
let outside: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'global-instructions-')))
  home = join(root, 'home')
  outside = join(root, 'outside')
  await mkdir(home)
  await mkdir(outside)
})

afterEach(async () => {
  await removeTempPath(root)
})

describe('matchGlobalAgentInstructionPath', () => {
  it('main が作った filePath と完全一致 → その場所', () => {
    const locations = resolveGlobalAgentInstructionLocations({ env: {}, homeDir: home })
    expect(matchGlobalAgentInstructionPath(locations, join(home, '.claude', 'CLAUDE.md'))).toBe(
      locations.claude
    )
    expect(
      matchGlobalAgentInstructionPath(locations, join(home, '.copilot', 'copilot-instructions.md'))
    ).toBe(locations.copilot)
  })

  it.each([
    ['末尾に区切り', (h: string) => join(h, '.claude', 'CLAUDE.md') + '/'],
    ['大文字小文字の違い', (h: string) => join(h, '.claude', 'claude.md')],
    // join は .. を畳むので、文字列で組み立てる(畳まれると完全一致してテストにならない)
    ['.. を含む書き方', (h: string) => `${h}/.claude/x/../CLAUDE.md`],
    ['別のファイル', (h: string) => join(h, '.claude', 'settings.json')]
  ])('%s → null', (_label, makePath) => {
    const locations = resolveGlobalAgentInstructionLocations({ env: {}, homeDir: home })
    expect(matchGlobalAgentInstructionPath(locations, makePath(home))).toBeNull()
  })

  it.each([null, 1, undefined, {}])('文字列でない値(%s) → null', (value) => {
    const locations = resolveGlobalAgentInstructionLocations({ env: {}, homeDir: home })
    expect(matchGlobalAgentInstructionPath(locations, value)).toBeNull()
  })

  it('unavailable の場所 → 一致しない', () => {
    const locations = resolveGlobalAgentInstructionLocations({
      env: { CLAUDE_CONFIG_DIR: 'rel' },
      homeDir: home
    })
    expect(matchGlobalAgentInstructionPath(locations, join(home, '.claude', 'CLAUDE.md'))).toBeNull()
  })
})

describe('assertResolvedWithinHome', () => {
  it('ホームの中のファイル → 解決した先を返す', async () => {
    await writeFile(join(home, 'a.md'), 'x')
    await expect(assertResolvedWithinHome(home, join(home, 'a.md'))).resolves.toBe(join(home, 'a.md'))
  })

  it('ホームそのもの → 通す', async () => {
    await expect(assertResolvedWithinHome(home, home)).resolves.toBe(home)
  })

  itSymlink('ホームの中を指すリンク(dotfiles) → 通す', async () => {
    await mkdir(join(home, 'dotfiles'))
    await writeFile(join(home, 'dotfiles', 'CLAUDE.md'), 'x')
    await mkdir(join(home, '.claude'))
    await symlink(join(home, 'dotfiles', 'CLAUDE.md'), join(home, '.claude', 'CLAUDE.md'))
    await expect(
      assertResolvedWithinHome(home, join(home, '.claude', 'CLAUDE.md'))
    ).resolves.toBe(join(home, 'dotfiles', 'CLAUDE.md'))
  })

  itSymlink('ホームの中を指すリンクのフォルダの下のファイル → 通す', async () => {
    await mkdir(join(home, 'dotfiles'))
    await writeFile(join(home, 'dotfiles', 'CLAUDE.md'), 'x')
    await symlink(join(home, 'dotfiles'), join(home, '.claude'))
    await expect(
      assertResolvedWithinHome(home, join(home, '.claude', 'CLAUDE.md'))
    ).resolves.toBe(join(home, 'dotfiles', 'CLAUDE.md'))
  })

  itSymlink('ホームの外を指すファイルのリンク → 拒否(文言にパスが入らない)', async () => {
    await writeFile(join(outside, 'CLAUDE.md'), 'secret')
    await symlink(join(outside, 'CLAUDE.md'), join(home, 'CLAUDE.md'))
    const result = assertResolvedWithinHome(home, join(home, 'CLAUDE.md'))
    await expect(result).rejects.toBeInstanceOf(GlobalAgentInstructionAccessDeniedError)
    await expect(result).rejects.not.toThrow(root)
  })

  itSymlink('ホームの外を指すフォルダのリンク → 拒否', async () => {
    await symlink(outside, join(home, '.claude'))
    await expect(assertResolvedWithinHome(home, join(home, '.claude'))).rejects.toBeInstanceOf(
      GlobalAgentInstructionAccessDeniedError
    )
  })

  itSymlink('自分を指すリンク → realpath の失敗(ELOOP)をそのまま投げる', async () => {
    await symlink(join(home, 'loop.md'), join(home, 'loop.md'))
    await expect(assertResolvedWithinHome(home, join(home, 'loop.md'))).rejects.toMatchObject({
      code: 'ELOOP'
    })
  })

  itSymlink('ぶら下がったリンク → realpath の失敗(ENOENT)をそのまま投げる', async () => {
    await symlink(join(outside, 'missing.md'), join(home, 'CLAUDE.md'))
    await expect(assertResolvedWithinHome(home, join(home, 'CLAUDE.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/globalAgentInstructionAccess.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/main/globalAgentInstructionAccess.ts`:

```ts
// 全体の指示ファイルの境界(設計書 2026-11-07 global「境界」)。パスは main が作った文字列と完全一致のときだけ全体の指示ファイルとし、
// 正規化しない(検証の値と実行の値をずらさない。L-018)。realpath した先がホームの realpath の中かを確かめる(L-016)
import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'
import type {
  GlobalAgentInstructionLocations,
  ResolvedGlobalAgentInstructionLocation
} from './globalAgentInstructionLocations'

/** 全体の指示ファイルの入口での拒否(ホームの外を指すリンク)。文言にパスを入れない(L-017) */
export class GlobalAgentInstructionAccessDeniedError extends Error {
  constructor() {
    super('Access denied: 全体の指示ファイル')
  }
}

export function matchGlobalAgentInstructionPath(
  locations: GlobalAgentInstructionLocations,
  filePath: unknown
): ResolvedGlobalAgentInstructionLocation | null {
  if (typeof filePath !== 'string') return null
  for (const location of [locations.claude, locations.copilot]) {
    if (location.kind === 'resolved' && location.filePath === filePath) return location
  }
  return null
}

/** realpath した先がホームの realpath と等しいか、その中か。違えば GlobalAgentInstructionAccessDeniedError。realpath の失敗はそのまま投げる */
export async function assertResolvedWithinHome(homeDir: string, path: string): Promise<string> {
  const resolved = await realpath(path)
  const resolvedHome = await realpath(homeDir)
  const prefix = resolvedHome.endsWith(sep) ? resolvedHome : resolvedHome + sep
  if (resolved !== resolvedHome && !resolved.startsWith(prefix)) {
    throw new GlobalAgentInstructionAccessDeniedError()
  }
  return resolved
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/globalAgentInstructionAccess.test.ts`
Expected: PASS

- [ ] **Step 5: lint と型**

Run: `npx eslint src/main/globalAgentInstructionAccess.ts src/main/__tests__/globalAgentInstructionAccess.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 4: 有無の問い合わせと作成（main）

設計書: 3 章「有無の問い合わせ」の手順 1〜5 と 2a、「作成」の手順 1〜5。2 章「フォルダが無いとき」。

**Files:**
- Create: `src/main/globalAgentInstructionStatus.ts`
- Create: `src/main/globalAgentInstructionFileCreator.ts`
- Test: `src/main/__tests__/globalAgentInstructionStatus.test.ts`
- Test: `src/main/__tests__/globalAgentInstructionFileCreator.test.ts`
- Test: `src/main/__tests__/globalAgentInstructionFileCreator.cleanup.test.ts`（`createFileContent` をモックして後始末を確かめる）

**Interfaces:**
- Consumes: `GlobalAgentInstructionLocation`・`ResolvedGlobalAgentInstructionLocation`・`resolveGlobalAgentInstructionLocations`（Task 2）、`assertResolvedWithinHome`・`GlobalAgentInstructionAccessDeniedError`（Task 3）、`GlobalAgentInstructionStatus`・`GlobalAgentInstructionCreateFailureReason`（Task 1）、既存の `createFileContent`（`src/main/fileSystem.ts`）・`isFsError`（`src/main/fsErrors.ts`）
- Produces:
  - `async function getGlobalAgentInstructionStatus(location: GlobalAgentInstructionLocation, homeDir: string): Promise<GlobalAgentInstructionStatus>`（例外を投げない）
  - `async function createGlobalAgentInstructionFile(location: ResolvedGlobalAgentInstructionLocation, homeDir: string): Promise<void>`（途中の失敗は投げる）
  - `function toGlobalAgentInstructionCreateFailureReason(err: unknown): Exclude<GlobalAgentInstructionCreateFailureReason, 'unavailable'>`

- [ ] **Step 1: 問い合わせの失敗するテストを書く**

`src/main/__tests__/globalAgentInstructionStatus.test.ts`:

```ts
import { chmod, mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { resolveGlobalAgentInstructionLocations } from '../globalAgentInstructionLocations'
import { getGlobalAgentInstructionStatus } from '../globalAgentInstructionStatus'

const itPosix = it.skipIf(process.platform === 'win32')
// root はパーミッションを無視して読めてしまうので、chmod 000 のテストは root では飛ばす
const itPosixNonRoot = it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)
let root: string
let home: string
let outside: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'global-status-')))
  home = join(root, 'home')
  outside = join(root, 'outside')
  await mkdir(home)
  await mkdir(outside)
})

afterEach(async () => {
  // chmod 000 にしたフォルダが残っていても消せるよう戻す
  await chmod(join(home, '.claude'), 0o700).catch(() => undefined)
  await removeTempPath(root)
})

const statusOf = (env: NodeJS.ProcessEnv = {}): ReturnType<typeof getGlobalAgentInstructionStatus> =>
  getGlobalAgentInstructionStatus(
    resolveGlobalAgentInstructionLocations({ env, homeDir: home }).claude,
    home
  )

describe('getGlobalAgentInstructionStatus', () => {
  it('ファイルがある → exists と filePath・displayPath', async () => {
    await mkdir(join(home, '.claude'))
    await writeFile(join(home, '.claude', 'CLAUDE.md'), 'x')
    await expect(statusOf()).resolves.toEqual({
      kind: 'exists',
      filePath: join(home, '.claude', 'CLAUDE.md'),
      displayPath: '~/.claude/CLAUDE.md'
    })
  })

  it('フォルダはあるがファイルが無い → missing(filePath を含まない)', async () => {
    await mkdir(join(home, '.claude'))
    await expect(statusOf()).resolves.toEqual({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
  })

  it('フォルダも無く、親(ホーム)がある → missing', async () => {
    await expect(statusOf()).resolves.toEqual({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
  })

  itPosix('ファイルがホームの外を指すリンク → linkOutsideHome', async () => {
    await mkdir(join(home, '.claude'))
    await writeFile(join(outside, 'CLAUDE.md'), 'secret')
    await symlink(join(outside, 'CLAUDE.md'), join(home, '.claude', 'CLAUDE.md'))
    await expect(statusOf()).resolves.toEqual({ kind: 'linkOutsideHome', displayPath: '~/.claude/CLAUDE.md' })
  })

  itPosix('設定のフォルダがホームの外へのリンクで中にファイルが無い → linkOutsideHome(missing にならない)', async () => {
    await symlink(outside, join(home, '.claude'))
    await expect(statusOf()).resolves.toMatchObject({ kind: 'linkOutsideHome' })
  })

  itPosix('設定のフォルダが無く、親がホームの外へのリンク → linkOutsideHome', async () => {
    await symlink(outside, join(home, 'link'))
    await expect(statusOf({ CLAUDE_CONFIG_DIR: join(home, 'link', 'claude') })).resolves.toMatchObject({
      kind: 'linkOutsideHome'
    })
  })

  it('設定のフォルダの親も無い → failed', async () => {
    await expect(statusOf({ CLAUDE_CONFIG_DIR: join(home, 'a', 'b') })).resolves.toMatchObject({
      kind: 'failed'
    })
  })

  itPosix('設定のフォルダがぶら下がったリンク → failed(missing にならない)', async () => {
    await symlink(join(outside, 'gone'), join(home, '.claude'))
    await expect(statusOf()).resolves.toMatchObject({ kind: 'failed' })
  })

  itPosix('ファイルがぶら下がったリンク → failed', async () => {
    await mkdir(join(home, '.claude'))
    await symlink(join(home, 'gone.md'), join(home, '.claude', 'CLAUDE.md'))
    await expect(statusOf()).resolves.toMatchObject({ kind: 'failed' })
  })

  itPosix('ファイルが自分を指すリンク(ELOOP) → failed', async () => {
    await mkdir(join(home, '.claude'))
    await symlink(join(home, '.claude', 'CLAUDE.md'), join(home, '.claude', 'CLAUDE.md'))
    await expect(statusOf()).resolves.toMatchObject({ kind: 'failed' })
  })

  it('CLAUDE.md という名前のフォルダ → failed', async () => {
    await mkdir(join(home, '.claude', 'CLAUDE.md'), { recursive: true })
    await expect(statusOf()).resolves.toMatchObject({ kind: 'failed' })
  })

  itPosixNonRoot('読めない設定のフォルダ(chmod 000) → failed', async () => {
    await mkdir(join(home, '.claude'))
    await chmod(join(home, '.claude'), 0o000)
    await expect(statusOf()).resolves.toMatchObject({ kind: 'failed' })
  })

  it('場所を決められない → unavailable と理由', async () => {
    await expect(statusOf({ CLAUDE_CONFIG_DIR: 'rel' })).resolves.toEqual({
      kind: 'unavailable',
      reason: 'envNotAbsolute'
    })
  })
})
```


- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/globalAgentInstructionStatus.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 問い合わせを実装する**

`src/main/globalAgentInstructionStatus.ts`:

```ts
// 全体の指示ファイルの有無の問い合わせ(設計書 2026-11-07 global「有無の問い合わせ」)。「無い」は、ファイルが ENOENT で、
// 作成で書く先(設定のフォルダ、無ければその親)がホームの中にあるときだけ(L-002)。例外は投げず、途中の失敗は failed にする
import { lstat, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { GlobalAgentInstructionStatus } from '@shared/types'
import { isFsError } from './fsErrors'
import {
  GlobalAgentInstructionAccessDeniedError,
  assertResolvedWithinHome
} from './globalAgentInstructionAccess'
import type { GlobalAgentInstructionLocation } from './globalAgentInstructionLocations'

type DirectoryCheck = 'inside' | 'outside' | 'missing' | 'failed'

/** フォルダを realpath してホームの中か。realpath の ENOENT は lstat で「本当に無い」と「ぶら下がったリンク」を分ける */
async function checkDirectory(homeDir: string, path: string): Promise<DirectoryCheck> {
  try {
    await assertResolvedWithinHome(homeDir, path)
    return 'inside'
  } catch (err) {
    if (err instanceof GlobalAgentInstructionAccessDeniedError) return 'outside'
    if (!isFsError(err, 'ENOENT')) return 'failed'
  }
  try {
    await lstat(path)
    // エントリはあるのに realpath できない(ぶら下がったリンク)。mkdir は EEXIST になり、作成は失敗し続ける
    return 'failed'
  } catch (err) {
    return isFsError(err, 'ENOENT') ? 'missing' : 'failed'
  }
}

async function statusOfMissingFile(
  homeDir: string,
  dirPath: string,
  displayPath: string
): Promise<GlobalAgentInstructionStatus> {
  let check = await checkDirectory(homeDir, dirPath)
  // 設定のフォルダが無いときは、作成で 1 段作る先の親を確かめる(ホームそのものなら親は見ない)
  if (check === 'missing' && dirPath !== homeDir) {
    const parent = await checkDirectory(homeDir, dirname(dirPath))
    check = parent === 'missing' ? 'failed' : parent
  }
  if (check === 'inside') return { kind: 'missing', displayPath }
  if (check === 'outside') return { kind: 'linkOutsideHome', displayPath }
  return { kind: 'failed', displayPath }
}

export async function getGlobalAgentInstructionStatus(
  location: GlobalAgentInstructionLocation,
  homeDir: string
): Promise<GlobalAgentInstructionStatus> {
  if (location.kind === 'unavailable') return { kind: 'unavailable', reason: location.reason }
  const { filePath, dirPath, displayPath } = location
  try {
    try {
      await lstat(filePath)
    } catch (err) {
      if (isFsError(err, 'ENOENT')) return await statusOfMissingFile(homeDir, dirPath, displayPath)
      throw err
    }
    let resolved: string
    try {
      resolved = await assertResolvedWithinHome(homeDir, filePath)
    } catch (err) {
      if (err instanceof GlobalAgentInstructionAccessDeniedError) {
        return { kind: 'linkOutsideHome', displayPath }
      }
      throw err
    }
    if (!(await stat(resolved)).isFile()) return { kind: 'failed', displayPath }
    return { kind: 'exists', filePath, displayPath }
  } catch (err) {
    console.error('[globalAgentInstructionStatus] failed:', err)
    return { kind: 'failed', displayPath }
  }
}
```

- [ ] **Step 4: 問い合わせのテストが通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/globalAgentInstructionStatus.test.ts`
Expected: PASS。続けて、`checkDirectory` の `lstat` の分岐を消して（`ENOENT` をすぐ `'missing'` にして）走らせ、「設定のフォルダがぶら下がったリンク → failed」が落ちることを確かめてから戻す

- [ ] **Step 5: 作成の失敗するテストを書く**

`src/main/__tests__/globalAgentInstructionFileCreator.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_GLOBAL_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { resolveGlobalAgentInstructionLocations } from '../globalAgentInstructionLocations'
import type { ResolvedGlobalAgentInstructionLocation } from '../globalAgentInstructionLocations'
import { GlobalAgentInstructionAccessDeniedError } from '../globalAgentInstructionAccess'
import {
  createGlobalAgentInstructionFile,
  toGlobalAgentInstructionCreateFailureReason
} from '../globalAgentInstructionFileCreator'

const itPosix = it.skipIf(process.platform === 'win32')
const TEMPLATE = AGENT_GLOBAL_INSTRUCTION_FILES.claude.template
let root: string
let home: string
let outside: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'global-create-')))
  home = join(root, 'home')
  outside = join(root, 'outside')
  await mkdir(home)
  await mkdir(outside)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempPath(root)
})

const claudeAt = (env: NodeJS.ProcessEnv = {}): ResolvedGlobalAgentInstructionLocation => {
  const location = resolveGlobalAgentInstructionLocations({ env, homeDir: home }).claude
  if (location.kind !== 'resolved') throw new Error('unexpected unavailable')
  return location
}

describe('createGlobalAgentInstructionFile', () => {
  itPosix('フォルダが無い → 0o700 で作ってから雛形を書く', async () => {
    await createGlobalAgentInstructionFile(claudeAt(), home)
    expect((await stat(join(home, '.claude'))).mode & 0o777).toBe(0o700)
    expect(await readFile(join(home, '.claude', 'CLAUDE.md'), 'utf-8')).toBe(TEMPLATE)
  })

  it('フォルダがある → そのまま中に書く', async () => {
    await mkdir(join(home, '.claude'))
    await createGlobalAgentInstructionFile(claudeAt(), home)
    expect(await readFile(join(home, '.claude', 'CLAUDE.md'), 'utf-8')).toBe(TEMPLATE)
  })

  it('既にある → EEXIST で中身が変わらない', async () => {
    await mkdir(join(home, '.claude'))
    await writeFile(join(home, '.claude', 'CLAUDE.md'), 'mine')
    await expect(createGlobalAgentInstructionFile(claudeAt(), home)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(join(home, '.claude', 'CLAUDE.md'), 'utf-8')).toBe('mine')
  })

  itPosix('フォルダがホームの外へのリンク → 拒否し、外に何も書かない', async () => {
    await symlink(outside, join(home, '.claude'))
    await expect(createGlobalAgentInstructionFile(claudeAt(), home)).rejects.toBeInstanceOf(
      GlobalAgentInstructionAccessDeniedError
    )
    expect(await readdir(outside)).toEqual([])
  })

  itPosix('親がホームの外へのリンク(~/link/claude) → 拒否し、外にフォルダもファイルも作らない', async () => {
    await symlink(outside, join(home, 'link'))
    await expect(
      createGlobalAgentInstructionFile(claudeAt({ CLAUDE_CONFIG_DIR: join(home, 'link', 'claude') }), home)
    ).rejects.toBeInstanceOf(GlobalAgentInstructionAccessDeniedError)
    expect(await readdir(outside)).toEqual([])
  })

  it('フォルダが同じ名前のファイル → ENOTDIR', async () => {
    await writeFile(join(home, '.claude'), 'file')
    await expect(createGlobalAgentInstructionFile(claudeAt(), home)).rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it('設定のフォルダの親が無い → 失敗し、何も作らない', async () => {
    await expect(
      createGlobalAgentInstructionFile(claudeAt({ CLAUDE_CONFIG_DIR: join(home, 'a', 'b') }), home)
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(home)).toEqual([])
  })

  it('設定のフォルダがホームそのもの → フォルダを作らずにホームの直下に書く', async () => {
    await createGlobalAgentInstructionFile(claudeAt({ CLAUDE_CONFIG_DIR: home }), home)
    expect(await readdir(home)).toEqual(['CLAUDE.md'])
  })

  itPosix('ファイル名の位置にぶら下がったリンク → 辿らずに EEXIST で、外に何も作らない', async () => {
    await mkdir(join(home, '.claude'))
    await symlink(join(outside, 'gone'), join(home, '.claude', 'CLAUDE.md'))
    await expect(createGlobalAgentInstructionFile(claudeAt(), home)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readdir(outside)).toEqual([])
  })
})

describe('toGlobalAgentInstructionCreateFailureReason', () => {
  const fsError = (code: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`${code}: /secret`), { code })

  it.each([
    [new GlobalAgentInstructionAccessDeniedError(), 'outside'],
    [fsError('EEXIST'), 'exists'],
    [fsError('ENOTDIR'), 'exists'],
    [fsError('EACCES'), 'failed'],
    [fsError('ENOENT'), 'failed'],
    [new Error('other'), 'failed']
  ])('%s → %s', (err, reason) => {
    expect(toGlobalAgentInstructionCreateFailureReason(err)).toBe(reason)
  })
})
```

「作ったフォルダは後の失敗でも消さない」(L-004)は、`createFileContent` を失敗させる必要があるので、`vi.mock` を使う別のファイル `src/main/__tests__/globalAgentInstructionFileCreator.cleanup.test.ts` に書く(上のファイルは実物の書き込みを使うため分ける):

```ts
import { mkdir, mkdtemp, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateFileContent = vi.hoisted(() => vi.fn())
vi.mock('../fileSystem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fileSystem')>()
  return { ...actual, createFileContent: mockCreateFileContent }
})

import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { resolveGlobalAgentInstructionLocations } from '../globalAgentInstructionLocations'
import { createGlobalAgentInstructionFile } from '../globalAgentInstructionFileCreator'

let root: string
let home: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'global-create-cleanup-')))
  home = join(root, 'home')
  await mkdir(home)
})

afterEach(async () => {
  vi.resetAllMocks()
  await removeTempPath(root)
})

describe('createGlobalAgentInstructionFile(後始末)', () => {
  it.skipIf(process.platform === 'win32')(
    '.claude が無い状態から始めてファイルの書き込みが失敗 → 作った .claude は 0o700 のフォルダとして残る(L-004)',
    async () => {
      mockCreateFileContent.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
      const location = resolveGlobalAgentInstructionLocations({ env: {}, homeDir: home }).claude
      if (location.kind !== 'resolved') throw new Error('unexpected unavailable')
      await expect(createGlobalAgentInstructionFile(location, home)).rejects.toMatchObject({ code: 'EACCES' })
      const dir = await stat(join(home, '.claude'))
      expect(dir.isDirectory()).toBe(true)
      expect(dir.mode & 0o777).toBe(0o700)
      expect(mockCreateFileContent).toHaveBeenCalledTimes(1)
    }
  )
})
```

- [ ] **Step 6: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/globalAgentInstructionFileCreator.test.ts src/main/__tests__/globalAgentInstructionFileCreator.cleanup.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 7: 作成を実装する**

`src/main/globalAgentInstructionFileCreator.ts`:

```ts
// 全体の指示ファイルの作成(設計書 2026-11-07 global「作成」)。途中の失敗は投げ、受け口が理由に変える。
// フォルダを作る前に親を確かめ、確かめた親の直下にだけ作る(字面の dirPath には作らない。L-018)。
// 作ったフォルダは、後の失敗でも消さない(L-004)
import { mkdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { GlobalAgentInstructionCreateFailureReason } from '@shared/types'
import { createFileContent } from './fileSystem'
import { isFsError } from './fsErrors'
import {
  GlobalAgentInstructionAccessDeniedError,
  assertResolvedWithinHome
} from './globalAgentInstructionAccess'
import type { ResolvedGlobalAgentInstructionLocation } from './globalAgentInstructionLocations'

export async function createGlobalAgentInstructionFile(
  location: ResolvedGlobalAgentInstructionLocation,
  homeDir: string
): Promise<void> {
  const { dirPath, file } = location
  let dirToCheck = dirPath
  if (dirPath !== homeDir) {
    // 2. 親を確かめる(~/link がホームの外へのリンクなら、ここで拒否して何も作らない)。親が無ければ realpath の失敗を投げる
    const resolvedParent = await assertResolvedWithinHome(homeDir, dirname(dirPath))
    dirToCheck = join(resolvedParent, basename(dirPath))
    // 3. 確かめた親の直下に 1 段だけ作る。既にあれば(リンクを含む)4 で確かめる
    try {
      await mkdir(dirToCheck, { mode: 0o700 })
    } catch (err) {
      if (!isFsError(err, 'EEXIST')) throw err
    }
  }
  // 4. フォルダ自体を確かめる(ホームそのもののときは dirPath を確かめる)
  const resolvedDir = await assertResolvedWithinHome(homeDir, dirToCheck)
  if (!(await stat(resolvedDir)).isDirectory()) {
    throw Object.assign(new Error('ENOTDIR: not a directory'), { code: 'ENOTDIR' })
  }
  // 5. 排他的に作る。既にあれば EEXIST、ぶら下がったリンクも辿らない
  await createFileContent(join(resolvedDir, file.fileName), file.template)
}

export function toGlobalAgentInstructionCreateFailureReason(
  err: unknown
): Exclude<GlobalAgentInstructionCreateFailureReason, 'unavailable'> {
  if (err instanceof GlobalAgentInstructionAccessDeniedError) return 'outside'
  if (isFsError(err, 'EEXIST') || isFsError(err, 'ENOTDIR')) return 'exists'
  return 'failed'
}
```

- [ ] **Step 8: 通ることと、守りを外すと落ちることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/globalAgentInstructionFileCreator.test.ts src/main/__tests__/globalAgentInstructionFileCreator.cleanup.test.ts`
Expected: PASS。続けて、手順 2 の `assertResolvedWithinHome(homeDir, dirname(dirPath))` を消して `dirToCheck = dirPath` にし、`mkdir` を先に行う形に一時的に変えて走らせ、「親がホームの外へのリンク」のテストが落ちる（`outside` に `claude` が作られる）ことを確かめてから戻す

- [ ] **Step 9: lint と型**

Run: `npx eslint src/main/globalAgentInstructionStatus.ts src/main/globalAgentInstructionFileCreator.ts src/main/__tests__/globalAgentInstructionStatus.test.ts src/main/__tests__/globalAgentInstructionFileCreator.test.ts src/main/__tests__/globalAgentInstructionFileCreator.cleanup.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 5: 入口の振り分けと照合付きの保存（main）

設計書: 3 章「入口の振り分け」・「照合付きの保存」。

**Files:**
- Create: `src/main/fileAccessScope.ts`
- Modify: `src/main/checkedFileWrite.ts`（`CheckedFileWriteRequest` と `writeFileChecked` の冒頭）
- Test: `src/main/__tests__/fileAccessScope.test.ts`
- Test: `src/main/__tests__/checkedFileWrite.test.ts`（`write` の補助を直し、全体の scope のテストを足す）

**Interfaces:**
- Consumes: `GlobalAgentInstructionContext`（Task 2）、`matchGlobalAgentInstructionPath`・`assertResolvedWithinHome`・`GlobalAgentInstructionAccessDeniedError`（Task 3）、既存の `FolderAccessManager`・`assertFileWithinFolder`（`src/main/fileWithinFolder.ts`）・`convertFsAccessError`・`isMissingPathError`
- Produces:
  - `interface FileAccessScope { assertExisting(path: string): Promise<void>; assertRecreatable(path: string): Promise<void>; toRendererError(err: unknown, operation: 'read' | 'write'): unknown }`
  - `interface FileAccessScopeDeps { folderAccess: FolderAccessManager; globalInstructions: GlobalAgentInstructionContext }`
  - `function resolveFileAccessScope(deps: FileAccessScopeDeps, ownerId: number, filePath: string): FileAccessScope`
  - `const GLOBAL_INSTRUCTION_ACCESS_MESSAGES: { denied: string; missing: string; read: string; write: string }`
  - `CheckedFileWriteRequest` が `{ scope: Pick<FileAccessScope, 'assertExisting' | 'assertRecreatable'>; filePath; content; baseContent }` になる（`folderAccess`・`allowedFolder` を消す）

- [ ] **Step 1: 振り分けの失敗するテストを書く**

`src/main/__tests__/fileAccessScope.test.ts`（実ファイル）:

```ts
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { FolderAccessManager } from '../folderAccessManager'
import { resolveGlobalAgentInstructionContext } from '../globalAgentInstructionLocations'
import { GlobalAgentInstructionAccessDeniedError } from '../globalAgentInstructionAccess'
import { GLOBAL_INSTRUCTION_ACCESS_MESSAGES, resolveFileAccessScope } from '../fileAccessScope'
import type { FileAccessScopeDeps } from '../fileAccessScope'

const itPosix = it.skipIf(process.platform === 'win32')
let root: string
let home: string
let project: string
let deps: FileAccessScopeDeps
let globalFile: string

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  root = await realpath(await mkdtemp(join(tmpdir(), 'file-access-scope-')))
  home = join(root, 'home')
  project = join(root, 'project')
  await mkdir(join(home, '.claude'), { recursive: true })
  await mkdir(project)
  globalFile = join(home, '.claude', 'CLAUDE.md')
  await writeFile(globalFile, 'x')
  await writeFile(join(project, 'a.md'), 'a')
  deps = {
    folderAccess: new FolderAccessManager(),
    globalInstructions: resolveGlobalAgentInstructionContext({ env: {}, homeDir: home })
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempPath(root)
})

describe('resolveFileAccessScope', () => {
  it('全体の指示ファイル → フォルダを開いていなくても通る', async () => {
    await expect(resolveFileAccessScope(deps, 1, globalFile).assertExisting(globalFile)).resolves.toBeUndefined()
  })

  it('全体の指示ファイルが消えた → assertRecreatable は親(~/.claude)で通る', async () => {
    const missing = join(home, '.copilot', 'copilot-instructions.md')
    await mkdir(join(home, '.copilot'))
    await expect(resolveFileAccessScope(deps, 1, missing).assertRecreatable(missing)).resolves.toBeUndefined()
  })

  it('ほかのパス → 許可フォルダの規則(フォルダの中は通る・外は断る)', async () => {
    deps.folderAccess.set(1, project)
    const inside = join(project, 'a.md')
    await expect(resolveFileAccessScope(deps, 1, inside).assertExisting(inside)).resolves.toBeUndefined()
    const other = join(home, 'other.md')
    await writeFile(other, 'o')
    await expect(resolveFileAccessScope(deps, 1, other).assertExisting(other)).rejects.toThrow('Access denied')
  })

  it('ほかのパスでフォルダが無い → No folder open', async () => {
    const inside = join(project, 'a.md')
    await expect(resolveFileAccessScope(deps, 1, inside).assertExisting(inside)).rejects.toThrow('No folder open')
  })

  it('許可フォルダの scope → 作った時点のフォルダで 2 つの検査をする(後の切り替えに追従しない)', async () => {
    deps.folderAccess.set(1, project)
    const inside = join(project, 'a.md')
    const scope = resolveFileAccessScope(deps, 1, inside)
    deps.folderAccess.set(1, home)
    await expect(scope.assertExisting(inside)).resolves.toBeUndefined()
    await expect(scope.assertRecreatable(inside)).resolves.toBeUndefined()
  })

  itPosix('全体の指示ファイルがホームの外へのリンク → 拒否', async () => {
    const outside = join(root, 'outside.md')
    await writeFile(outside, 's')
    const copilotFile = join(home, '.copilot', 'copilot-instructions.md')
    await mkdir(join(home, '.copilot'))
    await symlink(outside, copilotFile)
    await expect(resolveFileAccessScope(deps, 1, copilotFile).assertExisting(copilotFile)).rejects.toBeInstanceOf(
      GlobalAgentInstructionAccessDeniedError
    )
  })

  it.each([
    ['拒否', new GlobalAgentInstructionAccessDeniedError(), 'read', GLOBAL_INSTRUCTION_ACCESS_MESSAGES.denied],
    ['ENOENT', Object.assign(new Error(`ENOENT: ${'/secret/path'}`), { code: 'ENOENT' }), 'read', GLOBAL_INSTRUCTION_ACCESS_MESSAGES.missing],
    ['EACCES の読み込み', Object.assign(new Error('EACCES: /secret/path'), { code: 'EACCES' }), 'read', GLOBAL_INSTRUCTION_ACCESS_MESSAGES.read],
    ['EACCES の保存', Object.assign(new Error('EACCES: /secret/path'), { code: 'EACCES' }), 'write', GLOBAL_INSTRUCTION_ACCESS_MESSAGES.write]
  ] as const)('全体の指示ファイルの失敗(%s) → パスを含まない固定の文言', (_label, err, operation, message) => {
    const converted = resolveFileAccessScope(deps, 1, globalFile).toRendererError(err, operation)
    expect(converted).toBeInstanceOf(Error)
    expect((converted as Error).message).toBe(message)
    expect((converted as Error).message).not.toContain('/')
  })

  it('フォルダのファイルの失敗 → 今と同じ文言(パスを含む)', () => {
    deps.folderAccess.set(1, project)
    const inside = join(project, 'a.md')
    const converted = resolveFileAccessScope(deps, 1, inside).toRendererError(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      'read'
    )
    expect((converted as Error).message).toBe(`ファイルが見つかりません: ${inside}`)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/fileAccessScope.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 振り分けを実装する**

`src/main/fileAccessScope.ts`:

```ts
// 読む・保存する・監視するの入口(fs:readFile・fs:writeFile・fs:writeFileChecked・fs:setWatchedFiles)の規則の振り分け
// (設計書 2026-11-07 global「入口の振り分け」)。拒否の判定を入口ごとに写さず、ここだけで決める(L-061)。
// 全体の指示ファイル(main が作ったパスと完全一致)はホームの中かで確かめ、それ以外は今の許可フォルダの規則のまま
import { dirname } from 'node:path'
import type { FolderAccessManager } from './folderAccessManager'
import { assertFileWithinFolder } from './fileWithinFolder'
import { convertFsAccessError } from './fsErrorConverter'
import { isMissingPathError } from './fsErrors'
import {
  GlobalAgentInstructionAccessDeniedError,
  assertResolvedWithinHome,
  matchGlobalAgentInstructionPath
} from './globalAgentInstructionAccess'
import type { GlobalAgentInstructionContext } from './globalAgentInstructionLocations'

export interface FileAccessScope {
  /** realpath して、許す範囲の中にある既存のファイルか。違えば・解決できなければ投げる */
  assertExisting(path: string): Promise<void>
  /** realpath できなかったファイル(削除された・ぶら下がったリンク)を wx で作り直してよいか。親で確かめる */
  assertRecreatable(path: string): Promise<void>
  /** 入口の失敗を renderer へ返す例外に変える(全体の指示ファイルはパスを含まない固定の文言。L-017) */
  toRendererError(err: unknown, operation: 'read' | 'write'): unknown
}

export interface FileAccessScopeDeps {
  folderAccess: FolderAccessManager
  globalInstructions: GlobalAgentInstructionContext
}

export const GLOBAL_INSTRUCTION_ACCESS_MESSAGES = {
  denied: '全体の指示ファイルはホームフォルダの外を指しているため、開けません',
  missing: '全体の指示ファイルが見つかりません',
  read: '全体の指示ファイルを読み込めませんでした',
  write: '全体の指示ファイルを保存できませんでした'
} as const

export function resolveFileAccessScope(
  { folderAccess, globalInstructions }: FileAccessScopeDeps,
  ownerId: number,
  filePath: string
): FileAccessScope {
  const { locations, homeDir } = globalInstructions
  if (matchGlobalAgentInstructionPath(locations, filePath) !== null) {
    return {
      assertExisting: async (path) => {
        await assertResolvedWithinHome(homeDir, path)
      },
      // 親が無ければ(~/.claude が消えた)realpath の失敗を投げる。フォルダは作らない(作るのは節の 作成 だけ)
      assertRecreatable: async (path) => {
        await assertResolvedWithinHome(homeDir, dirname(path))
      },
      toRendererError: (err, operation) => {
        console.error('[fileAccessScope] global instruction file access failed:', err)
        if (err instanceof GlobalAgentInstructionAccessDeniedError) {
          return new Error(GLOBAL_INSTRUCTION_ACCESS_MESSAGES.denied)
        }
        if (isMissingPathError(err)) return new Error(GLOBAL_INSTRUCTION_ACCESS_MESSAGES.missing)
        return new Error(GLOBAL_INSTRUCTION_ACCESS_MESSAGES[operation])
      }
    }
  }
  // 作った時点のフォルダを控え、2 つの検査で同じ値を使う(間の切り替えで別のフォルダで確かめない)
  const allowedFolder = folderAccess.get(ownerId)
  const requireFolder = (): string => {
    if (allowedFolder === undefined) throw new Error('No folder open')
    return allowedFolder
  }
  return {
    assertExisting: async (path) => folderAccess.assertWithinFolder(requireFolder(), path),
    assertRecreatable: async (path) => assertFileWithinFolder(folderAccess, requireFolder(), path),
    toRendererError: (err) =>
      convertFsAccessError(err, `ファイルが見つかりません: ${filePath}`, filePath)
  }
}
```

- [ ] **Step 4: 振り分けのテストが通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/fileAccessScope.test.ts`
Expected: PASS

- [ ] **Step 5: 照合付きの保存のテストを直し、全体の scope のテストを足す**

`src/main/__tests__/checkedFileWrite.test.ts` の `write` の補助を、scope を渡す形に変える（`FolderAccessManager` と `/work` の振る舞いは今のまま）:

```ts
import { assertFileWithinFolder } from '../fileWithinFolder'
import type { FileAccessScope } from '../fileAccessScope'

const folderScope = (): Pick<FileAccessScope, 'assertExisting' | 'assertRecreatable'> => ({
  assertExisting: (path) => folderAccess.assertWithinFolder('/work', path),
  assertRecreatable: (path) => assertFileWithinFolder(folderAccess, '/work', path)
})

const write = (
  baseContent: string | null,
  filePath = '/work/a.ts'
): ReturnType<typeof writeFileChecked> =>
  writeFileChecked({ scope: folderScope(), filePath, content: 'new', baseContent }, io)
```

ファイルの中で `folderAccess,` と `allowedFolder: '/work'` を直接渡している呼び出しがほかにあれば、すべて `scope: folderScope()` に置き換える（`grep -n "allowedFolder" src/main/__tests__/checkedFileWrite.test.ts` が 0 件になるまで）。

全体の scope のテストは、モックの realpath を使わない実ファイルの別ファイル `src/main/__tests__/checkedFileWrite.global.test.ts` に書く（`checkedFileWrite.test.ts` は `node:fs/promises` をモックしているため）:

```ts
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { FolderAccessManager } from '../folderAccessManager'
import { resolveGlobalAgentInstructionContext } from '../globalAgentInstructionLocations'
import { resolveFileAccessScope } from '../fileAccessScope'
import { writeFileChecked } from '../checkedFileWrite'

const describePosix = describe.skipIf(process.platform === 'win32')
let root: string
let home: string
let globalFile: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'checked-write-global-')))
  home = join(root, 'home')
  await mkdir(join(home, '.claude'), { recursive: true })
  globalFile = join(home, '.claude', 'CLAUDE.md')
})

afterEach(async () => {
  await removeTempPath(root)
})

const scopeFor = (path: string): ReturnType<typeof resolveFileAccessScope> =>
  resolveFileAccessScope(
    {
      folderAccess: new FolderAccessManager(),
      globalInstructions: resolveGlobalAgentInstructionContext({ env: {}, homeDir: home })
    },
    1,
    path
  )

describePosix('writeFileChecked(全体の指示ファイル)', () => {
  it('ホームの中のリンク → リンク先を書き換え、リンクは残る', async () => {
    await writeFile(join(home, 'real.md'), 'old')
    await symlink(join(home, 'real.md'), globalFile)
    await expect(
      writeFileChecked({ scope: scopeFor(globalFile), filePath: globalFile, content: 'new', baseContent: 'old' })
    ).resolves.toEqual({ kind: 'written' })
    expect(await readFile(join(home, 'real.md'), 'utf-8')).toBe('new')
    expect((await lstat(globalFile)).isSymbolicLink()).toBe(true)
    expect(await readlink(globalFile)).toBe(join(home, 'real.md'))
  })

  it('消えたファイル → wx で作り直す', async () => {
    await expect(
      writeFileChecked({ scope: scopeFor(globalFile), filePath: globalFile, content: 'new', baseContent: null })
    ).resolves.toEqual({ kind: 'written' })
    expect(await readFile(globalFile, 'utf-8')).toBe('new')
  })

  it('ホームの外を指すぶら下がったリンク → 辿らずに modified', async () => {
    const outside = join(root, 'outside.md')
    await symlink(outside, globalFile)
    await expect(
      writeFileChecked({ scope: scopeFor(globalFile), filePath: globalFile, content: 'new', baseContent: null })
    ).resolves.toEqual({ kind: 'conflict', reason: 'modified' })
    await expect(lstat(outside)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
```

- [ ] **Step 6: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/checkedFileWrite.test.ts src/main/__tests__/checkedFileWrite.global.test.ts`
Expected: FAIL（`writeFileChecked` が `scope` を受け取らない。型エラーか `folderAccess` が undefined）

- [ ] **Step 7: 照合付きの保存を scope に変える**

`src/main/checkedFileWrite.ts`:

```ts
import type { FileAccessScope } from './fileAccessScope'
```

を足し、`import type { FolderAccessManager } from './folderAccessManager'` と `import { assertFileWithinFolder } from './fileWithinFolder'` を消す。`CheckedFileWriteRequest` と `writeFileChecked` の冒頭を次にする（照合と書き込みの部分は変えない）:

```ts
export interface CheckedFileWriteRequest {
  /** 許可の確認(許可フォルダか全体の指示ファイルか。fileAccessScope.ts の resolveFileAccessScope が決める) */
  scope: Pick<FileAccessScope, 'assertExisting' | 'assertRecreatable'>
  filePath: string
  content: string
  /** タブが最後にディスクと一致した内容(savedContent)。null は照合せずに書く(上書きの確認で OK の後) */
  baseContent: string | null
}

export async function writeFileChecked(
  { scope, filePath, content, baseContent }: CheckedFileWriteRequest,
  io: CheckedFileWriteIo = defaultIo
): Promise<WriteFileCheckedResult> {
  // 対象を realpath で解決できたか。できなかった(削除された・ぶら下がったシンボリックリンク)ときは、許可の確認を
  // 親フォルダへ倒し(削除されたファイルを作り直せるよう)、書き込みは排他的作成にする(リンクを辿って範囲の外へ
  // 作らない。照合と書き込みの間にファイルが復活した場合も上書きせず modified として返す)
  let resolved = true
  try {
    await scope.assertExisting(filePath)
  } catch (err) {
    if (!isMissingPathError(err)) throw err
    resolved = false
    await scope.assertRecreatable(filePath)
  }
```

（以下は今のまま）。このファイルの先頭のコメントの「(fs:writeFileChecked。型の検証とエラーの変換)」の説明は、変換を scope が持つようになるので「(fs:writeFileChecked。型の検証と scope の選択)」に直す。

- [ ] **Step 8: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/checkedFileWrite.test.ts src/main/__tests__/checkedFileWrite.global.test.ts src/main/__tests__/fileAccessScope.test.ts`
Expected: PASS（`externalChangeHandlers.ts` は次のタスクで直すので、`npm run typecheck` はこの時点では落ちてよい。次のタスクの終わりで通す）

- [ ] **Step 9: lint**

Run: `npx eslint src/main/fileAccessScope.ts src/main/checkedFileWrite.ts src/main/__tests__/fileAccessScope.test.ts src/main/__tests__/checkedFileWrite.test.ts src/main/__tests__/checkedFileWrite.global.test.ts --max-warnings 0`
Expected: エラー無し

---

### Task 6: 4 つの入口と起動時の配線（main）

設計書: 3 章「入口ごとの扱い（L-061 の表）」・「監視の登録」、2 章「全体の指示ファイルの許可は、フォルダを開いているかに依らない」。

**Files:**
- Modify: `src/main/handlers/fileSystemHandlers.ts`（`registerFileSystemHandlers` の引数・`fs:readFile`・`fs:writeFile`）
- Modify: `src/main/handlers/externalChangeHandlers.ts`（`registerExternalChangeHandlers` の引数・`fs:writeFileChecked`・`fs:setWatchedFiles`）
- Modify: `src/main/ipcHandlers.ts`（場所を決めて渡す）
- Test: `src/main/__tests__/handlers/fileSystemHandlers.test.ts`・`externalChangeHandlers.test.ts`・`externalChangeHandlers.fs.test.ts`・`src/main/__tests__/ipcHandlers.test.ts`
- Test（新規）: `src/main/__tests__/handlers/globalInstructionEntrances.fs.test.ts`

**Interfaces:**
- Consumes: `resolveFileAccessScope`・`FileAccessScopeDeps`（Task 5）、`GlobalAgentInstructionContext`・`resolveGlobalAgentInstructionContext`（Task 2）、`NO_GLOBAL_INSTRUCTIONS`（Task 2 のテストの補助）
- Produces:
  - `registerFileSystemHandlers(ipcMain: IpcMain, folderAccess: FolderAccessManager, globalInstructions: GlobalAgentInstructionContext): void`
  - `registerExternalChangeHandlers(ipcMain: IpcMain, folderAccess: FolderAccessManager, watcher: OpenFileWatcher, globalInstructions: GlobalAgentInstructionContext): void`
  - `ipcHandlers.ts` の中の `const globalInstructions = resolveGlobalAgentInstructionContext({ env: process.env, homeDir: homedir() })`（Task 7 の `registerAgentInstructionsHandlers` も同じ値を受け取る）

- [ ] **Step 1: 入口の失敗するテストを書く**

`src/main/__tests__/handlers/globalInstructionEntrances.fs.test.ts`（実ファイル。Electron は `webContents` だけを差し替える）:

```ts
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ webContents: { fromId: vi.fn() }, BrowserWindow: { fromWebContents: vi.fn() } }))

import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { FolderAccessManager } from '../../folderAccessManager'
import { OpenFileWatcher } from '../../openFileWatcher'
import { resolveGlobalAgentInstructionContext } from '../../globalAgentInstructionLocations'
import { registerFileSystemHandlers } from '../../handlers/fileSystemHandlers'
import { registerExternalChangeHandlers } from '../../handlers/externalChangeHandlers'

type Listener = (...args: unknown[]) => Promise<unknown>
const handles = new Map<string, Listener>()
const ipcMain = { handle: (channel: string, listener: Listener) => handles.set(channel, listener) }
const event = { sender: { id: 1 } }
const call = (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handles.get(channel)
  if (handler === undefined) throw new Error(`not registered: ${channel}`)
  return handler(event, ...args)
}

let root: string
let home: string
let project: string
let globalFile: string
let folderAccess: FolderAccessManager
let watcher: OpenFileWatcher

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  handles.clear()
  root = await realpath(await mkdtemp(join(tmpdir(), 'global-entrances-')))
  home = join(root, 'home')
  project = join(root, 'project')
  await mkdir(join(home, '.claude'), { recursive: true })
  await mkdir(project)
  globalFile = join(home, '.claude', 'CLAUDE.md')
  await writeFile(globalFile, 'g')
  folderAccess = new FolderAccessManager()
  watcher = new OpenFileWatcher({ watch: vi.fn(() => ({ close: vi.fn(), on: vi.fn() })), notify: vi.fn() })
  const globalInstructions = resolveGlobalAgentInstructionContext({ env: {}, homeDir: home })
  registerFileSystemHandlers(ipcMain as never, folderAccess, globalInstructions)
  registerExternalChangeHandlers(ipcMain as never, folderAccess, watcher, globalInstructions)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempPath(root)
})

describe('全体の指示ファイルの入口', () => {
  it('fs:readFile → フォルダを開いていなくても読める', async () => {
    await expect(call('fs:readFile', globalFile)).resolves.toBe('g')
  })

  it('fs:readFile → フォルダの外のほかのパスは今までどおり断る', async () => {
    folderAccess.set(1, project)
    const other = join(home, 'other.md')
    await writeFile(other, 'o')
    await expect(call('fs:readFile', other)).rejects.toThrow('Access denied')
  })

  it('fs:readFile → 消えた全体の指示ファイルは、パスを含まない文言で拒否', async () => {
    const missing = join(home, '.copilot', 'copilot-instructions.md')
    await expect(call('fs:readFile', missing)).rejects.toThrow('全体の指示ファイルが見つかりません')
    await expect(call('fs:readFile', missing)).rejects.not.toThrow(root)
  })

  it('fs:writeFile → 全体の指示ファイルに書ける', async () => {
    await call('fs:writeFile', globalFile, 'w')
    expect(await readFile(globalFile, 'utf-8')).toBe('w')
  })

  it('fs:writeFileChecked → 照合して書ける', async () => {
    await expect(call('fs:writeFileChecked', globalFile, 'c', 'g')).resolves.toEqual({ kind: 'written' })
    expect(await readFile(globalFile, 'utf-8')).toBe('c')
  })

  it('fs:setWatchedFiles → フォルダが無くても全体の指示ファイルだけを監視し、ほかのパスを除く', async () => {
    const setWatched = vi.spyOn(watcher, 'setWatchedFiles')
    const other = join(project, 'a.md')
    await writeFile(other, 'a')
    await call('fs:setWatchedFiles', [globalFile, other])
    expect(setWatched).toHaveBeenCalledWith(1, [globalFile])
  })

  it('fs:setWatchedFiles → フォルダを開いていれば、フォルダの中と全体の指示ファイルの両方を監視する', async () => {
    folderAccess.set(1, project)
    const setWatched = vi.spyOn(watcher, 'setWatchedFiles')
    const inside = join(project, 'a.md')
    await writeFile(inside, 'a')
    await call('fs:setWatchedFiles', [globalFile, inside])
    expect(setWatched).toHaveBeenCalledWith(1, [globalFile, inside])
  })

  it('fs:renameEntry・fs:deleteEntry → 全体の指示ファイルは断る(変えない入口)', async () => {
    folderAccess.set(1, project)
    await expect(call('fs:renameEntry', globalFile, 'x.md')).rejects.toThrow()
    await expect(call('fs:deleteEntry', globalFile)).rejects.toThrow()
    expect(await readFile(globalFile, 'utf-8')).toBe('g')
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/handlers/globalInstructionEntrances.fs.test.ts`
Expected: FAIL（`fs:readFile` が `No folder open`・`Access denied` で拒否する）

- [ ] **Step 3: `fs:readFile`・`fs:writeFile` を scope に通す**

`src/main/handlers/fileSystemHandlers.ts`:

```ts
import type { GlobalAgentInstructionContext } from '../globalAgentInstructionLocations'
import { resolveFileAccessScope } from '../fileAccessScope'
```

を足す。`registerFileSystemHandlers` の引数に `globalInstructions: GlobalAgentInstructionContext` を足し（3 つ目。省略できない）、関数の先頭で `const scopeDeps = { folderAccess, globalInstructions }` を作る。`fs:readFile`・`fs:writeFile` を次にする:

```ts
  ipcMain.handle('fs:readFile', async (event: IpcMainInvokeEvent, filePath: string) => {
    const scope = resolveFileAccessScope(scopeDeps, event.sender.id, filePath)
    try {
      await scope.assertExisting(filePath)
      return await readFileContent(filePath)
    } catch (err) {
      throw scope.toRendererError(err, 'read')
    }
  })

  ipcMain.handle(
    'fs:writeFile',
    async (event: IpcMainInvokeEvent, filePath: string, content: string) => {
      const scope = resolveFileAccessScope(scopeDeps, event.sender.id, filePath)
      try {
        await scope.assertExisting(filePath)
        return await writeFileContent(filePath, content)
      } catch (err) {
        throw scope.toRendererError(err, 'write')
      }
    }
  )
```

`assertFileAccess` の import がほかで使われていなければ消す（`grep -n assertFileAccess src/main/handlers/fileSystemHandlers.ts`）。`fs:createFile` など、ほかの受け口は変えない。

- [ ] **Step 4: `fs:writeFileChecked`・`fs:setWatchedFiles` を scope に通す**

`src/main/handlers/externalChangeHandlers.ts`: `getAllowedFolder`・`convertFsAccessError` の import を消し、

```ts
import type { GlobalAgentInstructionContext } from '../globalAgentInstructionLocations'
import { resolveFileAccessScope } from '../fileAccessScope'
```

を足す。`registerExternalChangeHandlers` の 4 つ目の引数に `globalInstructions: GlobalAgentInstructionContext` を足し、先頭で `const scopeDeps = { folderAccess, globalInstructions }` を作る。

`fs:writeFileChecked` の型の検証の後を次にする:

```ts
      const scope = resolveFileAccessScope(scopeDeps, event.sender.id, filePath)
      try {
        return await writeFileChecked({ scope, filePath, content, baseContent })
      } catch (err) {
        throw scope.toRendererError(err, 'write')
      }
```

`fs:setWatchedFiles` の件数の検証の後を次にする:

```ts
      const ownerId = event.sender.id
      // 全体の指示ファイルはフォルダに依らずに監視する。フォルダの中のパスは、フォルダが無ければ scope が断る
      const folderAtStart = folderAccess.get(ownerId)
      // 呼び出しが重なったとき(タブの一覧は変わるたびに送られる)、後から出た呼び出しや、検証の間の clear
      // (リロード・フォルダの切り替え・破棄)より古い呼び出しの一覧を反映しない
      const generation = watcher.beginUpdate(ownerId)
      const valid: string[] = []
      for (const path of paths) {
        if (
          typeof path !== 'string' ||
          path.length > MAX_WATCHED_PATH_LENGTH ||
          !isAbsolute(path)
        ) {
          continue
        }
        try {
          await resolveFileAccessScope(scopeDeps, ownerId, path).assertExisting(path)
          valid.push(path)
        } catch {
          // 範囲外・存在しない
        }
        // await の後ごとに確かめる(後の呼び出しや clear があれば、残りの検証もせずに打ち切る)
        if (!watcher.isCurrentUpdate(ownerId, generation)) return
      }
      // 検証の間にフォルダが切り替わっていたら、古いフォルダのパスで監視を張らない
      if (folderAccess.get(ownerId) !== folderAtStart) return
      // フォルダが無く、監視するものも無ければ、今までどおり監視を消す
      if (folderAtStart === undefined && valid.length === 0) {
        watcher.clear(ownerId)
        return
      }
      watcher.setWatchedFiles(ownerId, valid)
```

- [ ] **Step 5: 起動時に場所を決めて渡す**

`src/main/ipcHandlers.ts`: `import { homedir, tmpdir } from 'node:os'`（今の `tmpdir` の import に `homedir` を足す）と `import { resolveGlobalAgentInstructionContext } from './globalAgentInstructionLocations'` を足し、`registerIpcHandlers` の `const folderAccess = new FolderAccessManager()` の直後に置く:

```ts
  // 全体の指示ファイルの場所は起動時の process.env で 1 回だけ決める(CLI の起動のたびに作る環境と同じ値。設計書 2026-11-07 global)
  const globalInstructions = resolveGlobalAgentInstructionContext({
    env: process.env,
    homeDir: homedir()
  })
```

`registerFileSystemHandlers(ipcMain, folderAccess, globalInstructions)`、`registerExternalChangeHandlers(ipcMain, folderAccess, openFileWatcher, globalInstructions)` にする（`registerAgentInstructionsHandlers` は Task 7 で直す）。

- [ ] **Step 6: 既存のテストの呼び出しを直す**

- `src/main/__tests__/handlers/fileSystemHandlers.test.ts`: `registerFileSystemHandlers(mockIpcMain, folderAccess)` をすべて `registerFileSystemHandlers(mockIpcMain, folderAccess, NO_GLOBAL_INSTRUCTIONS)` にする（`import { NO_GLOBAL_INSTRUCTIONS } from '../helpers/globalAgentInstructionContext'`）
- `externalChangeHandlers.test.ts`・`externalChangeHandlers.fs.test.ts`: `registerExternalChangeHandlers(ipcMain as never, folderAccess, watcher)` を `…, watcher, NO_GLOBAL_INSTRUCTIONS)` にする
- `externalChangeHandlers.test.ts` で「フォルダが無いと clear」を確かめているテストは、パスがフォルダの中のものだけなら今の期待のまま通る。通らなければ、上の Step 4 の「監視するものも無ければ clear」の分岐を確かめる
- `src/main/__tests__/ipcHandlers.test.ts`:
  - `registerFileSystemHandlers を ipcMain と FolderAccessManager を引数に呼び出す`: 3 つ目の引数が `{ locations, homeDir }` の形で、`homeDir` が `homedir()`（`import { homedir } from 'node:os'`。このテストのファイルは `node:os` をモックしていない）と等しいことを足す。名前は「…と FolderAccessManager と全体の指示ファイルの文脈を引数に呼び出す」に直す

```ts
    const globalInstructions = mockRegisterFileSystemHandlers.mock.calls[0][2]
    expect(globalInstructions).toEqual(
      expect.objectContaining({ locations: expect.anything(), homeDir: homedir() })
    )
```

  - `外部変更の IPC と監視の寿命に、同じ FolderAccessManager と同じ OpenFileWatcher を渡す`（595〜605 行付近）: `registerExternalChangeHandlers` の期待を、4 つ目の引数まで比べる形にする。4 つ目は `mockRegisterFileSystemHandlers.mock.calls[0][2]` と `toBe` で同じものか比べる（別の値を作って渡す配線の漏れを見つけるため。L-060）。名前は「…同じ OpenFileWatcher と、同じ全体の指示ファイルの文脈を渡す」に直す

```ts
    const globalInstructions = mockRegisterFileSystemHandlers.mock.calls[0][2]
    const [ipc, externalFolderAccess, externalWatcher, externalGlobal] =
      mockRegisterExternalChangeHandlers.mock.calls[0]
    expect(ipc).toBe(mockIpcMain)
    expect(externalFolderAccess).toBe(folderAccess)
    expect(externalWatcher).toBe(watcher)
    expect(externalGlobal).toBe(globalInstructions)
```
- 置き換えの漏れが無いことを確かめる: `grep -rn "registerFileSystemHandlers(\|registerExternalChangeHandlers(" src/main | grep -v "NO_GLOBAL_INSTRUCTIONS\|globalInstructions"` が、定義の行のほかに 0 件

- [ ] **Step 7: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main`
Expected: PASS

- [ ] **Step 8: lint と型**

Run: `npx eslint src/main/handlers/fileSystemHandlers.ts src/main/handlers/externalChangeHandlers.ts src/main/ipcHandlers.ts src/main/__tests__/handlers src/main/__tests__/ipcHandlers.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 7: 問い合わせと作成の IPC・preload

設計書: 3 章「有無の問い合わせ（IPC）」・「作成（IPC）」・「preload と renderer の API」。

**Files:**
- Modify: `src/main/handlers/agentInstructionsHandlers.ts`
- Modify: `src/main/ipcHandlers.ts`（`registerAgentInstructionsHandlers` に `globalInstructions` を渡す）
- Modify: `src/preload/api.ts`・`src/preload/index.d.ts`
- Modify: `src/renderer/src/lib/agentInstructionsApi.ts`・`src/renderer/src/__tests__/setup.ts`
- Test: `src/main/__tests__/handlers/agentInstructionsHandlers.test.ts`・`src/main/__tests__/ipcHandlers.test.ts`・`src/preload/__tests__/api.test.ts`

**Interfaces:**
- Consumes: `getGlobalAgentInstructionStatus`・`createGlobalAgentInstructionFile`・`toGlobalAgentInstructionCreateFailureReason`（Task 4）、`GlobalAgentInstructionContext`（Task 2）、`GlobalAgentInstructionStatus`・`GlobalAgentInstructionCreateResult`（Task 1）
- Produces:
  - `registerAgentInstructionsHandlers(ipcMain: IpcMain, folderAccess: FolderAccessManager, globalInstructions: GlobalAgentInstructionContext): void`
  - チャンネル `agentInstructions:getGlobalStatus`（引数 `cliKind`）・`agentInstructions:createGlobal`（引数 `cliKind`）
  - `window.api.getGlobalAgentInstructionStatus(cliKind: AgentCliKind): Promise<GlobalAgentInstructionStatus>`
  - `window.api.createGlobalAgentInstructionFile(cliKind: AgentCliKind): Promise<GlobalAgentInstructionCreateResult>`
  - `agentInstructionsApi.getGlobalAgentInstructionStatus(cliKind)`・`agentInstructionsApi.createGlobalAgentInstructionFile(cliKind)`（同じ型）

- [ ] **Step 1: 受け口の失敗するテストを書く**

`src/main/__tests__/handlers/agentInstructionsHandlers.test.ts` に足す。上の方の `vi.mock` に次を足す:

```ts
const mockGetGlobalStatus = vi.hoisted(() => vi.fn())
vi.mock('../../globalAgentInstructionStatus', () => ({
  getGlobalAgentInstructionStatus: mockGetGlobalStatus
}))
const mockCreateGlobal = vi.hoisted(() => vi.fn())
vi.mock('../../globalAgentInstructionFileCreator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../globalAgentInstructionFileCreator')>()
  return { ...actual, createGlobalAgentInstructionFile: mockCreateGlobal }
})
```

今の `register` を `registerAgentInstructionsHandlers({ handle: mockHandle } as never, folderAccess, NO_GLOBAL_INSTRUCTIONS)` にし、末尾に足す:

```ts
import { resolveGlobalAgentInstructionContext } from '../../globalAgentInstructionLocations'
import { GlobalAgentInstructionAccessDeniedError } from '../../globalAgentInstructionAccess'
import { NO_GLOBAL_INSTRUCTIONS } from '../helpers/globalAgentInstructionContext'

const registerGlobal = (channel: string, env: NodeJS.ProcessEnv = {}): Handler => {
  mockHandle.mockClear()
  const context = resolveGlobalAgentInstructionContext({ env, homeDir: '/home/u' })
  registerAgentInstructionsHandlers({ handle: mockHandle } as never, {} as FolderAccessManager, context)
  const found = mockHandle.mock.calls.find(([c]) => c === channel)
  if (found === undefined) throw new Error('not registered')
  return found[1] as Handler
}

describe('agentInstructions:getGlobalStatus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('claude → claude の場所とホームで問い合わせ、結果をそのまま返す', async () => {
    mockGetGlobalStatus.mockResolvedValue({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
    const handler = registerGlobal('agentInstructions:getGlobalStatus')
    await expect(handler(event, 'claude')).resolves.toEqual({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
    expect(mockGetGlobalStatus).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'resolved', displayPath: '~/.claude/CLAUDE.md' }),
      '/home/u'
    )
  })

  it.each(['codex', null, 1])('不正な cliKind(%s) → 例外で、問い合わせない', async (value) => {
    const handler = registerGlobal('agentInstructions:getGlobalStatus')
    await expect(handler(event, value)).rejects.toThrow()
    expect(mockGetGlobalStatus).not.toHaveBeenCalled()
  })
})

describe('agentInstructions:createGlobal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('作れた → { ok: true }', async () => {
    mockCreateGlobal.mockResolvedValue(undefined)
    const handler = registerGlobal('agentInstructions:createGlobal')
    await expect(handler(event, 'copilot')).resolves.toEqual({ ok: true })
    expect(mockCreateGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ displayPath: '~/.copilot/copilot-instructions.md' }),
      '/home/u'
    )
  })

  it('場所を決められない → unavailable で、作成を呼ばない', async () => {
    const handler = registerGlobal('agentInstructions:createGlobal', { CLAUDE_CONFIG_DIR: 'rel' })
    await expect(handler(event, 'claude')).resolves.toEqual({ ok: false, reason: 'unavailable' })
    expect(mockCreateGlobal).not.toHaveBeenCalled()
  })

  it.each([
    [new GlobalAgentInstructionAccessDeniedError(), 'outside'],
    [fsError('EEXIST'), 'exists'],
    [fsError('EACCES'), 'failed']
  ])('作成の例外(%s) → 理由で返し、文言・パスを入れない', async (err, reason) => {
    mockCreateGlobal.mockRejectedValue(err)
    const handler = registerGlobal('agentInstructions:createGlobal')
    const result = await handler(event, 'claude')
    expect(result).toEqual({ ok: false, reason })
    expect(JSON.stringify(result)).not.toContain('/')
  })

  it('不正な cliKind → 例外で、作成を呼ばない', async () => {
    const handler = registerGlobal('agentInstructions:createGlobal')
    await expect(handler(event, 'codex')).rejects.toThrow()
    expect(mockCreateGlobal).not.toHaveBeenCalled()
  })
})
```

`src/preload/__tests__/api.test.ts` の表に 2 行足す:

```ts
  [
    'getGlobalAgentInstructionStatus は agentInstructions:getGlobalStatus チャンネルに cliKind を渡す',
    () => api.getGlobalAgentInstructionStatus('claude'),
    ['agentInstructions:getGlobalStatus', 'claude']
  ],
  [
    'createGlobalAgentInstructionFile は agentInstructions:createGlobal チャンネルに cliKind を渡す',
    () => api.createGlobalAgentInstructionFile('copilot'),
    ['agentInstructions:createGlobal', 'copilot']
  ],
```

`src/main/__tests__/ipcHandlers.test.ts` の `registerAgentInstructionsHandlers を ipcMain と registerFileSystemHandlers と同じ FolderAccessManager で呼び出す` に、3 つ目の引数が `mockRegisterFileSystemHandlers.mock.calls[0][2]` と同じ値（`toBe`）であることを足し、名前を「…同じ FolderAccessManager と全体の指示ファイルの文脈で…」に直す。外部変更の登録（`外部変更の IPC と監視の寿命に、…` のテスト）の 4 つ目の引数も、Task 6 で同じ値（`toBe`）と比べる形にしてあることを確かめる（3 つの登録関数が 1 つの値を共有する。L-060）:

```ts
    const globalInstructions = mockRegisterFileSystemHandlers.mock.calls[0][2]
    expect(mockRegisterAgentInstructionsHandlers.mock.calls[0][2]).toBe(globalInstructions)
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/handlers/agentInstructionsHandlers.test.ts src/preload/__tests__/api.test.ts src/main/__tests__/ipcHandlers.test.ts`
Expected: FAIL（チャンネルが無い・API が無い）

- [ ] **Step 3: 受け口を実装する**

`src/main/handlers/agentInstructionsHandlers.ts` に import を足す:

```ts
import type { GlobalAgentInstructionCreateResult, GlobalAgentInstructionStatus } from '@shared/types'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { GlobalAgentInstructionContext } from '../globalAgentInstructionLocations'
import { getGlobalAgentInstructionStatus } from '../globalAgentInstructionStatus'
import {
  createGlobalAgentInstructionFile,
  toGlobalAgentInstructionCreateFailureReason
} from '../globalAgentInstructionFileCreator'
```

ファイルの中に足す:

```ts
/** 全体の指示ファイルの IPC の引数。renderer は CLI の種類だけを送る(パスは main が決める。L-018・L-019)。不正なら投げる(L-044) */
function parseGlobalCliKind(cliKind: unknown): AgentCliKind {
  if (!isAgentCliKind(cliKind)) throw new Error('不正なエージェント CLI の種類です')
  return cliKind
}
```

`registerAgentInstructionsHandlers` の引数に `globalInstructions: GlobalAgentInstructionContext`（3 つ目。省略できない）を足し、`agentInstructions:create` の登録の後に足す:

```ts
  // 全体の指示ファイルの有無(設計書 2026-11-07 global「有無の問い合わせ」)。問い合わせは例外を投げず状態で返す
  ipcMain.handle(
    'agentInstructions:getGlobalStatus',
    async (_event: IpcMainInvokeEvent, cliKind: unknown): Promise<GlobalAgentInstructionStatus> => {
      const kind = parseGlobalCliKind(cliKind)
      return getGlobalAgentInstructionStatus(globalInstructions.locations[kind], globalInstructions.homeDir)
    }
  )

  // 全体の指示ファイルの作成。書く場所はフォルダに依らないので expectedRoot を受け取らない
  ipcMain.handle(
    'agentInstructions:createGlobal',
    async (_event: IpcMainInvokeEvent, cliKind: unknown): Promise<GlobalAgentInstructionCreateResult> => {
      const location = globalInstructions.locations[parseGlobalCliKind(cliKind)]
      if (location.kind === 'unavailable') return { ok: false, reason: 'unavailable' }
      try {
        await createGlobalAgentInstructionFile(location, globalInstructions.homeDir)
        return { ok: true }
      } catch (err) {
        console.error('[agentInstructions:createGlobal] failed:', err)
        return { ok: false, reason: toGlobalAgentInstructionCreateFailureReason(err) }
      }
    }
  )
```

`src/main/ipcHandlers.ts` の `registerAgentInstructionsHandlers(ipcMain, folderAccess)` を `registerAgentInstructionsHandlers(ipcMain, folderAccess, globalInstructions)` にする（`globalInstructions` の定義は Task 6 で `registerFileSystemHandlers` の前に置いた）。

- [ ] **Step 4: preload と renderer の包みを足す**

`src/preload/api.ts` の `createAgentInstructionFile` の後に足す（型の import に `GlobalAgentInstructionStatus`・`GlobalAgentInstructionCreateResult` を足す）:

```ts
  getGlobalAgentInstructionStatus: (cliKind: AgentCliKind): Promise<GlobalAgentInstructionStatus> =>
    ipcRenderer.invoke('agentInstructions:getGlobalStatus', cliKind),
  createGlobalAgentInstructionFile: (
    cliKind: AgentCliKind
  ): Promise<GlobalAgentInstructionCreateResult> =>
    ipcRenderer.invoke('agentInstructions:createGlobal', cliKind),
```

`src/preload/index.d.ts` の `createAgentInstructionFile(…)` の宣言の後に足す（型の import も足す）:

```ts
      /** 利用者の全体の指示ファイルの有無(agentInstructions:getGlobalStatus)。場所は main が起動時の環境変数で決める。
       *  絶対パスは exists のときだけ返る(開くためのノード。画面には displayPath だけを出す) */
      getGlobalAgentInstructionStatus(cliKind: AgentCliKind): Promise<GlobalAgentInstructionStatus>
      /** 利用者の全体の指示ファイルを雛形で作る(agentInstructions:createGlobal)。失敗は理由で返す */
      createGlobalAgentInstructionFile(cliKind: AgentCliKind): Promise<GlobalAgentInstructionCreateResult>
```

`src/renderer/src/lib/agentInstructionsApi.ts` に足す:

```ts
import type {
  GlobalAgentInstructionCreateResult,
  GlobalAgentInstructionStatus
} from '@shared/types'

/** 全体の指示ファイルの有無。送るのは CLI の種類だけ */
export function getGlobalAgentInstructionStatus(
  cliKind: AgentCliKind
): Promise<GlobalAgentInstructionStatus> {
  return window.api.getGlobalAgentInstructionStatus(cliKind)
}

/** 全体の指示ファイルを作る。送るのは CLI の種類だけ */
export function createGlobalAgentInstructionFile(
  cliKind: AgentCliKind
): Promise<GlobalAgentInstructionCreateResult> {
  return window.api.createGlobalAgentInstructionFile(cliKind)
}
```

（既存の `import type { AgentInstructionCreateResult } from '@shared/types'` と 1 つの import にまとめる）

`src/renderer/src/__tests__/setup.ts` の `window.api` の stub の `createAgentInstructionFile` の後に足す:

```ts
    getGlobalAgentInstructionStatus: () =>
      Promise.resolve({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' }),
    createGlobalAgentInstructionFile: () => Promise.resolve({ ok: true }),
```

- [ ] **Step 5: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/main/__tests__/handlers/agentInstructionsHandlers.test.ts src/preload/__tests__/api.test.ts src/main/__tests__/ipcHandlers.test.ts`
Expected: PASS

- [ ] **Step 6: lint と型**

Run: `npx eslint src/main/handlers/agentInstructionsHandlers.ts src/main/ipcHandlers.ts src/preload src/renderer/src/lib/agentInstructionsApi.ts src/renderer/src/__tests__/setup.ts src/main/__tests__/handlers/agentInstructionsHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 8: 文言と表示用の行（renderer・純粋）

設計書: 3 章「画面」の状態ごとの表示の表・「文言」の表。

**Files:**
- Modify: `src/renderer/src/lib/agentInstructionMessages.ts`
- Modify: `src/renderer/src/types.ts`（`AgentGlobalInstructionRow` を足す）
- Create: `src/renderer/src/lib/agentGlobalInstructionRow.ts`
- Test: `src/renderer/src/lib/__tests__/agentGlobalInstructionRow.test.ts`

**Interfaces:**
- Consumes: `GlobalAgentInstructionStatus`・`GlobalAgentInstructionCreateFailureReason`・`GlobalAgentInstructionUnavailableReason`（Task 1）、`AGENT_GLOBAL_INSTRUCTION_FILES`（Task 1）
- Produces:
  - 文言の定数: `AGENT_GLOBAL_INSTRUCTION_HEADING`（`全体(すべてのプロジェクト)`）・`AGENT_GLOBAL_INSTRUCTION_LOADING`（`確かめています…`）・`AGENT_GLOBAL_INSTRUCTION_LINK_OUTSIDE_HOME`・`AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED`・`AGENT_GLOBAL_INSTRUCTION_OPEN_AFTER_CREATE_FAILED`、関数 `agentGlobalInstructionUnavailableMessage(reason, envName): string`・`agentGlobalInstructionCreateFailureMessage(reason): string`。`AGENT_INSTRUCTION_REFRESH_TITLE` の値を変える
  - `types.ts`: `type AgentGlobalInstructionRow = { kind: 'loading' } | { kind: 'exists'; displayPath: string; description: string; node: FileTreeNode } | { kind: 'missing'; displayPath: string; description: string } | { kind: 'blocked'; displayPath: string | null; message: string }`
  - `type AgentGlobalInstructionQueryState = { cliKind: AgentCliKind; status: GlobalAgentInstructionStatus | 'queryFailed' } | null`
  - `function toAgentGlobalInstructionRow(state: AgentGlobalInstructionQueryState, cliKind: AgentCliKind): AgentGlobalInstructionRow`
  - `function toGlobalInstructionNode(status: Extract<GlobalAgentInstructionStatus, { kind: 'exists' }>): FileTreeNode`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentGlobalInstructionRow.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  toAgentGlobalInstructionRow,
  toGlobalInstructionNode
} from '../agentGlobalInstructionRow'
import {
  AGENT_GLOBAL_INSTRUCTION_LINK_OUTSIDE_HOME,
  AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED,
  agentGlobalInstructionUnavailableMessage
} from '../agentInstructionMessages'

const DESCRIPTION = '個人の指示(全部のプロジェクトに効きます)'

describe('toAgentGlobalInstructionRow', () => {
  it('まだ問い合わせていない → loading', () => {
    expect(toAgentGlobalInstructionRow(null, 'claude')).toEqual({ kind: 'loading' })
  })

  it('持っている CLI の種類が今と違う → loading(前の CLI の行を出さない)', () => {
    expect(
      toAgentGlobalInstructionRow(
        { cliKind: 'claude', status: { kind: 'missing', displayPath: '~/.claude/CLAUDE.md' } },
        'copilot'
      )
    ).toEqual({ kind: 'loading' })
  })

  it('exists → ノードを持ち、ノードの name が displayPath', () => {
    const row = toAgentGlobalInstructionRow(
      {
        cliKind: 'claude',
        status: { kind: 'exists', filePath: '/home/u/.claude/CLAUDE.md', displayPath: '~/.claude/CLAUDE.md' }
      },
      'claude'
    )
    expect(row).toEqual({
      kind: 'exists',
      displayPath: '~/.claude/CLAUDE.md',
      description: DESCRIPTION,
      node: { type: 'file', name: '~/.claude/CLAUDE.md', path: '/home/u/.claude/CLAUDE.md' }
    })
  })

  it('missing → ノードを持たない', () => {
    expect(
      toAgentGlobalInstructionRow(
        { cliKind: 'copilot', status: { kind: 'missing', displayPath: '~/.copilot/copilot-instructions.md' } },
        'copilot'
      )
    ).toEqual({ kind: 'missing', displayPath: '~/.copilot/copilot-instructions.md', description: DESCRIPTION })
  })

  it.each([
    [{ kind: 'linkOutsideHome', displayPath: '~/.claude/CLAUDE.md' } as const, '~/.claude/CLAUDE.md', AGENT_GLOBAL_INSTRUCTION_LINK_OUTSIDE_HOME],
    [{ kind: 'failed', displayPath: '~/.claude/CLAUDE.md' } as const, '~/.claude/CLAUDE.md', AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED],
    ['queryFailed' as const, null, AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED],
    [{ kind: 'unavailable', reason: 'envNotAbsolute' } as const, null, agentGlobalInstructionUnavailableMessage('envNotAbsolute', 'CLAUDE_CONFIG_DIR')],
    [{ kind: 'unavailable', reason: 'envOutsideHome' } as const, null, agentGlobalInstructionUnavailableMessage('envOutsideHome', 'CLAUDE_CONFIG_DIR')]
  ])('%o → blocked と文言', (status, displayPath, message) => {
    expect(toAgentGlobalInstructionRow({ cliKind: 'claude', status }, 'claude')).toEqual({
      kind: 'blocked',
      displayPath,
      message
    })
  })

  it('環境変数の文言 → 表の envName を入れ、値は入れない', () => {
    expect(agentGlobalInstructionUnavailableMessage('envNotAbsolute', 'CLAUDE_CONFIG_DIR')).toBe(
      'CLAUDE_CONFIG_DIR が絶対パスでないため、全体の指示ファイルの場所を決められません'
    )
    expect(agentGlobalInstructionUnavailableMessage('envOutsideHome', 'COPILOT_HOME')).toBe(
      'COPILOT_HOME がホームフォルダの外を指すため、全体の指示ファイルを扱えません'
    )
  })
})

describe('toGlobalInstructionNode', () => {
  it('exists の状態 → ファイルのノード', () => {
    expect(
      toGlobalInstructionNode({ kind: 'exists', filePath: '/h/.claude/CLAUDE.md', displayPath: '~/.claude/CLAUDE.md' })
    ).toEqual({ type: 'file', name: '~/.claude/CLAUDE.md', path: '/h/.claude/CLAUDE.md' })
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/agentGlobalInstructionRow.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 文言を足す**

`src/renderer/src/lib/agentInstructionMessages.ts` の import に `GlobalAgentInstructionCreateFailureReason`・`GlobalAgentInstructionUnavailableReason` を足し、末尾に足す。`AGENT_INSTRUCTION_REFRESH_TITLE` の値は差し替える:

```ts
export const AGENT_INSTRUCTION_REFRESH_TITLE =
  'ファイルツリーを読み直し、全体の指示ファイルの有無も確かめ直します'

/** 全体の指示ファイル(設計書 2026-11-07 global「文言」) */
export const AGENT_GLOBAL_INSTRUCTION_HEADING = '全体(すべてのプロジェクト)'
export const AGENT_GLOBAL_INSTRUCTION_LOADING = '確かめています…'
export const AGENT_GLOBAL_INSTRUCTION_LINK_OUTSIDE_HOME =
  'ホームフォルダの外を指すリンクのため、開けません'
export const AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED =
  '全体の指示ファイルの状態を確かめられませんでした(更新 で確かめ直せます)'
export const AGENT_GLOBAL_INSTRUCTION_OPEN_AFTER_CREATE_FAILED =
  '作成しましたが、開けませんでした。節の 更新 を押してから開いてください'

/** 環境変数の名前(表の envName)だけを入れる。利用者が設定した値は出さない(L-017) */
export function agentGlobalInstructionUnavailableMessage(
  reason: GlobalAgentInstructionUnavailableReason,
  envName: string
): string {
  return reason === 'envNotAbsolute'
    ? `${envName} が絶対パスでないため、全体の指示ファイルの場所を決められません`
    : `${envName} がホームフォルダの外を指すため、全体の指示ファイルを扱えません`
}

const GLOBAL_CREATE_FAILURE_MESSAGES: Record<GlobalAgentInstructionCreateFailureReason, string> = {
  exists: '同じ名前のファイルかフォルダが既にあります。節の 更新 を押して確かめてください',
  outside: 'ホームフォルダの外には作成できません',
  failed: '全体の指示ファイルを作成できませんでした',
  unavailable: '全体の指示ファイルを作成できませんでした'
}

export function agentGlobalInstructionCreateFailureMessage(
  reason: GlobalAgentInstructionCreateFailureReason
): string {
  return GLOBAL_CREATE_FAILURE_MESSAGES[reason]
}
```

`src/renderer/src/types.ts` の `AgentInstructionsPanelState` の前に足す:

```ts
/** 全体の指示ファイルの行(設計書 2026-11-07 global「画面」)。exists だけが開くためのノードを持つ */
export type AgentGlobalInstructionRow =
  | { kind: 'loading' }
  | { kind: 'exists'; displayPath: string; description: string; node: FileTreeNode }
  | { kind: 'missing'; displayPath: string; description: string }
  | { kind: 'blocked'; displayPath: string | null; message: string }
```

- [ ] **Step 4: 行の関数を実装する**

`src/renderer/src/lib/agentGlobalInstructionRow.ts`:

```ts
// 全体の指示ファイルの問い合わせの状態から、表示用の行を作る(設計書 2026-11-07 global「状態」)。「無い」と「確かめられない」を分ける(L-002)
import type { AgentCliKind } from '@shared/agentCliKinds'
import { AGENT_GLOBAL_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'
import type { GlobalAgentInstructionStatus } from '@shared/types'
import type { AgentGlobalInstructionRow, FileTreeNode } from '../types'
import {
  AGENT_GLOBAL_INSTRUCTION_LINK_OUTSIDE_HOME,
  AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED,
  agentGlobalInstructionUnavailableMessage
} from './agentInstructionMessages'

/** hook が持つ問い合わせの結果。null は未問い合わせ。queryFailed は IPC 自体の拒否 */
export type AgentGlobalInstructionQueryState = {
  cliKind: AgentCliKind
  status: GlobalAgentInstructionStatus | 'queryFailed'
} | null

/** 開くためのノード。name を ~/… にして、タブでフォルダの同じ名前のファイルと区別できるようにする */
export function toGlobalInstructionNode(
  status: Extract<GlobalAgentInstructionStatus, { kind: 'exists' }>
): FileTreeNode {
  return { type: 'file', name: status.displayPath, path: status.filePath }
}

export function toAgentGlobalInstructionRow(
  state: AgentGlobalInstructionQueryState,
  cliKind: AgentCliKind
): AgentGlobalInstructionRow {
  // CLI を切り替えた直後に、前の CLI の行を出さない
  if (state === null || state.cliKind !== cliKind) return { kind: 'loading' }
  const { status } = state
  const file = AGENT_GLOBAL_INSTRUCTION_FILES[cliKind]
  if (status === 'queryFailed') {
    return { kind: 'blocked', displayPath: null, message: AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED }
  }
  switch (status.kind) {
    case 'exists':
      return {
        kind: 'exists',
        displayPath: status.displayPath,
        description: file.description,
        node: toGlobalInstructionNode(status)
      }
    case 'missing':
      return { kind: 'missing', displayPath: status.displayPath, description: file.description }
    case 'linkOutsideHome':
      return { kind: 'blocked', displayPath: status.displayPath, message: AGENT_GLOBAL_INSTRUCTION_LINK_OUTSIDE_HOME }
    case 'failed':
      return { kind: 'blocked', displayPath: status.displayPath, message: AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED }
    case 'unavailable':
      return {
        kind: 'blocked',
        displayPath: null,
        message: agentGlobalInstructionUnavailableMessage(status.reason, file.envName)
      }
  }
}
```

- [ ] **Step 5: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/agentGlobalInstructionRow.test.ts`
Expected: PASS。`AGENT_INSTRUCTION_REFRESH_TITLE` の古い文言（`ファイルツリーを読み直して、指示ファイルを探し直します`）は、`src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx` の 289 行付近の `title` の期待に文字列で書かれている。定数を参照せず、新しい文言の文字列 `'ファイルツリーを読み直し、全体の指示ファイルの有無も確かめ直します'` に書き換える（定数を参照すると、定数を誤って変えたときにテストが気づかない）。`grep -rn "指示ファイルを探し直します" src` が 0 件になること（L-203）

- [ ] **Step 6: lint と型**

Run: `npx eslint src/renderer/src/lib/agentInstructionMessages.ts src/renderer/src/lib/agentGlobalInstructionRow.ts src/renderer/src/types.ts src/renderer/src/lib/__tests__/agentGlobalInstructionRow.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 9: hook の問い合わせ・開く・作成・更新（renderer）

設計書: 3 章「状態（`useAgentInstructionFiles.ts`）」。

**Files:**
- Modify: `src/renderer/src/hooks/useAgentInstructionFiles.ts`
- Modify: `src/renderer/src/types.ts`（`AgentInstructionsPanelState` に 3 つ足す）
- Modify: `src/renderer/src/hooks/useAppState.ts`（2 つの API を渡す）
- Modify: `src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts`（既定値）
- Test: `src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`

**Interfaces:**
- Consumes: `toAgentGlobalInstructionRow`・`toGlobalInstructionNode`・`AgentGlobalInstructionQueryState`（Task 8）、文言（Task 8）、`agentInstructionsApi` の 2 つ（Task 7）
- Produces:
  - `UseAgentInstructionFilesOptions` に必須の `getGlobalStatus: (cliKind: AgentCliKind) => Promise<GlobalAgentInstructionStatus>` と `createGlobalFile: (cliKind: AgentCliKind) => Promise<GlobalAgentInstructionCreateResult>`
  - `AgentInstructionsPanelState` に `globalRow: AgentGlobalInstructionRow`・`openGlobal: () => void`・`createGlobal: () => Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts` の `renderFiles` の既定に足す:

```ts
    getGlobalStatus: vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValue({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' }),
    createGlobalFile: vi
      .fn<UseAgentInstructionFilesOptions['createGlobalFile']>()
      .mockResolvedValue({ ok: true }),
```

ファイルの中で引数を全部書いている箇所にも、新しい必須の引数を足す（型エラーで漏れが分かる）。対象は、`rerender({ … })` に全部書いている箇所（CLI の切り替えのテストなど）と、`const props: UseAgentInstructionFilesOptions = { … }` の 3 か所（313・330・528 行付近。`grep -n "const props: UseAgentInstructionFilesOptions" src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`）。これらには`getGlobalStatus: vi.fn().mockResolvedValue({ kind: 'missing', displayPath: '~/.copilot/copilot-instructions.md' })` と `createGlobalFile: vi.fn()` を足す（型エラーで漏れが分かる）。

末尾に足す:

```ts
import type { GlobalAgentInstructionStatus } from '@shared/types'
import {
  AGENT_GLOBAL_INSTRUCTION_OPEN_AFTER_CREATE_FAILED,
  agentGlobalInstructionCreateFailureMessage
} from '../../lib/agentInstructionMessages'

const existsStatus: GlobalAgentInstructionStatus = {
  kind: 'exists',
  filePath: '/home/u/.claude/CLAUDE.md',
  displayPath: '~/.claude/CLAUDE.md'
}
const globalNode = { type: 'file', name: '~/.claude/CLAUDE.md', path: '/home/u/.claude/CLAUDE.md' }

/** 解決を外から決められる Promise(古い問い合わせを遅れて解決させる) */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('useAgentInstructionFiles(全体の指示ファイル)', () => {
  it('マウント時に問い合わせ → 結果が出るまで loading、出たら行になる', async () => {
    const getGlobalStatus = vi.fn<UseAgentInstructionFilesOptions['getGlobalStatus']>().mockResolvedValue(existsStatus)
    const { result } = renderFiles({ getGlobalStatus })
    expect(result.current.globalRow).toEqual({ kind: 'loading' })
    await act(async () => {})
    expect(getGlobalStatus).toHaveBeenCalledWith('claude')
    expect(result.current.globalRow).toMatchObject({ kind: 'exists', node: globalNode })
  })

  it('フォルダを変える → 問い合わせ直す', async () => {
    const getGlobalStatus = vi.fn<UseAgentInstructionFilesOptions['getGlobalStatus']>().mockResolvedValue(existsStatus)
    const props: UseAgentInstructionFilesOptions = {
      folderPath: '/p',
      fileTree: [],
      cliKind: 'claude',
      createFile: vi.fn(),
      openFile: vi.fn(),
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus,
      createGlobalFile: vi.fn()
    }
    const { rerender } = renderHook((p: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(p), {
      initialProps: props
    })
    await act(async () => {})
    getGlobalStatus.mockClear()
    rerender({ ...props, folderPath: '/q' })
    await act(async () => {})
    expect(getGlobalStatus).toHaveBeenCalledTimes(1)
  })

  it('CLI を切り替える → loading になり、古い問い合わせの結果を反映しない', async () => {
    const first = deferred<GlobalAgentInstructionStatus>()
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.copilot/copilot-instructions.md' })
    const base = {
      folderPath: '/p',
      fileTree: [],
      createFile: vi.fn(),
      openFile: vi.fn(),
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus,
      createGlobalFile: vi.fn()
    }
    const { result, rerender } = renderHook((props: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(props), {
      initialProps: { ...base, cliKind: 'claude' as AgentCliKind }
    })
    rerender({ ...base, cliKind: 'copilot' as AgentCliKind })
    // 切り替えた直後(問い合わせの結果が出る前)は、前の CLI の行を出さずに loading
    expect(result.current.globalRow).toEqual({ kind: 'loading' })
    await act(async () => {})
    expect(result.current.globalRow).toMatchObject({ kind: 'missing', displayPath: '~/.copilot/copilot-instructions.md' })
    await act(async () => {
      first.resolve(existsStatus)
    })
    expect(result.current.globalRow).toMatchObject({ kind: 'missing', displayPath: '~/.copilot/copilot-instructions.md' })
  })

  it('CLI が同じまま、古い問い合わせが後から解決 → 新しい結果のまま(世代で捨てる)', async () => {
    const first = deferred<GlobalAgentInstructionStatus>()
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
    const props: UseAgentInstructionFilesOptions = {
      folderPath: '/p',
      fileTree: [],
      cliKind: 'claude',
      createFile: vi.fn(),
      openFile: vi.fn(),
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus,
      createGlobalFile: vi.fn()
    }
    const { result, rerender } = renderHook((p: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(p), {
      initialProps: props
    })
    // マウント時の問い合わせ(first)が終わる前に、フォルダを変えて問い合わせ直す(missing)
    rerender({ ...props, folderPath: '/q' })
    await act(async () => {})
    expect(result.current.globalRow).toMatchObject({ kind: 'missing' })
    // 古い方(exists)を後から解決しても、missing のまま
    await act(async () => {
      first.resolve(existsStatus)
    })
    expect(result.current.globalRow).toMatchObject({ kind: 'missing' })
  })

  it('問い合わせの拒否 → blocked(確かめられない)で、missing にならない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const getGlobalStatus = vi.fn<UseAgentInstructionFilesOptions['getGlobalStatus']>().mockRejectedValue(new Error('x'))
    const { result } = renderFiles({ getGlobalStatus })
    await act(async () => {})
    expect(result.current.globalRow).toMatchObject({ kind: 'blocked', displayPath: null })
  })

  it('openGlobal → exists のノードを openFile に渡す', async () => {
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
    const { result } = renderFiles({
      openFile,
      getGlobalStatus: vi.fn<UseAgentInstructionFilesOptions['getGlobalStatus']>().mockResolvedValue(existsStatus)
    })
    await act(async () => {})
    act(() => result.current.openGlobal())
    expect(openFile).toHaveBeenCalledWith(globalNode)
  })

  it('createGlobal の成功 → 開始時の CLI で作り、問い合わせ直してから開く', async () => {
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
      .mockResolvedValue(existsStatus)
    const createGlobalFile = vi.fn<UseAgentInstructionFilesOptions['createGlobalFile']>().mockResolvedValue({ ok: true })
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
    const { result } = renderFiles({ getGlobalStatus, createGlobalFile, openFile })
    await act(async () => {})
    await act(async () => {
      await result.current.createGlobal()
    })
    expect(createGlobalFile).toHaveBeenCalledWith('claude')
    expect(openFile).toHaveBeenCalledWith(globalNode)
    expect(result.current.globalRow).toMatchObject({ kind: 'exists' })
    expect(result.current.isCreating).toBe(false)
  })

  it('createGlobal の後も exists でない → 開けない文言', async () => {
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValue({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const { result } = renderFiles({ getGlobalStatus, openFile })
    await act(async () => {})
    await act(async () => {
      await result.current.createGlobal()
    })
    expect(openFile).not.toHaveBeenCalled()
    expect(result.current.message).toBe(AGENT_GLOBAL_INSTRUCTION_OPEN_AFTER_CREATE_FAILED)
  })

  it.each(['exists', 'outside', 'failed', 'unavailable'] as const)(
    'createGlobal の失敗(%s) → 理由の文言を出し、問い合わせ直す',
    async (reason) => {
      const getGlobalStatus = vi
        .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
        .mockResolvedValue({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
      const { result } = renderFiles({
        getGlobalStatus,
        createGlobalFile: vi.fn<UseAgentInstructionFilesOptions['createGlobalFile']>().mockResolvedValue({ ok: false, reason })
      })
      await act(async () => {})
      getGlobalStatus.mockClear()
      await act(async () => {
        await result.current.createGlobal()
      })
      expect(result.current.message).toBe(agentGlobalInstructionCreateFailureMessage(reason))
      expect(getGlobalStatus).toHaveBeenCalledTimes(1)
    }
  )

  it('createGlobal の IPC の拒否 → failed の文言', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result } = renderFiles({
      createGlobalFile: vi.fn<UseAgentInstructionFilesOptions['createGlobalFile']>().mockRejectedValue(new Error('/secret'))
    })
    await act(async () => {})
    await act(async () => {
      await result.current.createGlobal()
    })
    expect(result.current.message).toBe(agentGlobalInstructionCreateFailureMessage('failed'))
  })

  it('createGlobal を同じ tick で 2 回 → 作成は 1 回', async () => {
    const createGlobalFile = vi.fn<UseAgentInstructionFilesOptions['createGlobalFile']>().mockResolvedValue({ ok: true })
    const { result } = renderFiles({ createGlobalFile })
    await act(async () => {})
    await act(async () => {
      await Promise.all([result.current.createGlobal(), result.current.createGlobal()])
    })
    expect(createGlobalFile).toHaveBeenCalledTimes(1)
  })

  it('createGlobal を待つ間にフォルダを変える → 開かず、文言も出さない', async () => {
    const pending = deferred<{ ok: true }>()
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>()
    const props: UseAgentInstructionFilesOptions = {
      folderPath: '/p',
      fileTree: [],
      cliKind: 'claude',
      createFile: vi.fn(),
      openFile,
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus: vi.fn<UseAgentInstructionFilesOptions['getGlobalStatus']>().mockResolvedValue(existsStatus),
      createGlobalFile: vi.fn<UseAgentInstructionFilesOptions['createGlobalFile']>().mockReturnValue(pending.promise)
    }
    const { result, rerender } = renderHook((p: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(p), {
      initialProps: props
    })
    await act(async () => {})
    let done!: Promise<void>
    act(() => {
      done = result.current.createGlobal()
    })
    rerender({ ...props, folderPath: '/q' })
    await act(async () => {
      pending.resolve({ ok: true })
      await done
    })
    expect(openFile).not.toHaveBeenCalled()
    expect(result.current.message).toBeNull()
  })

  it('createGlobal を待つ間に CLI だけを変える → 開始時の CLI で問い合わせて開き、文言は出さない', async () => {
    const pending = deferred<{ ok: true }>()
    const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockImplementation(async (kind) =>
        kind === 'claude' ? existsStatus : { kind: 'missing', displayPath: '~/.copilot/copilot-instructions.md' }
      )
    const props: UseAgentInstructionFilesOptions = {
      folderPath: '/p',
      fileTree: [],
      cliKind: 'claude',
      createFile: vi.fn(),
      openFile,
      refreshTree: vi.fn().mockResolvedValue(true),
      getGlobalStatus,
      createGlobalFile: vi.fn<UseAgentInstructionFilesOptions['createGlobalFile']>().mockReturnValue(pending.promise)
    }
    const { result, rerender } = renderHook((p: UseAgentInstructionFilesOptions) => useAgentInstructionFiles(p), {
      initialProps: props
    })
    await act(async () => {})
    let done!: Promise<void>
    act(() => {
      done = result.current.createGlobal()
    })
    rerender({ ...props, cliKind: 'copilot' })
    await act(async () => {
      pending.resolve({ ok: true })
      await done
    })
    expect(openFile).toHaveBeenCalledWith(globalNode)
    expect(result.current.message).toBeNull()
  })

  it('refresh → refreshTree と問い合わせの両方を呼び、両方が終わるまで isRefreshing', async () => {
    const status = deferred<GlobalAgentInstructionStatus>()
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
      .mockReturnValueOnce(status.promise)
    const refreshTree = vi.fn<UseAgentInstructionFilesOptions['refreshTree']>().mockResolvedValue(true)
    const { result } = renderFiles({ getGlobalStatus, refreshTree })
    await act(async () => {})
    let done!: Promise<void>
    act(() => {
      done = result.current.refresh()
    })
    await act(async () => {})
    expect(refreshTree).toHaveBeenCalledTimes(1)
    expect(result.current.isRefreshing).toBe(true)
    await act(async () => {
      status.resolve(existsStatus)
      await done
    })
    expect(result.current.isRefreshing).toBe(false)
    expect(result.current.globalRow).toMatchObject({ kind: 'exists' })
  })

  it('refresh で問い合わせだけが拒否 → 失敗の文言の枠には何も出さない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const getGlobalStatus = vi
      .fn<UseAgentInstructionFilesOptions['getGlobalStatus']>()
      .mockResolvedValueOnce({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })
      .mockRejectedValueOnce(new Error('x'))
    const { result } = renderFiles({ getGlobalStatus })
    await act(async () => {})
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.message).toBeNull()
    expect(result.current.globalRow).toMatchObject({ kind: 'blocked' })
  })
})
```


- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`
Expected: FAIL（`globalRow`・`openGlobal`・`createGlobal` が無い）

- [ ] **Step 3: 型を足す**

`src/renderer/src/types.ts` の `AgentInstructionsPanelState` の末尾に足す:

```ts
  /** 全体の指示ファイルの行(設計書 2026-11-07 global) */
  globalRow: AgentGlobalInstructionRow
  /** 全体の指示ファイルを開く(exists のときだけ。エクスプローラーでファイルを選んだときと同じ経路) */
  openGlobal: () => void
  /** 全体の指示ファイルを雛形で作って開く */
  createGlobal: () => Promise<void>
```

- [ ] **Step 4: hook を実装する**

`src/renderer/src/hooks/useAgentInstructionFiles.ts`:

import を足す:

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  GlobalAgentInstructionCreateResult,
  GlobalAgentInstructionStatus
} from '@shared/types'
import {
  toAgentGlobalInstructionRow,
  toGlobalInstructionNode
} from '../lib/agentGlobalInstructionRow'
import type { AgentGlobalInstructionQueryState } from '../lib/agentGlobalInstructionRow'
import {
  AGENT_GLOBAL_INSTRUCTION_OPEN_AFTER_CREATE_FAILED,
  agentGlobalInstructionCreateFailureMessage
} from '../lib/agentInstructionMessages'
```

`UseAgentInstructionFilesOptions` に足す:

```ts
  /** 全体の指示ファイルの有無(agentInstructionsApi。送るのは CLI の種類だけ) */
  getGlobalStatus: (cliKind: AgentCliKind) => Promise<GlobalAgentInstructionStatus>
  /** 全体の指示ファイルの作成(agentInstructionsApi) */
  createGlobalFile: (cliKind: AgentCliKind) => Promise<GlobalAgentInstructionCreateResult>
```

関数の引数の分割に `getGlobalStatus`・`createGlobalFile` を足し、`cliKindRef` の定義の後に足す:

```ts
  const [globalQuery, setGlobalQuery] = useState<AgentGlobalInstructionQueryState>(null)
  // 問い合わせの世代。後から始めた問い合わせの結果だけを反映する(L-037・L-040)
  const globalQuerySeqRef = useRef(0)

  /** 今の CLI の種類で問い合わせて行に反映する。拒否しない(失敗は queryFailed。「無い」にしない。L-002) */
  const queryGlobalStatus = async (): Promise<void> => {
    const seq = ++globalQuerySeqRef.current
    const kind = cliKindRef.current
    let status: GlobalAgentInstructionStatus | 'queryFailed'
    try {
      status = await getGlobalStatus(kind)
    } catch (err) {
      console.error('[useAgentInstructionFiles] global status failed:', err)
      status = 'queryFailed'
    }
    if (seq !== globalQuerySeqRef.current || cliKindRef.current !== kind) return
    setGlobalQuery({ cliKind: kind, status })
  }
  const queryGlobalStatusRef = useLatestRef(queryGlobalStatus)
  // マウント時・CLI の種類の切り替え・フォルダの切り替えで問い合わせる。StrictMode の 2 回目は世代で古い方を捨てる(L-469)
  useEffect(() => {
    void queryGlobalStatusRef.current()
  }, [cliKind, folderPath, queryGlobalStatusRef])

  const globalRow = toAgentGlobalInstructionRow(globalQuery, cliKind)
```

注意: `cliKindRef` は `useLatestRef`（layout effect で更新）なので、この `useEffect` の中では新しい値になっている。

`openSubfolderFile` の後に足す:

```ts
  const openGlobal = (): void => {
    if (globalRow.kind !== 'exists') return
    openNode(globalRow.node)
  }

  const createGlobal = async (): Promise<void> => {
    if (creatingRef.current) return
    creatingRef.current = true
    setIsCreating(true)
    setMessage(null)
    const folderAtStart = folderPath
    const cliKindAtStart = cliKind
    // フォルダの走査の途中にタブを開くと、走査の後にタブを閉じる判定が働かないので、今の create と同じくフォルダが変わったら何もしない
    const isFolderChanged = (): boolean => folderPathRef.current !== folderAtStart
    // CLI の種類だけが変わったときは、今の create と同じく文言だけを止め、作れたファイルは開く
    const showMessage = (text: string): void => {
      if (isFolderChanged() || cliKindRef.current !== cliKindAtStart) return
      setMessage(text)
    }
    try {
      let result: GlobalAgentInstructionCreateResult
      try {
        result = await createGlobalFile(cliKindAtStart)
      } catch (err) {
        console.error('[useAgentInstructionFiles] create global failed:', err)
        result = { ok: false, reason: 'failed' }
      }
      // 結果に関係なく行を問い合わせ直す(外で作られたファイルが出て 開く に変わる)
      const rowQuery = queryGlobalStatus()
      if (!result.ok) {
        await rowQuery
        showMessage(agentGlobalInstructionCreateFailureMessage(result.reason))
        return
      }
      // 作ったのは開始時の CLI のファイルなので、その種類で問い合わせて開くノードを得る
      let created: GlobalAgentInstructionStatus | null
      try {
        created = await getGlobalStatus(cliKindAtStart)
      } catch (err) {
        console.error('[useAgentInstructionFiles] global status after create failed:', err)
        created = null
      }
      await rowQuery
      if (isFolderChanged()) return
      if (created?.kind !== 'exists') {
        showMessage(AGENT_GLOBAL_INSTRUCTION_OPEN_AFTER_CREATE_FAILED)
        return
      }
      await openFile(toGlobalInstructionNode(created))
    } finally {
      creatingRef.current = false
      setIsCreating(false)
    }
  }
```

`refresh` の `try` の中の `await refreshTree()` と `catch` を次にする（`finally` は今のまま）:

```ts
    // ファイルツリーの読み直しと、全体の指示ファイルの問い合わせを並べて待つ。問い合わせの失敗は行に出すので、ここでは扱わない(L-249)
    const [tree] = await Promise.allSettled([refreshTree(), queryGlobalStatus()])
    if (tree.status === 'rejected') {
      // refreshTree は失敗を folderLoadError にしか書かず、エクスプローラーの赤字に出ないので、節で伝える(L-001)
      console.error('[useAgentInstructionFiles] refresh failed:', tree.reason)
      if (folderPathRef.current === folderAtStart && cliKindRef.current === cliKindAtStart) {
        setMessage(AGENT_INSTRUCTION_REFRESH_FAILED)
      }
    }
```

（`try { … } catch (err) { … }` の形をやめ、`try { … } finally { … }` にする）

戻り値に `globalRow`・`openGlobal`・`createGlobal` を足す。

- [ ] **Step 5: 配線と既定値**

`src/renderer/src/hooks/useAppState.ts` の import に `import * as agentInstructionsApi from '../lib/agentInstructionsApi'`（既に同じモジュールを import していればそれを使う。`grep -n agentInstructionsApi src/renderer/src/hooks/useAppState.ts`）を足し、`useAgentInstructionFiles({ … })` に足す:

```ts
    getGlobalStatus: agentInstructionsApi.getGlobalAgentInstructionStatus,
    createGlobalFile: agentInstructionsApi.createGlobalAgentInstructionFile
```

（関数をそのまま渡す。`(kind) => …` で包まない。CLAUDE.md の「デフォルト引数の参照安定性」と同じ考え方）

`src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts` の既定に足す:

```ts
  globalRow: { kind: 'missing', displayPath: '~/.claude/CLAUDE.md', description: '個人の指示(全部のプロジェクトに効きます)' },
  openGlobal: vi.fn<AgentInstructionsPanelState['openGlobal']>(),
  createGlobal: vi.fn<AgentInstructionsPanelState['createGlobal']>().mockResolvedValue(undefined),
```

- [ ] **Step 6: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`
Expected: PASS。続けて、`queryGlobalStatus` の `if (…) return` から世代の比較（`seq !== globalQuerySeqRef.current`）だけを一時的に消し（CLI の種類の比較は残す）、「CLI が同じまま、古い問い合わせが後から解決 → 新しい結果のまま」が落ちることを確かめてから戻す（CLI の切り替えのテストは CLI の種類の比較で捨てられるので、この変異では落ちない）

- [ ] **Step 7: lint と型**

Run: `npx eslint src/renderer/src/hooks/useAgentInstructionFiles.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/types.ts src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 10: 全体の行の部品と節の配置（renderer）

設計書: 3 章「画面」・「文言」・「アクセシビリティ」、2 章「行の場所」。

**Files:**
- Create: `src/renderer/src/components/explorer/AgentInstructionGlobalList.tsx`
- Modify: `src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx`
- Test: `src/renderer/src/components/explorer/__tests__/AgentInstructionGlobalList.test.tsx`
- Test: `src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx`（足す）
- Test: `src/renderer/src/components/__tests__/App.agentInstructions.test.tsx`（足す）

**Interfaces:**
- Consumes: `AgentGlobalInstructionRow`・`AgentInstructionsPanelState`（Task 8・9）、文言（Task 8）、既存の `AgentInstructionOpenButton`（props `relativePath`・`isBlocked`・`isCreating`・`onOpen`）
- Produces: `AgentInstructionGlobalList` の props `{ cliKind: AgentCliKind; row: AgentGlobalInstructionRow; isBlocked: boolean; isCreating: boolean; onOpen: () => void; onCreate: () => void }`（すべて必須）

- [ ] **Step 1: 部品の失敗するテストを書く**

`src/renderer/src/components/explorer/__tests__/AgentInstructionGlobalList.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AgentInstructionGlobalList from '../AgentInstructionGlobalList'
import type { AgentGlobalInstructionRow } from '../../../types'
import { AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED } from '../../../lib/agentInstructionMessages'

const DESCRIPTION = '個人の指示(全部のプロジェクトに効きます)'
const existsRow: AgentGlobalInstructionRow = {
  kind: 'exists',
  displayPath: '~/.claude/CLAUDE.md',
  description: DESCRIPTION,
  node: { type: 'file', name: '~/.claude/CLAUDE.md', path: '/h/.claude/CLAUDE.md' }
}
const missingRow: AgentGlobalInstructionRow = { kind: 'missing', displayPath: '~/.claude/CLAUDE.md', description: DESCRIPTION }

const renderList = (
  row: AgentGlobalInstructionRow,
  overrides: Partial<{ isBlocked: boolean; isCreating: boolean; onOpen: () => void; onCreate: () => void }> = {}
): void => {
  render(
    <AgentInstructionGlobalList
      cliKind="claude"
      row={row}
      isBlocked={overrides.isBlocked ?? false}
      isCreating={overrides.isCreating ?? false}
      onOpen={overrides.onOpen ?? vi.fn()}
      onCreate={overrides.onCreate ?? vi.fn()}
    />
  )
}

describe('AgentInstructionGlobalList', () => {
  it('小見出し 全体(すべてのプロジェクト) を出す', () => {
    renderList(missingRow)
    expect(screen.getByRole('heading', { level: 4, name: '全体(すべてのプロジェクト)' })).toBeInTheDocument()
  })

  it('exists → ~/… のパスと説明と 開く', async () => {
    const onOpen = vi.fn()
    renderList(existsRow, { onOpen })
    expect(screen.getByText('~/.claude/CLAUDE.md')).toBeInTheDocument()
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '~/.claude/CLAUDE.md を開く' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('missing → 作成', async () => {
    const onCreate = vi.fn()
    renderList(missingRow, { onCreate })
    await userEvent.click(screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('loading → 確かめています… でボタンが無い', () => {
    renderList({ kind: 'loading' })
    expect(screen.getByText('確かめています…')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('blocked → 文言だけで、ボタンが無く、role="alert" でもない', () => {
    renderList({ kind: 'blocked', displayPath: '~/.claude/CLAUDE.md', message: AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED })
    expect(screen.getByText(AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clone 中 → 開く・作成 が disabled', () => {
    renderList(missingRow, { isBlocked: true })
    expect(screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' })).toBeDisabled()
  })

  it('作成の途中 → aria-disabled で、押しても呼ばず、フォーカスが残る', async () => {
    const onCreate = vi.fn()
    renderList(missingRow, { isCreating: true, onCreate })
    const button = screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(button)
    expect(onCreate).not.toHaveBeenCalled()
    expect(button).toHaveFocus()
  })
})
```

`AgentInstructionFilesSection.test.tsx` に足す:

```tsx
  it('全体の一覧 → このフォルダの一覧の後、失敗の文言とサブフォルダの開閉のボタンの前', () => {
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ message: '失敗' })}
        isBlocked={false}
      />
    )
    const globalHeading = screen.getByRole('heading', { level: 4, name: '全体(すべてのプロジェクト)' })
    const thisFolder = screen.getByRole('heading', { level: 4, name: 'このフォルダ' })
    const alert = screen.getByRole('alert')
    const toggle = screen.getByRole('button', { name: /サブフォルダ/ })
    const follows = (a: Element, b: Element): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows(thisFolder, globalHeading)).toBe(true)
    expect(follows(globalHeading, alert)).toBe(true)
    expect(follows(alert, toggle)).toBe(true)
  })

  it('全体の 作成 → state.createGlobal を呼ぶ', async () => {
    const state = makeAgentInstructionsPanelState()
    render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
    await userEvent.click(screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' }))
    expect(state.createGlobal).toHaveBeenCalledTimes(1)
  })
```

`App.agentInstructions.test.tsx` の `beforeEach` に `window.api.getGlobalAgentInstructionStatus = vi.fn().mockResolvedValue({ kind: 'missing', displayPath: '~/.claude/CLAUDE.md' })` と `window.api.createGlobalAgentInstructionFile = vi.fn().mockResolvedValue({ ok: true })` を足し、末尾に足す:

```tsx
  it('全体の指示ファイルが exists → 開く を押すとそのパスで読み、タブの名前が ~/… になる', async () => {
    window.api.getGlobalAgentInstructionStatus = vi.fn().mockResolvedValue({
      kind: 'exists',
      filePath: '/home/u/.claude/CLAUDE.md',
      displayPath: '~/.claude/CLAUDE.md'
    })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await screen.findByRole('button', { name: '~/.claude/CLAUDE.md を開く' }))
    await waitFor(() => expect(window.api.readFile).toHaveBeenCalledWith('/home/u/.claude/CLAUDE.md'))
    expect(await screen.findByRole('tab', { name: /~\/\.claude\/CLAUDE\.md/ })).toBeInTheDocument()
    expect(screen.queryByText('/home/u/.claude/CLAUDE.md')).not.toBeInTheDocument()
  })

  it('全体の指示ファイルが missing → 作成 を押すと claude で作成を呼ぶ', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await screen.findByRole('button', { name: '~/.claude/CLAUDE.md を作成' }))
    expect(window.api.createGlobalAgentInstructionFile).toHaveBeenCalledWith('claude')
  })

  it('更新 → 全体の指示ファイルをもう一度問い合わせる', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await screen.findByRole('button', { name: '~/.claude/CLAUDE.md を作成' })
    const before = vi.mocked(window.api.getGlobalAgentInstructionStatus).mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: '指示ファイルの一覧を更新' }))
    await waitFor(() =>
      expect(vi.mocked(window.api.getGlobalAgentInstructionStatus).mock.calls.length).toBeGreaterThan(before)
    )
  })
```

あわせて、`AgentInstructionFilesSection.test.tsx` の既存のテストのうち、全体の一覧（`<ul>` と `<li>` が 1 つずつ増える）で落ちるものを直す。`このフォルダ` の一覧を特定してから、`within` の中で数える・探す:

```tsx
/** 小見出し `このフォルダ` の直後の一覧(全体の一覧・サブフォルダの一覧と区別する) */
const thisFolderList = (): HTMLElement => {
  const heading = screen.getByRole('heading', { level: 4, name: 'このフォルダ' })
  const list = heading.nextElementSibling
  if (!(list instanceof HTMLElement) || list.tagName !== 'UL') throw new Error('このフォルダ の一覧が無い')
  return list
}
```

- 63〜64 行付近（`ある行は 開く、無い行は 作成。…`）: `screen.getAllByRole('listitem')` を `within(thisFolderList()).getAllByRole('listitem')` にする（3 件のまま）
- 177 行付近と 229 行付近（失敗の文言・小見出しの位置のテスト）: `const thisFolderList = screen.getByRole('list')` を `const list = thisFolderList()` にし、以降の参照も `list` に直す（`getByRole('list')` は複数に一致して落ちる）
- 漏れが無いことを確かめる: `grep -n "getAllByRole('listitem')\|getByRole('list')" src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx` の結果が、すべて `within(...)` の中か、全体の一覧を数えるために足した箇所だけ

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components/explorer/__tests__/AgentInstructionGlobalList.test.tsx src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx src/renderer/src/components/__tests__/App.agentInstructions.test.tsx`
Expected: FAIL（部品が無い・節に全体の一覧が無い）

- [ ] **Step 3: 部品を実装する**

`src/renderer/src/components/explorer/AgentInstructionGlobalList.tsx`:

```tsx
// 指示ファイルの節の「全体(すべてのプロジェクト)」(設計書 2026-11-07 global「画面」)。状態の文言は今の状態なので role="alert" にしない。
// 押した操作の失敗は節の失敗の文言の枠(1 か所)に出す(L-249)
import type { AgentCliKind } from '@shared/agentCliKinds'
import { AGENT_GLOBAL_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'
import type { AgentGlobalInstructionRow } from '../../types'
import {
  AGENT_GLOBAL_INSTRUCTION_HEADING,
  AGENT_GLOBAL_INSTRUCTION_LOADING
} from '../../lib/agentInstructionMessages'
import AgentInstructionOpenButton from './AgentInstructionOpenButton'

interface Props {
  cliKind: AgentCliKind
  row: AgentGlobalInstructionRow
  /** clone の実行中など。押す前から押せないので disabled */
  isBlocked: boolean
  /** 作成の途中。押した結果なので aria-disabled(L-157) */
  isCreating: boolean
  onOpen: () => void
  onCreate: () => void
}

export default function AgentInstructionGlobalList({
  cliKind,
  row,
  isBlocked,
  isCreating,
  onOpen,
  onCreate
}: Props): React.JSX.Element {
  const displayPath = row.kind === 'loading' ? null : row.displayPath
  const description =
    row.kind === 'loading'
      ? AGENT_GLOBAL_INSTRUCTION_LOADING
      : row.kind === 'blocked'
        ? row.message
        : row.description
  return (
    <>
      <h4 className="agent-instructions__subtitle">{AGENT_GLOBAL_INSTRUCTION_HEADING}</h4>
      <ul className="agent-instructions__list">
        {/* key は表の id(表示文言を key にしない) */}
        <li key={AGENT_GLOBAL_INSTRUCTION_FILES[cliKind].id} className="agent-instructions__row">
          <span className="agent-instructions__text">
            {displayPath !== null && <span className="agent-instructions__path">{displayPath}</span>}
            <span className="agent-instructions__description">{description}</span>
          </span>
          {row.kind === 'exists' && (
            <AgentInstructionOpenButton
              relativePath={row.displayPath}
              isBlocked={isBlocked}
              isCreating={isCreating}
              onOpen={onOpen}
            />
          )}
          {row.kind === 'missing' && (
            <button
              type="button"
              className="agent-instructions__button"
              aria-label={`${row.displayPath} を作成`}
              disabled={isBlocked}
              aria-disabled={isCreating ? true : undefined}
              onClick={() => {
                if (!isCreating) onCreate()
              }}
            >
              作成
            </button>
          )}
        </li>
      </ul>
    </>
  )
}
```

- [ ] **Step 4: 節に置き、失敗の文言を移す**

`src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx`: `import AgentInstructionGlobalList from './AgentInstructionGlobalList'` を足し、`このフォルダ` の `</ul>` の直後（今の失敗の文言の前）に置く:

```tsx
      <AgentInstructionGlobalList
        cliKind={state.cliKind}
        row={state.globalRow}
        isBlocked={isBlocked}
        isCreating={creating}
        onOpen={state.openGlobal}
        onCreate={() => void state.createGlobal()}
      />
```

失敗の文言の直前のコメントを「節が縮んで中でスクロールするとき、下の一覧の後ろに置くと隠れる。「全体」の一覧の直後(サブフォルダの開閉のボタンの前)に置く」に直す。

- [ ] **Step 5: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components/explorer src/renderer/src/components/__tests__/App.agentInstructions.test.tsx`
Expected: PASS

- [ ] **Step 6: lint と型**

Run: `npx eslint src/renderer/src/components/explorer src/renderer/src/components/__tests__/App.agentInstructions.test.tsx --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 11: 文書・実機テスト仕様書・全体の検証

設計書: 7 章（実機テスト仕様書の項目の案と、既存の項目の直し方）、8 章（ROADMAP・README・developer-guide）。

**Files:**
- Modify: `docs/manual-test-spec.md`
- Modify: `ROADMAP.md`・`README.md`・`docs/developer-guide.md`
- 再生成: `.superpowers/manual-test-spec.html`（`node scripts/build-manual-test-spec.mjs` の出力）

**Interfaces:**
- Consumes: Task 1〜10 の実装（画面の文言・チャンネル名・ファイル名）
- Produces: 文書の更新だけ

- [ ] **Step 1: 実機テスト仕様書に追記する**

`docs/manual-test-spec.md` の「サブフォルダのエージェントの指示ファイル」（`###`）の最後の項目（EXP-099）の後、`## エディタ` の前に、設計書の 7 章のコードブロックの中身（`### 全体のエージェントの指示ファイル`・前提・EXP-100〜EXP-116）をそのまま写す。文言が実装（Task 8 の定数）と 1 字も違わないことを、`grep -n "全体の指示ファイルの状態を確かめられませんでした" docs/manual-test-spec.md src/renderer/src/lib/agentInstructionMessages.ts` などで突き合わせる

- [ ] **Step 2: 既存の項目を直す（ID は変えない）**

設計書の 7 章「既存の項目の手順・期待結果を次のように直す」のとおり、EXP-084・EXP-086・EXP-097・EXP-099 の期待結果を直す。直したら `grep -n "このフォルダ\` の一覧のすぐ下" docs/manual-test-spec.md` が 0 件であること（L-203）

- [ ] **Step 3: HTML を再生成し、書式を検査する**

Run: `node scripts/build-manual-test-spec.mjs && NODE_ENV=test npx vitest run scripts`
Expected: 生成が成功し、テストが PASS（ID の一意性・接頭辞ごとの連番の昇順・書式）

- [ ] **Step 4: ROADMAP・README・developer-guide を直す**

設計書の 8 章のとおりに直す:
- `ROADMAP.md`: 実装済み機能の「エージェント向けの指示ファイルの編集支援」に `[x]` の項目を 1 つ、「既知の制約」に 3 つ。「エージェント実行の支援（MVP の次）」の説明に 1 文を足し、「残り」から「利用者の全体の指示ファイル（`~/.claude/CLAUDE.md` など）」を消す
- `README.md`: 「エクスプローラー・エディタ」の文に 1 文、「ディレクトリ構成と主要なモジュール」に `fileAccessScope.ts`・`globalAgentInstructionAccess.ts` の説明
- `docs/developer-guide.md`: 3.1 の `FolderAccessManager` の段落の後に入口の振り分けの説明、3.4 の `agentInstructionFiles.ts` の説明に「全体の指示ファイルの場所」

直したら `grep -n "利用者の全体の指示ファイル（\`~/.claude/CLAUDE.md\` など）、プロンプト" ROADMAP.md` が 0 件であること

- [ ] **Step 5: 全体の検証**

Run（順に）:
- `NODE_ENV=test npm test`
- `npm run typecheck`
- `npx eslint . --max-warnings 0`
- `npm run build`

Expected: すべて成功。失敗したら、原因のタスクの手順に戻って直す（テストを消して通さない）

- [ ] **Step 6: 変更の範囲を確かめる**

Run: `git status --short && git diff --stat`
Expected: 「ファイルの構成」の表のファイルと、Task 5〜7 で直したテスト・`checkedFileWrite.global.test.ts`・`globalInstructionEntrances.fs.test.ts` だけが変わっている。無関係な差分（整形だけの変更など）があれば戻す（L-199）。コミットはしない
