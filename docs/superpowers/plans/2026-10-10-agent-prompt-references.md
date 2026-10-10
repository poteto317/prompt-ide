# エージェントへ送るプロンプトへの参照の添付 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェント CLI 方式で、開いているファイル・エディタの選択範囲・エクスプローラで選んだファイルを、`claude` の `@` 参照（`@src/app.ts`・`@src/app.ts#L10-20`）としてプロンプトの末尾に添えられるようにする（プロンプトパネルのチップ・エクスプローラの右クリック・未保存の注意）。

**Architecture:** 参照の文字列の組み立ては純粋な関数（`lib/agentReferences.ts`）に置く。エディタの選択の行の範囲は `useEditorSelectionRange` が `EditorPanel` の新しい prop `onEditorMount` から追い、チップのオン・オフ・エクスプローラから足したファイル・後始末・未保存の判定は `useAgentReferences` が持つ（どちらも `useAppState` で使う）。`usePromptRunner` はエージェント CLI 方式の分岐で、押した時点の参照の写し（`prepare()`）を本文の末尾へ足し、`sendToAgent` の第 2 引数のオプション（`{ promptId, unsavedPaths, onSent }`）で未保存の一覧と「送れたら足したファイルを外す」知らせを運ぶ。送信前の確認のダイアログは未保存の注意を出し、読み上げは App の常設の `aria-live` を 1 つ足して出す。

**Tech Stack:** React 19, TypeScript, Electron, Monaco（`@monaco-editor/react`）, Vitest, Testing Library

**設計書:** `docs/superpowers/specs/2026-10-10-agent-prompt-references-design.md`（承認済み。実装の前に必ず読む）

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
> - アクティブなタブが差分のタブのときの「開いているファイル」の押せない理由は、`開いているファイルがありません` ではなく `差分のタブは参照にできません` にする（実ファイルのタブは開いているため、取り違えないように）。そのため `useAgentReferences` は、`activeFile`（`useFileSystem.openFile`。差分のタブの表示中も実ファイルを指す）とは別に `isDiffTabActive` を受け取る。
> - 押せないチップは、パスの代わりに `開いているファイル`・`選択範囲` を出す（`title` と `aria-describedby` で理由）。押せるチップの `title` は `開いているファイルを参照として添える`・`選択範囲を参照として添える`。理由の要素は視覚的に隠した `span`（`.agent-announcer` と同じ規則）にする。
> - `未保存` の印は、設計書のとおりオンにしたチップのファイルに未保存の変更があるときだけ出す。エクスプローラから足したファイルは未保存の判定に含めない（設計書の範囲）。
> - `sendToAgent` の第 2 引数の型 `AgentSendOptions`（`promptId: string | null`・`unsavedPaths: readonly string[]`・`onSent?: () => void`）は `src/renderer/src/types.ts` に置き、`usePromptRunner`・`useAgentWorkspace`・`useAgentSendConfirm` で共有する。`onSent` は送信の結果が `sent` のときだけ、新しい `notifyAgentSent`（`lib/agentSendCallbacks.ts`）から呼ぶ（`onSent` が投げても、確認の後のフォーカスの移動・結果の返却を止めない。L-053）。`PendingAgentSend` は `AgentSendOptions` を継承し、`AgentSendConfirmPending` に `unsavedPaths` を足す。
> - 配線の漏れを型で検出するため（L-060）、`EditorPanel.onEditorMount`・`PromptsPanel.agentReferences`・`Sidebar.agentReferences`・`usePromptRunner` の `agentReferences` は省略できない形にする（`ExplorerPanel.onAddReference` と `ExplorerMenuActions.onAddReference` は設計書のとおり「渡したときだけ出す」ので省略できる）。`App` の配線は、実物の hook を通す `App.agentReferences.test.tsx` で確かめる。
> - 参照の行は、プロンプトパネルの送信の結果の文言の下・検索欄の上に置く（「プロンプトの一覧の上」）。
> - `appendAgentReferences` は、本文の末尾の改行（`\r`・`\n`）を落としてから空行を 1 つ挟む（末尾が改行の本文でも空行が 2 つ以上にならない）。本文が空なら参照の一覧だけを返す。
> - `buildAgentReferenceList` の選択範囲の入力は `AgentReference`（`{ path, lineRange }`）にする。「ファイル全体を先に」は、選択範囲のファイルがエクスプローラから足されているとき、そのファイル全体の参照を選択範囲より先に出すことで満たす。
> - `toWorkspaceRelativePath` は `isPathInside` を使うため、POSIX のルート（`/`）をフォルダとして開いたときは参照にできない（`null`）。既知の制約として ROADMAP に書く。
> - 読み上げは `Announcement`（`{ id, text }`）で持ち、`toAnnouncementText` で文字列にして常設の `AgentAnnouncer` に渡す（外してから同じファイルを足し直したときも読み上げ直す。パターン 87）。
> - `×` で外したボタンは消えるため、外した後のフォーカスを同じ位置の次の `×` へ、無ければ参照の行（`tabIndex={-1}` の `role="group"`）へ移す（body に落とさない）。
> - エクスプローラの `参照として添える` は、ファイルのメニューの末尾（`.gitignore に追加` の後）に足す。
> - 確認を開いている間は背景がモーダルで覆われ、エクスプローラから足せない。「確認を開いている間に足したものは残す」は `useAgentReferences` と `usePromptRunner` の単体テストだけで確かめ、実機テスト仕様書の項目にしない（L-297。画面から通れない経路）。

## Global Constraints

- コメント・文言は日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。クライアントのコンポーネントには `'use client'`
- 参照の書式（設計書「参照の書式」）: 本文の後に空行を 1 つ挟んで `参照:` の行と `- @<相対パス>` の行を足す（参照が 1 つも無ければ何も足さない）。相対パスは開いているフォルダからの相対で区切りは `/`（POSIX のファイル名の `\` は変えない）。選択範囲はパスの直後に空白なしで `#L10-20`、1 行なら `#L10`。選択の終わりが列 1 で開始行より後なら、その行は含めない。同じ参照は 1 回にまとめ、行の範囲の有無が違うものは両方出す（ファイル全体を先に）。並びは開いているファイル → 選択範囲 → エクスプローラから足した順
- 文言: 参照の行の名前 `参照`、押せないチップ `開いているファイル`・`選択範囲`、押せない理由 `開いているファイルがありません`・`差分のタブは参照にできません`・`フォルダの外のファイルは参照にできません`・`エディタで範囲を選ぶと添えられます`、押せるチップの `title` `開いているファイルを参照として添える`・`選択範囲を参照として添える`、印 `未保存`、外すボタンの `aria-label` `@docs/notes.md を参照から外す`、メニュー `参照として添える`、読み上げ `参照に @docs/notes.md を足しました`、ダイアログの注意 `未保存の変更があるファイルは、保存するまで claude に見えません: src/app.ts`（複数は `、` で区切る）
- 対象はエージェント CLI 方式でフォルダを開いているときだけ（従来の方式は今のまま。`usePromptRunner` の従来の方式の分岐は変えない）。参照は本文の後に足すので、先頭が `!` かの判定は変わらない。長さの上限は足した後の全文で判定する（既存の送信前の確認のまま）
- `onSent` は送信の結果が `sent` のときだけ呼ぶ（確認がオンなら確認から送れたとき、オフならすぐ送って送れたとき）。確認のキャンセル・フォルダの切り替えなどで閉じたとき・送信の失敗では呼ばない。エクスプローラから足したファイルは、`実行` を押した時点の写しの分だけ外す。開いているファイル・選択範囲のオン・オフは送った後も保つ
- フォルダの切り替え・従来の方式への切り替えで、エクスプローラから足したファイルを外し、開いているファイル・選択範囲をオフに戻す（L-405）
- チップと `×` はタッチで押せる大きさ（`min-height: 32px`、`×` は `min-width: 32px` も）。色は既存の `main.css` のダークテーマの固定色に合わせる
- `react-hooks/set-state-in-effect`（eslint-plugin-react-hooks 7）: effect の本体で setState を直接呼ぶと lint が落ちる。フォルダ・方式の切り替えの後始末は既存の `useOnChange`（effect の中で渡した関数を呼ぶ）を使う
- テストのタイマーは後始末で必ず解除する（CLAUDE.md）。`act(...).then(...)` で書かない。`console.error` の spy は `afterEach` で戻す。テストの補助関数にも戻り値の型を書く（`@typescript-eslint/explicit-function-return-type`）
- 気をつける知見（dev-flow-kit の review-lessons.md）: **L-060**（同じ形の値を各階層で取り違えても型とテストが通る → 省略できない props と、実物の hook を通す配線のテスト）、**L-405**（元の状態が終わる契機〈フォルダの切り替え・方式の切り替え・送れた〉で後始末する）、**L-407**（既存の流れに処理を挟むときの副作用の時点。参照の写しは `実行` を押した時点、足したファイルを外すのは送れた時点）、**L-156**（見える文字を含むアクセシブルな名前。チップの名前は見えている `@src/app.ts 未保存` そのもの）、**L-297**（実機テスト仕様書の項目が確かめたい経路を通ること）
- **コミットしない。** 各タスクの最後は検証だけ（`npx vitest run <変更したテスト>`、`npm run typecheck`、変更した TypeScript のファイルへの `npx eslint --fix` → `npx eslint --max-warnings 0`）

---

### Task 1: 参照の純粋な関数と文言（`agentReferences.ts`・`agentReferenceMessages.ts`）

**Files:**
- Create: `src/renderer/src/lib/agentReferences.ts`
- Create: `src/renderer/src/lib/agentReferenceMessages.ts`
- Test: `src/renderer/src/lib/__tests__/agentReferences.test.ts`（新規）

**Interfaces:**
- Produces:
```ts
// src/renderer/src/lib/agentReferences.ts
export interface LineSelection {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}
export interface AgentReference {
  path: string // フォルダからの相対パス('/' 区切り)
  lineRange: string | null // '#L10-20'・'#L10'。ファイル全体なら null
}
export interface AgentReferenceListInput {
  openFile: string | null
  selection: AgentReference | null
  added: readonly string[]
}
export const AGENT_REFERENCES_HEADING = '参照:'
export function toWorkspaceRelativePath(folderPath: string, filePath: string): string | null
export function formatLineRange(selection: LineSelection): string
export function formatAgentReference(reference: AgentReference): string
export function buildAgentReferenceList(input: AgentReferenceListInput): AgentReference[]
export function appendAgentReferences(text: string, references: readonly AgentReference[]): string

// src/renderer/src/lib/agentReferenceMessages.ts
export const AGENT_REFERENCE_GROUP_LABEL = '参照'
export const AGENT_REFERENCE_CHIP_FALLBACK_LABELS: { openFile: '開いているファイル'; selection: '選択範囲' }
export const AGENT_REFERENCE_TOGGLE_TITLES: { openFile: string; selection: string }
export const AGENT_REFERENCE_DISABLED_REASONS: { noOpenFile: string; diffTab: string; outsideFolder: string; noSelection: string }
export const AGENT_REFERENCE_UNSAVED_MARK = '未保存'
export const AGENT_REFERENCE_MENU_LABEL = '参照として添える'
export function formatAgentReferenceAddedAnnouncement(label: string): string
export function formatAgentReferenceRemoveLabel(label: string): string
export function formatAgentUnsavedNotice(paths: readonly string[]): string
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentReferences.test.ts`（新規）:
```ts
import { describe, it, expect } from 'vitest'
import {
  appendAgentReferences,
  buildAgentReferenceList,
  formatAgentReference,
  formatLineRange,
  toWorkspaceRelativePath
} from '../agentReferences'
import type { AgentReference } from '../agentReferences'
import {
  formatAgentReferenceAddedAnnouncement,
  formatAgentReferenceRemoveLabel,
  formatAgentUnsavedNotice
} from '../agentReferenceMessages'

const whole = (path: string): AgentReference => ({ path, lineRange: null })
const ranged = (path: string, lineRange: string): AgentReference => ({ path, lineRange })

describe('toWorkspaceRelativePath', () => {
  it.each([
    ['フォルダの直下', '/repo', '/repo/a.ts', 'a.ts'],
    ['深い階層', '/repo', '/repo/src/lib/util.ts', 'src/lib/util.ts'],
    ['フォルダの末尾の区切り', '/repo/', '/repo/src/a.ts', 'src/a.ts'],
    ['Windows の区切りは / にそろえる', 'C:\\Proj', 'C:\\Proj\\src\\a.ts', 'src/a.ts'],
    [
      'Windows の大文字小文字の違いと末尾の区切り(ファイルの表記のまま)',
      'C:\\Proj\\',
      'c:\\proj\\src\\A.ts',
      'src/A.ts'
    ],
    ['POSIX のファイル名の \\ は変えない', '/repo', '/repo/dir\\name.ts', 'dir\\name.ts']
  ])('%s', (_label, folderPath, filePath, expected) => {
    expect(toWorkspaceRelativePath(folderPath, filePath)).toBe(expected)
  })

  it.each([
    ['フォルダの外', '/repo', '/other/a.ts'],
    ['名前が前方一致するだけの別のフォルダ', '/repo', '/repository/a.ts'],
    ['フォルダそのもの', '/repo', '/repo'],
    ['POSIX のルートを開いたとき(既知の制約)', '/', '/a.ts']
  ])('%s は null', (_label, folderPath, filePath) => {
    expect(toWorkspaceRelativePath(folderPath, filePath)).toBeNull()
  })
})

describe('formatLineRange', () => {
  it.each([
    ['複数行', { startLineNumber: 10, startColumn: 3, endLineNumber: 20, endColumn: 5 }, '#L10-20'],
    ['1 行の中', { startLineNumber: 10, startColumn: 3, endLineNumber: 10, endColumn: 8 }, '#L10'],
    [
      '終わりが列 1 なら、その行は含めない',
      { startLineNumber: 10, startColumn: 1, endLineNumber: 13, endColumn: 1 },
      '#L10-12'
    ],
    [
      '1 行を丸ごと選んだ(次の行の列 1 まで)',
      { startLineNumber: 10, startColumn: 1, endLineNumber: 11, endColumn: 1 },
      '#L10'
    ]
  ])('%s', (_label, selection, expected) => {
    expect(formatLineRange(selection)).toBe(expected)
  })
})

describe('formatAgentReference', () => {
  it('パスの前に @、直後に行の範囲を空白なしで付ける', () => {
    expect(formatAgentReference(whole('src/a.ts'))).toBe('@src/a.ts')
    expect(formatAgentReference(ranged('src/a.ts', '#L1-2'))).toBe('@src/a.ts#L1-2')
  })
})

describe('buildAgentReferenceList', () => {
  it('開いているファイル → 選択範囲 → エクスプローラから足した順に並べる', () => {
    expect(
      buildAgentReferenceList({
        openFile: 'src/app.ts',
        selection: ranged('src/util.ts', '#L10-20'),
        added: ['docs/notes.md', 'docs/b.md']
      })
    ).toEqual([
      whole('src/app.ts'),
      ranged('src/util.ts', '#L10-20'),
      whole('docs/notes.md'),
      whole('docs/b.md')
    ])
  })

  it('同じ参照は 1 回にまとめる', () => {
    expect(
      buildAgentReferenceList({
        openFile: 'src/app.ts',
        selection: null,
        added: ['src/app.ts', 'docs/a.md', 'docs/a.md']
      })
    ).toEqual([whole('src/app.ts'), whole('docs/a.md')])
  })

  it('同じファイルの全体と選択範囲は別の参照として両方出す(ファイル全体を先に)', () => {
    expect(
      buildAgentReferenceList({
        openFile: 'src/app.ts',
        selection: ranged('src/app.ts', '#L10'),
        added: []
      })
    ).toEqual([whole('src/app.ts'), ranged('src/app.ts', '#L10')])
    // 全体の参照がエクスプローラから足されていても、選択範囲より先に出す
    expect(
      buildAgentReferenceList({
        openFile: null,
        selection: ranged('src/app.ts', '#L10'),
        added: ['docs/a.md', 'src/app.ts']
      })
    ).toEqual([whole('src/app.ts'), ranged('src/app.ts', '#L10'), whole('docs/a.md')])
  })

  it('何も無ければ空', () => {
    expect(buildAgentReferenceList({ openFile: null, selection: null, added: [] })).toEqual([])
  })
})

describe('appendAgentReferences', () => {
  it('参照が無ければ本文のまま(末尾の改行も変えない)', () => {
    expect(appendAgentReferences('本文\n', [])).toBe('本文\n')
  })

  it('本文の後に空行を 1 つ挟んで、参照: と - @… の行を足す', () => {
    expect(appendAgentReferences('本文', [whole('src/app.ts')])).toBe(
      '本文\n\n参照:\n- @src/app.ts'
    )
  })

  it('複数の参照を並べ、本文の末尾の改行は落としてから空行を 1 つだけ挟む', () => {
    expect(
      appendAgentReferences('本文\r\n\n', [whole('src/a.ts'), ranged('src/a.ts', '#L1-2')])
    ).toBe('本文\n\n参照:\n- @src/a.ts\n- @src/a.ts#L1-2')
  })

  it('本文が空なら参照の一覧だけ', () => {
    expect(appendAgentReferences('', [whole('a.ts')])).toBe('参照:\n- @a.ts')
  })
})

describe('文言', () => {
  it('読み上げ・外すボタン・未保存の注意', () => {
    expect(formatAgentReferenceAddedAnnouncement('@docs/notes.md')).toBe(
      '参照に @docs/notes.md を足しました'
    )
    expect(formatAgentReferenceRemoveLabel('@docs/notes.md')).toBe('@docs/notes.md を参照から外す')
    expect(formatAgentUnsavedNotice(['src/app.ts', 'docs/a.md'])).toBe(
      '未保存の変更があるファイルは、保存するまで claude に見えません: src/app.ts、docs/a.md'
    )
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentReferences.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/agentReferences.ts`（新規）:
```ts
import { isPathInside, normalizePathSeparators, stripTrailingSeparators } from './pathUtils'

// エージェントへ送るプロンプトに添える参照(claude の `@相対パス`)の組み立て(設計書「参照の書式」)。純粋な関数だけを置く

/** エディタの選択の範囲(Monaco の Selection・IRange はこの形を満たす。開始は終わりより前) */
export interface LineSelection {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/** 1 つの参照。path は開いているフォルダからの相対パス('/' 区切り)、lineRange は `#L10-20` のような行の範囲(ファイル全体なら null) */
export interface AgentReference {
  path: string
  lineRange: string | null
}

