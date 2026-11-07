# サブフォルダのエージェントの指示ファイルの探索 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エクスプローラーの「エージェントの指示ファイル」の節を小見出し `このフォルダ`・`サブフォルダ(N 件)` に分け、サブフォルダの指示ファイルを一覧して開けるようにする。節の `更新` でファイルツリーを読み直す。

**Architecture:** 探すファイル名の表(CLI ごと)を `src/shared/agentInstructionFiles.ts` に足す。renderer は今のファイルツリーを純粋な関数でたどって一覧を作る(`useMemo`。ツリーの読み直しに連動)。`更新` は既存の `useFileSystem.refreshTree` を呼ぶだけ。main・preload・IPC は変えない。

**Tech Stack:** Electron + React + TypeScript、Vitest + Testing Library

**設計書:** `docs/superpowers/specs/2026-11-07-agent-instruction-files-subfolders-design.md`(各タスクの前に該当の節を読む)

## Global Constraints

- **コミットしない。** このプランの手順にコミット・プッシュは無い。コミットは利用者の明示の指示があるときだけ行う(プロジェクトの CLAUDE.md の規則)
- `git add -A` を使わない(使う場面が来ても `git add -u` か、パスを指定する)
- 型だけの import は `import type`。関数には戻り値の型を書く(テストを含む)
- コメント・テストの名前・画面の文言は日本語。テストの名前(`it` の文字列)は「条件 → 期待する結果」
- テストは `NODE_ENV=test` を付けて走らせる(シェルの `NODE_ENV=production` で大量に落ちるため)。例: `NODE_ENV=test npx vitest run <パス>`
- `act(...).then(...)` の形で書かない。hook の非同期は `await act(async () => { ... })` で待つ
- 画面の文言に絶対パス・例外の文言を入れない。出すのはフォルダからの相対パスと、設計書の「文言」の表の固定の文字列だけ(L-017)
- リストの `key` に表示文言を使わない。サブフォルダの行の key はノードの `path`
- 押した結果として押せなくなるボタンは `disabled` ではなく `aria-disabled="true"` にし、押しても何もしない(L-157)。多重の実行は ref で止める(L-653)
- 新しい props・hook の引数は省略できないものにする(L-060)
- main の `SKIP_DIRS`・`MAX_DEPTH` の規則を renderer に書き直さない(ツリーに出ているものだけをたどる)
- 各タスクの終わりに、そのタスクで変えたファイルへ `npx eslint <パス...> --max-warnings 0` と `npm run typecheck` を通す。整形の崩れは `npx prettier --write <パス>` で直す
- 気をつける知見の ID(`$DEV_FLOW_KIT/lessons/review-lessons.md`): L-001, L-002, L-009, L-016, L-017, L-035, L-037, L-040, L-048, L-059, L-060, L-061, L-157, L-466, L-653(L-004・L-018・L-019・L-044 はこの PR では当てはまらない。理由は設計書の 6 章)

## ファイルの構成

| ファイル | 役割 |
| --- | --- |
| `src/shared/agentInstructionFiles.ts` | サブフォルダで探すファイル名と注の表 `AGENT_INSTRUCTION_SUBFOLDER_FILES` を足す |
| `src/renderer/src/types.ts` | `AgentInstructionSubfolderRow`、`AgentInstructionsPanelState` の追加の項目 |
| `src/renderer/src/lib/agentInstructionSubfolderLookup.ts`(新規) | ツリーをたどってサブフォルダの指示ファイルを集める純粋な関数 |
| `src/renderer/src/lib/agentInstructionMessages.ts` | サブフォルダ・`更新` の固定の文言 |
| `src/renderer/src/hooks/useAgentInstructionFiles.ts` | 一覧の計算・`openSubfolderFile`・`refresh`・`isRefreshing` |
| `src/renderer/src/hooks/useAppState.ts` | `useAgentInstructionFiles` へ `refreshTree` を渡す |
| `src/renderer/src/components/explorer/AgentInstructionOpenButton.tsx`(新規) | 節の `開く` のボタン(このフォルダ・サブフォルダで共通) |
| `src/renderer/src/components/explorer/AgentInstructionSubfolderList.tsx`(新規) | 開閉のボタン・注・一覧・`ほか N 件`・0 件の文言 |
| `src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx` | 見出しの行の `更新`・小見出し `このフォルダ`・サブフォルダの部品の配置 |
| `src/renderer/src/assets/main.css` | 見出しの行・小見出し・開閉のボタン・注の見た目 |
| `src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts` | テスト用の状態に新しい項目の既定値を足す |

設計書との違い: 設計書の `AgentInstructionSubfolderMatch`(探索の結果の 1 件)と `AgentInstructionSubfolderRow`(状態の 1 行)は同じ形なので、`AgentInstructionSubfolderRow` の 1 つの型にまとめる(`src/renderer/src/types.ts` に置き、探索の関数もこれを返す)。

---

### Task 1: サブフォルダで探すファイル名の表

**Files:**
- Modify: `src/shared/agentInstructionFiles.ts`(末尾に足す)
- Test: `src/shared/__tests__/agentInstructionFiles.test.ts`(末尾に `describe` を足す)