export interface AgentReferenceListInput {
  /** オンにした開いているファイル(相対パス)。無ければ null */
  openFile: string | null
  /** オンにした選択範囲。無ければ null */
  selection: AgentReference | null
  /** エクスプローラから足したファイル(相対パス。足した順) */
  added: readonly string[]
}

/** 参照の一覧の見出しの行 */
export const AGENT_REFERENCES_HEADING = '参照:'

/**
 * 開いているフォルダからの相対パス('/' 区切り)。フォルダの外・フォルダそのものなら null。
 * フォルダの中かは区切り・末尾の区切り・(Windows の)大文字小文字を吸収して判定する(isPathInside)。POSIX のルート('/')を
 * 開いたときは isPathInside が false を返すため参照にできない(既知の制約)
 */
export function toWorkspaceRelativePath(folderPath: string, filePath: string): string | null {
  if (!isPathInside(filePath, folderPath)) return null
  // 区切りの統一は Windows のパスだけ(POSIX のファイル名の '\\' は変えない)。表記が違っても長さは同じなので、
  // 正規化したフォルダの長さの位置で切り出せる(quickOpenSearch の toRelativePath と同じ)
  const normalizedFile = normalizePathSeparators(filePath)
  const normalizedFolder = stripTrailingSeparators(normalizePathSeparators(folderPath))
  return normalizedFile.slice(normalizedFolder.length + 1)
}

/** 行の範囲(`#L10-20`、1 行なら `#L10`)。Claude Code の IDE 連携が選択範囲の参照に使う書式に合わせる */
export function formatLineRange(selection: LineSelection): string {
  const start = selection.startLineNumber
  // 終わりが行頭(列 1)で開始行より後なら、その行は含めない(行を丸ごと選んだときの見た目に合わせる)
  const end =
    selection.endColumn === 1 && selection.endLineNumber > start
      ? selection.endLineNumber - 1
      : selection.endLineNumber
  return start === end ? `#L${start}` : `#L${start}-${end}`
}

/** `@src/app.ts`・`@src/app.ts#L10-20`(パスと行の範囲の間に空白を入れない。claude は空白までをパスとみなす) */
export function formatAgentReference(reference: AgentReference): string {
  return `@${reference.path}${reference.lineRange ?? ''}`
}

/** 送る参照の一覧。並びは開いているファイル → 選択範囲 → エクスプローラから足した順。同じ参照は 1 回にまとめる */
export function buildAgentReferenceList({
  openFile,
  selection,
  added
}: AgentReferenceListInput): AgentReference[] {
  const references: AgentReference[] = []
  const push = (reference: AgentReference): void => {
    if (references.some((r) => r.path === reference.path && r.lineRange === reference.lineRange)) {
      return
    }
    references.push(reference)
  }
  if (openFile !== null) push({ path: openFile, lineRange: null })
  if (selection !== null) {
    // 同じファイルの全体の参照(エクスプローラから足したもの)があれば、選択範囲より先に出す(ファイル全体を先に)
    if (selection.lineRange !== null && added.includes(selection.path)) {
      push({ path: selection.path, lineRange: null })
    }
    push(selection)
  }
  for (const path of added) push({ path, lineRange: null })
  return references
}

/** 本文の末尾に、空行を 1 つ挟んで参照の一覧を足す。参照が無ければ本文のまま */
export function appendAgentReferences(text: string, references: readonly AgentReference[]): string {
  if (references.length === 0) return text
  const block = [
    AGENT_REFERENCES_HEADING,
    ...references.map((reference) => `- ${formatAgentReference(reference)}`)
  ].join('\n')
  // 末尾が改行の本文でも空行が 2 つ以上にならないよう、末尾の改行を落としてから挟む。本文が空なら一覧だけ
  const body = text.replace(/[\r\n]+$/, '')
  return body === '' ? block : `${body}\n\n${block}`
}
```

`src/renderer/src/lib/agentReferenceMessages.ts`（新規）:
```ts
// エージェントへ送るプロンプトの参照(チップ・エクスプローラのメニュー・読み上げ・送信前の確認の注意)の文言

/** プロンプトパネルの参照の行の名前 */
export const AGENT_REFERENCE_GROUP_LABEL = '参照'

/** 押せないチップに、パスの代わりに出す文言 */
export const AGENT_REFERENCE_CHIP_FALLBACK_LABELS = {
  openFile: '開いているファイル',
  selection: '選択範囲'
} as const

/** 押せるチップの title(何を添えるか) */
export const AGENT_REFERENCE_TOGGLE_TITLES = {
  openFile: '開いているファイルを参照として添える',
  selection: '選択範囲を参照として添える'
} as const

/** チップを押せない理由(title と aria-describedby で出す) */
export const AGENT_REFERENCE_DISABLED_REASONS = {
  noOpenFile: '開いているファイルがありません',
  diffTab: '差分のタブは参照にできません',
  outsideFolder: 'フォルダの外のファイルは参照にできません',
  noSelection: 'エディタで範囲を選ぶと添えられます'
} as const

/** オンにしたチップのファイルに未保存の変更があるときの印 */
export const AGENT_REFERENCE_UNSAVED_MARK = '未保存'

/** エクスプローラの右クリックのメニューの項目 */
export const AGENT_REFERENCE_MENU_LABEL = '参照として添える'

/** エクスプローラから足したときの読み上げ */
export const formatAgentReferenceAddedAnnouncement = (label: string): string =>
  `参照に ${label} を足しました`

/** エクスプローラから足したファイルを外すボタンの名前 */
export const formatAgentReferenceRemoveLabel = (label: string): string => `${label} を参照から外す`

/** 送信前の確認のダイアログの未保存の注意(パスは表示用の相対パス) */
export const formatAgentUnsavedNotice = (paths: readonly string[]): string =>
  `未保存の変更があるファイルは、保存するまで claude に見えません: ${paths.join('、')}`
```

- [ ] **Step 4: テストを通す・型チェック・lint**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentReferences.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: `npx eslint --fix src/renderer/src/lib/agentReferences.ts src/renderer/src/lib/agentReferenceMessages.ts src/renderer/src/lib/__tests__/agentReferences.test.ts`
Run: `npx eslint --max-warnings 0 src/renderer/src/lib/agentReferences.ts src/renderer/src/lib/agentReferenceMessages.ts src/renderer/src/lib/__tests__/agentReferences.test.ts`
Expected: エラー・警告なし

---

### Task 2: エディタの選択の行の範囲の追跡（`useEditorSelectionRange`）と `EditorPanel.onEditorMount`

**Files:**
- Create: `src/renderer/src/hooks/useEditorSelectionRange.ts`
- Modify: `src/renderer/src/components/EditorPanel.tsx`（prop `onEditorMount` を足し、`onMount` から呼ぶ）
- Modify: `src/renderer/src/hooks/useAppState.ts`（`useEditorSelectionRange` を使い、`attachEditorSelection` を公開する）
- Modify: `src/renderer/src/App.tsx`（`EditorPanel` に `onEditorMount={attachEditorSelection}`）
- Modify: `src/renderer/src/components/__tests__/EditorPanel.test.tsx`・`EditorPanel.applyOutput.test.tsx`・`EditorPanel.agentTerminal.test.tsx`（base の props に `onEditorMount: vi.fn()`）
- Test: `src/renderer/src/hooks/__tests__/useEditorSelectionRange.test.ts`（新規）、`src/renderer/src/components/__tests__/EditorPanel.applyOutput.test.tsx`

**Interfaces:**
- Consumes: `LineSelection`（Task 1、`lib/agentReferences.ts`）、既存の `isEmptySelection(selection: IRange): boolean`（`lib/applyToEditor.ts`）
- Produces:
```ts
// src/renderer/src/hooks/useEditorSelectionRange.ts
export interface SelectionRangeEditor {
  getModel(): object | null
  getSelection(): LineSelection | null
  onDidChangeCursorSelection(listener: (event: { selection: LineSelection }) => void): { dispose(): void }
  onDidDispose(listener: () => void): { dispose(): void }
}
export interface EditorLineSelection {
  filePath: string // マウントの時点の openFile.path(絶対パス)
  range: LineSelection
}
export interface EditorSelectionRangeState {
  selection: EditorLineSelection | null // 空の選択・エディタが無いときは null
  attachEditor: (instance: SelectionRangeEditor, filePath: string) => void
}
export function useEditorSelectionRange(): EditorSelectionRangeState
// EditorPanel の Props
onEditorMount: (editor: SelectionRangeEditor, filePath: string) => void
// useAppState の戻り値
attachEditorSelection: EditorSelectionRangeState['attachEditor']
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useEditorSelectionRange.test.ts`（新規）:
```ts
import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useEditorSelectionRange } from '../useEditorSelectionRange'
import type { EditorSelectionRangeState } from '../useEditorSelectionRange'
import {
  collapsedSelection,
  makeFakeTrackedEditor,
  selectionOf
} from '../../__tests__/makeFakeApplyEditor'

// 偽のエディタ(makeFakeTrackedEditor)は、選択の変更・破棄の通知をテストから起こせる。購読の数(listenerCount)で解除を確かめる
const APP = '/repo/src/app.ts'
const NOTES = '/repo/docs/notes.md'
const lines10to20 = selectionOf(10, 3, 20, 5, 20, 5)

const renderSelection = (): RenderHookResult<EditorSelectionRangeState, unknown> =>
  renderHook(() => useEditorSelectionRange())