**Interfaces:**
- Consumes: なし(既存の `AgentCliKind`)
- Produces:
  - `interface AgentInstructionSubfolderFileName { name: string; description: string }`
  - `interface AgentInstructionSubfolderSpec { names: readonly AgentInstructionSubfolderFileName[]; note: string | null }`
  - `const AGENT_INSTRUCTION_SUBFOLDER_FILES: Record<AgentCliKind, AgentInstructionSubfolderSpec>`

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/__tests__/agentInstructionFiles.test.ts` の import に `AGENT_INSTRUCTION_SUBFOLDER_FILES` を足し、末尾に次を足す。

```ts
describe('AGENT_INSTRUCTION_SUBFOLDER_FILES', () => {
  it('すべての CLI の種類に名前が 1 つ以上あり、重複しない', () => {
    for (const kind of AGENT_CLI_KINDS) {
      const names = AGENT_INSTRUCTION_SUBFOLDER_FILES[kind].names.map((n) => n.name)
      expect(names.length).toBeGreaterThan(0)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('名前は区切りや .. を含まず、説明は空でない', () => {
    for (const kind of AGENT_CLI_KINDS) {
      for (const entry of AGENT_INSTRUCTION_SUBFOLDER_FILES[kind].names) {
        expect(entry.name).not.toMatch(/[\\/]/)
        expect(entry.name).not.toBe('..')
        expect(entry.name).not.toBe('')
        expect(entry.description).not.toBe('')
      }
    }
  })

  it('claude は CLAUDE.md・CLAUDE.local.md の順で、注は無い', () => {
    expect(AGENT_INSTRUCTION_SUBFOLDER_FILES.claude).toEqual({
      names: [
        { name: 'CLAUDE.md', description: '共有の指示' },
        { name: 'CLAUDE.local.md', description: '個人の指示' }
      ],
      note: null
    })
  })

  it('copilot は AGENTS.md だけで、読まないことがある旨の注がある', () => {
    expect(AGENT_INSTRUCTION_SUBFOLDER_FILES.copilot).toEqual({
      names: [{ name: 'AGENTS.md', description: '共有の指示' }],
      note: 'GitHub Copilot CLI は、サブフォルダの AGENTS.md を読まないことがあります(このアプリはフォルダの根で CLI を起動するため)'
    })
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/shared/__tests__/agentInstructionFiles.test.ts`
Expected: FAIL(`AGENT_INSTRUCTION_SUBFOLDER_FILES` が export されていない)

- [ ] **Step 3: 実装する**

`src/shared/agentInstructionFiles.ts` の末尾に足す。

```ts
/** サブフォルダの中で探すファイル名(設計書 2026-11-07「表」)。名前は完全一致で比べる(L-009) */
export interface AgentInstructionSubfolderFileName {
  name: string
  /** 一覧に出す短い説明 */
  description: string
}

export interface AgentInstructionSubfolderSpec {
  /** 探すファイル名。同じフォルダの中はこの順に並べる */
  names: readonly AgentInstructionSubfolderFileName[]
  /** 一覧の上に出す注(無ければ null) */
  note: string | null
}

// renderer だけが読む(サブフォルダの行は作成しない)。CLI の対応を今の表と 1 か所で見比べられるよう、ここに置く
export const AGENT_INSTRUCTION_SUBFOLDER_FILES: Record<AgentCliKind, AgentInstructionSubfolderSpec> =
  {
    claude: {
      names: [
        { name: 'CLAUDE.md', description: '共有の指示' },
        { name: 'CLAUDE.local.md', description: '個人の指示' }
      ],
      // Claude Code はサブフォルダの CLAUDE.md を、そのフォルダのファイルを読んだときに読む
      note: null
    },
    copilot: {
      names: [{ name: 'AGENTS.md', description: '共有の指示' }],
      // copilot は cwd から git root までの分だけを読み、根で起動すると子孫のフォルダの AGENTS.md は読まない(1.0.106 で確かめた)
      note: 'GitHub Copilot CLI は、サブフォルダの AGENTS.md を読まないことがあります(このアプリはフォルダの根で CLI を起動するため)'
    }
  }
```

- [ ] **Step 4: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/shared/__tests__/agentInstructionFiles.test.ts`
Expected: PASS

- [ ] **Step 5: 静的検査**

Run: `npx eslint src/shared/agentInstructionFiles.ts src/shared/__tests__/agentInstructionFiles.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 2: サブフォルダの指示ファイルの探索(純粋な関数)

**Files:**
- Modify: `src/renderer/src/types.ts`(`AgentInstructionFileRow` の直後に型を足す)
- Create: `src/renderer/src/lib/agentInstructionSubfolderLookup.ts`
- Test: `src/renderer/src/lib/__tests__/agentInstructionSubfolderLookup.test.ts`(新規)

**Interfaces:**
- Consumes: Task 1 の `AgentInstructionSubfolderSpec`
- Produces:
  - `interface AgentInstructionSubfolderRow { relativePath: string; description: string; node: FileTreeNode }`(`src/renderer/src/types.ts`)
  - `const AGENT_INSTRUCTION_SUBFOLDER_LIMIT = 50`
  - `interface AgentInstructionSubfolderLookupResult { rows: readonly AgentInstructionSubfolderRow[]; total: number }`
  - `function findAgentInstructionSubfolderFiles(tree: readonly FileTreeNode[], spec: AgentInstructionSubfolderSpec, excludedSegments: readonly (readonly string[])[], limit?: number): AgentInstructionSubfolderLookupResult`

- [ ] **Step 1: 型を足す**

`src/renderer/src/types.ts` の `AgentInstructionFileRow` の直後に足す。

```ts
/** サブフォルダの指示ファイルの 1 行(設計書 2026-11-07「状態」) */
export interface AgentInstructionSubfolderRow {
  /** 根からの相対パス(区切りは /)。表示と aria-label に使う */
  relativePath: string
  description: string
  node: FileTreeNode
}
```

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentInstructionSubfolderLookup.test.ts` を作る。

```ts
import { describe, expect, it } from 'vitest'
import {
  AGENT_INSTRUCTION_FILES,
  AGENT_INSTRUCTION_SUBFOLDER_FILES
} from '@shared/agentInstructionFiles'
import type { FileTreeNode } from '../../types'
import {
  AGENT_INSTRUCTION_SUBFOLDER_LIMIT,
  findAgentInstructionSubfolderFiles
} from '../agentInstructionSubfolderLookup'

const file = (path: string): FileTreeNode => ({
  name: path.split('/').pop() ?? '',
  path,
  type: 'file'
})
const dir = (path: string, children: FileTreeNode[]): FileTreeNode => ({
  name: path.split('/').pop() ?? '',
  path,
  type: 'directory',
  children
})

const claude = AGENT_INSTRUCTION_SUBFOLDER_FILES.claude
const claudeExcluded = AGENT_INSTRUCTION_FILES.claude.map((f) => f.segments)
const paths = (tree: FileTreeNode[]): string[] =>
  findAgentInstructionSubfolderFiles(tree, claude, claudeExcluded).rows.map((r) => r.relativePath)

describe('findAgentInstructionSubfolderFiles', () => {
  it('根の直下のファイル → 含めない(このフォルダの分)', () => {
    expect(paths([file('/p/CLAUDE.md'), file('/p/CLAUDE.local.md')])).toEqual([])
  })

  it('入れ子のファイル → 相対パスを / でつなぎ、表の説明を付ける', () => {
    const result = findAgentInstructionSubfolderFiles(
      [dir('/p/src', [dir('/p/src/sub', [file('/p/src/sub/CLAUDE.local.md')])])],
      claude,
      claudeExcluded
    )
    expect(result.rows).toEqual([
      {
        relativePath: 'src/sub/CLAUDE.local.md',
        description: '個人の指示',
        node: file('/p/src/sub/CLAUDE.local.md')
      }
    ])
    expect(result.total).toBe(1)
  })

  it('今の表の位置(根の .claude/CLAUDE.md) → 除く。サブフォルダの src/.claude/CLAUDE.md は根の位置でないので出る', () => {
    expect(
      paths([
        dir('/p/.claude', [file('/p/.claude/CLAUDE.md')]),
        dir('/p/src', [dir('/p/src/.claude', [file('/p/src/.claude/CLAUDE.md')])])
      ])
    ).toEqual(['src/.claude/CLAUDE.md'])
  })

  it('大文字小文字だけ違う名前・同じ名前のフォルダ → 出さない(完全一致。L-009)', () => {
    expect(
      paths([
        dir('/p/src', [
          file('/p/src/claude.md'),
          dir('/p/src/CLAUDE.md', [])
        ])
      ])
    ).toEqual([])
  })

  it('並べ方 → 祖先のフォルダが先、同じフォルダは表の順、兄弟は localeCompare の順', () => {
    // ツリーの順(フォルダが先)のままだと src/sub が src の直下のファイルより先に来る
    const tree = [
      dir('/p/src', [
        dir('/p/src/sub', [file('/p/src/sub/CLAUDE.md')]),
        file('/p/src/CLAUDE.local.md'),
        file('/p/src/CLAUDE.md')
      ]),
      dir('/p/b', [file('/p/b/CLAUDE.md')]),
      dir('/p/a', [file('/p/a/CLAUDE.md')])
    ]
    expect(paths(tree)).toEqual([
      'a/CLAUDE.md',
      'b/CLAUDE.md',
      'src/CLAUDE.md',
      'src/CLAUDE.local.md',
      'src/sub/CLAUDE.md'
    ])
  })

  it('上限を超える → 上限までに切り、total は全件', () => {
    const many = Array.from({ length: AGENT_INSTRUCTION_SUBFOLDER_LIMIT + 1 }, (_, i) => {
      const name = `m${String(i).padStart(2, '0')}`
      return dir(`/p/${name}`, [file(`/p/${name}/CLAUDE.md`)])
    })
    const result = findAgentInstructionSubfolderFiles(many, claude, claudeExcluded)
    expect(result.rows).toHaveLength(50)
    expect(result.total).toBe(51)
    expect(result.rows[0].relativePath).toBe('m00/CLAUDE.md')
  })

  it('上限ちょうど → すべて出し、total も同じ', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      dir(`/p/m${i}`, [file(`/p/m${i}/CLAUDE.md`)])
    )
    const result = findAgentInstructionSubfolderFiles(many, claude, claudeExcluded)
    expect(result.rows).toHaveLength(50)
    expect(result.total).toBe(50)
  })

  it('空のツリー・children の無いフォルダ → 0 件', () => {
    expect(findAgentInstructionSubfolderFiles([], claude, claudeExcluded)).toEqual({
      rows: [],
      total: 0
    })
    expect(paths([{ name: 'src', path: '/p/src', type: 'directory' }])).toEqual([])
  })

  it('相対パスはノードの path ではなくたどった名前から作る', () => {
    // path の書き方が根と違っても(realpath の違いなど)、相対パスは名前でつなぐ
    const odd: FileTreeNode = { name: 'CLAUDE.md', path: '/private/x/y/CLAUDE.md', type: 'file' }
    expect(paths([dir('/p/src', [odd])])).toEqual(['src/CLAUDE.md'])
  })

  it('copilot → AGENTS.md だけを集める', () => {
    const result = findAgentInstructionSubfolderFiles(
      [dir('/p/src', [file('/p/src/AGENTS.md'), file('/p/src/CLAUDE.md')])],
      AGENT_INSTRUCTION_SUBFOLDER_FILES.copilot,
      AGENT_INSTRUCTION_FILES.copilot.map((f) => f.segments)
    )
    expect(result.rows.map((r) => r.relativePath)).toEqual(['src/AGENTS.md'])
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/agentInstructionSubfolderLookup.test.ts`
Expected: FAIL(モジュールが無い)

- [ ] **Step 4: 実装する**

`src/renderer/src/lib/agentInstructionSubfolderLookup.ts` を作る。

```ts
// サブフォルダの指示ファイルの探索(設計書 2026-11-07「探索」)。ツリーに出ているものだけをたどる。除外(SKIP_DIRS)と深さ(MAX_DEPTH)は
// main がツリーを作るときに済んでいるので、ここで書き直さない。相対パスはノードの path ではなく、たどった名前からつなぐ
// (renderer の folderPath と main の realpath 済みのパスの書き方が違いうるため)。名前は完全一致(L-009)
import type { AgentInstructionSubfolderSpec } from '@shared/agentInstructionFiles'
import type { AgentInstructionSubfolderRow, FileTreeNode } from '../types'
import { isFileNode } from './fileUtils'

export const AGENT_INSTRUCTION_SUBFOLDER_LIMIT = 50

export interface AgentInstructionSubfolderLookupResult {
  /** 並べ替えて上限までに切った分 */
  rows: readonly AgentInstructionSubfolderRow[]
  /** 見つかった全件の数(上限で隠した分を含む) */
  total: number
}

interface Found {
  row: AgentInstructionSubfolderRow
  parentSegments: readonly string[]
  /** spec.names の中の位置(同じフォルダの中の並び) */
  nameIndex: number
}

function isSameSegments(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index])
}

/** 親フォルダを区切りごとに比べる。片方がもう片方の祖先なら祖先を先にする */
function compareParents(a: readonly string[], b: readonly string[]): number {
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const order = a[index].localeCompare(b[index])
    if (order !== 0) return order
  }
  return a.length - b.length
}

function collect(
  nodes: readonly FileTreeNode[],
  parentSegments: readonly string[],
  spec: AgentInstructionSubfolderSpec,
  excludedSegments: readonly (readonly string[])[],
  found: Found[]
): void {
  for (const node of nodes) {
    if (node.type === 'directory') {
      collect(node.children ?? [], [...parentSegments, node.name], spec, excludedSegments, found)
      continue
    }
    // 根(0 段目)の直下のファイルは「このフォルダ」の分
    if (parentSegments.length === 0 || !isFileNode(node)) continue
    const nameIndex = spec.names.findIndex((entry) => entry.name === node.name)
    if (nameIndex === -1) continue
    const segments = [...parentSegments, node.name]
    if (excludedSegments.some((excluded) => isSameSegments(excluded, segments))) continue
    found.push({
      row: {
        relativePath: segments.join('/'),
        description: spec.names[nameIndex].description,
        node
      },
      parentSegments,
      nameIndex
    })
  }
}

export function findAgentInstructionSubfolderFiles(
  tree: readonly FileTreeNode[],
  spec: AgentInstructionSubfolderSpec,
  excludedSegments: readonly (readonly string[])[],
  limit: number = AGENT_INSTRUCTION_SUBFOLDER_LIMIT
): AgentInstructionSubfolderLookupResult {
  const found: Found[] = []
  collect(tree, [], spec, excludedSegments, found)
  // 並べ方を安定させるため、全件を集めて並べてから切る
  found.sort(
    (a, b) => compareParents(a.parentSegments, b.parentSegments) || a.nameIndex - b.nameIndex
  )
  return { rows: found.slice(0, limit).map((entry) => entry.row), total: found.length }
}
```

- [ ] **Step 5: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/lib/__tests__/agentInstructionSubfolderLookup.test.ts`
Expected: PASS

- [ ] **Step 6: 静的検査**

Run: `npx eslint src/renderer/src/types.ts src/renderer/src/lib/agentInstructionSubfolderLookup.ts src/renderer/src/lib/__tests__/agentInstructionSubfolderLookup.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 3: hook のサブフォルダの一覧と `openSubfolderFile`

**Files:**
- Modify: `src/renderer/src/types.ts`(`AgentInstructionsPanelState`)
- Modify: `src/renderer/src/hooks/useAgentInstructionFiles.ts`
- Modify: `src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`(末尾に足す)

**Interfaces:**
- Consumes: Task 1 の `AGENT_INSTRUCTION_SUBFOLDER_FILES`、Task 2 の `findAgentInstructionSubfolderFiles`・`AgentInstructionSubfolderRow`
- Produces: `AgentInstructionsPanelState` に `subfolderRows: readonly AgentInstructionSubfolderRow[]`・`subfolderTotal: number`・`subfolderNote: string | null`・`openSubfolderFile: (row: AgentInstructionSubfolderRow) => void`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts` の末尾(最後の `})` の前)に足す。`FileTreeNode` は既に import 済み。

```ts
  describe('サブフォルダ', () => {
    const srcDir = (children: FileTreeNode[]): FileTreeNode => ({
      name: 'src',
      path: '/p/src',
      type: 'directory',
      children
    })
    const srcClaude: FileTreeNode = { name: 'CLAUDE.md', path: '/p/src/CLAUDE.md', type: 'file' }
    const srcAgents: FileTreeNode = { name: 'AGENTS.md', path: '/p/src/AGENTS.md', type: 'file' }

    it('ツリーのサブフォルダの CLAUDE.md → 行と件数に出る。claude の注は無い', () => {
      const { result } = renderFiles({ fileTree: [srcDir([srcClaude])] })
      expect(result.current.subfolderRows).toEqual([
        { relativePath: 'src/CLAUDE.md', description: '共有の指示', node: srcClaude }
      ])
      expect(result.current.subfolderTotal).toBe(1)
      expect(result.current.subfolderNote).toBeNull()
    })

    it('ツリーを差し替える(読み直し)→ 一覧が変わる', () => {
      const props: UseAgentInstructionFilesOptions = {
        folderPath: '/p',
        fileTree: [],
        cliKind: 'claude',
        createFile: vi.fn(),
        openFile: vi.fn()
      }
      const { result, rerender } = renderHook((p) => useAgentInstructionFiles(p), {
        initialProps: props
      })
      expect(result.current.subfolderTotal).toBe(0)
      rerender({ ...props, fileTree: [srcDir([srcClaude])] })
      expect(result.current.subfolderRows.map((r) => r.relativePath)).toEqual(['src/CLAUDE.md'])
    })

    it('CLI を copilot に切り替える → AGENTS.md と注に変わる', () => {
      const props: UseAgentInstructionFilesOptions = {
        folderPath: '/p',
        fileTree: [srcDir([srcClaude, srcAgents])],
        cliKind: 'claude',
        createFile: vi.fn(),
        openFile: vi.fn()
      }
      const { result, rerender } = renderHook((p) => useAgentInstructionFiles(p), {
        initialProps: props
      })
      rerender({ ...props, cliKind: 'copilot' })
      expect(result.current.subfolderRows.map((r) => r.relativePath)).toEqual(['src/AGENTS.md'])
      expect(result.current.subfolderNote).toContain('AGENTS.md を読まないことがあります')
    })

    it('openSubfolderFile → そのノードで openFile を呼び、失敗の文言を消す', async () => {
      const createFile = vi
        .fn<UseAgentInstructionFilesOptions['createFile']>()
        .mockResolvedValue({ status: 'failed', reason: 'exists' })
      const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
      const { result } = renderFiles({ fileTree: [srcDir([srcClaude])], createFile, openFile })
      await act(async () => {
        await result.current.create(result.current.rows[1])
      })
      expect(result.current.message).not.toBeNull()
      act(() => result.current.openSubfolderFile(result.current.subfolderRows[0]))
      expect(openFile).toHaveBeenCalledWith(srcClaude)
      expect(result.current.message).toBeNull()
    })

    it('作成の途中の openSubfolderFile → openFile を呼ばない', async () => {
      let resolveCreate: (outcome: AgentInstructionCreateOutcome) => void = () => undefined
      const createFile = vi.fn<UseAgentInstructionFilesOptions['createFile']>(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve
          })
      )
      const openFile = vi.fn<UseAgentInstructionFilesOptions['openFile']>().mockResolvedValue(true)
      const { result } = renderFiles({ fileTree: [srcDir([srcClaude])], createFile, openFile })
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.create(result.current.rows[1])
      })
      act(() => result.current.openSubfolderFile(result.current.subfolderRows[0]))
      expect(openFile).not.toHaveBeenCalled()
      await act(async () => {
        resolveCreate({ status: 'skipped' })
        await pending
      })
    })
  })
```

- [ ] **Step 2: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`
Expected: FAIL(`subfolderRows` が undefined。型の検査では `openSubfolderFile` が無い)

- [ ] **Step 3: 状態の型を足す**

`src/renderer/src/types.ts` の `AgentInstructionsPanelState` の `create` の後に足す。

```ts
  /** サブフォルダの指示ファイル(上限までに切った分。設計書 2026-11-07) */
  subfolderRows: readonly AgentInstructionSubfolderRow[]
  /** 見つかった全件の数(上限で隠した分を含む) */
  subfolderTotal: number
  /** サブフォルダの一覧の上に出す注(無ければ null) */
  subfolderNote: string | null
  /** サブフォルダの行を開く(エクスプローラーでファイルを選んだときと同じ経路) */
  openSubfolderFile: (row: AgentInstructionSubfolderRow) => void
```

- [ ] **Step 4: hook を実装する**

`src/renderer/src/hooks/useAgentInstructionFiles.ts` を次のように変える。

import を変える(`useMemo` を足し、表と探索を読む):

```ts
import { useMemo, useRef, useState } from 'react'
import type { AgentCliKind } from '@shared/agentCliKinds'
import {
  AGENT_INSTRUCTION_FILES,
  AGENT_INSTRUCTION_SUBFOLDER_FILES,
  agentInstructionRelativePath
} from '@shared/agentInstructionFiles'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import type {
  AgentInstructionFileRow,
  AgentInstructionSubfolderRow,
  AgentInstructionsPanelState,
  FileTreeNode
} from '../types'
import { findAgentInstructionFileNode } from '../lib/agentInstructionFileLookup'
import { findAgentInstructionSubfolderFiles } from '../lib/agentInstructionSubfolderLookup'
```

`rows` の計算の直後に足す:

```ts
  // ツリーは読み直すたびに新しい配列になるので、読み直しに連動して探し直す(一覧を別に控えない。L-037・L-040)
  const subfolder = useMemo(
    () =>
      findAgentInstructionSubfolderFiles(
        fileTree,
        AGENT_INSTRUCTION_SUBFOLDER_FILES[cliKind],
        AGENT_INSTRUCTION_FILES[cliKind].map((file) => file.segments)
      ),
    [fileTree, cliKind]
  )
```

今の `open` を、ノードを開く共通の関数とそれを呼ぶ 2 つに置き換える:

```ts
  // このフォルダの行・サブフォルダの行で共通。作成の途中は開かない(作成の結果で開くファイルと競わせない)
  const openNode = (node: FileTreeNode): void => {
    if (creatingRef.current) return
    setMessage(null)
    // selectFile は読み込みの失敗を自分でエクスプローラーのエラーに出し、拒否せず false を返す
    void openFile(node)
  }

  const open = (row: AgentInstructionFileRow): void => {
    if (row.node === null) return
    openNode(row.node)
  }

  const openSubfolderFile = (row: AgentInstructionSubfolderRow): void => {
    openNode(row.node)
  }
```

戻り値を変える:

```ts
  return {
    cliKind,
    rows,
    isCreating,
    message,
    open,
    create,
    subfolderRows: subfolder.rows,
    subfolderTotal: subfolder.total,
    subfolderNote: AGENT_INSTRUCTION_SUBFOLDER_FILES[cliKind].note,
    openSubfolderFile
  }
```

- [ ] **Step 5: テスト用の状態に既定値を足す**

`src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts` の `create` の行の後に足す(コメントの既定の説明に「サブフォルダは 0 件」を足す)。

```ts
  subfolderRows: [],
  subfolderTotal: 0,
  subfolderNote: null,
  openSubfolderFile: vi.fn<AgentInstructionsPanelState['openSubfolderFile']>(),
```

- [ ] **Step 6: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts src/renderer/src/components`
Expected: PASS(既存の節・エクスプローラーのテストも通る)

- [ ] **Step 7: 静的検査**

Run: `npx eslint src/renderer/src/types.ts src/renderer/src/hooks/useAgentInstructionFiles.ts src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 4: hook の `refresh`(ツリーの読み直し)と `useAppState` の配線

**Files:**
- Modify: `src/renderer/src/lib/agentInstructionMessages.ts`
- Modify: `src/renderer/src/types.ts`(`AgentInstructionsPanelState`)
- Modify: `src/renderer/src/hooks/useAgentInstructionFiles.ts`
- Modify: `src/renderer/src/hooks/useAppState.ts:376-382`
- Modify: `src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts`
- Test: `src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`

**Interfaces:**
- Consumes: Task 3 の hook。既存の `useFileSystem` の `refreshTree: () => Promise<boolean>`(反映したら true、走査中・古い結果・フォルダが無いなら false、読み込みの失敗は `folderLoadError` に書いてから投げ直す)
- Produces:
  - `UseAgentInstructionFilesOptions.refreshTree: () => Promise<boolean>`(必須)
  - `AgentInstructionsPanelState.isRefreshing: boolean`・`refresh: () => Promise<void>`
  - `AGENT_INSTRUCTION_REFRESH_FAILED = 'ファイルツリーを読み直せませんでした'`

- [ ] **Step 1: 既存のテストの props に `refreshTree` を足す**

`useAgentInstructionFiles.test.ts` で、`renderFiles` の `initialProps` に次を足す(`openFile` の行の後)。

```ts
    refreshTree: vi.fn<UseAgentInstructionFilesOptions['refreshTree']>().mockResolvedValue(true),
```

ほかに `UseAgentInstructionFilesOptions` を組む箇所(`rerender({ ... })` の 5 か所と、Task 3 で足した 2 か所の `props`)にも `refreshTree: vi.fn().mockResolvedValue(true)` を足す。たとえば 44 行目付近は次のようになる。

```ts
    rerender({
      folderPath: '/p',
      fileTree: [],
      cliKind: 'copilot' as AgentCliKind,
      createFile: vi.fn(),
      openFile: vi.fn(),
      refreshTree: vi.fn().mockResolvedValue(true)
    })
```

`rerender({ folderPath: '/q', fileTree: [], cliKind: 'claude', createFile, openFile })` の形の行は `rerender({ folderPath: '/q', fileTree: [], cliKind: 'claude', createFile, openFile, refreshTree: vi.fn().mockResolvedValue(true) })` にする(`cliKind: 'copilot'` の行も同じ)。

- [ ] **Step 2: 失敗するテストを書く**

同じファイルの末尾(最後の `})` の前)に足す。import に `AGENT_INSTRUCTION_REFRESH_FAILED` を足す(`../../lib/agentInstructionMessages` から)。

```ts
  describe('refresh', () => {
    it('refreshTree を 1 回呼び、待つ間は isRefreshing。2 回目は呼ばない', async () => {
      let resolveRefresh: (applied: boolean) => void = () => undefined
      const refreshTree = vi.fn<UseAgentInstructionFilesOptions['refreshTree']>(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve
          })
      )
      const { result } = renderFiles({ refreshTree })
      let first: Promise<void> = Promise.resolve()
      let second: Promise<void> = Promise.resolve()
      act(() => {
        first = result.current.refresh()
        // 同じ tick の 2 回目も止める(state の反映を待たない。L-653)
        second = result.current.refresh()
      })
      expect(result.current.isRefreshing).toBe(true)
      expect(refreshTree).toHaveBeenCalledTimes(1)
      await act(async () => {
        resolveRefresh(true)
        await first
        await second
      })
      expect(result.current.isRefreshing).toBe(false)
      expect(result.current.message).toBeNull()
    })

    it('作成の途中 → refreshTree を呼ばない', async () => {
      let resolveCreate: (outcome: AgentInstructionCreateOutcome) => void = () => undefined
      const createFile = vi.fn<UseAgentInstructionFilesOptions['createFile']>(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve
          })
      )
      const refreshTree = vi
        .fn<UseAgentInstructionFilesOptions['refreshTree']>()
        .mockResolvedValue(true)
      const { result } = renderFiles({ createFile, refreshTree })
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.create(result.current.rows[0])
      })
      await act(async () => {
        await result.current.refresh()
      })
      expect(refreshTree).not.toHaveBeenCalled()
      await act(async () => {
        resolveCreate({ status: 'skipped' })
        await pending
      })
    })

    it('押す → 前の失敗の文言を消す', async () => {
      const createFile = vi
        .fn<UseAgentInstructionFilesOptions['createFile']>()
        .mockResolvedValue({ status: 'failed', reason: 'exists' })
      const { result } = renderFiles({ createFile })
      await act(async () => {
        await result.current.create(result.current.rows[0])
      })
      expect(result.current.message).not.toBeNull()
      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.message).toBeNull()
    })

    it('refreshTree が拒否する → 固定の文言を出し、例外の文言は出さない。refresh は拒否しない', async () => {
      const refreshTree = vi
        .fn<UseAgentInstructionFilesOptions['refreshTree']>()
        .mockRejectedValue(new Error('ENOENT: /secret/path'))
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { result } = renderFiles({ refreshTree })
      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.message).toBe(AGENT_INSTRUCTION_REFRESH_FAILED)
      expect(result.current.message).not.toContain('/secret/path')
      expect(result.current.isRefreshing).toBe(false)
      expect(consoleError).toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it('refreshTree が false(反映しなかった)→ 文言を出さない', async () => {
      const refreshTree = vi
        .fn<UseAgentInstructionFilesOptions['refreshTree']>()
        .mockResolvedValue(false)
      const { result } = renderFiles({ refreshTree })
      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.message).toBeNull()
    })

    it.each<[string, Partial<UseAgentInstructionFilesOptions>]>([
      ['フォルダ', { folderPath: '/q' }],
      ['CLI の種類', { cliKind: 'copilot' }]
    ])('待つ間に%sが切り替わってから拒否される → 文言を出さない', async (_label, change) => {
      let rejectRefresh: (err: Error) => void = () => undefined
      const refreshTree = vi.fn<UseAgentInstructionFilesOptions['refreshTree']>(
        () =>
          new Promise((_resolve, reject) => {
            rejectRefresh = reject
          })
      )
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const props: UseAgentInstructionFilesOptions = {
        folderPath: '/p',
        fileTree: [],
        cliKind: 'claude',
        createFile: vi.fn(),
        openFile: vi.fn(),
        refreshTree
      }
      const { result, rerender } = renderHook((p) => useAgentInstructionFiles(p), {
        initialProps: props
      })
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.refresh()
      })
      rerender({ ...props, ...change })
      await act(async () => {
        rejectRefresh(new Error('failed'))
        await pending
      })
      expect(result.current.message).toBeNull()
      expect(result.current.isRefreshing).toBe(false)
      consoleError.mockRestore()
    })
  })
```

- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts`
Expected: FAIL(`refresh` が無い・`AGENT_INSTRUCTION_REFRESH_FAILED` が無い)

- [ ] **Step 4: 文言を足す**

`src/renderer/src/lib/agentInstructionMessages.ts` の末尾に足す。

```ts
/** 節の `更新` で、ファイルツリーの読み直しが拒否されたとき(例外の文言は出さない。L-017) */
export const AGENT_INSTRUCTION_REFRESH_FAILED = 'ファイルツリーを読み直せませんでした'
```

- [ ] **Step 5: 状態の型を足す**

`src/renderer/src/types.ts` の `AgentInstructionsPanelState` の `openSubfolderFile` の後に足す。

```ts
  /** `更新` の途中(押した結果)。`更新` を aria-disabled にする */
  isRefreshing: boolean
  /** ファイルツリーを読み直す(useFileSystem.refreshTree を呼ぶだけ)。拒否しない */
  refresh: () => Promise<void>
```

- [ ] **Step 6: hook を実装する**

`src/renderer/src/hooks/useAgentInstructionFiles.ts`:

`UseAgentInstructionFilesOptions` に足す(`openFile` の後):

```ts
  /** useFileSystem.refreshTree(反映したら true。失敗は folderLoadError に書いてから投げ直す。エクスプローラーの赤字には出ない) */
  refreshTree: () => Promise<boolean>
```

引数の分割代入に `refreshTree` を足し、import の `agentInstructionMessages` に `AGENT_INSTRUCTION_REFRESH_FAILED` を足す。`creatingRef` の宣言の後に足す:

```ts
  const [isRefreshing, setIsRefreshing] = useState(false)
  // 多重の読み直しは ref で止める(state の反映を待たない。L-653)
  const refreshingRef = useRef(false)
```

`create` の後に足す:

```ts
  const refresh = async (): Promise<void> => {
    // 作成は終わりに自分でツリーを読み直すので、重ねて読まない
    if (creatingRef.current || refreshingRef.current) return
    refreshingRef.current = true
    setIsRefreshing(true)
    setMessage(null)
    const folderAtStart = folderPath
    const cliKindAtStart = cliKind
    try {
      // false(走査中で抑止した・古い結果・フォルダが無い)は失敗ではない。走査中の分は走査の後に useFileSystem が読み直す
      await refreshTree()
    } catch (err) {
      // refreshTree は失敗を folderLoadError にしか書かず、エクスプローラーの赤字に出ないので、節で伝える(L-001)。
      // 切り替え先の節に前のフォルダ・前の CLI の失敗を出さない(作成の showMessage と同じ扱い)
      console.error('[useAgentInstructionFiles] refresh failed:', err)
      if (folderPathRef.current === folderAtStart && cliKindRef.current === cliKindAtStart) {
        setMessage(AGENT_INSTRUCTION_REFRESH_FAILED)
      }
    } finally {
      refreshingRef.current = false
      setIsRefreshing(false)
    }
  }
```

戻り値に `isRefreshing` と `refresh` を足す。

- [ ] **Step 7: `useAppState` で `refreshTree` を渡す**

`src/renderer/src/hooks/useAppState.ts` の `useAgentInstructionFiles({ ... })`(376 行目付近)に 1 行足す。

```ts
  const agentInstructions = useAgentInstructionFiles({
    folderPath: fileSystem.folderPath,
    fileTree: fileSystem.fileTree,
    cliKind: agentWorkspace.agentTerminal.appCliKind,
    createFile: createAgentInstructionFile,
    openFile: selectFile,
    refreshTree: fileSystem.refreshTree
  })
```

- [ ] **Step 8: テスト用の状態に既定値を足す**

`src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts` の `openSubfolderFile` の行の後に足す。

```ts
  isRefreshing: false,
  refresh: vi.fn<AgentInstructionsPanelState['refresh']>().mockResolvedValue(undefined),
```

- [ ] **Step 9: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/hooks src/renderer/src/components`
Expected: PASS(`useAppState.test.ts` の偽の `fileSystem` は `refreshTree` を省略できる形のままでよい。押されない限り呼ばれない)

- [ ] **Step 10: 静的検査**

Run: `npx eslint src/renderer/src/lib/agentInstructionMessages.ts src/renderer/src/types.ts src/renderer/src/hooks/useAgentInstructionFiles.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/__tests__/makeAgentInstructionsPanelState.ts src/renderer/src/hooks/__tests__/useAgentInstructionFiles.test.ts --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 5: サブフォルダの一覧の画面(小見出し・開閉・注・上限)

**Files:**
- Modify: `src/renderer/src/lib/agentInstructionMessages.ts`
- Create: `src/renderer/src/components/explorer/AgentInstructionOpenButton.tsx`
- Create: `src/renderer/src/components/explorer/AgentInstructionSubfolderList.tsx`
- Modify: `src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx`
- Modify: `src/renderer/src/assets/main.css`(`.agent-instructions__message` の後)
- Test: `src/renderer/src/components/explorer/__tests__/AgentInstructionSubfolderList.test.tsx`(新規)
- Test: `src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx`
- Test: `src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx:245-251`

**Interfaces:**
- Consumes: Task 3 の `subfolderRows`・`subfolderTotal`・`subfolderNote`・`openSubfolderFile`
- Produces:
  - `AgentInstructionOpenButton` の props `{ relativePath: string; isBlocked: boolean; isCreating: boolean; onOpen: () => void }`
  - `AgentInstructionSubfolderList` の props `{ rows: readonly AgentInstructionSubfolderRow[]; total: number; note: string | null; isBlocked: boolean; isCreating: boolean; onOpen: (row: AgentInstructionSubfolderRow) => void }`
  - 文言 `agentInstructionSubfolderToggleLabel(total: number): string`・`AGENT_INSTRUCTION_SUBFOLDER_EMPTY`・`agentInstructionSubfolderHiddenLabel(count: number): string`・`AGENT_INSTRUCTION_THIS_FOLDER_HEADING`

- [ ] **Step 1: 失敗するテストを書く(部品)**

`src/renderer/src/components/explorer/__tests__/AgentInstructionSubfolderList.test.tsx` を作る。

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AgentInstructionSubfolderList from '../AgentInstructionSubfolderList'
import type { AgentInstructionSubfolderRow } from '../../../types'

const row = (relativePath: string, description = '共有の指示'): AgentInstructionSubfolderRow => ({
  relativePath,
  description,
  node: { name: relativePath.split('/').pop() ?? '', path: `/p/${relativePath}`, type: 'file' }
})

type Props = React.ComponentProps<typeof AgentInstructionSubfolderList>
const renderList = (overrides: Partial<Props> = {}): ReturnType<typeof render> & { props: Props } => {
  const props: Props = {
    rows: [row('src/CLAUDE.md'), row('src/CLAUDE.local.md', '個人の指示')],
    total: 2,
    note: null,
    isBlocked: false,
    isCreating: false,
    onOpen: vi.fn(),
    ...overrides
  }
  return { ...render(<AgentInstructionSubfolderList {...props} />), props }
}

const toggle = (): HTMLElement => screen.getByRole('button', { name: /^サブフォルダ\(/ })

describe('AgentInstructionSubfolderList', () => {
  it('既定 → 折りたたみ。件数入りの開閉のボタンだけを出す', () => {
    renderList()
    expect(toggle()).toHaveAccessibleName('サブフォルダ(2 件)')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('押す → 開き、aria-controls が注・一覧などを包む div を指す。もう一度押すと閉じる', async () => {
    renderList()
    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    const region = document.getElementById(toggle().getAttribute('aria-controls') ?? '')
    expect(region).not.toBeNull()
    expect(region).toContainElement(screen.getByRole('list'))
    expect(screen.getByRole('button', { name: 'src/CLAUDE.md を開く' })).toHaveTextContent('開く')
    expect(screen.getByText('個人の指示')).toBeInTheDocument()
    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('0 件で開く → 文言を出し、aria-controls の先がある', async () => {
    renderList({ rows: [], total: 0 })
    expect(toggle()).toHaveAccessibleName('サブフォルダ(0 件)')
    await userEvent.click(toggle())
    expect(screen.getByText('サブフォルダに指示ファイルはありません')).toBeInTheDocument()
    expect(document.getElementById(toggle().getAttribute('aria-controls') ?? '')).not.toBeNull()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('上限を超える → 件数は全件、最後に「ほか N 件」', async () => {
    renderList({ rows: [row('a/CLAUDE.md')], total: 12 })
    expect(toggle()).toHaveAccessibleName('サブフォルダ(12 件)')
    await userEvent.click(toggle())
    expect(screen.getByText('ほか 11 件(ファイルツリーから開いてください)')).toBeInTheDocument()
  })

  it('注 → 一覧の前に出し、一覧の aria-describedby が注を指す。role=alert にしない', async () => {
    const note = 'GitHub Copilot CLI は、サブフォルダの AGENTS.md を読まないことがあります(このアプリはフォルダの根で CLI を起動するため)'
    renderList({ rows: [row('src/AGENTS.md')], total: 1, note })
    await userEvent.click(toggle())
    expect(screen.getByRole('list')).toHaveAccessibleDescription(note)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('開く → その行で onOpen を呼ぶ', async () => {
    const { props } = renderList()
    await userEvent.click(toggle())
    await userEvent.click(screen.getByRole('button', { name: 'src/CLAUDE.local.md を開く' }))
    expect(props.onOpen).toHaveBeenCalledWith(props.rows[1])
  })

  it('clone 中 → 開くは disabled、開閉のボタンは押せる', async () => {
    renderList({ isBlocked: true })
    expect(toggle()).not.toBeDisabled()
    await userEvent.click(toggle())
    expect(screen.getByRole('button', { name: 'src/CLAUDE.md を開く' })).toBeDisabled()
  })

  it('作成の途中 → 開くは aria-disabled で押しても呼ばない。開閉のボタンは押せる', async () => {
    const { props } = renderList({ isCreating: true })
    expect(toggle()).not.toHaveAttribute('aria-disabled')
    await userEvent.click(toggle())
    const open = screen.getByRole('button', { name: 'src/CLAUDE.md を開く' })
    expect(open).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(open)
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(open)
  })

  it('開いた状態で 0 件になる → 開閉のボタンは残り、フォーカスを持ったまま', async () => {
    const { rerender, props } = renderList()
    await userEvent.click(toggle())
    const button = toggle()
    expect(document.activeElement).toBe(button)
    rerender(<AgentInstructionSubfolderList {...props} rows={[]} total={0} />)
    expect(toggle()).toBe(button)
    expect(document.activeElement).toBe(button)
  })
})
```

- [ ] **Step 2: 節のテストを足し、既存の「すべてのボタン」のテストを直す**

`AgentInstructionFilesSection.test.tsx` に足す。

```tsx
  it('小見出し「このフォルダ」の下に今の行、その下にサブフォルダの開閉のボタン', async () => {
    const subfolderRows = [
      {
        relativePath: 'src/CLAUDE.md',
        description: '共有の指示',
        node: { name: 'CLAUDE.md', path: '/p/src/CLAUDE.md', type: 'file' as const }
      }
    ]
    const state = makeAgentInstructionsPanelState({ subfolderRows, subfolderTotal: 1 })
    render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
    expect(screen.getByRole('heading', { level: 4, name: 'このフォルダ' })).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'サブフォルダ(1 件)' })
    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('button', { name: 'src/CLAUDE.md を開く' }))
    expect(state.openSubfolderFile).toHaveBeenCalledWith(subfolderRows[0])
  })
```

既存のテスト「clone 中 → すべてのボタンが disabled」を、開閉のボタン(`aria-expanded` を持つ)を除く形に直す。

```tsx
  it('clone 中 → 開閉のボタン以外のすべてのボタンが disabled', () => {
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ rows: claudeRows(['CLAUDE.md']) })}
        isBlocked
      />
    )
    for (const button of screen.getAllByRole('button')) {
      if (button.hasAttribute('aria-expanded')) expect(button).not.toBeDisabled()
      else expect(button).toBeDisabled()
    }
  })
```

「作成中 → disabled ではなく aria-disabled="true"」のテストの `for` も、開閉のボタンを除く。

```tsx
    for (const button of screen.getAllByRole('button')) {
      if (button.hasAttribute('aria-expanded')) continue
      expect(button).not.toBeDisabled()
      expect(button).toHaveAttribute('aria-disabled', 'true')
    }
```

`ExplorerPanel.test.tsx` の「clone の実行中 → 節のボタンがすべて disabled(isBlocked の配線)」の `for` も同じく直す。

```tsx
    for (const button of within(section).getAllByRole('button')) {
      if (!button.hasAttribute('aria-expanded')) expect(button).toBeDisabled()
    }
```

- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components/explorer`
Expected: FAIL(`AgentInstructionSubfolderList` が無い・小見出しが無い)

- [ ] **Step 4: 文言を足す**

`src/renderer/src/lib/agentInstructionMessages.ts` の末尾に足す。

```ts
/** 節の小見出し(設計書 2026-11-07「文言」) */
export const AGENT_INSTRUCTION_THIS_FOLDER_HEADING = 'このフォルダ'

/** サブフォルダの開閉のボタン。件数は上限で隠した分を含む全件 */
export function agentInstructionSubfolderToggleLabel(total: number): string {
  return `サブフォルダ(${total} 件)`
}

export const AGENT_INSTRUCTION_SUBFOLDER_EMPTY = 'サブフォルダに指示ファイルはありません'

/** 上限を超えて一覧に出さなかった分 */
export function agentInstructionSubfolderHiddenLabel(count: number): string {
  return `ほか ${count} 件(ファイルツリーから開いてください)`
}
```

- [ ] **Step 5: `開く` のボタンを共通の部品にする**

`src/renderer/src/components/explorer/AgentInstructionOpenButton.tsx` を作る。

```tsx
// 指示ファイルの節の `開く`(このフォルダ・サブフォルダで共通)。clone 中は押す前から押せないので disabled、作成の途中は押した結果
// として起きる状態なので aria-disabled にして押しても何もしない(disabled にするとフォーカスが body に落ちる。L-157)
interface Props {
  relativePath: string
  isBlocked: boolean
  isCreating: boolean
  onOpen: () => void
}

export default function AgentInstructionOpenButton({
  relativePath,
  isBlocked,
  isCreating,
  onOpen
}: Props): React.JSX.Element {
  return (
    <button
      type="button"
      className="agent-instructions__button"
      aria-label={`${relativePath} を開く`}
      disabled={isBlocked}
      aria-disabled={isCreating ? true : undefined}
      onClick={() => {
        if (!isCreating) onOpen()
      }}
    >
      開く
    </button>
  )
}
```

- [ ] **Step 6: サブフォルダの部品を作る**

`src/renderer/src/components/explorer/AgentInstructionSubfolderList.tsx` を作る。

```tsx
// 指示ファイルの節の「サブフォルダ」(設計書 2026-11-07「画面」「アクセシビリティ」)。開閉は WAI-ARIA の disclosure の形。
// 開閉のボタンは 0 件でも出す(件数で出し消しすると、読み直しで 0 件になったときにフォーカスが body に落ちる)
import { useId, useState } from 'react'
import type { AgentInstructionSubfolderRow } from '../../types'
import {
  AGENT_INSTRUCTION_SUBFOLDER_EMPTY,
  agentInstructionSubfolderHiddenLabel,
  agentInstructionSubfolderToggleLabel
} from '../../lib/agentInstructionMessages'
import AgentInstructionOpenButton from './AgentInstructionOpenButton'

interface Props {
  rows: readonly AgentInstructionSubfolderRow[]
  /** 見つかった全件の数(上限で隠した分を含む) */
  total: number
  note: string | null
  isBlocked: boolean
  isCreating: boolean
  onOpen: (row: AgentInstructionSubfolderRow) => void
}

export default function AgentInstructionSubfolderList({
  rows,
  total,
  note,
  isBlocked,
  isCreating,
  onOpen
}: Props): React.JSX.Element {
  // 既定は折りたたみ。保存はせず、節が出ている間は保つ(フォルダ・CLI の切り替えや読み直しでも戻さない)
  const [expanded, setExpanded] = useState(false)
  const regionId = useId()
  const noteId = useId()
  const hiddenCount = total - rows.length
  return (
    <>
      <h4 className="agent-instructions__subtitle">
        <button
          type="button"
          className="agent-instructions__toggle"
          aria-expanded={expanded}
          // 描画していない間は指す先が無いので付けない
          aria-controls={expanded ? regionId : undefined}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          {agentInstructionSubfolderToggleLabel(total)}
        </button>
      </h4>
      {expanded && (
        // 注・一覧・「ほか N 件」・0 件の文言をまとめて包む。0 件のときも描画し、aria-controls の先を必ず置く
        <div id={regionId} className="agent-instructions__subfolders">
          {total === 0 ? (
            <p className="agent-instructions__note">{AGENT_INSTRUCTION_SUBFOLDER_EMPTY}</p>
          ) : (
            <>
              {note !== null && (
                <p id={noteId} className="agent-instructions__note">
                  {note}
                </p>
              )}
              <ul
                className="agent-instructions__list"
                aria-describedby={note !== null ? noteId : undefined}
              >
                {rows.map((row) => (
                  <li key={row.node.path} className="agent-instructions__row">
                    <span className="agent-instructions__text">
                      <span className="agent-instructions__path">{row.relativePath}</span>
                      <span className="agent-instructions__description">{row.description}</span>
                    </span>
                    <AgentInstructionOpenButton
                      relativePath={row.relativePath}
                      isBlocked={isBlocked}
                      isCreating={isCreating}
                      onOpen={() => onOpen(row)}
                    />
                  </li>
                ))}
              </ul>
              {hiddenCount > 0 && (
                <p className="agent-instructions__note">
                  {agentInstructionSubfolderHiddenLabel(hiddenCount)}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 7: 節に小見出しとサブフォルダの部品を置く**

`AgentInstructionFilesSection.tsx` を変える。

- import に `AGENT_INSTRUCTION_THIS_FOLDER_HEADING`(`../../lib/agentInstructionMessages`)・`AgentInstructionOpenButton`・`AgentInstructionSubfolderList` を足す
- `<h3>` の直後(`<ul>` の前)に足す:

```tsx
      <h4 className="agent-instructions__subtitle">{AGENT_INSTRUCTION_THIS_FOLDER_HEADING}</h4>
```

- 行の `開く` の `<button>…開く</button>` を、共通の部品に置き換える:

```tsx
            {row.node !== null ? (
              <AgentInstructionOpenButton
                relativePath={row.relativePath}
                isBlocked={isBlocked}
                isCreating={creating}
                onOpen={() => state.open(row)}
              />
            ) : (
```

- `</ul>` の直後(文言の `role="alert"` の前)に足す:

```tsx
      <AgentInstructionSubfolderList
        rows={state.subfolderRows}
        total={state.subfolderTotal}
        note={state.subfolderNote}
        isBlocked={isBlocked}
        isCreating={creating}
        onOpen={state.openSubfolderFile}
      />
```

- [ ] **Step 8: 見た目を足す**

`src/renderer/src/assets/main.css` の `.agent-instructions__message { … }` の直後に足す。

```css
/* 節の小見出し(このフォルダ・サブフォルダ) */
.agent-instructions__subtitle {
  margin: 6px 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: #969696;
}

/* サブフォルダの開閉(disclosure)。文字だけの見た目で、押せる高さは他のボタンと同じ 32px */
.agent-instructions__toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 0;
  background: none;
  border: none;
  color: #cccccc;
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.agent-instructions__toggle:focus-visible {
  outline: 2px solid #007acc;
  outline-offset: -2px;
}

/* 注・「ほか N 件」・0 件の文言。長い文は折り返す */
.agent-instructions__note {
  margin: 2px 0;
  font-size: 12px;
  color: #969696;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 9: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components`
Expected: PASS

- [ ] **Step 10: 静的検査**

Run: `npx eslint src/renderer/src/lib/agentInstructionMessages.ts src/renderer/src/components/explorer/AgentInstructionOpenButton.tsx src/renderer/src/components/explorer/AgentInstructionSubfolderList.tsx src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx src/renderer/src/components/explorer/__tests__/AgentInstructionSubfolderList.test.tsx src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 6: 節の `更新` のボタンと App の配線のテスト

**Files:**
- Modify: `src/renderer/src/lib/agentInstructionMessages.ts`
- Modify: `src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx`
- Modify: `src/renderer/src/assets/main.css`(`.agent-instructions__title` の付近)
- Test: `src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx`
- Test: `src/renderer/src/components/__tests__/App.agentInstructions.test.tsx`

**Interfaces:**
- Consumes: Task 4 の `isRefreshing`・`refresh`、Task 5 の節の形
- Produces: 文言 `AGENT_INSTRUCTION_REFRESH_TEXT = '更新'`・`AGENT_INSTRUCTION_REFRESH_LABEL = '指示ファイルの一覧を更新'`・`AGENT_INSTRUCTION_REFRESH_TITLE = 'ファイルツリーを読み直して、指示ファイルを探し直します'`

- [ ] **Step 1: 失敗するテストを書く(節)**

`AgentInstructionFilesSection.test.tsx` の型の import を `import type { AgentInstructionFileRow, AgentInstructionsPanelState } from '../../../types'` にし、次を足す。

```tsx
  describe('更新', () => {
    const refreshButton = (): HTMLElement =>
      screen.getByRole('button', { name: '指示ファイルの一覧を更新' })

    it('見出しの行に出す。文字は 更新、title で何をするかを示す。押すと refresh を呼ぶ', async () => {
      const state = makeAgentInstructionsPanelState()
      render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
      expect(refreshButton()).toHaveTextContent('更新')
      expect(refreshButton()).toHaveAttribute(
        'title',
        'ファイルツリーを読み直して、指示ファイルを探し直します'
      )
      await userEvent.click(refreshButton())
      expect(state.refresh).toHaveBeenCalledTimes(1)
    })

    it('clone 中 → disabled', () => {
      render(<AgentInstructionFilesSection state={makeAgentInstructionsPanelState()} isBlocked />)
      expect(refreshButton()).toBeDisabled()
    })

    it.each<[string, Partial<AgentInstructionsPanelState>]>([
      ['作成の途中', { isCreating: true }],
      ['更新の途中', { isRefreshing: true }]
    ])('%s → aria-disabled で、押しても refresh を呼ばず、フォーカスが残る', async (_label, change) => {
      const state = makeAgentInstructionsPanelState(change)
      render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
      const button = refreshButton()
      expect(button).not.toBeDisabled()
      expect(button).toHaveAttribute('aria-disabled', 'true')
      await userEvent.click(button)
      expect(state.refresh).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(button)
    })

    it('読み直しの失敗の文言 → 節の role=alert に出す', () => {
      render(
        <AgentInstructionFilesSection
          state={makeAgentInstructionsPanelState({
            message: 'ファイルツリーを読み直せませんでした'
          })}
          isBlocked={false}
        />
      )
      expect(screen.getByRole('alert')).toHaveTextContent('ファイルツリーを読み直せませんでした')
    })
  })
```

既存のテスト「作成中でなければ aria-disabled を付けない」は、そのままで通る(`isRefreshing` の既定は false)。

- [ ] **Step 2: 失敗するテストを書く(App の配線)**

`App.agentInstructions.test.tsx` の `describe` の中に足す。

```tsx
  it('サブフォルダの CLAUDE.md → 開閉のボタンを開いて 開く を押すとそのファイルを読む', async () => {
    const withSub: FileTreeNode[] = [
      {
        name: 'src',
        path: '/p/src',
        type: 'directory',
        children: [{ name: 'CLAUDE.md', path: '/p/src/CLAUDE.md', type: 'file' }]
      },
      ...before
    ]
    window.api.readDirectory = vi.fn().mockResolvedValue(withSub)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await screen.findByRole('button', { name: 'サブフォルダ(1 件)' }))
    await userEvent.click(screen.getByRole('button', { name: 'src/CLAUDE.md を開く' }))
    await waitFor(() => expect(window.api.readFile).toHaveBeenCalledWith('/p/src/CLAUDE.md'))
  })

  it('更新 → ツリーを読み直し、外で足したサブフォルダのファイルとこのフォルダの行が新しくなる', async () => {
    const added: FileTreeNode[] = [
      { name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' },
      {
        name: 'src',
        path: '/p/src',
        type: 'directory',
        children: [{ name: 'CLAUDE.md', path: '/p/src/CLAUDE.md', type: 'file' }]
      },
      ...before
    ]
    // 読み込みの回数に頼らず、フォルダを開いた後に外で足したことにする
    let tree = before
    window.api.readDirectory = vi.fn(async () => tree)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    expect(await screen.findByRole('button', { name: 'サブフォルダ(0 件)' })).toBeInTheDocument()
    tree = added
    await userEvent.click(screen.getByRole('button', { name: '指示ファイルの一覧を更新' }))
    expect(await screen.findByRole('button', { name: 'サブフォルダ(1 件)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CLAUDE.md を開く' })).toBeInTheDocument()
  })

  it('更新の失敗 → 節に固定の文言を出し、例外の文言は出さない', async () => {
    let fails = false
    window.api.readDirectory = vi.fn(async () => {
      if (fails) throw new Error('EACCES: /p/secret')
      return before
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    const refreshButton = await screen.findByRole('button', { name: '指示ファイルの一覧を更新' })
    fails = true
    await userEvent.click(refreshButton)
    const section = screen.getByRole('region', { name: 'エージェントの指示ファイル(Claude Code)' })
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'ファイルツリーを読み直せませんでした'
    )
    expect(screen.queryByText(/EACCES/)).not.toBeInTheDocument()
    consoleError.mockRestore()
  })
```

- [ ] **Step 3: 失敗を確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx src/renderer/src/components/__tests__/App.agentInstructions.test.tsx`
Expected: FAIL(`指示ファイルの一覧を更新` のボタンが無い)。サブフォルダを開く App のテストは Task 5 までで通ってよい

- [ ] **Step 4: 文言を足す**

`src/renderer/src/lib/agentInstructionMessages.ts` の末尾に足す。

```ts
/** 節の `更新`。aria-label はソース管理のツールバーの `更新`(↻)と読み上げで区別する */
export const AGENT_INSTRUCTION_REFRESH_TEXT = '更新'
export const AGENT_INSTRUCTION_REFRESH_LABEL = '指示ファイルの一覧を更新'
export const AGENT_INSTRUCTION_REFRESH_TITLE = 'ファイルツリーを読み直して、指示ファイルを探し直します'
```

- [ ] **Step 5: 見出しの行に `更新` を置く**

`AgentInstructionFilesSection.tsx` の `<h3 …>…</h3>` を、見出しの行の `div` で包み、右に `更新` を置く。import に 3 つの文言を足す。

```tsx
      <div className="agent-instructions__header">
        <h3 id={headingId} className="agent-instructions__title">
          エージェントの指示ファイル({AGENT_CLI_PROFILES[state.cliKind].displayName})
        </h3>
        {/* clone 中は押す前から押せないので disabled。作成の途中(作成が自分で読み直す)と更新の途中は押した結果なので
            aria-disabled にして押しても何もしない(L-157)。フォルダの走査中は押せる(refreshTree が走査の後に読み直す) */}
        <button
          type="button"
          className="agent-instructions__button"
          aria-label={AGENT_INSTRUCTION_REFRESH_LABEL}
          title={AGENT_INSTRUCTION_REFRESH_TITLE}
          disabled={isBlocked}
          aria-disabled={creating || state.isRefreshing ? true : undefined}
          onClick={() => {
            if (!creating && !state.isRefreshing) void state.refresh()
          }}
        >
          {AGENT_INSTRUCTION_REFRESH_TEXT}
        </button>
      </div>
```

- [ ] **Step 6: 見出しの行の見た目**

`src/renderer/src/assets/main.css` の `.agent-instructions__title { … }` の直後に足す。

```css
/* 見出しの行。見出しが長いときは見出しの文字を折り返し、`更新` は行の右端に残す */
.agent-instructions__header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 4px;
}

.agent-instructions__header .agent-instructions__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 7: 通ることを確かめる**

Run: `NODE_ENV=test npx vitest run src/renderer/src/components`
Expected: PASS(`ExplorerPanel.styles.test.tsx` の、作成の途中の `aria-disabled` が半透明になるテストも、そのまま通る)

- [ ] **Step 8: 静的検査**

Run: `npx eslint src/renderer/src/lib/agentInstructionMessages.ts src/renderer/src/components/explorer/AgentInstructionFilesSection.tsx src/renderer/src/components/explorer/__tests__/AgentInstructionFilesSection.test.tsx src/renderer/src/components/__tests__/App.agentInstructions.test.tsx --max-warnings 0 && npm run typecheck`
Expected: エラー無し

---

### Task 7: ROADMAP・README・開発者ガイドの更新、テスト仕様書への追記と全体の検証

**Files:**
- Modify: `ROADMAP.md`(709〜714 行目の「エージェント向けの指示ファイルの編集支援」の節と、814〜815 行目の項目)
- Modify: `README.md:11`
- Modify: `docs/developer-guide.md:106`
- Modify: `docs/manual-test-spec.md`(EXP-085 の後、`## エディタ` の前)

**Interfaces:**
- Consumes: Task 1〜6 の完成した機能
- Produces: なし

- [ ] **Step 1: ROADMAP の実装済みの節に足す**

`ROADMAP.md` の `### エージェント向けの指示ファイルの編集支援` の最後の項目(`- [x] フォルダの切り替えの途中…`)の後に足す。

```markdown
- [x] 節を小見出し `このフォルダ`・`サブフォルダ(N 件)` に分け、サブフォルダの指示ファイル(claude: `CLAUDE.md`・`CLAUDE.local.md`、copilot: `AGENTS.md`)を一覧して開く。ファイルツリーから探し、ツリーの読み直しに連動する。節の `更新` でファイルツリーを読み直す。既定は折りたたみ、上限は 50 件(超えた分は `ほか N 件`)。作成は出さない。copilot には読まないことがある旨の注を出す(2026-11-07。設計書 `docs/superpowers/specs/2026-11-07-agent-instruction-files-subfolders-design.md`)

既知の制約(設計書の「既知の制約」と同じ):
- 外部(ターミナルやエージェント CLI)で足した・消した指示ファイルは、ツリーを読み直すまで出ない。節の `更新` を押す(自動の反映は file watcher)
- 探すのはファイルツリーに出ている範囲だけ。`SKIP_DIRS`(`node_modules`・`.git`・`out`・`dist`・`.next`)の中と、6 段目以降のフォルダの中は探さない。`.gitignore` を見ないので、worktree の中(`.worktrees/<名前>/CLAUDE.md` など)も並ぶ
- copilot(1.0.106)は、このアプリから起動したときはサブフォルダの `AGENTS.md` を読まないことがある。一覧に出ていても CLI に効いているとは限らない
```

- [ ] **Step 2: ROADMAP の項目の説明と「残り」を直す**

`- [x] エージェント向けの指示ファイル(`CLAUDE.md` など)の編集支援` の説明の行(815 行目)の末尾の「残り: …」の前に 1 文を足し、残りから「サブフォルダの指示ファイルの探索、」を消す。直した後の行の後半は次のようになる。

```markdown
…を一覧し、あれば開く、無ければ見出しだけの雛形で作って開く。実装済み(2026-11-07。設計書 `docs/superpowers/specs/2026-11-07-agent-instruction-files-subfolders-design.md`): サブフォルダの指示ファイルの一覧と、節の `更新`。残り: 利用者の全体の指示ファイル(`~/.claude/CLAUDE.md` など)、プロンプトの内容の追記、外部での追加・削除の自動の反映(file watcher)
```

- [ ] **Step 3: README を直す**

`README.md` の 11 行目の「エクスプローラーの上部から、エージェントの指示ファイル（`CLAUDE.md`・`AGENTS.md` など）を開く・雛形で作ることもできます。」の後に足す。

```markdown
サブフォルダにある指示ファイルも一覧から開けます。
```

- [ ] **Step 4: 開発者ガイドを直す**

`docs/developer-guide.md` の 106 行目の `src/shared/agentInstructionFiles.ts`〈指示ファイルの一覧と雛形〉を、〈指示ファイルの一覧と雛形・サブフォルダで探す名前〉に直す。

- [ ] **Step 5: テスト仕様書に追記する**

`docs/manual-test-spec.md` の **EXP-085** の行の後(`## エディタ` の前)に、設計書の「8. 実機テスト仕様書の項目の案」の `### サブフォルダのエージェントの指示ファイル` から **EXP-097** までを、そのまま写す(前提の行を含む。ID は案のとおりで、変えない)。

- [ ] **Step 6: HTML を再生成する**

Run: `node scripts/build-manual-test-spec.mjs`
Expected: エラー無しで `.superpowers/manual-test-spec.html` を書き出す

- [ ] **Step 7: 仕様書の書式の検査**

Run: `NODE_ENV=test npx vitest run scripts`
Expected: PASS(ID の一意性・接頭辞ごとの連番の昇順・書式)

- [ ] **Step 8: 全体の検証**

Run: `NODE_ENV=test npm test`
Expected: PASS

Run: `npm run typecheck`
Expected: エラー無し

Run: `npx eslint . --max-warnings 0`
Expected: エラー・警告無し

Run: `npm run build`
Expected: 成功

---

## 自己点検(設計書との対応)

- 表(設計書 3 章「表」)→ Task 1
- 探索・並べ方・上限・除外・相対パス(「探索」)→ Task 2
- 状態の計算・`openSubfolderFile`(「状態」)→ Task 3
- `更新` の手順・失敗の文言・切り替えの扱い・`refreshTree` の配線(「`更新` のボタン」「状態」「部品」)→ Task 4(hook)・Task 6(画面)
- 小見出し・開閉・注・`ほか N 件`・0 件・`aria-controls` の `div`・フォーカス(「画面」「アクセシビリティ」)→ Task 5
- 文言の表 → Task 4(失敗)・Task 5(サブフォルダ)・Task 6(`更新`)
- テスト方針(4 章)→ 各タスクの Step 1・2
- 実機テスト仕様書・ROADMAP・README・開発者ガイド(8・9 章)→ Task 7