describe('useEditorSelectionRange', () => {
  it('エディタがマウントされるまでは選択が無い', () => {
    const { result } = renderSelection()
    expect(result.current.selection).toBeNull()
  })

  it('マウントの時点の空でない選択を、マウントの時点のファイルのパスと一緒に持つ', () => {
    const { result } = renderSelection()
    act(() =>
      result.current.attachEditor(makeFakeTrackedEditor({ selection: lines10to20 }).editor, APP)
    )
    expect(result.current.selection).toEqual({
      filePath: APP,
      range: { startLineNumber: 10, startColumn: 3, endLineNumber: 20, endColumn: 5 }
    })
  })

  it('マウントの時点の選択が空・取れないなら選択は無い', () => {
    const { result } = renderSelection()
    act(() => result.current.attachEditor(makeFakeTrackedEditor().editor, APP))
    expect(result.current.selection).toBeNull()
    act(() => result.current.attachEditor(makeFakeTrackedEditor({ selection: null }).editor, APP))
    expect(result.current.selection).toBeNull()
  })

  it('選択の変化に追従し、空になったら選択を無しにする', () => {
    const { result } = renderSelection()
    const fake = makeFakeTrackedEditor()
    act(() => result.current.attachEditor(fake.editor, APP))
    act(() => fake.select(lines10to20))
    expect(result.current.selection?.range.endLineNumber).toBe(20)
    act(() => fake.select(collapsedSelection(3, 1)))
    expect(result.current.selection).toBeNull()
  })

  it('同じ範囲の通知では、選択の値を作り直さない(描画を増やさない)', () => {
    const { result } = renderSelection()
    const fake = makeFakeTrackedEditor({ selection: lines10to20 })
    act(() => result.current.attachEditor(fake.editor, APP))
    const first = result.current.selection
    act(() => fake.select(selectionOf(10, 3, 20, 5, 10, 3)))
    expect(result.current.selection).toBe(first)
  })

  it('エディタが外れたら(破棄)選択を無しにし、購読を外す', () => {
    const { result } = renderSelection()
    const fake = makeFakeTrackedEditor({ selection: lines10to20 })
    act(() => result.current.attachEditor(fake.editor, APP))
    act(() => fake.dispose())
    expect(result.current.selection).toBeNull()
    expect(fake.listenerCount()).toBe(0)
  })

  it('別のファイルのエディタへ付け替えたら、前のエディタの購読を外し、新しいファイルのパスで追う', () => {
    const { result } = renderSelection()
    const first = makeFakeTrackedEditor({ selection: lines10to20 })
    const second = makeFakeTrackedEditor({ selection: selectionOf(2, 1, 4, 1, 4, 1) })
    act(() => result.current.attachEditor(first.editor, APP))
    act(() => result.current.attachEditor(second.editor, NOTES))
    expect(first.listenerCount()).toBe(0)
    expect(result.current.selection?.filePath).toBe(NOTES)
    // 前のエディタの通知(選択の変化・破棄)は、新しいエディタの選択を変えない
    act(() => first.select(collapsedSelection(1, 1)))
    act(() => first.dispose())
    expect(result.current.selection).toEqual({
      filePath: NOTES,
      range: { startLineNumber: 2, startColumn: 1, endLineNumber: 4, endColumn: 1 }
    })
  })

  it('破棄済みのインスタンス(遅れて届いたマウントの通知)は追わず、それまでの選択も無しにする', () => {
    const { result } = renderSelection()
    const live = makeFakeTrackedEditor({ selection: lines10to20 })
    act(() => result.current.attachEditor(live.editor, APP))
    const disposed = makeFakeTrackedEditor({ model: null, selection: lines10to20 })
    act(() => result.current.attachEditor(disposed.editor, NOTES))
    expect(result.current.selection).toBeNull()
    expect(disposed.listenerCount()).toBe(0)
    expect(live.listenerCount()).toBe(0)
  })

  it('アンマウントで購読を外す', () => {
    const { result, unmount } = renderSelection()
    const fake = makeFakeTrackedEditor()
    act(() => result.current.attachEditor(fake.editor, APP))
    unmount()
    expect(fake.listenerCount()).toBe(0)
  })
})
```

`src/renderer/src/components/__tests__/EditorPanel.applyOutput.test.tsx`:
- import に足す: `import type { SelectionRangeEditor } from '../../hooks/useEditorSelectionRange'`
- `baseProps` の末尾（`isConflictBlocked: false` の次）に `onEditorMount: vi.fn<(editor: SelectionRangeEditor, filePath: string) => void>()` を足す。
- ファイルの末尾に足す:
```tsx
describe('EditorPanel: エディタのマウントの通知(onEditorMount)', () => {
  it('現在のファイルのエディタがマウントされたら、そのエディタとマウントの時点のファイルのパスを渡す', () => {
    const onEditorMount = vi.fn<(editor: SelectionRangeEditor, filePath: string) => void>()
    render(<EditorPanel {...baseProps} onEditorMount={onEditorMount} />)
    expect(onEditorMount).toHaveBeenCalledOnce()
    const [instance, filePath] = onEditorMount.mock.calls[0]
    expect(filePath).toBe(file.path)
    expect(instance.getModel()).toBe(mockEditorModel.current)
  })

  it('差分のタブの表示中はエディタをマウントしないので呼ばない', () => {
    const onEditorMount = vi.fn<(editor: SelectionRangeEditor, filePath: string) => void>()
    const diffTab: DiffTabKey = { path: file.path, kind: 'unstaged' }
    render(
      <EditorPanel
        {...baseProps}
        diffTabs={[diffTab]}
        activeDiffTab={diffTab}
        diffContent=""
        onEditorMount={onEditorMount}
      />
    )
    expect(onEditorMount).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/components/__tests__/EditorPanel.test.tsx` の `defaultProps` と `EditorPanel.agentTerminal.test.tsx` の `baseProps` の末尾に、`onEditorMount: vi.fn(),` を足す（型エラーを防ぐだけ。振る舞いは上で確かめる）。

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useEditorSelectionRange.test.ts src/renderer/src/components/__tests__/EditorPanel.applyOutput.test.tsx`
Expected: FAIL（モジュールが無い・`onEditorMount` が呼ばれない）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/useEditorSelectionRange.ts`（新規）:
```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { isEmptySelection } from '../lib/applyToEditor'
import type { LineSelection } from '../lib/agentReferences'

interface Disposable {
  dispose(): void
}

/** 選択の行の範囲を追うエディタ。Monaco の IStandaloneCodeEditor はこの形を満たす */
export interface SelectionRangeEditor {
  getModel(): object | null
  getSelection(): LineSelection | null
  onDidChangeCursorSelection(listener: (event: { selection: LineSelection }) => void): Disposable
  onDidDispose(listener: () => void): Disposable
}

/** アクティブなエディタの空でない選択と、そのエディタのファイル */
export interface EditorLineSelection {
  /** マウントの時点の openFile.path(エディタはファイルごとに付け替わる。EditorPanel の key) */
  filePath: string
  range: LineSelection
}

export interface EditorSelectionRangeState {
  /** アクティブなエディタの空でない選択。選択が空・エディタが無い(差分のタブ・ファイルを閉じた)ときは null */
  selection: EditorLineSelection | null
  /** 現在のファイルのエディタがマウントされたときに呼ぶ(EditorPanel の onEditorMount)。前のエディタの購読を外し、このエディタを追う */
  attachEditor: (instance: SelectionRangeEditor, filePath: string) => void
}

const toLineSelection = (
  filePath: string,
  range: LineSelection | null
): EditorLineSelection | null =>
  range === null || isEmptySelection(range)
    ? null
    : {
        filePath,
        // Monaco の Selection はクラスのインスタンスなので、比べる 4 つの値だけを写す
        range: {
          startLineNumber: range.startLineNumber,
          startColumn: range.startColumn,
          endLineNumber: range.endLineNumber,
          endColumn: range.endColumn
        }
      }

const isSameSelection = (a: EditorLineSelection | null, b: EditorLineSelection | null): boolean =>
  a === null || b === null
    ? a === b
    : a.filePath === b.filePath &&
      a.range.startLineNumber === b.range.startLineNumber &&
      a.range.startColumn === b.range.startColumn &&
      a.range.endLineNumber === b.range.endLineNumber &&
      a.range.endColumn === b.range.endColumn

// アクティブなエディタの選択の行の範囲と、そのエディタのファイルのパスを状態として追う(エージェントへ送るプロンプトの参照の
// 「選択範囲」。設計書「構成」)。購読はマウントの通知(attachEditor)で張り、破棄の通知(onDidDispose)・次のマウント・アンマウントで外す。
// 出力パネルの反映先の追跡(useTrackedEditorSelection)と同じ形だが、持つ値(行の範囲とパス)と使う側が違うため分ける
export function useEditorSelectionRange(): EditorSelectionRangeState {
  const [selection, setSelection] = useState<EditorLineSelection | null>(null)
  const subscriptionsRef = useRef<Disposable[]>([])

  // カーソルが動くたびに通知が来るため、範囲が変わらなければ同じ値のままにする(描画を増やさない)
  const update = useCallback((next: EditorLineSelection | null): void => {
    setSelection((prev) => (isSameSelection(prev, next) ? prev : next))
  }, [])

  const detach = useCallback((): void => {
    for (const subscription of subscriptionsRef.current) subscription.dispose()
    subscriptionsRef.current = []
  }, [])

  const attachEditor = useCallback(
    (instance: SelectionRangeEditor, filePath: string): void => {
      // 前のエディタの購読を外す。外さないと、前のエディタの破棄の通知が新しいエディタの選択を消す
      detach()
      // 破棄済みのインスタンス(遅れて届いたマウントの通知)は追わない
      if (instance.getModel() === null) {
        setSelection(null)
        return
      }
      subscriptionsRef.current = [
        instance.onDidChangeCursorSelection((event) => {
          update(toLineSelection(filePath, event.selection))
        }),
        instance.onDidDispose(() => {
          detach()
          setSelection(null)
        })
      ]
      update(toLineSelection(filePath, instance.getSelection()))
    },
    [detach, update]
  )

  // アンマウント時は、エディタの購読を外す(エディタより先にフックの持ち主が消える場合に備える)
  useEffect(() => detach, [detach])

  return { selection, attachEditor }
}
```

`src/renderer/src/components/EditorPanel.tsx`:
- import に足す: `import type { SelectionRangeEditor } from '../hooks/useEditorSelectionRange'`
- `Props` の `isConflictBlocked: boolean` の次に足す:
```ts
  /** 現在のファイルのエディタがマウントされたときに呼ぶ(useAppState の attachEditorSelection。エージェントへ送るプロンプトの参照の
   *  「選択範囲」を追う)。filePath はマウントの時点の openFile.path(エディタはファイルごとに付け替わる)。省略できない(L-060) */
  onEditorMount: (editor: SelectionRangeEditor, filePath: string) => void
```
- 分割代入の `isConflictBlocked,` の次に `onEditorMount,` を足す。
- `<Editor>` の `onMount` の `attachEditor(editorInstance)` の次に足す:
```tsx
                    onEditorMount(editorInstance, openFile.path)
```

`src/renderer/src/hooks/useAppState.ts`:
- import に足す:
```ts
import { useEditorSelectionRange } from './useEditorSelectionRange'
import type { EditorSelectionRangeState } from './useEditorSelectionRange'
```
- `AppState` の `externalChangeBanner: ExternalChangeBannerState | null` の次に足す:
```ts
  /** エディタのマウントの通知(EditorPanel の onEditorMount)。アクティブなエディタの選択の行の範囲を追い、参照の「選択範囲」に使う */
  attachEditorSelection: EditorSelectionRangeState['attachEditor']
```
- `const promptRunner = usePromptRunner({` の直前に足す:
```ts
  // アクティブなエディタの選択の行の範囲(エージェントへ送るプロンプトの参照の「選択範囲」)
  const editorSelection = useEditorSelectionRange()
```
- 戻り値の `externalChangeBanner,` の次に `attachEditorSelection: editorSelection.attachEditor,` を足す。

`src/renderer/src/App.tsx`:
- `useAppState()` の分割代入の `externalChangeBanner,` の次に `attachEditorSelection,` を足す。
- `<EditorPanel` の `agentChangesReview={agentChangesReview}` の次に `onEditorMount={attachEditorSelection}` を足す。

- [ ] **Step 4: テストを通す・型チェック・lint**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useEditorSelectionRange.test.ts src/renderer/src/components/__tests__/EditorPanel.test.tsx src/renderer/src/components/__tests__/EditorPanel.applyOutput.test.tsx src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/__tests__/App.test.tsx`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: `npx eslint --fix src/renderer/src/hooks/useEditorSelectionRange.ts src/renderer/src/components/EditorPanel.tsx src/renderer/src/hooks/useAppState.ts src/renderer/src/App.tsx src/renderer/src/hooks/__tests__/useEditorSelectionRange.test.ts src/renderer/src/components/__tests__/EditorPanel.test.tsx src/renderer/src/components/__tests__/EditorPanel.applyOutput.test.tsx src/renderer/src/components/__tests__/EditorPanel.agentTerminal.test.tsx`
Run: `npx eslint --max-warnings 0` に同じファイルを渡す
Expected: エラー・警告なし

---

### Task 3: `sendToAgent` のオプション化（`promptId`・`unsavedPaths`・`onSent`）と確認のダイアログの未保存の注意

**Files:**
- Modify: `src/renderer/src/types.ts`（`AgentSendOptions` を足し、`AgentSendConfirmPending` に `unsavedPaths`）
- Create: `src/renderer/src/lib/agentSendCallbacks.ts`
- Modify: `src/renderer/src/hooks/useAgentSendConfirm.ts`（`request` の第 2 引数・`PendingAgentSend`・送れたときの `onSent`）
- Modify: `src/renderer/src/hooks/useAgentWorkspace.ts`（`sendToAgent` の第 2 引数・すぐ送るときの `onSent`・確認の状態の `unsavedPaths`）
- Modify: `src/renderer/src/hooks/usePromptRunner.ts`（`Deps.sendToAgent` の型。今は `{ promptId: prompt.id, unsavedPaths: [] }` を渡す）
- Modify: `src/renderer/src/components/agent/AgentSendConfirmDialog.tsx`（未保存の注意）
- Modify: `src/renderer/src/assets/main.css`（`.agent-send-confirm__unsaved`）
- Test: `src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts`（新規）、`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`、`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`、`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`、`src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx`、`src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx`・`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`（`pending` の値に `unsavedPaths: []` を足すだけ）

**Interfaces:**
- Consumes: `formatAgentUnsavedNotice(paths: readonly string[]): string`（Task 1）
- Produces:
```ts
// src/renderer/src/types.ts
export interface AgentSendOptions {
  promptId: string | null
  unsavedPaths: readonly string[]
  onSent?: () => void
}
export interface AgentSendConfirmPending {
  text: string
  slotId: string
  label: string
  promptId: string | null
  unsavedPaths: readonly string[] // 追加
}
// src/renderer/src/lib/agentSendCallbacks.ts
export function notifyAgentSent(outcome: AgentSendOutcome | undefined, onSent: (() => void) | undefined): void
// src/renderer/src/hooks/useAgentSendConfirm.ts
export interface PendingAgentSend extends AgentSendOptions { text: string; target: AgentSendTarget; label: string }
request: (text: string, options: AgentSendOptions) => void
// src/renderer/src/hooks/useAgentWorkspace.ts(AgentWorkspaceState)
sendToAgent: (text: string, options: AgentSendOptions) => ReturnType<AgentPromptSenderState['send']>
// src/renderer/src/hooks/usePromptRunner.ts(Deps)
sendToAgent: (text: string, options: AgentSendOptions) => Promise<unknown>
```

- [ ] **Step 1: 既存のテストを新しい引数の形に直す**

`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`:
- import に足す: `import type { AgentSendOptions } from '../../types'`。`@testing-library/react` の import に `waitFor` を足す。
- `const SENT: AgentSendOutcome = ...` の次に足す:
```ts
// request の第 2 引数(送る元のプロンプト・未保存の一覧)
const opts = (promptId: string | null, unsavedPaths: readonly string[] = []): AgentSendOptions => ({
  promptId,
  unsavedPaths
})
```
- 呼び出しを置き換える: `perl -pi -e "s/request\('(\w+)', ('p\d'|null)\)/request('\1', opts(\2))/g" src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts`（10 か所が `request('hello', opts('p1'))` の形になる）
- `request で開き、…` のテストの `expect(result.current.pending).toEqual({ … promptId: 'p1' })` の `promptId: 'p1'` の次に `unsavedPaths: []` を足す。

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`:
- 呼び出しを置き換える: `perl -pi -e "s/sendToAgent\('(\w+)', ('p\d'|null)\)/sendToAgent('\1', { promptId: \2, unsavedPaths: [] })/g" src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts`（4 か所）
- `設定がオンなら送らずに確認を開き、…` のテストの `pending` の `toEqual` の `promptId: 'p1'` の次に `unsavedPaths: []` を足す。

`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts` の `エージェント CLI 方式では本文だけをエージェントへ送り、…` のテストの期待を直す:
```ts
    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith('送る本文', {
      promptId: 'p1',
      unsavedPaths: []
    })
```

`src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx` の `makePending` の既定の `promptId: 'p1',` の次に `unsavedPaths: [],` を足す。`src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx`（2 か所）と `src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`（1 か所）の `pending: { text: '本文', slotId: 'slot-1', label: 'claude 1', promptId: 'p1' }` を `pending: { text: '本文', slotId: 'slot-1', label: 'claude 1', promptId: 'p1', unsavedPaths: [] }` にする。

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts`（新規）:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { notifyAgentSent } from '../agentSendCallbacks'

let consoleErrorSpy: MockInstance<typeof console.error> | null = null

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
})

describe('notifyAgentSent', () => {
  it('送れた(sent)ときだけ onSent を呼ぶ', () => {
    const onSent = vi.fn()
    notifyAgentSent({ kind: 'sent', clearedDraft: false }, onSent)
    expect(onSent).toHaveBeenCalledOnce()
  })

  it('失敗・結果なし(undefined)では呼ばない', () => {
    const onSent = vi.fn()
    notifyAgentSent({ kind: 'failed', reason: 'input-not-found' }, onSent)
    notifyAgentSent(undefined, onSent)
    expect(onSent).not.toHaveBeenCalled()
  })

  it('onSent が無ければ何もしない', () => {
    expect(() => notifyAgentSent({ kind: 'sent', clearedDraft: false }, undefined)).not.toThrow()
  })

  it('onSent が投げても呼び出し元へ投げず、理由を記録する(L-053)', () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onSent = vi.fn(() => {
      throw new Error('broken')
    })
    expect(() => notifyAgentSent({ kind: 'sent', clearedDraft: false }, onSent)).not.toThrow()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[notifyAgentSent] onSent failed:',
      expect.any(Error)
    )
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts` の末尾に足す:
```ts
describe('useAgentSendConfirm: 未保存の一覧と送れたときの知らせ(onSent)', () => {
  it('request の未保存の一覧と onSent を、開いた確認に控える', () => {
    const { result } = renderConfirm()
    const onSent = vi.fn()
    act(() => result.current.request('hello', { ...opts('p1', ['src/a.ts']), onSent }))
    expect(result.current.pending?.unsavedPaths).toEqual(['src/a.ts'])
    expect(result.current.pending?.onSent).toBe(onSent)
  })

  it('confirm で送れた(sent)ら、onSendSettled の前に onSent を呼ぶ', async () => {
    const calls: string[] = []
    const onSent = vi.fn(() => {
      calls.push('onSent')
    })
    const { result, onSendSettled } = renderConfirm()
    onSendSettled.mockImplementation(() => {
      calls.push('settled')
    })
    act(() => result.current.request('hello', { ...opts('p1'), onSent }))
    act(() => result.current.confirm())
    await waitFor(() => expect(onSendSettled).toHaveBeenCalledOnce())
    expect(calls).toEqual(['onSent', 'settled'])
  })

  it.each([
    ['失敗した', vi.fn<UseAgentSendConfirmOptions['send']>(async () => ({ kind: 'failed', reason: 'input-not-found' }))],
    ['結果が無い(undefined)', vi.fn<UseAgentSendConfirmOptions['send']>(async () => undefined)]
  ])('送信が%sときは onSent を呼ばない', async (_label, send) => {
    const onSent = vi.fn()
    const { result, onSendSettled } = renderConfirm({ send })
    act(() => result.current.request('hello', { ...opts('p1'), onSent }))
    act(() => result.current.confirm())
    await waitFor(() => expect(onSendSettled).toHaveBeenCalledOnce())
    expect(onSent).not.toHaveBeenCalled()
  })

  it('cancel では onSent を呼ばない', () => {
    const onSent = vi.fn()
    const { result } = renderConfirm()
    act(() => result.current.request('hello', { ...opts('p1'), onSent }))
    act(() => result.current.cancel())
    expect(onSent).not.toHaveBeenCalled()
  })

  it('onSent が投げても onSendSettled を呼ぶ(フォーカスの移動を止めない。L-053)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onSent = vi.fn(() => {
      throw new Error('broken')
    })
    const { result, onSendSettled } = renderConfirm()
    act(() => result.current.request('hello', { ...opts('p1'), onSent }))
    act(() => result.current.confirm())
    await waitFor(() =>
      expect(onSendSettled).toHaveBeenCalledExactlyOnceWith({
        slotId: 'slot-1',
        promptId: 'p1',
        outcome: SENT
      })
    )
  })
})
```

`src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts` の `describe('送信前の確認', …)` の中、`確認のキャンセルで閉じ、送らない` のテストの前に足す:
```ts
    it('設定がオフなら、すぐ送って送れた(sent)ときだけ onSent を呼ぶ', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(false)
      const sender = makeSender({
        send: vi.fn<AgentPromptSenderState['send']>(async () => ({
          kind: 'sent',
          clearedDraft: false
        }))
      })
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const onSent = vi.fn()
      const { result } = renderWorkspace()
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [], onSent })
      })
      expect(onSent).toHaveBeenCalledOnce()
    })

    it('設定がオフで送信が失敗したら onSent を呼ばない', async () => {
      setMode('agent-cli')
      setSendConfirmEnabled(false)
      mockUseAgentPromptSender.mockReturnValue(
        makeSender({
          send: vi.fn<AgentPromptSenderState['send']>(async () => ({
            kind: 'failed',
            reason: 'input-not-found'
          }))
        })
      )
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const onSent = vi.fn()
      const { result } = renderWorkspace()
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [], onSent })
      })
      expect(onSent).not.toHaveBeenCalled()
    })

    it('確認を開いたら、未保存の一覧を確認の状態に持たせ、確認から送れたときだけ onSent を呼ぶ', async () => {
      setMode('agent-cli')
      mockUseAgentPromptSender.mockReturnValue(
        makeSender({
          send: vi.fn<AgentPromptSenderState['send']>(async () => ({
            kind: 'sent',
            clearedDraft: false
          }))
        })
      )
      const { tab1, tab2 } = twoRunningTabs()
      setTabs([tab1, tab2], 'slot-2')
      const onSent = vi.fn()
      const { result } = renderWorkspace()
      await act(async () => {
        await result.current.sendToAgent('hello', {
          promptId: 'p1',
          unsavedPaths: ['src/a.ts'],
          onSent
        })
      })
      expect(result.current.agentSendConfirmDialog.pending?.unsavedPaths).toEqual(['src/a.ts'])
      expect(onSent).not.toHaveBeenCalled()
      act(() => result.current.agentSendConfirmDialog.onConfirm())
      await waitFor(() => expect(onSent).toHaveBeenCalledOnce())
    })

    it('確認をキャンセルしたら onSent を呼ばない', async () => {
      setMode('agent-cli')
      const sender = makeSender()
      mockUseAgentPromptSender.mockReturnValue(sender)
      mockUseAgentSessions.mockReturnValue(
        makeAgentSessionsState({ selected: { status: 'running' } })
      )
      const onSent = vi.fn()
      const { result } = renderWorkspace()
      await act(async () => {
        await result.current.sendToAgent('hello', { promptId: 'p1', unsavedPaths: [], onSent })
      })
      act(() => result.current.agentSendConfirmDialog.onCancel())
      expect(sender.send).not.toHaveBeenCalled()
      expect(onSent).not.toHaveBeenCalled()
    })
```

`src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx` の `describe('AgentSendConfirmDialog', …)` の中、`describe('表示', …)` の後に足す:
```tsx
  describe('未保存の注意', () => {
    const NOTICE =
      '未保存の変更があるファイルは、保存するまで claude に見えません: src/app.ts、docs/a.md'

    it('未保存のファイルがあれば注意を出し、ダイアログの説明に含める(送信は止めない)', () => {
      render(
        <AgentSendConfirmDialog
          state={makeState({ pending: makePending({ unsavedPaths: ['src/app.ts', 'docs/a.md'] }) })}
        />
      )
      expect(within(getDialog()).getByText(NOTICE)).toBeInTheDocument()
      expect(getDialog()).toHaveAccessibleDescription(`送り先: claude 2 ${NOTICE}`)
      expect(submitButton()).toBeEnabled()
    })

    it('未保存のファイルが無ければ注意を出さない', () => {
      render(<AgentSendConfirmDialog state={makeState()} />)
      expect(screen.queryByText(/未保存の変更があるファイル/)).toBeNull()
    })
  })
```

- [ ] **Step 3: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx`
Expected: FAIL（`agentSendCallbacks` が無い・`unsavedPaths`・`onSent` が扱われない）

- [ ] **Step 4: 実装する**

`src/renderer/src/types.ts`:
- `AgentSendConfirmPending` の `promptId: string | null` の次に足す:
```ts
  /** 未保存の変更がある、参照として添えたファイル(表示用の相対パス)。実行を押した時点の写しで、開いている間に保存しても変えない */
  unsavedPaths: readonly string[]
```
- `AgentSendConfirmPending` の前に足す:
```ts
// エージェントへの送信の依頼に添える値(usePromptRunner → useAgentWorkspace.sendToAgent → useAgentSendConfirm.request)
export interface AgentSendOptions {
  /** 送る元のプロンプトの id(確認をキャンセルで閉じたとき・確認からの送信が失敗したときのフォーカスの戻り先を探す) */
  promptId: string | null
  /** 未保存の変更がある、参照として添えたファイル(表示用の相対パス)。送信前の確認のダイアログに注意として出す */
  unsavedPaths: readonly string[]
  /** 送れた(結果が sent)ときだけ呼ぶ。確認のキャンセル・閉じた(フォルダの切り替えなど)・送信の失敗では呼ばない */
  onSent?: () => void
}
```

`src/renderer/src/lib/agentSendCallbacks.ts`（新規）:
```ts
import type { AgentSendOutcome } from './agentPromptSend'

// 送れた(sent)ときの知らせ(AgentSendOptions.onSent)を呼ぶ。確認から送ったとき(useAgentSendConfirm)とすぐ送ったとき
// (useAgentWorkspace)で共有する。知らせが投げても、呼び出し元の後続(フォーカスの移動・結果の返却)は止めない(L-053)
export function notifyAgentSent(
  outcome: AgentSendOutcome | undefined,
  onSent: (() => void) | undefined
): void {
  if (outcome?.kind !== 'sent' || onSent === undefined) return
  try {
    onSent()
  } catch (err) {
    console.error('[notifyAgentSent] onSent failed:', err)
  }
}
```

`src/renderer/src/hooks/useAgentSendConfirm.ts`:
- import に足す:
```ts
import type { AgentSendOptions } from '../types'
import { notifyAgentSent } from '../lib/agentSendCallbacks'
```
- `PendingAgentSend` を次にする（`promptId` の説明は `AgentSendOptions` へ移した）:
```ts
export interface PendingAgentSend extends AgentSendOptions {
  /** 送る全文(正規化の前。送るときに sendAgentPrompt が正規化する) */
  text: string
  /** 開いた時点の選択中のタブ(送り先) */
  target: AgentSendTarget
  /** 開いた時点の送り先のタブの名前(表示はこれで固定) */
  label: string
}
```
- `AgentSendConfirmState.request` を次にする:
```ts
  /** 確認を開く(すでに開いていれば無視)。options(プロンプト・未保存の一覧・送れたときの知らせ)は開いた時点の写しとして控える。描画をまたいで同じ参照 */
  request: (text: string, options: AgentSendOptions) => void
```
- `request` の実装を次にする:
```ts
  const request = useCallback(
    (text: string, options: AgentSendOptions): void => {
      if (pendingRef.current !== null) return
      const { slotId, controller, label } = selectedRef.current
      const next: PendingAgentSend = { ...options, text, target: { slotId, controller }, label }
      pendingRef.current = next
      setPending(next)
    },
    [selectedRef]
  )
```
- `confirm` の中の分割代入と `finally` を次にする:
```ts
    const { text, target, promptId, onSent } = current
    void (async (): Promise<void> => {
      let outcome: AgentSendOutcome | undefined
      try {
        outcome = await send(text, target)
      } catch (err) {
        console.error('[useAgentSendConfirm] send failed:', err)
      } finally {
        // 送れたときだけ知らせる(エクスプローラから足した参照を外す)。知らせが投げてもフォーカスの移動は止めない(L-053)
        notifyAgentSent(outcome, onSent)
        onSendSettledRef.current({ slotId: target.slotId, promptId, outcome })
      }
    })()
```

`src/renderer/src/hooks/useAgentWorkspace.ts`:
- `import type { … } from '../types'` の一覧に `AgentSendOptions,` を足し、`import { notifyAgentSent } from '../lib/agentSendCallbacks'` を足す。
- `AgentWorkspaceState.sendToAgent` の説明と型を次にする:
```ts
  /** プロンプトを送る(usePromptRunner に渡す)。送信前の確認の設定がオン(読み込み中は既定に従う)なら送らずに確認を開き、undefined で
   *  resolve する。オフなら押した時点の選択中のタブへすぐ送る。options の promptId は確認をキャンセルで閉じたとき・確認からの送信が
   *  失敗したときのフォーカスの戻り先、unsavedPaths は確認のダイアログの未保存の注意、onSent は送れた(sent)ときだけ呼ぶ知らせ */
  sendToAgent: (text: string, options: AgentSendOptions) => ReturnType<AgentPromptSenderState['send']>
```
- `sendToAgent` の実装を次にする（依存の配列は今のまま）:
```ts
  const sendToAgent = useCallback(
    async (text: string, options: AgentSendOptions): ReturnType<AgentPromptSenderState['send']> => {
      if (isSendConfirmRequired) {
        // 送るまで send の setError(null) が呼ばれないので、前の送信の結果をここで消す(今のプロンプトの文言に見えないように)
        clearSendResult()
        requestSendConfirm(text, options)
        return undefined
      }
      const outcome = await sendAgentPrompt(text, {
        slotId: selectedSlotId,
        controller: selectedController
      })
      // 確認を開かない分岐でも、送れたときだけ知らせる(確認から送ったときは useAgentSendConfirm が知らせる)
      notifyAgentSent(outcome, options.onSent)
      return outcome
    },
    [
      isSendConfirmRequired,
      clearSendResult,
      requestSendConfirm,
      sendAgentPrompt,
      selectedSlotId,
      selectedController
    ]
  )
```
- 戻り値の `agentSendConfirmDialog.pending` の `promptId: pendingSend.promptId` の次に `unsavedPaths: pendingSend.unsavedPaths` を足す（前の行の末尾に `,`）。

`src/renderer/src/hooks/usePromptRunner.ts`:
- `import type { HistoryEntry, OpenFile, Prompt, PromptToolId } from '../types'` を `import type { AgentSendOptions, HistoryEntry, OpenFile, Prompt, PromptToolId } from '../types'` にする。
- `Deps.sendToAgent` を次にする:
```ts
  /** エージェント CLI 方式の送信(useAgentWorkspace.sendToAgent。送信前の確認の設定がオンなら、送る前に確認を開く)。options の
   *  promptId は確認をキャンセルで閉じたとき・確認からの送信が失敗したときのフォーカスの戻り先を探すのに使う。ファイル内容は添付しない(C2) */
  sendToAgent: (text: string, options: AgentSendOptions) => Promise<unknown>
```
- `runPrompt` の `await sendToAgent(content, prompt.id)` を `await sendToAgent(content, { promptId: prompt.id, unsavedPaths: [] })` にする（参照は Task 6 で足す）。

`src/renderer/src/components/agent/AgentSendConfirmDialog.tsx`:
- import に `import { formatAgentUnsavedNotice } from '../../lib/agentReferenceMessages'` を足す。
- `const targetId = useId()` の次に `const unsavedId = useId()` を足し、`const isSubmitDisabled = reason !== null` の次に足す:
```tsx
  // 参照として添えたファイルの未保存の注意(送信は止めない)。実行を押した時点の写し
  const hasUnsaved = pending.unsavedPaths.length > 0
  // 開いたときのフォーカスは送信(送れなければキャンセル)なので、送り先・未保存の注意・送れない理由を説明として読ませる
  const describedBy = [targetId, hasUnsaved ? unsavedId : null, reason !== null ? reasonId : null]
    .filter((id): id is string => id !== null)
    .join(' ')
```
- ダイアログの `aria-describedby={reason !== null ? \`${targetId} ${reasonId}\` : targetId}` を `aria-describedby={describedBy}` にする（直前のコメント 2 行は今のまま）。
- `<p className="agent-send-confirm__count">…</p>` の次に足す:
```tsx
        {hasUnsaved && (
          <p id={unsavedId} className="agent-send-confirm__unsaved">
            {formatAgentUnsavedNotice(pending.unsavedPaths)}
          </p>
        )}
```

`src/renderer/src/assets/main.css` の `.agent-send-confirm__reason { … }` の後に足す:
```css
/* 参照として添えたファイルの未保存の注意(送信は止めないので、送れない理由の赤より弱い黄系) */
.agent-send-confirm__unsaved {
  margin: 0;
  font-size: 12px;
  color: #e2c08d;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 5: テストを通す・型チェック・lint**

Run: `npx vitest run src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/agent src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: `npx eslint --fix src/renderer/src/types.ts src/renderer/src/lib/agentSendCallbacks.ts src/renderer/src/hooks/useAgentSendConfirm.ts src/renderer/src/hooks/useAgentWorkspace.ts src/renderer/src/hooks/usePromptRunner.ts src/renderer/src/components/agent/AgentSendConfirmDialog.tsx src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/components/agent/__tests__/AgentSendConfirmDialog.test.tsx src/renderer/src/components/__tests__/App.agentSendConfirm.test.tsx src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`
Run: `npx eslint --max-warnings 0` に同じファイルを渡す
Expected: エラー・警告なし

---

### Task 4: 参照の状態（`useAgentReferences`）

**Files:**
- Modify: `src/renderer/src/types.ts`（`AgentReferenceChipState`・`AgentAddedReference`・`AgentReferencesPanelState`）
- Create: `src/renderer/src/hooks/useAgentReferences.ts`
- Create: `src/renderer/src/__tests__/makeAgentReferencesState.ts`（テストの型付きの偽物。Task 5・6 で使う）
- Test: `src/renderer/src/hooks/__tests__/useAgentReferences.test.ts`（新規）

**Interfaces:**
- Consumes: Task 1 の `toWorkspaceRelativePath`・`formatLineRange`・`formatAgentReference`・`buildAgentReferenceList`・`AgentReference`・`AGENT_REFERENCE_DISABLED_REASONS`・`formatAgentReferenceAddedAnnouncement`、Task 2 の `EditorLineSelection`、既存の `useOnChange`・`useLatestRef`・`isSamePath`・`Announcement`・`OpenFile`
- Produces:
```ts
// src/renderer/src/types.ts
export interface AgentReferenceChipState {
  label: string | null
  disabledReason: string | null
  pressed: boolean
  unsaved: boolean
  onToggle: () => void
}
export interface AgentAddedReference { path: string; label: string }
export interface AgentReferencesPanelState {
  openFile: AgentReferenceChipState
  selection: AgentReferenceChipState
  added: AgentAddedReference[]
  onRemove: (path: string) => void
  onAddFromExplorer: (path: string) => void
}
// src/renderer/src/hooks/useAgentReferences.ts
export interface UseAgentReferencesOptions {
  folderPath: string | null
  isAgentMode: boolean
  activeFile: OpenFile | null
  isDiffTabActive: boolean
  openFiles: readonly OpenFile[]
  selection: EditorLineSelection | null
}
export interface PreparedAgentReferences {
  references: AgentReference[]
  unsavedPaths: string[]
  addedPaths: string[]
}
export interface AgentReferencesState {
  panel: AgentReferencesPanelState | null
  announcement: Announcement | null
  prepare: () => PreparedAgentReferences
  markSent: (prepared: PreparedAgentReferences) => void
}
export function useAgentReferences(options: UseAgentReferencesOptions): AgentReferencesState
// src/renderer/src/__tests__/makeAgentReferencesState.ts
export const EMPTY_PREPARED_AGENT_REFERENCES: PreparedAgentReferences
export function makeAgentReferencesPanelState(overrides?: Partial<AgentReferencesPanelState>): AgentReferencesPanelState
export function makeAgentReferencesState(overrides?: Partial<AgentReferencesState>): AgentReferencesState
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAgentReferences.test.ts`（新規）:
```ts
import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { OpenFile } from '../../types'
import type { LineSelection } from '../../lib/agentReferences'
import { AGENT_REFERENCE_DISABLED_REASONS } from '../../lib/agentReferenceMessages'
import { useAgentReferences } from '../useAgentReferences'
import type { AgentReferencesState, UseAgentReferencesOptions } from '../useAgentReferences'

const makeFile = (path: string, overrides: Partial<OpenFile> = {}): OpenFile => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  content: '本文',
  savedContent: '本文',
  language: 'typescript',
  ...overrides
})
const appTs = makeFile('/repo/src/app.ts')
const notesMd = makeFile('/repo/docs/notes.md')
const lines = (start: number, end: number): LineSelection => ({
  startLineNumber: start,
  startColumn: 3,
  endLineNumber: end,
  endColumn: 5
})

const baseOptions: UseAgentReferencesOptions = {
  folderPath: '/repo',
  isAgentMode: true,
  activeFile: appTs,
  isDiffTabActive: false,
  openFiles: [appTs, notesMd],
  selection: null
}

type Rendered = RenderHookResult<AgentReferencesState, UseAgentReferencesOptions>

const renderReferences = (overrides: Partial<UseAgentReferencesOptions> = {}): Rendered =>
  renderHook((props: UseAgentReferencesOptions) => useAgentReferences(props), {
    initialProps: { ...baseOptions, ...overrides }
  })

// panel が null でないことを確かめて返す
const panelOf = (result: Rendered['result']): NonNullable<AgentReferencesState['panel']> => {
  const { panel } = result.current
  if (panel === null) throw new Error('panel is null')
  return panel
}

describe('useAgentReferences: 出す条件', () => {
  it.each([
    ['従来の方式', { isAgentMode: false }],
    ['フォルダを開いていない', { folderPath: null }]
  ])('%s では参照の行を出さず、参照を足さない', (_label, overrides) => {
    const { result } = renderReferences(overrides)
    expect(result.current.panel).toBeNull()
    expect(result.current.prepare()).toEqual({ references: [], unsavedPaths: [], addedPaths: [] })
  })
})

describe('useAgentReferences: 開いているファイル', () => {
  it('アクティブな実ファイルの相対パスを出し、押すとオン・オフし、オンなら参照に入る', () => {
    const { result } = renderReferences()
    expect(panelOf(result).openFile).toMatchObject({
      label: '@src/app.ts',
      disabledReason: null,
      pressed: false,
      unsaved: false
    })
    expect(result.current.prepare().references).toEqual([])
    act(() => panelOf(result).openFile.onToggle())
    expect(panelOf(result).openFile.pressed).toBe(true)
    expect(result.current.prepare().references).toEqual([{ path: 'src/app.ts', lineRange: null }])
    act(() => panelOf(result).openFile.onToggle())
    expect(panelOf(result).openFile.pressed).toBe(false)
  })

  it('アクティブなタブが変わると中身が追従し、オンのまま', () => {
    const { result, rerender } = renderReferences()
    act(() => panelOf(result).openFile.onToggle())
    rerender({ ...baseOptions, activeFile: notesMd })
    expect(panelOf(result).openFile).toMatchObject({ label: '@docs/notes.md', pressed: true })
    expect(result.current.prepare().references).toEqual([
      { path: 'docs/notes.md', lineRange: null }
    ])
  })

  it.each([
    ['タブが無い', { activeFile: null }, AGENT_REFERENCE_DISABLED_REASONS.noOpenFile],
    ['差分のタブ', { isDiffTabActive: true }, AGENT_REFERENCE_DISABLED_REASONS.diffTab],
    [
      'フォルダの外のファイル',
      { activeFile: makeFile('/other/a.ts') },
      AGENT_REFERENCE_DISABLED_REASONS.outsideFolder
    ]
  ])('%s なら押せず理由を出し、オンにしてあっても参照に入れない', (_label, overrides, reason) => {
    const { result, rerender } = renderReferences()
    act(() => panelOf(result).openFile.onToggle())
    rerender({ ...baseOptions, ...overrides })
    expect(panelOf(result).openFile).toMatchObject({
      label: null,
      disabledReason: reason,
      pressed: true,
      unsaved: false
    })
    expect(result.current.prepare().references).toEqual([])
  })
})

describe('useAgentReferences: 選択範囲', () => {
  it('空でない選択を `@パス#L開始-終了` で出し、オンなら参照に入る。選択が変わると追従する', () => {
    const { result, rerender } = renderReferences({
      selection: { filePath: appTs.path, range: lines(10, 20) }
    })
    expect(panelOf(result).selection).toMatchObject({
      label: '@src/app.ts#L10-20',
      disabledReason: null,
      pressed: false
    })
    act(() => panelOf(result).selection.onToggle())
    rerender({ ...baseOptions, selection: { filePath: appTs.path, range: lines(3, 3) } })
    expect(panelOf(result).selection).toMatchObject({ label: '@src/app.ts#L3', pressed: true })
    expect(result.current.prepare().references).toEqual([{ path: 'src/app.ts', lineRange: '#L3' }])
  })

  it('選択が無ければ押せず、理由を出す', () => {
    const { result } = renderReferences()
    expect(panelOf(result).selection).toMatchObject({
      label: null,
      disabledReason: AGENT_REFERENCE_DISABLED_REASONS.noSelection
    })
  })

  it('フォルダの外のファイルの選択は押せない', () => {
    const { result } = renderReferences({
      selection: { filePath: '/other/a.ts', range: lines(1, 2) }
    })
    expect(panelOf(result).selection.disabledReason).toBe(
      AGENT_REFERENCE_DISABLED_REASONS.outsideFolder
    )
  })

  it('開いているファイルと同じファイルの選択は、ファイル全体の後に別の参照として入る', () => {
    const { result } = renderReferences({
      selection: { filePath: appTs.path, range: lines(10, 20) }
    })
    act(() => {
      panelOf(result).openFile.onToggle()
      panelOf(result).selection.onToggle()
    })
    expect(result.current.prepare().references).toEqual([
      { path: 'src/app.ts', lineRange: null },
      { path: 'src/app.ts', lineRange: '#L10-20' }
    ])
  })
})

describe('useAgentReferences: エクスプローラから足したファイル', () => {
  it('足すと末尾に加えて読み上げの文言を出し、同じファイルはもう一度足しても何もしない', () => {
    const { result } = renderReferences()
    act(() => panelOf(result).onAddFromExplorer('/repo/docs/notes.md'))
    expect(panelOf(result).added).toEqual([
      { path: '/repo/docs/notes.md', label: '@docs/notes.md' }
    ])
    expect(result.current.announcement).toEqual({ id: 1, text: '参照に @docs/notes.md を足しました' })
    act(() => panelOf(result).onAddFromExplorer('/repo/docs/notes.md'))
    expect(panelOf(result).added).toHaveLength(1)
    expect(result.current.announcement?.id).toBe(1)
    act(() => panelOf(result).onAddFromExplorer('/repo/src/app.ts'))
    expect(panelOf(result).added.map((item) => item.label)).toEqual([
      '@docs/notes.md',
      '@src/app.ts'
    ])
    expect(result.current.announcement).toEqual({ id: 2, text: '参照に @src/app.ts を足しました' })
    expect(result.current.prepare()).toMatchObject({
      references: [
        { path: 'docs/notes.md', lineRange: null },
        { path: 'src/app.ts', lineRange: null }
      ],
      addedPaths: ['/repo/docs/notes.md', '/repo/src/app.ts']
    })
  })

  it('フォルダの外のファイルは足さない', () => {
    const { result } = renderReferences()
    act(() => panelOf(result).onAddFromExplorer('/other/a.ts'))
    expect(panelOf(result).added).toEqual([])
    expect(result.current.announcement).toBeNull()
  })

  it('外すと一覧から消える', () => {
    const { result } = renderReferences()
    act(() => panelOf(result).onAddFromExplorer('/repo/docs/notes.md'))
    act(() => panelOf(result).onRemove('/repo/docs/notes.md'))
    expect(panelOf(result).added).toEqual([])
  })
})

describe('useAgentReferences: 後始末', () => {
  it('送れたら(markSent)、写しを取った時点のエクスプローラのファイルだけ外し、後から足したもの・チップのオンは残す', () => {
    const { result } = renderReferences()
    act(() => {
      panelOf(result).openFile.onToggle()
      panelOf(result).onAddFromExplorer('/repo/docs/notes.md')
    })
    const prepared = result.current.prepare()
    // 確認を開いている間に足したもの
    act(() => panelOf(result).onAddFromExplorer('/repo/src/app.ts'))
    act(() => result.current.markSent(prepared))
    expect(panelOf(result).added.map((item) => item.path)).toEqual(['/repo/src/app.ts'])
    expect(panelOf(result).openFile.pressed).toBe(true)
  })

  it('フォルダを切り替えたら、足したファイルを外し、チップをオフに戻す(L-405)', () => {
    const { result, rerender } = renderReferences({
      selection: { filePath: appTs.path, range: lines(1, 2) }
    })
    act(() => {
      panelOf(result).openFile.onToggle()
      panelOf(result).selection.onToggle()
      panelOf(result).onAddFromExplorer('/repo/docs/notes.md')
    })
    rerender({
      ...baseOptions,
      folderPath: '/next',
      activeFile: makeFile('/next/a.ts'),
      openFiles: []
    })
    expect(panelOf(result).openFile.pressed).toBe(false)
    expect(panelOf(result).selection.pressed).toBe(false)
    expect(panelOf(result).added).toEqual([])
  })

  it('従来の方式へ切り替えたら行を隠し、エージェント CLI 方式へ戻してもオフ・足したファイル無しのまま', () => {
    const { result, rerender } = renderReferences()
    act(() => {
      panelOf(result).openFile.onToggle()
      panelOf(result).onAddFromExplorer('/repo/docs/notes.md')
    })
    rerender({ ...baseOptions, isAgentMode: false })
    expect(result.current.panel).toBeNull()
    rerender({ ...baseOptions, isAgentMode: true })
    expect(panelOf(result).openFile.pressed).toBe(false)
    expect(panelOf(result).added).toEqual([])
  })
})

describe('useAgentReferences: 未保存の判定', () => {
  const dirtyApp = makeFile('/repo/src/app.ts', { content: '編集中' })

  it('オンにした開いているファイルに未保存の変更があれば、印を付けて未保存の一覧に入れる(オフなら入れない)', () => {
    const { result } = renderReferences({ activeFile: dirtyApp, openFiles: [dirtyApp] })
    expect(panelOf(result).openFile.unsaved).toBe(false)
    expect(result.current.prepare().unsavedPaths).toEqual([])
    act(() => panelOf(result).openFile.onToggle())
    expect(panelOf(result).openFile.unsaved).toBe(true)
    expect(result.current.prepare().unsavedPaths).toEqual(['src/app.ts'])
  })

  it('選択範囲のファイルは、選択のパスのタブの内容で判定し、開いているファイルと同じなら 1 回だけ入れる', () => {
    const { result } = renderReferences({
      activeFile: dirtyApp,
      openFiles: [dirtyApp, notesMd],
      selection: { filePath: dirtyApp.path, range: lines(1, 2) }
    })
    act(() => panelOf(result).selection.onToggle())
    expect(panelOf(result).selection.unsaved).toBe(true)
    expect(result.current.prepare().unsavedPaths).toEqual(['src/app.ts'])
    act(() => panelOf(result).openFile.onToggle())
    expect(result.current.prepare().unsavedPaths).toEqual(['src/app.ts'])
  })

  it('保存すれば(content と savedContent が同じ)印を外す', () => {
    const { result, rerender } = renderReferences({ activeFile: dirtyApp, openFiles: [dirtyApp] })
    act(() => panelOf(result).openFile.onToggle())
    rerender({ ...baseOptions, activeFile: appTs, openFiles: [appTs] })
    expect(panelOf(result).openFile.unsaved).toBe(false)
  })
})

describe('useAgentReferences: prepare の参照', () => {
  // usePromptRunner の useCallback の依存に入るため
  it('prepare・markSent は描画をまたいで同じ参照で、prepare は最新の状態を返す', () => {
    const { result } = renderReferences()
    const { prepare, markSent } = result.current
    act(() => panelOf(result).openFile.onToggle())
    expect(result.current.prepare).toBe(prepare)
    expect(result.current.markSent).toBe(markSent)
    expect(prepare().references).toEqual([{ path: 'src/app.ts', lineRange: null }])
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentReferences.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/types.ts` の `AgentSendOptions` の前に足す:
```ts
// 参照のチップ(開いているファイル・選択範囲)の状態と操作(useAgentReferences が組み立て、Sidebar → PromptsPanel → AgentReferenceChips へ渡す)
export interface AgentReferenceChipState {
  /** チップに出す参照(`@src/app.ts`・`@src/app.ts#L10-20`)。押せないときは null */
  label: string | null
  /** 押せない理由(title と aria-describedby で出す)。押せるなら null */
  disabledReason: string | null
  /** オンか(押せないときも保つ。タブを切り替えてもオンのまま) */
  pressed: boolean
  /** オンで、そのファイルに未保存の変更があるか(チップに「未保存」の印を付ける) */
  unsaved: boolean
  onToggle: () => void
}

/** エクスプローラから足したファイル */
export interface AgentAddedReference {
  /** 絶対パス(外すときの識別子・React の key) */
  path: string
  /** チップに出す参照(`@docs/notes.md`) */
  label: string
}

// プロンプトパネルの参照の行の状態と操作(useAgentReferences が組み立てる。エージェント CLI 方式でフォルダを開いているときだけで、
// それ以外は null)。Sidebar がプロンプトパネル(チップ)とエクスプローラ(右クリックの「参照として添える」)へ渡す
export interface AgentReferencesPanelState {
  openFile: AgentReferenceChipState
  selection: AgentReferenceChipState
  /** エクスプローラから足したファイル(足した順) */
  added: AgentAddedReference[]
  /** エクスプローラから足したファイルを外す(絶対パス) */
  onRemove: (path: string) => void
  /** エクスプローラの右クリックの「参照として添える」(絶対パス。すでにあれば何もしない) */
  onAddFromExplorer: (path: string) => void
}
```

`src/renderer/src/hooks/useAgentReferences.ts`（新規）:
```ts
import { useCallback, useState } from 'react'
import type {
  AgentReferenceChipState,
  AgentReferencesPanelState,
  Announcement,
  OpenFile
} from '../types'
import type { EditorLineSelection } from './useEditorSelectionRange'
import { useLatestRef } from './useLatestRef'
import { useOnChange } from './useOnChange'
import {
  buildAgentReferenceList,
  formatAgentReference,
  formatLineRange,
  toWorkspaceRelativePath
} from '../lib/agentReferences'
import type { AgentReference } from '../lib/agentReferences'
import {
  AGENT_REFERENCE_DISABLED_REASONS,
  formatAgentReferenceAddedAnnouncement
} from '../lib/agentReferenceMessages'
import { isSamePath } from '../lib/pathUtils'

// エージェントへ送るプロンプトに添える参照の状態(設計書「プロンプトパネルのチップ」「エクスプローラ」)。チップのオン・オフ、
// エクスプローラから足したファイル、フォルダ・方式の切り替えと送れたときの後始末、未保存の判定を持ち、実行のときに使う参照の
// 写し(prepare)を返す。useAppState で使い、写しを本文へ足すのは usePromptRunner

export interface UseAgentReferencesOptions {
  /** 開いているフォルダ(claude の作業フォルダと同じ。相対パスの基準) */
  folderPath: string | null
  /** エージェント CLI 方式か(読み込み中は false) */
  isAgentMode: boolean
  /** アクティブな実ファイルのタブ(useFileSystem.openFile。差分のタブの表示中も実ファイルを指す) */
  activeFile: OpenFile | null
  /** 差分のタブを表示しているか(開いているファイルのチップを押せなくする) */
  isDiffTabActive: boolean
  /** 開いているタブ(選択範囲のファイルの未保存の判定に使う。選択があるときだけ読む) */
  openFiles: readonly OpenFile[]
  /** アクティブなエディタの空でない選択(useEditorSelectionRange) */
  selection: EditorLineSelection | null
}

/** 実行を押した時点の参照の写し */
export interface PreparedAgentReferences {
  /** 本文へ足す参照(並び・重複のまとめの後) */
  references: AgentReference[]
  /** オンにしたチップのファイルのうち、未保存の変更があるもの(表示用の相対パス) */
  unsavedPaths: string[]
  /** この写しに入れた、エクスプローラから足したファイル(絶対パス。送れたときに外す) */
  addedPaths: string[]
}

export interface AgentReferencesState {
  /** プロンプトパネルの参照の行。エージェント CLI 方式でフォルダを開いているときだけで、それ以外は null */
  panel: AgentReferencesPanelState | null
  /** エクスプローラから足したときの読み上げ(App の常設の aria-live に出す)。まだ無ければ null */
  announcement: Announcement | null
  /** 今の参照の写し(実行を押した時点で呼ぶ)。描画をまたいで同じ参照 */
  prepare: () => PreparedAgentReferences
  /** 送れたときに呼ぶ。写しに入れたエクスプローラのファイルだけを外す(後から足したもの・チップのオンは残す)。描画をまたいで同じ参照 */
  markSent: (prepared: PreparedAgentReferences) => void
}

const EMPTY_PREPARED: PreparedAgentReferences = { references: [], unsavedPaths: [], addedPaths: [] }

// 1 つのチップの候補。押せるなら参照と未保存か、押せないなら理由
type Candidate =
  | { kind: 'available'; reference: AgentReference; unsaved: boolean }
  | { kind: 'unavailable'; reason: string }

interface ResolvedAdded {
  absolutePath: string
  reference: AgentReference
}

// 未保存の判定は、既存のタブの未保存の印と同じ規則(content と保存した内容の比較)
const isUnsaved = (file: OpenFile): boolean => file.content !== file.savedContent

function resolveOpenFile(
  folderPath: string,
  activeFile: OpenFile | null,
  isDiffTabActive: boolean
): Candidate {
  if (isDiffTabActive) return { kind: 'unavailable', reason: AGENT_REFERENCE_DISABLED_REASONS.diffTab }
  if (activeFile === null) {
    return { kind: 'unavailable', reason: AGENT_REFERENCE_DISABLED_REASONS.noOpenFile }
  }
  const path = toWorkspaceRelativePath(folderPath, activeFile.path)
  if (path === null) {
    return { kind: 'unavailable', reason: AGENT_REFERENCE_DISABLED_REASONS.outsideFolder }
  }
  return { kind: 'available', reference: { path, lineRange: null }, unsaved: isUnsaved(activeFile) }
}

function resolveSelection(
  folderPath: string,
  selection: EditorLineSelection | null,
  openFiles: readonly OpenFile[]
): Candidate {
  if (selection === null) {
    return { kind: 'unavailable', reason: AGENT_REFERENCE_DISABLED_REASONS.noSelection }
  }
  const path = toWorkspaceRelativePath(folderPath, selection.filePath)
  if (path === null) {
    return { kind: 'unavailable', reason: AGENT_REFERENCE_DISABLED_REASONS.outsideFolder }
  }
  // 未保存かは、選択のファイル(マウントの時点のパス)のタブの内容で判定する
  const file = openFiles.find((f) => isSamePath(f.path, selection.filePath))
  return {
    kind: 'available',
    reference: { path, lineRange: formatLineRange(selection.range) },
    unsaved: file !== undefined && isUnsaved(file)
  }
}

// エクスプローラから足したファイルは、削除・改名されてもそのまま残す(既知の制約)。フォルダの外になったもの(起きない想定)は出さない
const resolveAdded = (folderPath: string, addedPaths: readonly string[]): ResolvedAdded[] =>
  addedPaths.flatMap((absolutePath) => {
    const path = toWorkspaceRelativePath(folderPath, absolutePath)
    return path === null ? [] : [{ absolutePath, reference: { path, lineRange: null } }]
  })

const toChip = (
  candidate: Candidate,
  pressed: boolean,
  onToggle: () => void
): AgentReferenceChipState =>
  candidate.kind === 'available'
    ? {
        label: formatAgentReference(candidate.reference),
        disabledReason: null,
        pressed,
        // 印はオンにしたときだけ(送る参照のファイルが claude に見えない内容かを知らせる)
        unsaved: pressed && candidate.unsaved,
        onToggle
      }
    : { label: null, disabledReason: candidate.reason, pressed, unsaved: false, onToggle }

function buildPrepared(
  openFile: Candidate,
  includeOpenFile: boolean,
  selection: Candidate,
  includeSelection: boolean,
  added: readonly ResolvedAdded[]
): PreparedAgentReferences {
  const openFileRef = includeOpenFile && openFile.kind === 'available' ? openFile : null
  const selectionRef = includeSelection && selection.kind === 'available' ? selection : null
  const references = buildAgentReferenceList({
    openFile: openFileRef?.reference.path ?? null,
    selection: selectionRef?.reference ?? null,
    added: added.map((item) => item.reference.path)
  })
  const unsavedPaths: string[] = []
  for (const ref of [openFileRef, selectionRef]) {
    if (ref !== null && ref.unsaved && !unsavedPaths.includes(ref.reference.path)) {
      unsavedPaths.push(ref.reference.path)
    }
  }
  return { references, unsavedPaths, addedPaths: added.map((item) => item.absolutePath) }
}

export function useAgentReferences({
  folderPath,
  isAgentMode,
  activeFile,
  isDiffTabActive,
  openFiles,
  selection
}: UseAgentReferencesOptions): AgentReferencesState {
  const [includeOpenFile, setIncludeOpenFile] = useState(false)
  const [includeSelection, setIncludeSelection] = useState(false)
  const [addedPaths, setAddedPaths] = useState<readonly string[]>([])
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)

  // 元の状態が終わる契機(フォルダの切り替え・従来の方式への切り替え)で、足したファイルを外し、チップをオフに戻す(L-405)
  const reset = (): void => {
    setIncludeOpenFile(false)
    setIncludeSelection(false)
    setAddedPaths([])
  }
  useOnChange(folderPath, reset)
  useOnChange(isAgentMode, () => {
    if (!isAgentMode) reset()
  })

  // 参照を出すのはエージェント CLI 方式でフォルダを開いているときだけ
  const workspace = isAgentMode ? folderPath : null
  const view =
    workspace === null
      ? null
      : {
          openFile: resolveOpenFile(workspace, activeFile, isDiffTabActive),
          selection: resolveSelection(workspace, selection, openFiles),
          added: resolveAdded(workspace, addedPaths)
        }
  const prepared =
    view === null
      ? EMPTY_PREPARED
      : buildPrepared(view.openFile, includeOpenFile, view.selection, includeSelection, view.added)

  // usePromptRunner の useCallback の依存に入るため、prepare・markSent は同じ参照にし、最新の写しは ref から読む
  const preparedRef = useLatestRef(prepared)
  const prepare = useCallback((): PreparedAgentReferences => preparedRef.current, [preparedRef])
  // 外すのは写しに入れたものだけ(確認を開いている間に足したものは残す。写しは実行を押した時点。L-407)
  const markSent = useCallback((sent: PreparedAgentReferences): void => {
    if (sent.addedPaths.length === 0) return
    setAddedPaths((prev) =>
      prev.filter((path) => !sent.addedPaths.some((sentPath) => isSamePath(sentPath, path)))
    )
  }, [])

  const addFromExplorer = (absolutePath: string): void => {
    if (workspace === null) return
    const path = toWorkspaceRelativePath(workspace, absolutePath)
    if (path === null) return
    if (addedPaths.some((added) => isSamePath(added, absolutePath))) return
    setAddedPaths((prev) =>
      prev.some((added) => isSamePath(added, absolutePath)) ? prev : [...prev, absolutePath]
    )
    // 同じ文言が続いても読み上げ直すよう、id を進める(toAnnouncementText。パターン 87)
    setAnnouncement((prev) => ({
      id: (prev?.id ?? 0) + 1,
      text: formatAgentReferenceAddedAnnouncement(formatAgentReference({ path, lineRange: null }))
    }))
  }

  const panel: AgentReferencesPanelState | null =
    view === null
      ? null
      : {
          openFile: toChip(view.openFile, includeOpenFile, () => setIncludeOpenFile((v) => !v)),
          selection: toChip(view.selection, includeSelection, () => setIncludeSelection((v) => !v)),
          added: view.added.map((item) => ({
            path: item.absolutePath,
            label: formatAgentReference(item.reference)
          })),
          onRemove: (path) => setAddedPaths((prev) => prev.filter((added) => added !== path)),
          onAddFromExplorer: addFromExplorer
        }

  return { panel, announcement, prepare, markSent }
}
```

`src/renderer/src/__tests__/makeAgentReferencesState.ts`（新規）:
```ts
import { vi } from 'vitest'
import type { AgentReferencesPanelState } from '../types'
import type { AgentReferencesState, PreparedAgentReferences } from '../hooks/useAgentReferences'

// 参照の状態(useAgentReferences の戻り値とプロンプトパネルの参照の行)の型付きの偽物(1 か所から作る。パターン 102)。
// 既定の行は「開いているファイルは押せてオフ・選択は無い・足したファイルは無い」、既定の hook の戻り値は「行を出さない(従来の方式)」

export const EMPTY_PREPARED_AGENT_REFERENCES: PreparedAgentReferences = {
  references: [],
  unsavedPaths: [],
  addedPaths: []
}

export function makeAgentReferencesPanelState(
  overrides: Partial<AgentReferencesPanelState> = {}
): AgentReferencesPanelState {
  return {
    openFile: {
      label: '@src/app.ts',
      disabledReason: null,
      pressed: false,
      unsaved: false,
      onToggle: vi.fn()
    },
    selection: {
      label: null,
      disabledReason: 'エディタで範囲を選ぶと添えられます',
      pressed: false,
      unsaved: false,
      onToggle: vi.fn()
    },
    added: [],
    onRemove: vi.fn<AgentReferencesPanelState['onRemove']>(),
    onAddFromExplorer: vi.fn<AgentReferencesPanelState['onAddFromExplorer']>(),
    ...overrides
  }
}

export function makeAgentReferencesState(
  overrides: Partial<AgentReferencesState> = {}
): AgentReferencesState {
  return {
    panel: null,
    announcement: null,
    prepare: vi.fn<AgentReferencesState['prepare']>(() => EMPTY_PREPARED_AGENT_REFERENCES),
    markSent: vi.fn<AgentReferencesState['markSent']>(),
    ...overrides
  }
}
```

- [ ] **Step 4: テストを通す・型チェック・lint**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAgentReferences.test.ts`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: `npx eslint --fix src/renderer/src/types.ts src/renderer/src/hooks/useAgentReferences.ts src/renderer/src/__tests__/makeAgentReferencesState.ts src/renderer/src/hooks/__tests__/useAgentReferences.test.ts`
Run: `npx eslint --max-warnings 0` に同じファイルを渡す
Expected: エラー・警告なし

---

### Task 5: 参照のチップの表示（`AgentReferenceChips`）とエクスプローラのメニュー

**Files:**
- Create: `src/renderer/src/components/prompts/AgentReferenceChips.tsx`
- Modify: `src/renderer/src/assets/main.css`（`.agent-references*`・視覚的に隠す規則に `.agent-references__reason`）
- Modify: `src/renderer/src/lib/explorerMenuItems.ts`（`onAddReference`）
- Modify: `src/renderer/src/components/explorer/ExplorerPanel.tsx`（prop `onAddReference`）
- Test: `src/renderer/src/components/prompts/__tests__/AgentReferenceChips.test.tsx`（新規）、`src/renderer/src/lib/__tests__/explorerMenuItems.test.ts`、`src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx`

**Interfaces:**
- Consumes: `AgentReferencesPanelState`・`AgentReferenceChipState`・`AgentAddedReference`（Task 4）、`makeAgentReferencesPanelState`（Task 4）、Task 1 の文言（`AGENT_REFERENCE_GROUP_LABEL`・`AGENT_REFERENCE_CHIP_FALLBACK_LABELS`・`AGENT_REFERENCE_TOGGLE_TITLES`・`AGENT_REFERENCE_UNSAVED_MARK`・`AGENT_REFERENCE_MENU_LABEL`・`formatAgentReferenceRemoveLabel`）
- Produces:
```ts
// src/renderer/src/components/prompts/AgentReferenceChips.tsx
export default function AgentReferenceChips(props: { state: AgentReferencesPanelState }): React.JSX.Element
// src/renderer/src/lib/explorerMenuItems.ts(ExplorerMenuActions に追加)
onAddReference?: (node: FileTreeNode) => void
// src/renderer/src/components/explorer/ExplorerPanel.tsx(Props に追加)
onAddReference?: (node: FileTreeNode) => void
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/prompts/__tests__/AgentReferenceChips.test.tsx`（新規）:
```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { AgentAddedReference, AgentReferenceChipState } from '../../../types'
import { makeAgentReferencesPanelState } from '../../../__tests__/makeAgentReferencesState'
import AgentReferenceChips from '../AgentReferenceChips'

const getGroup = (): HTMLElement => screen.getByRole('group', { name: '参照' })

const chip = (overrides: Partial<AgentReferenceChipState> = {}): AgentReferenceChipState => ({
  label: '@src/app.ts',
  disabledReason: null,
  pressed: false,
  unsaved: false,
  onToggle: vi.fn(),
  ...overrides
})

const notes: AgentAddedReference = { path: '/repo/docs/notes.md', label: '@docs/notes.md' }
const other: AgentAddedReference = { path: '/repo/docs/other.md', label: '@docs/other.md' }

// 外すと一覧から消える(本物の useAgentReferences と同じく、次の描画で added が変わる)
function Harness({ initial }: { initial: AgentAddedReference[] }): React.JSX.Element {
  const [added, setAdded] = useState(initial)
  return (
    <AgentReferenceChips
      state={makeAgentReferencesPanelState({
        added,
        onRemove: (path) => setAdded((prev) => prev.filter((item) => item.path !== path))
      })}
    />
  )
}

describe('AgentReferenceChips', () => {
  it('名前「参照」のグループに、開いているファイル・選択範囲のチップを aria-pressed 付きで出す', () => {
    render(
      <AgentReferenceChips
        state={makeAgentReferencesPanelState({
          openFile: chip({ pressed: true }),
          selection: chip({ label: '@src/app.ts#L10-20' })
        })}
      />
    )
    const group = getGroup()
    expect(within(group).getByRole('button', { name: '@src/app.ts' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(group).getByRole('button', { name: '@src/app.ts#L10-20' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('押すと onToggle を呼ぶ。押せるチップの title は何を添えるかの説明', async () => {
    const openFile = chip()
    render(<AgentReferenceChips state={makeAgentReferencesPanelState({ openFile })} />)
    const button = screen.getByRole('button', { name: '@src/app.ts' })
    expect(button).toHaveAttribute('title', '開いているファイルを参照として添える')
    await userEvent.click(button)
    expect(openFile.onToggle).toHaveBeenCalledOnce()
  })

  it('押せないチップは、パスの代わりに見出しの文言を出して押せなくし、理由を title と説明で出す', () => {
    render(
      <AgentReferenceChips
        state={makeAgentReferencesPanelState({
          openFile: chip({ label: null, disabledReason: '開いているファイルがありません' }),
          selection: chip({ label: null, disabledReason: 'エディタで範囲を選ぶと添えられます' })
        })}
      />
    )
    const openFile = screen.getByRole('button', { name: '開いているファイル' })
    expect(openFile).toBeDisabled()
    expect(openFile).toHaveAttribute('title', '開いているファイルがありません')
    expect(openFile).toHaveAccessibleDescription('開いているファイルがありません')
    const selection = screen.getByRole('button', { name: '選択範囲' })
    expect(selection).toBeDisabled()
    expect(selection).toHaveAccessibleDescription('エディタで範囲を選ぶと添えられます')
  })

  it('未保存なら「未保存」の印を付け、名前は見えている文字そのもの(L-156)', () => {
    render(
      <AgentReferenceChips
        state={makeAgentReferencesPanelState({ openFile: chip({ pressed: true, unsaved: true }) })}
      />
    )
    expect(screen.getByRole('button', { name: '@src/app.ts 未保存' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('エクスプローラから足したファイルを外すボタン付きで出し、押すと onRemove に絶対パスを渡す', async () => {
    const onRemove = vi.fn()
    render(
      <AgentReferenceChips state={makeAgentReferencesPanelState({ added: [notes], onRemove })} />
    )
    expect(within(getGroup()).getByText('@docs/notes.md')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '@docs/notes.md を参照から外す' }))
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('/repo/docs/notes.md')
  })

  it('外した後は、同じ位置の次の外すボタンへ、無ければ参照の行へフォーカスを移す(body に落とさない)', async () => {
    render(<Harness initial={[notes, other]} />)
    await userEvent.click(screen.getByRole('button', { name: '@docs/notes.md を参照から外す' }))
    expect(screen.getByRole('button', { name: '@docs/other.md を参照から外す' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: '@docs/other.md を参照から外す' }))
    expect(getGroup()).toHaveFocus()
  })

  it('チップと外すボタンはタッチで押せる大きさ(32px 以上)', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      render(<AgentReferenceChips state={makeAgentReferencesPanelState({ added: [notes] })} />)
      expect(getComputedStyle(screen.getByRole('button', { name: '@src/app.ts' })).minHeight).toBe(
        '32px'
      )
      const remove = screen.getByRole('button', { name: '@docs/notes.md を参照から外す' })
      expect(getComputedStyle(remove).minHeight).toBe('32px')
      expect(getComputedStyle(remove).minWidth).toBe('32px')
    } finally {
      style.remove()
    }
  })
})
```

`src/renderer/src/lib/__tests__/explorerMenuItems.test.ts`:
- 今の `function makeActions() {` は戻り値の型が無く eslint が落ちるので、次にする（`onAddReference` は渡さない。既存のテストの期待は変えない）:
```ts
import type { Mock } from 'vitest'
// (既存の import の後に足す)

type BaseActionName =
  | 'onCreateFile'
  | 'onCreateDirectory'
  | 'onRename'
  | 'onDelete'
  | 'onAddToGitignore'

function makeActions(): Record<BaseActionName, Mock> {
  return {
    onCreateFile: vi.fn(),
    onCreateDirectory: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onAddToGitignore: vi.fn()
  }
}
```
- `describe('buildMenuItems', …)` の中の末尾に足す:
```ts
  describe('参照として添える(エージェント CLI 方式のときだけ onAddReference を渡す)', () => {
    it('onAddReference があれば、ファイルのメニューの末尾に出し、選ぶとそのノードを渡す', () => {
      const onAddReference = vi.fn()
      const items = buildMenuItems('/project', fileNode, { ...makeActions(), onAddReference })
      expect(items.map((i) => i.label)).toEqual([
        'リネーム',
        '削除',
        '.gitignore に追加',
        '参照として添える'
      ])
      expect(items.at(-1)?.id).toBe('addReference')
      items.at(-1)?.onSelect()
      expect(onAddReference).toHaveBeenCalledExactlyOnceWith(fileNode)
    })

    it('フォルダ・ツリーの空白には出さない', () => {
      const onAddReference = vi.fn()
      const actions = { ...makeActions(), onAddReference }
      expect(buildMenuItems('/project', dirNode, actions).map((i) => i.label)).not.toContain(
        '参照として添える'
      )
      expect(buildMenuItems('/project', null, actions).map((i) => i.label)).not.toContain(
        '参照として添える'
      )
    })

    it('onAddReference が無ければ出さない', () => {
      expect(buildMenuItems('/project', fileNode, makeActions()).map((i) => i.label)).not.toContain(
        '参照として添える'
      )
    })
  })
```

`src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx` の `describe('コンテキストメニュー', …)` の中の末尾に足す:
```tsx
    it('onAddReference を渡すと、ファイルの「参照として添える」を選んだときに対象ノードで呼ぶ', async () => {
      const onAddReference = vi.fn()
      render(<ExplorerPanel {...openedProps} onAddReference={onAddReference} />)
      fireEvent.contextMenu(screen.getByText('package.json'))
      await userEvent.click(screen.getByRole('menuitem', { name: '参照として添える' }))
      expect(onAddReference).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ path: '/p/package.json' })
      )
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('onAddReference が無ければ「参照として添える」を出さない', () => {
      render(<ExplorerPanel {...openedProps} />)
      fireEvent.contextMenu(screen.getByText('package.json'))
      expect(screen.queryByRole('menuitem', { name: '参照として添える' })).not.toBeInTheDocument()
    })
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/AgentReferenceChips.test.tsx src/renderer/src/lib/__tests__/explorerMenuItems.test.ts src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx`
Expected: FAIL（コンポーネントが無い・メニューの項目が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/components/prompts/AgentReferenceChips.tsx`（新規）:
```tsx
'use client'
import { useId, useLayoutEffect, useRef } from 'react'
import type { AgentReferenceChipState, AgentReferencesPanelState } from '../../types'
import {
  AGENT_REFERENCE_CHIP_FALLBACK_LABELS,
  AGENT_REFERENCE_GROUP_LABEL,
  AGENT_REFERENCE_TOGGLE_TITLES,
  AGENT_REFERENCE_UNSAVED_MARK,
  formatAgentReferenceRemoveLabel
} from '../../lib/agentReferenceMessages'

interface Props {
  state: AgentReferencesPanelState
}

interface ToggleProps {
  chip: AgentReferenceChipState
  /** 押せないときにパスの代わりに出す文言 */
  fallbackLabel: string
  /** 押せるときの title(何を添えるか) */
  title: string
}

// 開いているファイル・選択範囲のチップ(オン・オフ)。押せないときは理由を title と aria-describedby で出す(視覚的に隠した要素)
function ReferenceToggle({ chip, fallbackLabel, title }: ToggleProps): React.JSX.Element {
  const reasonId = useId()
  return (
    <>
      <button
        type="button"
        className={`agent-references__chip${chip.pressed ? ' agent-references__chip--pressed' : ''}`}
        aria-pressed={chip.pressed}
        disabled={chip.label === null}
        title={chip.disabledReason ?? title}
        aria-describedby={chip.disabledReason !== null ? reasonId : undefined}
        onClick={chip.onToggle}
      >
        {chip.label ?? fallbackLabel}
        {/* 名前に見えている文字をそのまま含める(「@src/app.ts 未保存」。L-156) */}
        {chip.unsaved && (
          <>
            {' '}
            <span className="agent-references__unsaved">{AGENT_REFERENCE_UNSAVED_MARK}</span>
          </>
        )}
      </button>
      {chip.disabledReason !== null && (
        <span id={reasonId} className="agent-references__reason">
          {chip.disabledReason}
        </span>
      )}
    </>
  )
}

// プロンプトパネルの参照の行(設計書「プロンプトパネルのチップ」)。開いているファイル・選択範囲のチップと、エクスプローラから
// 足したファイルのチップ(× で外す)を出す
export default function AgentReferenceChips({ state }: Props): React.JSX.Element {
  const labelId = useId()
  const groupRef = useRef<HTMLDivElement>(null)
  // × で外したときのフォーカスの移し先(外した位置)。押したボタンは消えるので、描画の後に移す(body に落とさない)
  const pendingFocusIndexRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const index = pendingFocusIndexRef.current
    const group = groupRef.current
    if (index === null || group === null) return
    pendingFocusIndexRef.current = null
    const buttons = group.querySelectorAll<HTMLButtonElement>('[data-reference-remove]')
    const next = buttons.length === 0 ? null : buttons.item(Math.min(index, buttons.length - 1))
    if (next !== null) next.focus()
    else group.focus()
  }, [state.added])

  return (
    <div
      ref={groupRef}
      className="agent-references"
      role="group"
      aria-labelledby={labelId}
      // 足したファイルを全部外した後のフォーカスの置き場(Tab の順には入らない)
      tabIndex={-1}
    >
      <span id={labelId} className="agent-references__label">
        {AGENT_REFERENCE_GROUP_LABEL}
      </span>
      <ReferenceToggle
        chip={state.openFile}
        fallbackLabel={AGENT_REFERENCE_CHIP_FALLBACK_LABELS.openFile}
        title={AGENT_REFERENCE_TOGGLE_TITLES.openFile}
      />
      <ReferenceToggle
        chip={state.selection}
        fallbackLabel={AGENT_REFERENCE_CHIP_FALLBACK_LABELS.selection}
        title={AGENT_REFERENCE_TOGGLE_TITLES.selection}
      />
      {state.added.map((item, index) => (
        <span key={item.path} className="agent-references__chip agent-references__chip--added">
          <span className="agent-references__chip-label">{item.label}</span>
          <button
            type="button"
            className="agent-references__remove"
            data-reference-remove=""
            aria-label={formatAgentReferenceRemoveLabel(item.label)}
            onClick={() => {
              pendingFocusIndexRef.current = index
              state.onRemove(item.path)
            }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )
}
```

`src/renderer/src/assets/main.css`:
- 視覚的に隠す規則（`/* 通知の文言の読み上げ(視覚的に隠す。…) */` の `.external-change-banner__live, .agent-diff__live, .agent-announcer {`）のセレクタの一覧に `.agent-references__reason` を足す（`.agent-announcer,` の後ろに `.agent-references__reason {`。コメントの「通知の文言の読み上げ」は「通知の文言の読み上げ・参照のチップの押せない理由」にする）。
- `.prompts-panel__tag-chip--active:hover { … }` の後に足す:
```css
/* ---- 参照の行(エージェントへ送るプロンプトに添える @ 参照のチップ) ---- */

.agent-references {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 6px;
  border-bottom: 1px solid #2d2d2d;
  flex-shrink: 0;
}

.agent-references:focus {
  outline: none;
}

.agent-references__label {
  margin-right: 4px;
  font-size: 11px;
  color: #aaaaaa;
}

.agent-references__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  max-width: 100%;
  padding: 0 10px;
  background: #3c3c3c;
  border: 1px solid #555555;
  border-radius: 16px;
  color: #cccccc;
  font-size: 11px;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.agent-references__chip:hover:not(:disabled) {
  background: #4a4a4a;
}

.agent-references__chip:focus-visible {
  outline: 1px solid #007acc;
  outline-offset: 1px;
}

.agent-references__chip--pressed {
  background: #007acc;
  border-color: #007acc;
  color: #ffffff;
}

.agent-references__chip--pressed:hover:not(:disabled) {
  background: #0062a3;
}

.agent-references__chip:disabled {
  opacity: 0.5;
  cursor: default;
}

.agent-references__chip--added {
  padding-right: 0;
  cursor: default;
}

.agent-references__unsaved {
  padding: 0 4px;
  border-radius: 4px;
  background: #5a4a1a;
  color: #e2c08d;
  font-size: 10px;
}

.agent-references__remove {
  min-width: 32px;
  min-height: 32px;
  background: transparent;
  border: none;
  border-radius: 16px;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
}

.agent-references__remove:hover {
  background: #4a4a4a;
}

.agent-references__remove:focus-visible {
  outline: 1px solid #007acc;
  outline-offset: -2px;
}
```

`src/renderer/src/lib/explorerMenuItems.ts`:
- import に `import { AGENT_REFERENCE_MENU_LABEL } from './agentReferenceMessages'` を足す。
- `ExplorerMenuActions` の `onAddToGitignore` の次に足す:
```ts
  /** 参照として添える(エージェント CLI 方式のときだけ渡す。ファイルにだけ出す) */
  onAddReference?: (node: FileTreeNode) => void
```
- `return items` の直前に足す:
```ts
  // エージェントへ送るプロンプトの参照として足す(ファイルだけ。フォルダ・空白には出さない)
  const { onAddReference } = actions
  if (node !== null && node.type === 'file' && onAddReference !== undefined) {
    items.push({
      id: 'addReference',
      label: AGENT_REFERENCE_MENU_LABEL,
      onSelect: () => onAddReference(node)
    })
  }
```

`src/renderer/src/components/explorer/ExplorerPanel.tsx`:
- `Props` の `clone: CloneRepositoryPanelState` の次に足す:
```ts
  /** 右クリックの「参照として添える」(エージェント CLI 方式でフォルダを開いているときだけ渡す。ファイルにだけ出す) */
  onAddReference?: (node: FileTreeNode) => void
```
- 分割代入の `clone` の次に `onAddReference` を足す（前の行の末尾に `,`）。
- `buildMenuItems` の `actions` の `onAddToGitignore` の次に `onAddReference` を足す（前の行の末尾に `,`）。

- [ ] **Step 4: テストを通す・型チェック・lint**

Run: `npx vitest run src/renderer/src/components/prompts/__tests__/AgentReferenceChips.test.tsx src/renderer/src/lib/__tests__/explorerMenuItems.test.ts src/renderer/src/components/explorer`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: `npx eslint --fix src/renderer/src/components/prompts/AgentReferenceChips.tsx src/renderer/src/lib/explorerMenuItems.ts src/renderer/src/components/explorer/ExplorerPanel.tsx src/renderer/src/components/prompts/__tests__/AgentReferenceChips.test.tsx src/renderer/src/lib/__tests__/explorerMenuItems.test.ts src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx`
Run: `npx eslint --max-warnings 0` に同じファイルを渡す
Expected: エラー・警告なし

---

### Task 6: 配線（`usePromptRunner` での連結・`useAppState`・`PromptsPanel`・`Sidebar`・`App` の読み上げの領域）

**Files:**
- Modify: `src/renderer/src/hooks/usePromptRunner.ts`（`agentReferences` を受け取り、本文へ足す）
- Modify: `src/renderer/src/hooks/useAppState.ts`（`useAgentReferences` を使い、`agentReferences`・`agentReferenceAnnouncement` を公開する）
- Modify: `src/renderer/src/components/prompts/PromptsPanel.tsx`（prop `agentReferences`）
- Modify: `src/renderer/src/components/Sidebar.tsx`（prop `agentReferences` → PromptsPanel・ExplorerPanel）
- Modify: `src/renderer/src/App.tsx`（Sidebar へ渡す・参照用の常設の `AgentAnnouncer`）
- Test: `src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`、`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`、`src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx`、`src/renderer/src/components/__tests__/Sidebar.test.tsx`、`src/renderer/src/components/__tests__/App.agentReferences.test.tsx`（新規）

**Interfaces:**
- Consumes: `appendAgentReferences`（Task 1）、`attachEditorSelection`・`useEditorSelectionRange`（Task 2）、`AgentSendOptions`（Task 3）、`useAgentReferences`・`AgentReferencesState`・`PreparedAgentReferences`・`AgentReferencesPanelState`・`makeAgentReferencesState`・`makeAgentReferencesPanelState`（Task 4）、`AgentReferenceChips`・`ExplorerPanel.onAddReference`（Task 5）、既存の `toAnnouncementText`
- Produces:
```ts
// usePromptRunner の Deps に追加
agentReferences: Pick<AgentReferencesState, 'prepare' | 'markSent'>
// useAppState の戻り値に追加
agentReferences: AgentReferencesPanelState | null
agentReferenceAnnouncement: string
// PromptsPanel・Sidebar の Props に追加(省略できない。L-060)
agentReferences: AgentReferencesPanelState | null
```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/usePromptRunner.test.ts`:
- import に足す:
```ts
import type { AgentSendOptions } from '../../types'
import type { PreparedAgentReferences } from '../useAgentReferences'
import { makeAgentReferencesState } from '../../__tests__/makeAgentReferencesState'
```
- 既存の 6 つの `usePromptRunner({ … })` の呼び出しすべてで、`sendToAgent` の行の次に `agentReferences: makeAgentReferencesState()` を足す（前の行の末尾に `,`）。
- `エージェント CLI 方式では本文だけをエージェントへ送り、…` のテストの期待を次にする（参照が無ければ本文のまま。送れたときの知らせは常に渡す）:
```ts
    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith('送る本文', {
      promptId: 'p1',
      unsavedPaths: [],
      onSent: expect.any(Function)
    })
```
- `describe('usePromptRunner: 実行方式', …)` の中の末尾に足す:
```ts
  it('エージェント CLI 方式では、押した時点の参照を本文の末尾に足し、未保存の一覧と送れたときの知らせを添えて送る', async () => {
    const prepared: PreparedAgentReferences = {
      references: [
        { path: 'src/app.ts', lineRange: null },
        { path: 'src/app.ts', lineRange: '#L10-20' },
        { path: 'docs/notes.md', lineRange: null }
      ],
      unsavedPaths: ['src/app.ts'],
      addedPaths: ['/repo/docs/notes.md']
    }
    const agentReferences = makeAgentReferencesState({ prepare: vi.fn(() => prepared) })
    const sendToAgent = vi.fn<(text: string, options: AgentSendOptions) => Promise<unknown>>(
      async () => undefined
    )
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt: vi.fn(),
        addHistoryEntry: vi.fn(),
        executionMode: 'agent-cli',
        sendToAgent,
        agentReferences
      })
    )
    await result.current.runPrompt('送る本文', 'claude', prompt)
    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith(
      '送る本文\n\n参照:\n- @src/app.ts\n- @src/app.ts#L10-20\n- @docs/notes.md',
      { promptId: 'p1', unsavedPaths: ['src/app.ts'], onSent: expect.any(Function) }
    )
    // 足したファイルを外すのは送れたときだけ(押した時点の写しを渡す。L-407)
    expect(agentReferences.markSent).not.toHaveBeenCalled()
    sendToAgent.mock.calls[0][1].onSent?.()
    expect(agentReferences.markSent).toHaveBeenCalledExactlyOnceWith(prepared)
  })

  it('従来の方式では参照を足さず、参照の写しも取らない', async () => {
    const executePrompt = vi.fn()
    const agentReferences = makeAgentReferencesState()
    const { result } = renderHook(() =>
      usePromptRunner({
        openFile,
        executePrompt,
        addHistoryEntry: vi.fn(),
        executionMode: 'legacy',
        sendToAgent: vi.fn(async () => undefined),
        agentReferences
      })
    )
    await result.current.runPrompt('実行する内容', 'claude', prompt)
    expect(agentReferences.prepare).not.toHaveBeenCalled()
    expect(executePrompt.mock.calls[0][0]).toBe('実行する内容')
  })
```

`src/renderer/src/hooks/__tests__/useAppState.agent.test.ts`:
- `vi.mock('../useAgentWorkspace', …)` の次に足す:
```ts
// 参照の状態の組み立ては useAgentReferences.test.ts で確かめる。ここでは渡す値と公開する値だけを見る
const mockUseAgentReferences = vi.hoisted(() =>
  vi.fn<typeof import('../useAgentReferences').useAgentReferences>()
)
vi.mock('../useAgentReferences', () => ({ useAgentReferences: mockUseAgentReferences }))
```
- import に `import { makeAgentReferencesPanelState, makeAgentReferencesState } from '../../__tests__/makeAgentReferencesState'` を足す。
- `beforeEach` の `mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState())` の次に `mockUseAgentReferences.mockReturnValue(makeAgentReferencesState())` を足す。
- `describe('実行方式とエージェント', …)` の中、`usePromptRunner に実行方式(%s)と…` の `it.each` の後に足す:
```ts
    it('useAgentReferences に、開いているフォルダ・エージェント CLI 方式か・差分のタブの表示中か・選択を渡す', () => {
      mockUseFileSystem.mockReturnValue({ ...defaultUseFileSystem(), folderPath: '/repo' })
      mockUseAgentWorkspace.mockReturnValue(
        makeAgentWorkspaceState({
          executionModePanel: {
            ...makeAgentWorkspaceState().executionModePanel,
            mode: 'agent-cli'
          }
        })
      )
      mockUseDiffTabs.mockReturnValue({
        ...defaultUseDiffTabs(),
        diffTabs: [{ path: '/repo/a.ts', kind: 'unstaged' }],
        activeDiffTab: { path: '/repo/a.ts', kind: 'unstaged' }
      })
      renderHook(() => useAppState())
      expect(mockUseAgentReferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          folderPath: '/repo',
          isAgentMode: true,
          activeFile: null,
          isDiffTabActive: true,
          selection: null
        })
      )
    })

    it.each(['legacy', null] as const)(
      '実行方式が %s なら useAgentReferences にエージェント CLI 方式でないと渡す',
      (mode) => {
        mockUseAgentWorkspace.mockReturnValue(
          makeAgentWorkspaceState({
            executionModePanel: { ...makeAgentWorkspaceState().executionModePanel, mode }
          })
        )
        renderHook(() => useAppState())
        expect(mockUseAgentReferences).toHaveBeenLastCalledWith(
          expect.objectContaining({ isAgentMode: false, isDiffTabActive: false })
        )
      }
    )

    it('usePromptRunner に参照の状態(prepare・markSent)を渡し、参照の行と読み上げの文言を公開する', () => {
      const panel = makeAgentReferencesPanelState()
      const references = makeAgentReferencesState({
        panel,
        announcement: { id: 1, text: '参照に @a.ts を足しました' }
      })
      mockUseAgentReferences.mockReturnValue(references)
      const { result } = renderHook(() => useAppState())
      const args = mockUsePromptRunner.mock.calls[0][0] as { agentReferences: unknown }
      expect(args.agentReferences).toBe(references)
      expect(result.current.agentReferences).toBe(panel)
      expect(result.current.agentReferenceAnnouncement).toBe('参照に @a.ts を足しました')
    })
```

`src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx`:
- `@testing-library/react` の import に `within` を足し、import に足す:
```ts
import type { AgentReferencesPanelState } from '../../../types'
import { makeAgentReferencesPanelState } from '../../../__tests__/makeAgentReferencesState'
```
（`import type { Prompt } from '../../../types'` は `import type { AgentReferencesPanelState, Prompt } from '../../../types'` にまとめる）
- `defaultProps` の `onImport: vi.fn()` の次に `agentReferences: null as AgentReferencesPanelState | null` を足す（前の行の末尾に `,`）。
- ファイルの末尾に足す:
```tsx
describe('PromptsPanel: 参照の行', () => {
  it('参照の状態が無ければ(従来の方式・フォルダを開いていない)参照の行を出さない', () => {
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
    expect(screen.queryByRole('group', { name: '参照' })).toBeNull()
  })

  it('参照の状態があれば、プロンプトの一覧より前に参照の行を出す', () => {
    render(
      <PromptsPanel
        {...defaultProps}
        prompts={[samplePrompt]}
        agentReferences={makeAgentReferencesPanelState()}
      />
    )
    const group = screen.getByRole('group', { name: '参照' })
    expect(within(group).getByRole('button', { name: '@src/app.ts' })).toBeInTheDocument()
    expect(
      group.compareDocumentPosition(screen.getByText('テストタイトル')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
```

`src/renderer/src/components/__tests__/Sidebar.test.tsx`:
- `@testing-library/react` の import に `fireEvent` を足し、`import type { … } from '../../types'` の一覧に `AgentReferencesPanelState` を足し、`import { makeAgentReferencesPanelState } from '../../__tests__/makeAgentReferencesState'` を足す。
- `defaultProps` の `agentSendConfirm: { … }` の次に `agentReferences: null as AgentReferencesPanelState | null` を足す（前の行の末尾に `,`）。
- `describe('Sidebar', …)` の中の末尾に足す:
```tsx
  describe('参照(エージェントへ送るプロンプトの @ 参照)', () => {
    it('prompts: 参照の状態をプロンプトパネルの参照の行へ渡す', () => {
      render(
        <Sidebar
          activePanel="prompts"
          {...defaultProps}
          agentReferences={makeAgentReferencesPanelState()}
        />
      )
      expect(screen.getByRole('group', { name: '参照' })).toBeInTheDocument()
    })

    it('explorer: 参照の状態があれば、ファイルの「参照として添える」で onAddFromExplorer に絶対パスを渡す', async () => {
      const agentReferences = makeAgentReferencesPanelState()
      render(
        <Sidebar
          activePanel="explorer"
          {...defaultProps}
          folderPath="/p"
          fileTree={[{ name: 'a.ts', path: '/p/a.ts', type: 'file' }]}
          agentReferences={agentReferences}
        />
      )
      fireEvent.contextMenu(screen.getByText('a.ts'))
      await userEvent.click(screen.getByRole('menuitem', { name: '参照として添える' }))
      expect(agentReferences.onAddFromExplorer).toHaveBeenCalledExactlyOnceWith('/p/a.ts')
    })

    it('explorer: 参照の状態が無ければ「参照として添える」を出さない', () => {
      render(
        <Sidebar
          activePanel="explorer"
          {...defaultProps}
          folderPath="/p"
          fileTree={[{ name: 'a.ts', path: '/p/a.ts', type: 'file' }]}
        />
      )
      fireEvent.contextMenu(screen.getByText('a.ts'))
      expect(screen.queryByRole('menuitem', { name: '参照として添える' })).toBeNull()
    })
  })
```

`src/renderer/src/components/__tests__/App.agentReferences.test.tsx`（新規。実物の useAppState・useAgentWorkspace・EditorPanel・Sidebar を通す配線のテスト。L-060）:
```tsx
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Panel } from '../../types'

// jsdom では xterm を開けない(matchMedia・canvas が無い)ため、文書ごとのタブの置き場の controller を偽物にする
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeAgentSessionTabs } = await import('../../__tests__/makeFakeAgentSessionTabs')
  const tabs = makeFakeAgentSessionTabs()
  return { getAgentSessionTabs: () => tabs }
})

import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'
import { mockEditor } from '../../__tests__/__mocks__/@monaco-editor/react'
import { selectionOf } from '../../__tests__/makeFakeApplyEditor'

// App → useAppState(useEditorSelectionRange・useAgentReferences)→ EditorPanel(onEditorMount)・Sidebar(PromptsPanel の参照の行・
// ExplorerPanel のメニュー)・常設の読み上げの領域、の配線を、末端の表示で確かめる

const panelButton = (panel: Panel): HTMLElement => {
  const config = activityBarPanels.find((p) => p.panel === panel)
  if (config === undefined) throw new Error(`panel config not found: ${panel}`)
  return screen.getByTitle(config.title)
}

// エージェント CLI 方式(ターミナルのパネルが出るまで待つ)でフォルダを開く
const openFolder = async (): Promise<HTMLElement> => {
  render(<App />)
  await screen.findByRole('region', { name: 'エージェント' })
  await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
  return screen.findByRole('tree')
}

describe('App: 参照の配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.getPromptExecutionMode = vi.fn().mockResolvedValue('agent-cli')
    window.api.loadPrompts = vi.fn().mockResolvedValue([])
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi.fn().mockResolvedValue([
      { name: 'a.ts', path: '/project/a.ts', type: 'file' },
      { name: 'notes.md', path: '/project/notes.md', type: 'file' }
    ])
    window.api.readFile = vi.fn().mockResolvedValue('line1\nline2\nline3')
    window.api.onExternalFileChange = vi.fn(() => () => {})
  })

  it('エクスプローラの「参照として添える」で足したファイルを、パネルの外の読み上げの領域とプロンプトパネルの参照の行に出す', async () => {
    const tree = await openFolder()
    fireEvent.contextMenu(await within(tree).findByText('notes.md'))
    await userEvent.click(screen.getByRole('menuitem', { name: '参照として添える' }))
    const announcement = await screen.findByText('参照に @notes.md を足しました')
    expect(announcement).toHaveAttribute('aria-live', 'polite')
    // エクスプローラを開いている間はプロンプトパネルが隠れるため、サイドバーの外に置く
    expect(document.querySelector('.sidebar')?.contains(announcement)).toBe(false)
    await userEvent.click(panelButton('prompts'))
    const group = screen.getByRole('group', { name: '参照' })
    expect(within(group).getByText('@notes.md')).toBeInTheDocument()
    expect(
      within(group).getByRole('button', { name: '@notes.md を参照から外す' })
    ).toBeInTheDocument()
  })

  it('エディタで開いたファイルと選択範囲を参照のチップに出し、オンにしたファイルを編集すると未保存の印を付ける', async () => {
    const tree = await openFolder()
    await userEvent.click(await within(tree).findByText('a.ts'))
    await screen.findByTestId('monaco-editor')
    act(() => mockEditor.current?.select(selectionOf(1, 1, 2, 3, 2, 3)))
    await userEvent.click(panelButton('prompts'))
    const group = await screen.findByRole('group', { name: '参照' })
    await userEvent.click(within(group).getByRole('button', { name: '@a.ts' }))
    expect(within(group).getByRole('button', { name: '@a.ts' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(group).getByRole('button', { name: '@a.ts#L1-2' })).toBeEnabled()
    fireEvent.change(screen.getByTestId('monaco-editor-textarea'), { target: { value: 'typed' } })
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: '@a.ts 未保存' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    )
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/App.agentReferences.test.tsx`
Expected: FAIL（参照を足さない・`agentReferences` を渡さない・参照の行が無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/usePromptRunner.ts`:
- import に足す:
```ts
import type { AgentReferencesState } from './useAgentReferences'
import { appendAgentReferences } from '../lib/agentReferences'
```
- `Deps` の `sendToAgent` の次に足す:
```ts
  /** エージェントへ送るプロンプトの参照(useAgentReferences)。実行を押した時点の写しを本文の末尾へ足し、送れたら写しの分の
   *  エクスプローラのファイルを外す。従来の方式では使わない。省略できない(L-060) */
  agentReferences: Pick<AgentReferencesState, 'prepare' | 'markSent'>
```
- 分割代入の `sendToAgent` の次に `agentReferences` を足し（前の行の末尾に `,`）、`const run = useCallback(` の前に足す:
```ts
  // useCallback の依存に入れるため、描画をまたいで同じ参照の関数だけを取り出す
  const { prepare: prepareAgentReferences, markSent: markAgentReferencesSent } = agentReferences
```
- `runPrompt` のエージェント CLI 方式の分岐を次にし、依存の配列に `prepareAgentReferences, markAgentReferencesSent` を足す:
```ts
      if (executionMode === 'agent-cli') {
        // 変数を差し込んだ後の本文の末尾へ、押した時点の参照を足す(送信前の確認には足した後の全文が出る)。エクスプローラから
        // 足したファイルは、送れたときだけ、この写しの分を外す(確認のキャンセル・送信の失敗では外さない。L-407)
        const prepared = prepareAgentReferences()
        await sendToAgent(appendAgentReferences(content, prepared.references), {
          promptId: prompt.id,
          unsavedPaths: prepared.unsavedPaths,
          onSent: () => markAgentReferencesSent(prepared)
        })
        return
      }
```
（依存の配列は `[run, openFile, executionMode, sendToAgent, prepareAgentReferences, markAgentReferencesSent]`）

`src/renderer/src/hooks/useAppState.ts`:
- import に足す:
```ts
import { useAgentReferences } from './useAgentReferences'
import { toAnnouncementText } from '../lib/announcementText'
```
`import type { CloneRepositoryPanelState, … } from '../types'` の一覧に `AgentReferencesPanelState,` を足す。
- `AppState` の `attachEditorSelection`（Task 2）の次に足す:
```ts
  /** プロンプトパネルの参照の行(エージェント CLI 方式でフォルダを開いているときだけ。それ以外は null)。Sidebar へ渡す */
  agentReferences: AgentReferencesPanelState | null
  /** エクスプローラから参照を足したときの読み上げの文言(App が常設の aria-live の領域に出す) */
  agentReferenceAnnouncement: string
```
- `const editorSelection = useEditorSelectionRange()`（Task 2）の次に足す:
```ts
  // エージェントへ送るプロンプトに添える参照(チップ・エクスプローラから足したファイル)。実行の時点の写しを usePromptRunner が本文へ足す
  const references = useAgentReferences({
    folderPath: fileSystem.folderPath,
    isAgentMode: agentWorkspace.executionModePanel.mode === 'agent-cli',
    activeFile: fileSystem.openFile,
    isDiffTabActive: diffTabs.activeDiffTab !== null,
    openFiles: fileSystem.openFiles,
    selection: editorSelection.selection
  })
```
- `usePromptRunner({ … })` の `sendToAgent: agentWorkspace.sendToAgent` の次に `agentReferences: references` を足す（前の行の末尾に `,`）。
- 戻り値の `attachEditorSelection: editorSelection.attachEditor,` の次に足す:
```ts
    agentReferences: references.panel,
    agentReferenceAnnouncement: toAnnouncementText(references.announcement),
```

`src/renderer/src/components/prompts/PromptsPanel.tsx`:
- import に足す（型の import は既存の `import type { AgentSendFeedback, PromptToolId, Prompt } from '../../types'` に `AgentReferencesPanelState` をまとめる）:
```ts
import AgentReferenceChips from './AgentReferenceChips'
```
- `Props` の `runAriaLabel?: string` の次に足す:
```ts
  /** 参照の行(エージェント CLI 方式でフォルダを開いているときだけ。それ以外は null で行を出さない)。省略できない(L-060) */
  agentReferences: AgentReferencesPanelState | null
```
- 分割代入の `runAriaLabel` の次に `agentReferences` を足す（前の行の末尾に `,`）。
- `<div className="prompts-panel__search">` の直前に足す:
```tsx
      {/* プロンプトの一覧の上(検索欄の前)に、実行のときに本文へ足す参照のチップを出す */}
      {agentReferences !== null && <AgentReferenceChips state={agentReferences} />}
```

`src/renderer/src/components/Sidebar.tsx`:
- `import type { … } from '../types'` の一覧に `AgentReferencesPanelState` を足す。
- `Props` の `agentSendConfirm: AgentSendConfirmPanelState` の次に足す:
```ts
  /** エージェントへ送るプロンプトの参照(プロンプトパネルの参照の行と、エクスプローラの「参照として添える」)。エージェント CLI 方式で
   *  フォルダを開いているときだけで、それ以外は null。省略できない(L-060) */
  agentReferences: AgentReferencesPanelState | null
```
- 分割代入の `agentSendConfirm` の次に `agentReferences` を足す（前の行の末尾に `,`）。
- `<ExplorerPanel` の `clone={clone}` の次に足す:
```tsx
          onAddReference={
            agentReferences === null
              ? undefined
              : (node) => agentReferences.onAddFromExplorer(node.path)
          }
```
- `<PromptsPanel` の `isActive={activePanel === 'prompts'}` の次に `agentReferences={agentReferences}` を足す。

`src/renderer/src/App.tsx`:
- `useAppState()` の分割代入の `attachEditorSelection,`（Task 2）の次に `agentReferences,`・`agentReferenceAnnouncement,` を足す。
- `<Sidebar` の `agentSendConfirm={agentSendConfirmPanel}` の次に `agentReferences={agentReferences}` を足す。
- `<AgentAnnouncer message={agentAnnouncement} />` の次に足す:
```tsx
      {/* エクスプローラから参照を足したときの読み上げ。エクスプローラを開いている間はプロンプトパネルが隠れるため、パネルの外に常設する */}
      <AgentAnnouncer message={agentReferenceAnnouncement} />
```

- [ ] **Step 4: テストを通す・型チェック・lint**

Run: `npx vitest run src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/prompts src/renderer/src/components/__tests__ src/renderer/src/components/explorer`
Expected: PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: `npx eslint --fix src/renderer/src/hooks/usePromptRunner.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/components/prompts/PromptsPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/hooks/__tests__/usePromptRunner.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts src/renderer/src/components/prompts/__tests__/PromptsPanel.test.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/App.agentReferences.test.tsx`
Run: `npx eslint --max-warnings 0` に同じファイルを渡す
Expected: エラー・警告なし

---

### Task 7: ROADMAP・実機テスト仕様書の更新と全体の検証

**Files:** `ROADMAP.md`、`docs/manual-test-spec.md`、`.superpowers/manual-test-spec.html`（生成。git 管理外）

- [ ] **Step 1: ROADMAP**
  - 「今後実装した方がよい機能（未実装）」→「エージェント実行の支援（MVP の次）」の `- [ ] 開いているファイル・選択範囲・ファイルパスを参照として添える（`@` 参照など。従来のファイル内容の添付に代わる手段）` を消す。
  - 「実装済み機能」の `### エージェントへの送信前の確認` の節（既知の制約の箇条書きまで）の後、`---` の前に次の節を足す:
```markdown
### エージェントへ送るプロンプトへの参照の添付

設計書: `docs/superpowers/specs/2026-10-10-agent-prompt-references-design.md`（2026-10-10）。

- [x] エージェント CLI 方式でフォルダを開いているとき、プロンプトパネルの検索欄の上に「参照」の行を出し、「開いているファイル」（`@src/app.ts`）・「選択範囲」（`@src/app.ts#L10-20`）のチップをオンにすると、`実行` のときに本文の末尾へ空行を挟んで `参照:` と `- @…` の一覧を足す（送信前の確認には足した後の全文が出る。従来の方式は今のまま）
- [x] チップの中身はアクティブなタブ・選択に追従し、オン・オフは送った後も保つ。押せないとき（タブが無い・差分のタブ・フォルダの外・選択が無い）は理由を出す
- [x] エクスプローラのファイルの右クリック `参照として添える` で任意のファイルを足し（読み上げ `参照に @docs/notes.md を足しました`）、`×` で外す。送れたら、`実行` を押した時点に入れたものだけ外す（キャンセル・送信の失敗では外さない）。フォルダ・方式の切り替えで足したファイルを外し、チップをオフに戻す
- [x] オンにしたチップのファイルに未保存の変更があれば、チップに `未保存` の印を付け、送信前の確認に `未保存の変更があるファイルは、保存するまで claude に見えません: …` を出す（送信は止めない）

既知の制約（設計書の「既知の制約」と同じ）:
- `@` 参照の解釈は `claude` に任せる（書式は `claude` の `@パス`・`#L開始-終了` に合わせた。パスに空白などを含むと参照として解釈されないことがある。貼り付けた本文の中の `@` 参照が展開されるかは `claude` の版による）
- 未保存の編集は `claude` に見えない（注意は出すが、送信は止めない）
- エクスプローラから足したファイルが後で削除・改名されても、参照は自動では外れない
- POSIX のルート（`/`）をフォルダとして開いたときは、参照にできない
```

- [ ] **Step 2: 実機テスト仕様書**
  - 最大の番号を確かめる: `grep -o 'AGT-[0-9]*' docs/manual-test-spec.md | sort -t- -k2 -n | tail -1`（計画の時点では `AGT-173`。違えばその次から振り、下の項目の中の相互参照〈`AGT-180` など〉も合わせて直す）。
  - `grep -n '^## \|^### ' docs/manual-test-spec.md` で、`### 送信前の確認` が `## エージェント CLI のアプリ内ターミナル` の領域の最後の `###` であることを確かめる（後ろに別の `###` が増えていれば、その領域の最後の `###` の後に足す）。
  - `### 送信前の確認` の最後の項目（`AGT-173`）の後、`## エージェントの変更の確認` の前に、次の節を足す（書式は `- [ ] **<ID>** <手順> → <期待結果>`、1 行 1 項目）。設計書「エラーと境界の扱い」との対応（L-297）: フォルダを開いていない・従来の方式 → AGT-175・AGT-183、開いているファイルの切り替え → AGT-177、参照の長さの上限 → 既存の AGT-159 と同じ経路のため項目にしない（`usePromptRunner` と送信前の確認の単体テストで確かめる）、エクスプローラから足したファイルの削除・改名 → 既知の制約のため項目にしない。「確認を開いている間に足したものは残す」は、確認がモーダルで背後を覆うため画面から通れず、`useAgentReferences` の単体テスト（Task 4）で確かめる:
```markdown
### 参照を添える

> 前提: Claude Code（`claude`）がインストールされログイン済みで、テスト用のフォルダ（`src/app.ts`〈30 行以上のテキスト〉と `docs/notes.md`〈数行のテキスト〉を含む）を開き、ターミナルのパネルで `claude 1` を起動している（設定の実行方式はエージェント CLI、設定の「送信前の確認」はオン〈既定〉）。プロンプトは「プロンプト」パネルに `要約`（内容 `参照したファイルの内容を 3 行で要約して`）を登録しておく。
> 前提: 実装の自動テストでは、実物の `claude` も Electron の画面も使っていない。以下はすべて実機で未確認。期待と違ったら、その画面（プロンプトパネルの参照の行・ダイアログ・ターミナル）を記録する。

- [ ] **AGT-174** `src/app.ts` をエディタで開き、プロンプトパネルの参照の行の `@src/app.ts` を押してオンにしてから、`要約` の `実行` を押す → 確認のダイアログの本文が `参照したファイルの内容を 3 行で要約して`・空行・`参照:`・`- @src/app.ts` の 4 行になっている。`送信` を押すと、`claude` が `src/app.ts` の内容を要約する。`claude` の画面で、貼り付けた本文の `@src/app.ts` がファイルの添付として展開されたか（入力欄・会話にファイルの読み込みの表示が出るか）、`claude` が自分でファイルを読んだか（`Read(src/app.ts)` などの表示）を、`claude --version` の版とあわせて記録する
- [ ] **AGT-175** フォルダを開いていない状態と、設定の実行方式を「従来の方式」にした状態で、それぞれプロンプトパネルを見る → どちらも参照の行（`参照`）が出ない。エージェント CLI 方式に戻してフォルダを開くと、プロンプトの検索欄の上に `参照` の行が出る
- [ ] **AGT-176** フォルダを開いた直後（エディタのタブが無い）にプロンプトパネルの参照の行を見て、`開いているファイル`・`選択範囲` のチップにマウスを載せる → どちらも薄く表示されて押せず、それぞれ `開いているファイルがありません`・`エディタで範囲を選ぶと添えられます` がツールチップで出る
- [ ] **AGT-177** `src/app.ts` を開いて `@src/app.ts` のチップを押し、続けて `docs/notes.md` を開いてタブを切り替える → チップは押した見た目（青）のまま、表示が `@docs/notes.md` に変わる。VoiceOver を有効にしてチップへ `Tab` で移ると、`@docs/notes.md` とオン（選択されている）の状態が読まれる。もう一度押すとオフに戻る
- [ ] **AGT-178** `src/app.ts` の 10 行目の途中から 20 行目の途中までをドラッグで選ぶ → `選択範囲` のチップが `@src/app.ts#L10-20` になって押せる。10 行目の行頭から `Shift+↓` を 3 回押して選ぶと `@src/app.ts#L10-12`（13 行目を含まない）、10 行目の中だけを選ぶと `@src/app.ts#L10` になる。クリックで選択を解除すると、チップは `選択範囲` に戻って押せなくなる
- [ ] **AGT-179** `src/app.ts` を開いて `@src/app.ts` をオンにし、10〜20 行目を選んで `@src/app.ts#L10-20` もオンにしてから `要約` の `実行` を押し、`送信` を押す → ダイアログの `参照:` の下が `- @src/app.ts`、`- @src/app.ts#L10-20` の順に並ぶ（ファイル全体が先）。`claude` が 10〜20 行目を見ているか（`claude` の画面の表示・要約の内容）を記録する。送った後も 2 つのチップはオンのまま
- [ ] **AGT-180** `src/app.ts` を開いて `@src/app.ts` をオンにし、エディタで 1 文字打って保存せずに `要約` の `実行` を押す → チップに `未保存` の印が出ていて、ダイアログに `未保存の変更があるファイルは、保存するまで claude に見えません: src/app.ts` が出る。`送信` は押せて送られる。その後エディタをクリックしてから `Cmd+S` で保存すると、チップの `未保存` の印が消える
- [ ] **AGT-181** AGT-180 と同じく未保存の状態で、設定の「送信前の確認」をオフにしてから `要約` の `実行` を押す → ダイアログは出ずにすぐ送られ、チップの `未保存` の印だけが残る（確かめたら、設定はオンに戻し、ファイルを保存しておく）
- [ ] **AGT-182** VoiceOver を有効にして、エクスプローラで `docs/notes.md` を右クリックし、`参照として添える` を押す → `参照に @docs/notes.md を足しました` が読まれる。プロンプトパネルに切り替えると、参照の行に `@docs/notes.md ×` が出る。もう一度同じファイルで `参照として添える` を押しても、チップは 1 つのまま。フォルダ（`docs`）を右クリックしたときは `参照として添える` が出ない
- [ ] **AGT-183** ターミナルの `claude 1` を終了し（実行中のエージェントがあると方式の切り替えが止められるため）、設定の実行方式を「従来の方式」にしてから、エクスプローラでファイルを右クリックする → `参照として添える` が出ない（確かめたら、エージェント CLI 方式に戻して `claude 1` を起動し直す）
- [ ] **AGT-184** AGT-182 で足した `@docs/notes.md` の `×` に `Tab` で移り、VoiceOver で聞いてから `Enter` を押す → `@docs/notes.md を参照から外す` と読まれ、押すとチップが消え、フォーカスは参照の行（ほかに足したファイルがあればその `×`）に残り、body に落ちない（続けて `Tab` を押すと、参照の行の中の押せるチップか、その次の検索欄へ進む）
- [ ] **AGT-185** エクスプローラから `docs/notes.md` を足し、`要約` の `実行` で開いたダイアログで `キャンセル` を押す → ダイアログの本文の末尾に `- @docs/notes.md` があり、キャンセルの後もチップは残る。もう一度 `実行` して `送信` を押すと、送れた後に `@docs/notes.md ×` のチップが消える（オンにしていた `@src/app.ts` などのチップはオンのまま）
- [ ] **AGT-186** エクスプローラから `docs/notes.md` を足し、`claude 1` で `/model` の選択の画面を出してから `要約` の `実行` を押し、`送信` を押す → プロンプトパネルに `エージェントの入力欄が見つかりません。…` の失敗の文言が出て、`@docs/notes.md ×` のチップは残る（確かめたら `Esc` で `claude` の選択の画面を閉じる）
- [ ] **AGT-187** エクスプローラから `docs/notes.md` を足し、`@src/app.ts` をオンにしてから、「フォルダを変更」で別のフォルダを開く（実行中のエージェントを終了する確認が出たら OK を押す）→ 参照の行から `@docs/notes.md` が消え、`開いているファイル`・`選択範囲` のチップはオフに戻る。元のフォルダに戻し、同じ状態を作ってから、ターミナルのエージェントをすべて終了し（実行中は方式の切り替えが止められるため）、設定の実行方式を「従来の方式」→「エージェント CLI」と切り替えたときも、足したファイルは消え、チップはオフに戻る
- [ ] **AGT-188** 「ソース管理」で変更のあるファイルの差分のタブを開いてアクティブにし、プロンプトパネルの参照の行を見る → `開いているファイル` のチップは押せず、マウスを載せると `差分のタブは参照にできません` が出る。`選択範囲` も押せない
- [ ] **AGT-189** ファイル名に空白を含む `docs/my notes.md` を作り、エクスプローラから足して `要約` の `実行` を押し、`送信` を押す → ダイアログの本文に `- @docs/my notes.md` が出る。`claude` がそのファイルを参照として読むか（読まない場合はその表示）を記録する（既知の制約: 空白を含むパスは `claude` が参照として解釈しないことがある）
- [ ] **AGT-190** OS（またはアプリ）をダークテーマにして、参照の行（オフ・オン・押せない・`未保存` の印・`×` 付きのチップ）を見る。タッチ対応の画面があれば指でタップする → どれも文字が読め、オン・オフ・押せないものの見た目が区別できる。チップと `×` はタッチで押せる大きさ（高さ 32px 以上）がある
```
  - 既存の項目のうち、この機能で期待結果が変わるものを直す（ID は変えない）:
    - `EXP-026` を次にする: `- [ ] **EXP-026** ファイルの行を右クリックする → メニューに `リネーム` `削除` `.gitignore に追加` が表示され（設定の実行方式がエージェント CLI なら、その後に `参照として添える` も出る）、`新規ファイル` `新規フォルダ` は出ない`
  - `grep -n '右クリック' docs/manual-test-spec.md` で、ファイルの右クリックのメニューの項目を列挙して確かめるほかの項目が無いかを見る。あれば、エージェント CLI 方式で `参照として添える` が増えることを期待結果に足す（ID は変えない）。

- [ ] **Step 3: HTML の再生成と仕様書の検査**

Run: `node scripts/build-manual-test-spec.mjs && npx vitest run scripts`
Expected: `.superpowers/manual-test-spec.html` が更新され、scripts のテスト（ID の一意性・接頭辞ごとの連番の昇順・書式）が PASS

- [ ] **Step 4: Artifact の再公開**

Artifact ツールで、`.superpowers/manual-test-spec.html`（同じファイルパス）を既存の Artifact（<manual-test-spec-artifact-url>）へ再公開する（`url` にこの URL を渡す。この会話でまだ読んでいなければ、先に `action: "read"` で読んでから公開する）。公開の結果の URL が同じであることを確かめる。

- [ ] **Step 5: 全体の検証**

Run: `npx vitest run`
Expected: すべて PASS
Run: `npm run typecheck`
Expected: エラーなし
Run: 下の eslint に渡すのと同じファイルへ `npx eslint --fix <files>`（prettier の 100 桁の折り返しなど、自動で直せるものを先に直す）
Run: `npx eslint --max-warnings 0` に、このプランで作成・変更した TypeScript のファイルをすべて渡す（`git status --porcelain` の `.ts`・`.tsx` の一覧から作る）
Expected: エラー・警告なし
