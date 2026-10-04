# AI 出力のエディタへの反映 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 出力パネルのヘッダー（出力全体）と各コードブロックの見出し（そのコードの原文）に `挿入`・`置換` を置き、開いているファイルのカーソル位置への挿入・選択範囲の置換を、Monaco の編集（1 回の undo で戻せる。タブは未保存になる。自動保存しない）として反映する。反映後はエディタへフォーカスを戻し、`挿入しました` / `置換しました` を `role="status"` で通知する。

**Architecture:** 反映の手順は `lib/applyToEditor.ts`（Monaco の最小のインターフェース `ApplyTargetEditor` を受け取る純粋に近い関数。`pushUndoStop` → `executeEdits` → `pushUndoStop` → `revealPosition` → `focus`。コードレビュー 1 巡目で `setSelection` を外し、カーソルは `executeEdits` の第 3 引数のコールバックの戻り値で置く。2 巡目で、挿入の末尾が見えるようにスクロールする `revealPosition` を足した）、コードブロックの原文の取り出しは `lib/codeBlockSource.ts`（react-markdown が `pre` に渡す hast の要素から）。反映先のエディタと選択範囲の有無・通知は `hooks/useApplyOutputToEditor.ts` が state で持ち、`EditorPanel` の Monaco の `onMount`（`handleEditorMount` が true のとき）から `attachEditor` で受け取り、`onDidChangeCursorSelection`・`onDidDispose` を購読する。表示は `OutputPanel`（ヘッダーのボタン・無効の理由・通知）と、`MarkdownRenderer` の `pre` を差し替える `CodeBlock`（反映の状態は context で渡し、`components` は定数のまま）。`useEditorFocusManager` と `App` は変えない。

**Tech Stack:** Electron / React 19 / TypeScript / `@monaco-editor/react` 4.7.0 / `monaco-editor` 0.55.1 / `react-markdown` 10.1.0（`remark-gfm` 4.0.1・`remark-breaks` 4.0.0）/ Vitest 4.1.7（jsdom）+ Testing Library

**Spec:** [docs/superpowers/specs/2026-10-04-apply-output-to-editor-design.md](../specs/2026-10-04-apply-output-to-editor-design.md)

## 設計書との差異（実物のライブラリで確認。実装はこちらに従う）

設計書の確認事項 1〜8 を、プラン作成の最初に実物のライブラリで確かめた（結果は設計書の末尾の「確認の結果」に追記済み）。scratchpad のリポジトリの写しで、実物の `monaco-editor` を vitest の jsdom で動かし、実物の `@monaco-editor/react` を依存をインライン化した実験用の vitest の設定で描画し、react-markdown の `pre`・`code` に渡る値を出力して確かめた。各項目は設計書の本文にも反映済み（「確認事項の結果で変更」「確認事項の検討で変更」と書いた箇所）。

1. （設計書へ反映済み）**「`onChange` → `value` の再同期で壊れない」は自動テストではなく、プラン作成時の実測と実機（APL）で確かめる**（当初の設計書は「結合テストで確かめる」）。`@monaco-editor/react` 4.7.0 の `Editor`（`node_modules/@monaco-editor/react/dist/index.mjs.map` の `src/Editor/Editor.tsx`）は、`value` が `editor.getValue()` と同じなら何もしない（違えば全体を `executeEdits('', [全範囲])` で置き換える。読み取り専用なら `setValue`）。実物を `value`・`onChange` で制御して `executeEdits` を呼ぶと、`onChange` が新しい内容で 1 回呼ばれ、その値を state に戻して再描画しても追加の `executeEdits`・`setValue` は無く、モデル・選択範囲・undo の履歴は保たれた。vitest の alias が `@monaco-editor/react` をモックへ向けており、実物を読むには全体の設定（`server.deps.inline`）を変える必要があるため、スイートには入れない（既知の制約）。
2. （設計書へ反映済み）**実物の Monaco を jsdom で動かし、undo・改行コード・カーソル・複数カーソル・読み取り専用・破棄済みを自動テストで固定する**（`lib/__tests__/applyToEditor.monaco.test.ts`）。`monaco-editor/esm/vs/editor/editor.api.js`（`editor.main` は全言語と worker を読むため使わない）の `editor.create` には、`matchMedia`（テーマの判定）と canvas の 2D コンテキスト（文字幅の計測・描画）の偽物が要る。`automaticLayout: false` にすれば `ResizeObserver` は要らない。テストの後は `editor.dispose()`・`model.dispose()` で描画のタイマーを残さない（未処理のエラーが出ないことを確認した）。読み込みに 1.5 秒前後かかる。
3. （設計書へ反映済み）**挿入の位置は主カーソルの位置（`positionLineNumber`・`positionColumn`）**（当初の設計書は「選択範囲の開始位置（カーソル位置）」）。前向きの選択ではカーソルは選択の終わりにあり、開始と違う。選択範囲があっても、選択された文字列は残してカーソルの位置に挿入する。
4. （設計書へ反映済み）**反映後のカーソルは `setSelection` で挿入したテキストの末尾へ置く**。`forceMoveMarkers: true` だけでは、前向きの選択の終わりに挿入したとき選択の終わりだけが動き、選択が広がる（実測 `(1,2)-(1,4)` → `(1,4)-(1,6)`。変異 A3 で確認）。末尾の位置は `executeEdits` の第 3 引数のコールバックが受け取る逆向きの編集の範囲（挿入したテキストの範囲。CRLF への変換後）の末尾から求める。コールバックは `null` を返す（カーソルを返すには `Selection` のクラスのインスタンスが要り、型の上で素のオブジェクトは返せない。`monaco-editor` を実行時に読み込むと単体テストが 1.5 秒重くなるため、クラスは使わない）。**コードレビュー 1 巡目で変更**: `setSelection` は undo の履歴に残らず、undo → redo の後に反映したテキスト全体が選択された状態で戻っていた。コールバックが末尾の空の選択（素の `ISelection`。実行時は Monaco が 4 つの値だけを読むため、クラスは要らない）を返すようにし、`setSelection` を外した。型は、コールバックをメソッドの形で宣言して双変にし、選択の配列も含めて `IStandaloneCodeEditor` と比べられるようにした。以下の Task の中のコード例は当初の形（`null` と `setSelection`）のまま残す。現行のコードは `src/renderer/src/lib/applyToEditor.ts`。
5. （設計書へ反映済み）**undo は 1 回で戻り、エディタの undo（Cmd+Z。`trigger(…, 'undo')`）なら選択範囲も反映前に戻る**。前の `pushUndoStop` が無いと、直前の入力とまとめて戻る（変異 A1 で確認）。後ろの `pushUndoStop` は、実測では直後の入力が別の undo になるため挙動では検出できず（Monaco は入力の前に区切る）、呼び出しの順序のテストで固定する。モデルの `undo()` は内容だけ戻し選択は戻さないため、実物のテストはエディタの undo を使う。
6. （設計書へ反映済み）**`executeEdits` が false（読み取り専用・破棄済み）なら `rejected` を返し、`反映できませんでした` を通知する**（設計書は「実装時に決める」）。このアプリのファイルのエディタは読み取り専用でなく（`editorOptions` に `readOnly` は無い）、diff タブは Monaco を使わないため、実際には起きない防御。モデルが無い・選択範囲が取れない・置換で選択が空のときは `unavailable` で、通知もしない。
7. （設計書へ反映済み）**`useEditorFocusManager` は変えない。反映先は `EditorPanel` の `onMount` から `attachEditor(editorInstance)` で受け取り、Monaco の `onDidDispose` で外す**（当初の設計書は「`useEditorFocusManager` にマウント通知を足す」「フックが `editorRef` と有効条件（アクティブなファイルの有無）を受け取る」）。`editorRef` は diff タブへの切り替えでは古いインスタンスを持ち続け、ref なので再描画も起こさない。`@monaco-editor/react` はアンマウントでエディタとモデルを `dispose` するため、diff タブ・Welcome・ファイルを閉じる・ファイルの切り替え（`key={openFile.path}`）のどれでも `onDidDispose` が呼ばれる。よってフックの引数は `isExecuting` だけになり、`App` も変わらない。`attachEditor` は前のエディタの購読を先に外す（外さないと、前のエディタの破棄の通知が新しい反映先を消す。変異 H1）。破棄済み（モデルが無い）のインスタンスは追わない。購読は effect ではなく `attachEditor` の中で張る（effect にすると、マウントと購読の間に破棄されたとき通知を取りこぼす）。
8. （設計書へ反映済み）**フックの戻り値は `{ applyOutput: ApplyOutputState, attachEditor }`、`ApplyOutputState = { insertDisabledReason, replaceDisabledReason, apply(mode, text), notice }`**（当初の設計書は `{ canInsert, canReplace, disabledReason(mode), insert(text), replace(text), notice }`）。無効の理由が null かどうかで可否を表し、可否と理由が食い違う状態を作らない。`ApplyOutputState` は `types.ts` に置き、`OutputPanel` の props（省略可能）にする。
9. （設計書へ反映済み）**無効の理由の文言は `反映先のファイルが表示されていません`・`実行中は反映できません`・`選択範囲がありません`、優先順位はこの順**（当初の設計書の例は `ファイルを開いていません`）。diff タブ・解決ビュー・Welcome・エディタのマウント前を 1 つの理由で表すため。理由は `title`・`aria-describedby` に加えて、出力パネルのヘッダーに表示する（`output-panel__apply-reason`。タッチ操作では `title` が出ないため）。表示する要素は 1 つで、置換の理由を出す（挿入が無効なら置換も同じ理由で無効なので、置換の理由で両方を説明できる）。無効なボタンだけがその要素を `aria-describedby` で参照する。
10. （設計書へ反映済み）**実行中は `挿入`・`置換` のボタン自体を出さない**。実行中の出力パネルは逐次出力を等幅の `pre` で出すだけで Markdown として描画しない（既存の作り）ため、コードブロックが無い。ヘッダーのボタンも同じ条件（`!isExecuting && result !== null && result !== ''`）で出す。フックは防御として `実行中は反映できません` を持つ。
11. （設計書へ反映済み）**中身の無いコードブロックには言語名だけを出し、ボタンを出さない。空の結果にもヘッダーのボタンを出さない**（反映しても何も変わらない。「押せるが効かない」を作らない。パターン 112）。
12. （設計書へ反映済み）**通知は、出力パネルの表示中ずっと置く `role="status"` の要素の文言を変える。id の偶奇でゼロ幅スペース（U+200B）を付けて、同じ文言でも読み上げ直させる**（当初の設計書は「通知の要素を作り直す」）。ライブリージョンは要素が先に在る必要があるため。`ConflictResolver` と同じ作り。通知は 3 秒（`APPLY_NOTICE_DURATION_MS = 3000`）で消し、次の反映で数え直す。コードレビュー 1 巡目で追加: 実行が始まったら（`isExecuting` が true）消す（`useTransientNotice.clear`）。
13. （設計書へ反映済み）**`MarkdownRenderer` の `components` はモジュールの定数にし、反映の状態は `CodeBlockActionsContext` で `CodeBlock` へ渡す**。`components` を描画ごとに作ると `pre` の要素の型が変わり、選択範囲の変化のたびにコードブロックが作り直されて、押したボタンのフォーカスが失われる（変異 K1 で確認）。`codeBlockActions` を渡さないときは従来の `components` をそのまま使う。
14. （設計書へ反映済み）**原文は React の `children` ではなく hast（`node`）から取り出し、名前は `lib/codeBlockSource.ts` の `getCodeBlockSource`**（当初の設計書は `lib/extractCodeBlocks.ts`（必要なら））。`code` を差し替えると React の `children` が変わるため。mdast-util-to-hast は中身があれば末尾に `\n` を 1 つ足すので 1 つだけ除く（中の末尾の空行は残す）。hast の型は react-markdown の公開の型 `ExtraProps['node']` から取る（`hast` はこのアプリの直接の依存ではない）。言語名は `language-` で始まる class の残り。text は再帰で集める（将来のハイライトで子が分かれても原文を保つ）。
15. （設計書へ反映済み）**`aria-label` の文言を確定する**: コードブロック `挿入（このコードブロックをカーソル位置へ）`・`置換（選択範囲をこのコードブロックで）`、ヘッダー `挿入（出力全体をカーソル位置へ）`・`置換（選択範囲を出力全体で）`。どれも可視の文言で始まる（パターン 76）。
16. （設計書の確認事項 5 の前提の訂正）**`MarkdownRenderer` を使うのは `OutputPanel` だけでなく `history/HistoryDetail.tsx`（実行履歴の詳細）も**。履歴の詳細には反映のボタンを付けない（`codeBlockActions` を渡さない）。既存の `OutputPanel.test.tsx`（19 件）・`MarkdownRenderer.test.tsx`（30 件）・履歴のテストは変更なしで通る。
17. （設計書の範囲外: テストの基盤）**`@monaco-editor/react` のモック（`src/renderer/src/__tests__/__mocks__/@monaco-editor/react.tsx`）に、選択範囲（`getSelection`・`setSelection`・`onDidChangeCursorSelection`）、編集（`executeEdits` は `\n` の文字列に 1 つの編集を当てて `onChange` を呼ぶ・`pushUndoStop`）、アンマウントでの破棄（`onDidDispose`・破棄後の `getModel` は null）を足し、最後にマウントされたエディタを `mockEditor.current` で公開する**（Task 6）。**コードレビュー 2 巡目で変更**: `executeEdits` は実物と同じく `endCursorState` の戻り値の先頭を編集の後の選択にし（当初は戻り値を捨て、常に挿入したテキストの末尾へ置いていた）、使われなくなった `setSelection` を外して `revealPosition` を足した。以下の Task の中のコード例は当初の形のまま残す。現行のコードは `src/renderer/src/__tests__/__mocks__/createMockEditorInstance.ts`。既存の `mockAddCommand`・`mockFocus`・`mockEditorModel` と描画は変えない。足した後も既存のコンポーネント・フックのテストは変更なしで通る。
18. （設計書の範囲外: 既存の lint の指摘）**変更する既存のファイルの lint の指摘を直す**。現行の `MarkdownRenderer.tsx` は `_node` の未使用 3 件・戻り値の型・prettier（末尾のカンマ）、`OutputPanel.tsx` は戻り値の型、モックの `Editor` は戻り値の型で `npx eslint` が失敗する。変更したファイルに eslint をかける規約のため、同じタスクで直す（`_node` はリポジトリの既存の書き方 `// eslint-disable-next-line @typescript-eslint/no-unused-vars` に合わせる）。
19. （設計書へ反映済み）**ROADMAP の整理**: 「クイックオープン」は PR #28（2026-08-21 マージ。Cmd/Ctrl+P）、「レスポンスのストリーミング表示」は PR #25（`useStreamingText`・`OutputPanel` の `streamingText`。Claude API と CLI の両方）で実装済みなのに未実装の一覧に残っている（ストリーミングは 2 か所に重複）。未実装から消し、実装済みへ足す（Task 7）。
20. （設計書の範囲外: テストの作り）**`aria-describedby` は参照そのものを確かめる**。`aria-label` を付けたボタンでは `title` も説明として計算されるため、`aria-describedby` を外しても `toHaveAccessibleDescription` は通る（変異 K2 が生き残った）。テストは `toHaveAttribute('aria-describedby', …)` か参照先の要素で確かめる。

設計書の仮定のうち、次は実物で確認でき、そのまま採用する。

- 改行コードは Monaco がモデルの改行コードへ変換する（CRLF のモデルに `\n` を入れると `\r\n`、LF のモデルに `\r\n` を入れると `\n`）。
- 複数カーソルのときは `getSelection()` が主カーソル（`setSelections` の先頭）を返し、`executeEdits` はその範囲だけを編集する。
- フォーカスの無いエディタへの `executeEdits` も成功し、選択範囲も保たれる（ボタンを押してもエディタの選択を失わない）。
- `onDidChangeCursorSelection` の戻り値の `dispose()` で購読が外れる。破棄済みのエディタでは `getSelection()` は null、`executeEdits` は false で、`pushUndoStop`・`focus` は例外を出さない。

## Global Constraints

- 返答・コメント・エラーメッセージ・テスト名は日本語。型だけの import は `import type`（CLAUDE.md）。
- `'use client'`: CLAUDE.md は「クライアントコンポーネントには必ず宣言」。この renderer（Electron + Vite。React Server Components は無い）では動作に影響しない指示子で、既存のファイルは混在している（`components/output` の 2 ファイルは宣言なし）。規約に従い、**新しいコンポーネント `CodeBlock.tsx` の先頭に `'use client'` を置く**。変更する既存のコンポーネント（`OutputPanel.tsx`・`MarkdownRenderer.tsx`・`EditorPanel.tsx`）には足さない（差分を機能に限る）。フック・lib・context のファイル・テストには置かない。
- `git commit` / `git push` は、ユーザーの明示的な指示があるまで行わない（SDD 中はコミットしない運用。各タスクのコミットの手順は飛ばす）。`git add -A` は使わない。ブランチを切り替えない（`git branch --show-current` が `feat/apply-output-to-editor`）。
- Copilot へのレビュー依頼・監視（`scripts/request-copilot-review.sh`・`scripts/watch-pr-review.sh`）は行わない（停止中。レビューはローカルで回す）。
- 実機（Electron）の確認の手順はプランに書かない。実機テスト仕様書 `docs/manual-test-spec.md` に新しい領域（接頭辞 `APL`）を追記する（Task 7）。Artifact（<manual-test-spec-artifact-url>）の再公開は親（コントローラー）が行う。
- テストは TDD（失敗するテスト → 実装 → 成功）。実装の後の検知力の確認（変異）は、`mktemp -d` の新しいディレクトリへ実装のファイルを `cp` で退避 → 変異を入れる → 該当のテストのファイル全体と、`-t` による単独の実行の両方で落ちることを確認 → `cp` で復元 → `cmp` で一致を確認、の手順で行う（`git stash` は使わない。パターン 57・78・103）。`-t` に渡す文字列は正規表現として解釈されるため、括弧を含めない（各タスクの表の「`-t`」の列をそのまま使う）。
- `act(...).then(...)` 形式でテストを書かない。モックの実装は、そのテストが依存するものをテストの中か `beforeEach` で設定し、前のテストの持続する実装に頼らない（1 回だけなら `Once`。パターン 103）。偽のタイマー（`vi.useFakeTimers()`）は `afterEach` の `vi.useRealTimers()` で戻す。effect の後に起きるもの（フォーカス・通知の消滅）を確かめるときは、偽のタイマーを `act` の中で進めるか `waitFor` で待つ（パターン 114）。
- テストのモックは型付きで作る（`vi.fn<Type['method']>()`。パターン 78）。`ApplyOutputState` のモックは `src/renderer/src/__tests__/makeApplyOutputState.ts` の 1 か所から作る（パターン 102）。
- CLAUDE.md の規約: 新しいボタンには `aria-label`（可視の文言で始める。パターン 76）。リストの `key` に表示文言を使わない（このプランでは新しいリストを作らない）。選択状態を表す UI は作らない（radiogroup は不要）。暗色固定のテーマに合わせる（`main.css` の既存の色と共通の枠付きボタンの規則。パターン 30・77）。
- 文字列のゼロ幅スペースは、ソースでは `'\u200b'` のエスケープで書く（実際の文字を埋め込まない。エディタの設定で見えなくなるため）。
- 型・定数（完全一致）:
  - `src/renderer/src/types.ts`: `ApplyMode = 'insert' | 'replace'`、`ApplyNotice = { text: string; id: number }`、`ApplyOutputState = { insertDisabledReason: string | null; replaceDisabledReason: string | null; apply: (mode: ApplyMode, text: string) => void; notice: ApplyNotice | null }`
  - `src/renderer/src/lib/applyToEditor.ts`: `APPLY_EDIT_SOURCE = 'apply-output'`、`ApplySelection = IRange & { positionLineNumber: number; positionColumn: number }`、`interface ApplyTargetEditor { getModel(): object | null; getSelection(): ApplySelection | null; pushUndoStop(): unknown; executeEdits(source, edits, endCursorState?): boolean; revealPosition(position): void; focus(): void }`（コードレビュー 1 巡目で `setSelection` を外し、2 巡目で `revealPosition` を足した。`endCursorState` は素の `ISelection[] | null` を返すコールバック、または選択の配列）、`ApplyResult = 'applied' | 'unavailable' | 'rejected'`、`isEmptySelection(selection: IRange): boolean`、`applyToEditor(editor: ApplyTargetEditor, mode: ApplyMode, text: string): ApplyResult`
  - `src/renderer/src/lib/codeBlockSource.ts`: `interface CodeBlockSource { code: string; language: string | null }`、`getCodeBlockSource(pre: Element | undefined): CodeBlockSource | null`（`Element` は `NonNullable<ExtraProps['node']>`）
  - `src/renderer/src/hooks/useApplyOutputToEditor.ts`: `APPLY_NOTICE_DURATION_MS = 3000`、`APPLY_DISABLED_REASONS`（のちに `lib/applyDisabledReason.ts` へ移動）`= { noEditor: '反映先のファイルが表示されていません', executing: '実行中は反映できません', noSelection: '選択範囲がありません' }`、`APPLY_NOTICES = { insert: '挿入しました', replace: '置換しました', rejected: '反映できませんでした' }`、`interface TrackedEditor extends ApplyTargetEditor { onDidChangeCursorSelection(listener): Disposable; onDidDispose(listener): Disposable }`、`useApplyOutputToEditor({ isExecuting }: UseApplyOutputToEditorOptions): ApplyOutputToEditor`、`ApplyOutputToEditor = { applyOutput: ApplyOutputState; attachEditor: (instance: TrackedEditor) => void }`
  - `src/renderer/src/components/output/codeBlockActions.ts`: `interface ApplyActions`（のちに `ApplyButtons.tsx` へ移動・改名。当初は `CodeBlockActions`）`{ insertDisabledReason; replaceDisabledReason; apply; reasonId: string }`、`CodeBlockActionsContext = createContext<CodeBlockActions | null>(null)`
  - `MarkdownRenderer` の props: `{ content: string; codeBlockActions?: CodeBlockActions }`。`OutputPanel` の props: 既存に `applyOutput?: ApplyOutputState` を足す
- UI 文言と ARIA（完全一致）:
  - コードブロック: ラッパー `div.code-block`（`pre` の外）、見出し `div.code-block__toolbar` に言語名 `span.code-block__language`（言語なしは `コード`）と `span.code-block__actions`。ボタン `挿入`（`aria-label="挿入（このコードブロックをカーソル位置へ）"`）・`置換`（`aria-label="置換（選択範囲をこのコードブロックで）"`）、class `code-block__button`。中身の無いブロックはボタンを出さない。`pre` は class `code-block__pre`
  - ヘッダー: `出力` の見出し、通知 `span.output-panel__notice`（`role="status"`。`applyOutput` があるときは常に置く）、右側 `span.output-panel__actions` に、無効の理由 `span.output-panel__apply-reason`（置換の理由があるときだけ。id は `useId`）、`挿入`（`aria-label="挿入（出力全体をカーソル位置へ）"`）・`置換`（`aria-label="置換（選択範囲を出力全体で）"`）、class `output-panel__apply-btn`、既存の `クリア` / `キャンセル`
  - 無効のボタン: `disabled`、`title` に理由、`aria-describedby` に理由の要素の id。有効なボタンには `title`・`aria-describedby` を付けない
  - 通知: `挿入しました`・`置換しました`・`反映できませんでした`。id が偶数のときは末尾にゼロ幅スペース。3 秒で消える
  - タップ領域: `挿入`・`置換` は 32px 以上（共通の枠付きボタンの規則に入れる）

## File Structure

実装の後の単一責任のリファクタ（2026-10-04）で、フック・ボタン・通知の文字列・テストの偽物を分けた。下の表はリファクタ後の構成。各タスクのコードは実装した時点のもので、`ApplyNotice` は `Announcement` に改名した。

| ファイル                                                           | 責務                                                                                        | 変更   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------ |
| `src/renderer/src/types.ts`                                        | `ApplyMode`・`Announcement`（旧 `ApplyNotice`）・`ApplyOutputState`                         | Modify |
| `src/renderer/src/lib/applyToEditor.ts`                            | 反映の手順（範囲・undo の区切り・編集・カーソル・フォーカス）                               | Create |
| `src/renderer/src/lib/codeBlockSource.ts`                          | hast の `pre` からコードの原文と言語名を取り出す                                            | Create |
| `src/renderer/src/hooks/useApplyOutputToEditor.ts`                 | 反映（無効の理由の規則は後に `lib/applyDisabledReason.ts` へ移動）。下の 2 つを組み合わせる | Create |
| `src/renderer/src/hooks/useTrackedEditorSelection.ts`              | 反映先のエディタと選択範囲の有無の追跡（購読・破棄・差し替え）                              | Create |
| `src/renderer/src/hooks/useTransientNotice.ts`                     | 一定時間で消える通知（id の採番・自動消去のタイマー）                                       | Create |
| `src/renderer/src/lib/announcementText.ts`                         | `role="status"` の文字列（読み上げ直しのゼロ幅スペース。`ConflictResolver` と共有）         | Create |
| `src/renderer/src/lib/applyDisabledReason.ts`                      | ヘッダーに表示する無効の理由の選択                                                          | Create |
| `src/renderer/src/components/output/codeBlockActions.ts`           | `CodeBlockActionsContext`（型 `ApplyActions` は後に ApplyButtons.tsx へ）                   | Create |
| `src/renderer/src/components/output/ApplyButtons.tsx`              | 挿入・置換のボタンの対（無効の示し方。ヘッダーとコードブロックで共有）                      | Create |
| `src/renderer/src/components/output/CodeBlock.tsx`                 | コードブロックの見出し（言語名・挿入・置換）                                                | Create |
| `src/renderer/src/components/output/MarkdownRenderer.tsx`          | `codeBlockActions` を受け取り `pre` を差し替える。既存の lint の指摘                        | Modify |
| `src/renderer/src/components/output/OutputPanel.tsx`               | ヘッダーの挿入・置換・無効の理由・通知                                                      | Modify |
| `src/renderer/src/components/EditorPanel.tsx`                      | フックを呼び、`onMount` で `attachEditor`、`OutputPanel` へ渡す                             | Modify |
| `src/renderer/src/assets/main.css`                                 | コードブロックの見出し・ヘッダーの並び・共通の枠付きボタンへの追加                          | Modify |
| `src/renderer/src/__tests__/__mocks__/@monaco-editor/react.tsx`    | 選択範囲・編集・破棄の通知を足す（テストの基盤。描画と受け渡しだけ）                        | Modify |
| `src/renderer/src/__tests__/__mocks__/createMockEditorInstance.ts` | モックの偽のエディタ（選択範囲・編集・破棄の購読）                                          | Create |
| `src/renderer/src/__tests__/__mocks__/fakeTextBuffer.ts`           | モックのテキストの編集（行列→位置・編集の適用・挿入した範囲）                               | Create |
| `src/renderer/src/__tests__/makeFakeApplyEditor.ts`                | 反映のテストが共有する選択範囲・偽のエディタ                                                | Create |
| `src/renderer/src/__tests__/makeApplyOutputState.ts`               | テスト用の型付きモック（`makeApplyActions` も（当初は `makeCodeBlockActions`））            | Create |
| テスト（新規 8 ファイル・92 件）                                   | 各タスクを参照                                                                              | Create |
| テスト（リファクタで新規 9 ファイル。全体で 6040 → 6115 件）       | 切り出した単位の直接のテスト・共有した偽物のテスト                                          | Create |
| `ROADMAP.md` / `docs/manual-test-spec.md`                          | 実装済みへの移動・見送り・既知の制約・整理 / 領域 `APL`（23 項目）                          | Modify |

---

### Task 1: `applyToEditor`（反映の手順）と `ApplyMode`

**Files:**

- Create: `src/renderer/src/lib/applyToEditor.ts`, `src/renderer/src/lib/__tests__/applyToEditor.test.ts`, `src/renderer/src/lib/__tests__/applyToEditor.monaco.test.ts`
- Modify: `src/renderer/src/types.ts`

**Interfaces:**

- Consumes: `IPosition`・`IRange`（`monaco-editor` の型だけ）
- Produces: `ApplyMode`（`types.ts`）、`APPLY_EDIT_SOURCE`・`ApplySelection`・`ApplyTargetEditor`・`ApplyResult`・`isEmptySelection`・`applyToEditor`（`lib/applyToEditor.ts`）
- 注: 実物の Monaco のテストは、jsdom に足りない `matchMedia` と canvas の 2D コンテキストを偽物で補う（差異 2）。`editor.api.js` を読むため、このファイルだけ 1.5 秒前後かかる

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/applyToEditor.test.ts`（新規。全文。偽のエディタで呼び出しと引数を固定する）:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { IRange } from 'monaco-editor'
import { APPLY_EDIT_SOURCE, applyToEditor, isEmptySelection } from '../applyToEditor'
import type { ApplySelection, ApplyTargetEditor } from '../applyToEditor'

// 偽のエディタ。呼び出しの順序を calls に記録する。executeEdits は、endCursorState に insertedRange を
// 逆向きの編集の範囲として渡す(Monaco と同じ形)。実物の Monaco での挙動は applyToEditor.monaco.test.ts
type FakeEditor = { [K in keyof ApplyTargetEditor]: Mock<ApplyTargetEditor[K]> }

function makeEditor(
  options: {
    selection?: ApplySelection | null
    model?: object | null
    executeResult?: boolean
    insertedRange?: IRange
  } = {}
): { editor: FakeEditor; calls: string[] } {
  const calls: string[] = []
  const insertedRange: IRange = options.insertedRange ?? {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 2,
    endColumn: 4
  }
  const editor = {
    getModel: vi.fn<ApplyTargetEditor['getModel']>(() =>
      options.model === undefined ? {} : options.model
    ),
    getSelection: vi.fn<ApplyTargetEditor['getSelection']>(() =>
      options.selection === undefined ? selectionOf(1, 1, 1, 1, 1, 1) : options.selection
    ),
    pushUndoStop: vi.fn<ApplyTargetEditor['pushUndoStop']>(() => {
      calls.push('pushUndoStop')
      return true
    }),
    executeEdits: vi.fn<ApplyTargetEditor['executeEdits']>((_source, _edits, endCursorState) => {
      calls.push('executeEdits')
      if (options.executeResult === false) return false
      endCursorState?.([{ range: insertedRange }])
      return true
    }),
    setSelection: vi.fn<ApplyTargetEditor['setSelection']>(() => {
      calls.push('setSelection')
    }),
    focus: vi.fn<ApplyTargetEditor['focus']>(() => {
      calls.push('focus')
    })
  }
  return { editor, calls }
}

// [選択の開始の行, 列, 終わりの行, 列, カーソルの行, 列]
function selectionOf(
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
  positionLineNumber: number,
  positionColumn: number
): ApplySelection {
  return {
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
    positionLineNumber,
    positionColumn
  }
}

const collapsed = (lineNumber: number, column: number): IRange => ({
  startLineNumber: lineNumber,
  startColumn: column,
  endLineNumber: lineNumber,
  endColumn: column
})

describe('applyToEditor', () => {
  it('挿入はカーソルの位置に空の範囲で、forceMoveMarkers を付けて編集する', () => {
    const { editor } = makeEditor({ selection: selectionOf(2, 3, 2, 3, 2, 3) })

    expect(applyToEditor(editor, 'insert', 'XY')).toBe('applied')

    expect(editor.executeEdits).toHaveBeenCalledWith(
      APPLY_EDIT_SOURCE,
      [{ range: collapsed(2, 3), text: 'XY', forceMoveMarkers: true }],
      expect.any(Function)
    )
  })

  it('選択範囲があるときの挿入は、選択の開始ではなくカーソルの位置に入れる(選択された文字列は残す)', () => {
    // 前向きの選択(1,2)-(1,5)。カーソルは選択の終わり(1,5)
    const { editor } = makeEditor({ selection: selectionOf(1, 2, 1, 5, 1, 5) })

    applyToEditor(editor, 'insert', 'XY')

    expect(editor.executeEdits.mock.calls[0][1]).toEqual([
      { range: collapsed(1, 5), text: 'XY', forceMoveMarkers: true }
    ])
  })

  it('置換は選択範囲を編集する(後ろ向きの選択でも範囲は開始から終わり)', () => {
    const { editor } = makeEditor({ selection: selectionOf(1, 2, 3, 4, 1, 2) })

    expect(applyToEditor(editor, 'replace', 'Z')).toBe('applied')

    expect(editor.executeEdits.mock.calls[0][1]).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 2, endLineNumber: 3, endColumn: 4 },
        text: 'Z',
        forceMoveMarkers: true
      }
    ])
  })

  it('置換で選択が空なら何もしない', () => {
    const { editor, calls } = makeEditor({ selection: selectionOf(1, 2, 1, 2, 1, 2) })

    expect(applyToEditor(editor, 'replace', 'Z')).toBe('unavailable')

    expect(calls).toEqual([])
  })

  it('pushUndoStop → executeEdits → setSelection → pushUndoStop → focus の順に呼ぶ(1 回の undo で戻る 1 つの編集)', () => {
    const { editor, calls } = makeEditor()

    applyToEditor(editor, 'insert', 'XY')

    expect(calls).toEqual(['pushUndoStop', 'executeEdits', 'setSelection', 'pushUndoStop', 'focus'])
  })

  it('カーソルを挿入したテキストの末尾(逆向きの編集の範囲の末尾)に置き、選択を解除する', () => {
    const { editor } = makeEditor({
      insertedRange: { startLineNumber: 3, startColumn: 5, endLineNumber: 4, endColumn: 7 }
    })

    applyToEditor(editor, 'insert', 'XY\nZ')

    expect(editor.setSelection).toHaveBeenCalledWith(collapsed(4, 7))
  })

  it('モデルが無い(破棄済みのインスタンス)なら何もしない', () => {
    const { editor, calls } = makeEditor({ model: null })

    expect(applyToEditor(editor, 'insert', 'XY')).toBe('unavailable')

    expect(calls).toEqual([])
  })

  it('選択範囲が取れないなら何もしない', () => {
    const { editor, calls } = makeEditor({ selection: null })

    expect(applyToEditor(editor, 'insert', 'XY')).toBe('unavailable')

    expect(calls).toEqual([])
  })

  it('executeEdits が false(読み取り専用など)なら rejected で、カーソルもフォーカスも動かさない', () => {
    const { editor, calls } = makeEditor({ executeResult: false })

    expect(applyToEditor(editor, 'insert', 'XY')).toBe('rejected')

    expect(calls).toEqual(['pushUndoStop', 'executeEdits'])
  })
})

describe('isEmptySelection', () => {
  it('開始と終わりが同じなら空', () => {
    expect(isEmptySelection(collapsed(2, 3))).toBe(true)
  })

  it.each([
    [{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }],
    [{ startLineNumber: 1, startColumn: 3, endLineNumber: 2, endColumn: 3 }]
  ])('列か行が違えば空でない(%j)', (range) => {
    expect(isEmptySelection(range)).toBe(false)
  })
})
```

`src/renderer/src/lib/__tests__/applyToEditor.monaco.test.ts`（新規。全文。実物の Monaco で undo・改行コード・カーソルを固定する）:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
// 実物の Monaco(@monaco-editor/react ではなく monaco-editor 本体)。editor.main は全言語と worker を読み込むため、
// 言語を含まない editor.api を使う
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { applyToEditor } from '../applyToEditor'

// jsdom で Monaco のエディタを作るのに足りないもの(プラン作成時に実測): matchMedia(テーマの判定)と
// canvas の 2D コンテキスト(文字幅の計測・概観ルーラーの描画)。描画の結果は検査しないため、何もしない偽物で足りる
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      new Proxy(
        {},
        {
          get: (_target, key) =>
            key === 'measureText' ? (text: string) => ({ width: text.length * 8 }) : () => {}
        }
      ) as unknown as CanvasRenderingContext2D
  )
})

afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const created: { editor: monaco.editor.IStandaloneCodeEditor; model: monaco.editor.ITextModel }[] =
  []

afterEach(() => {
  for (const { editor, model } of created.splice(0)) {
    editor.dispose()
    model.dispose()
  }
  document.body.innerHTML = ''
})

function createEditor(
  text: string,
  options: monaco.editor.IStandaloneEditorConstructionOptions = {}
): { editor: monaco.editor.IStandaloneCodeEditor; model: monaco.editor.ITextModel } {
  const model = monaco.editor.createModel(text, 'plaintext')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const editor = monaco.editor.create(container, { model, automaticLayout: false, ...options })
  created.push({ editor, model })
  return { editor, model }
}

const undo = (editor: monaco.editor.IStandaloneCodeEditor): void =>
  editor.trigger('test', 'undo', null)
const type = (editor: monaco.editor.IStandaloneCodeEditor, text: string): void =>
  editor.trigger('keyboard', 'type', { text })

describe('applyToEditor(実物の Monaco)', () => {
  it('カーソル位置に挿入し、カーソルを挿入したテキストの末尾に置く', () => {
    const { editor, model } = createEditor('abc\ndef')
    editor.setSelection(new monaco.Selection(1, 2, 1, 2))

    expect(applyToEditor(editor, 'insert', 'XY\nZ')).toBe('applied')

    expect(model.getValue()).toBe('aXY\nZbc\ndef')
    expect(editor.getSelection()?.toString()).toBe(new monaco.Selection(2, 2, 2, 2).toString())
  })

  it('選択範囲があるときの挿入は、カーソルの位置に入れて選択された文字列を残し、選択を解除する', () => {
    const { editor, model } = createEditor('abcdef')
    // 前向きの選択 b〜d(カーソルは d の後ろ)
    editor.setSelection(new monaco.Selection(1, 2, 1, 5))

    applyToEditor(editor, 'insert', 'XY')

    expect(model.getValue()).toBe('abcdXYef')
    expect(editor.getSelection()?.isEmpty()).toBe(true)
    expect(editor.getPosition()?.toString()).toBe('(1,7)')
  })

  it('選択範囲を置換する(後ろ向きの選択でも)', () => {
    const { editor, model } = createEditor('hello world')
    editor.setSelection(new monaco.Selection(1, 6, 1, 1))

    expect(applyToEditor(editor, 'replace', 'HI')).toBe('applied')

    expect(model.getValue()).toBe('HI world')
    expect(editor.getPosition()?.toString()).toBe('(1,3)')
  })

  it('1 回の undo で反映の前に戻り、選択範囲も戻る', () => {
    const { editor, model } = createEditor('hello world')
    editor.setSelection(new monaco.Selection(1, 1, 1, 6))

    applyToEditor(editor, 'replace', 'HI\nTHERE')
    undo(editor)

    expect(model.getValue()).toBe('hello world')
    expect(editor.getSelection()?.toString()).toBe(new monaco.Selection(1, 1, 1, 6).toString())
  })

  it('直前の入力とは別の undo になる(前の pushUndoStop が無いと入力とまとめて戻る)', () => {
    const { editor, model } = createEditor('abc')
    editor.setSelection(new monaco.Selection(1, 4, 1, 4))
    type(editor, 'q')

    applyToEditor(editor, 'insert', 'ZZ')
    undo(editor)

    expect(model.getValue()).toBe('abcq')
  })

  it('2 回の反映は 2 回の undo で 1 つずつ戻る', () => {
    const { editor, model } = createEditor('')

    applyToEditor(editor, 'insert', 'A')
    applyToEditor(editor, 'insert', 'B')
    expect(model.getValue()).toBe('AB')
    undo(editor)
    expect(model.getValue()).toBe('A')
    undo(editor)
    expect(model.getValue()).toBe('')
  })

  it('モデルの改行コードが CRLF なら、\\n のテキストも CRLF で入る', () => {
    const { editor, model } = createEditor('a\r\nb')
    editor.setSelection(new monaco.Selection(1, 2, 1, 2))

    applyToEditor(editor, 'insert', 'X\nY')

    expect(model.getValue()).toBe('aX\r\nY\r\nb')
    expect(editor.getPosition()?.toString()).toBe('(2,2)')
  })

  it('複数カーソルのときは主カーソルの選択範囲だけを置換する', () => {
    const { editor, model } = createEditor('aaa\nbbb\nccc')
    // 先頭の選択が主カーソル
    editor.setSelections([new monaco.Selection(2, 1, 2, 2), new monaco.Selection(1, 1, 1, 3)])

    applyToEditor(editor, 'replace', 'X')

    expect(model.getValue()).toBe('aaa\nXbb\nccc')
  })

  it('反映の後はエディタにフォーカスがある', () => {
    const { editor } = createEditor('abc')

    applyToEditor(editor, 'insert', 'X')

    expect(editor.hasTextFocus()).toBe(true)
  })

  it('読み取り専用のエディタは rejected で、内容を変えない', () => {
    const { editor, model } = createEditor('abc', { readOnly: true })

    expect(applyToEditor(editor, 'insert', 'X')).toBe('rejected')

    expect(model.getValue()).toBe('abc')
  })

  it('破棄済みのエディタは unavailable で、何もしない', () => {
    const { editor, model } = createEditor('abc')
    editor.dispose()

    expect(applyToEditor(editor, 'insert', 'X')).toBe('unavailable')

    expect(model.getValue()).toBe('abc')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/applyToEditor.test.ts src/renderer/src/lib/__tests__/applyToEditor.monaco.test.ts
```

Expected: FAIL（2 ファイルとも `Failed to resolve import "../applyToEditor"`）

- [ ] **Step 3: 実装する**

`src/renderer/src/types.ts` の末尾に、空行を 1 行置いて追加:

```ts
// AI の出力のエディタへの反映(useApplyOutputToEditor)。挿入はカーソルの位置へ、置換は選択範囲を置き換える
export type ApplyMode = 'insert' | 'replace'
```

`src/renderer/src/lib/applyToEditor.ts`（新規。全文）:

```ts
import type { IPosition, IRange } from 'monaco-editor'
import type { ApplyMode } from '../types'

// executeEdits の第 1 引数(編集の出どころ)。Monaco はこの値を undo の履歴・イベントの source に残すだけで、
// 挙動は変えない
export const APPLY_EDIT_SOURCE = 'apply-output'

/** Monaco の Selection のうち、反映に使う部分(範囲とカーソルの位置) */
export type ApplySelection = IRange & { positionLineNumber: number; positionColumn: number }

/**
 * 反映先のエディタの最小のインターフェース。Monaco の IStandaloneCodeEditor はこの形を満たす
 * (テストは偽のエディタと実物の Monaco の両方で確かめる)
 */
export interface ApplyTargetEditor {
  getModel(): object | null
  getSelection(): ApplySelection | null
  pushUndoStop(): unknown
  executeEdits(
    source: string,
    edits: { range: IRange; text: string; forceMoveMarkers?: boolean }[],
    endCursorState?: (inverseEditOperations: { range: IRange }[]) => null
  ): boolean
  setSelection(selection: IRange): void
  focus(): void
}

/**
 * 反映の結果。
 * - applied: 反映した
 * - unavailable: 反映先が無い(モデルが破棄済み・選択範囲が無い・置換で選択が空)。何もしていない
 * - rejected: Monaco が編集を拒否した(読み取り専用など。executeEdits が false)。何も変わっていない
 */
export type ApplyResult = 'applied' | 'unavailable' | 'rejected'

export const isEmptySelection = (selection: IRange): boolean =>
  selection.startLineNumber === selection.endLineNumber &&
  selection.startColumn === selection.endColumn

/**
 * AI の出力をエディタへ反映する。挿入はカーソルの位置(選択範囲があっても、その位置に挿入し、選択された
 * 文字列は残す)、置換は主カーソルの選択範囲(空なら何もしない)。前後に pushUndoStop を置き、1 回の undo で
 * 戻せる 1 つの編集にする。改行コードは Monaco がモデルの改行コードへ変換する。反映後はカーソルを挿入した
 * テキストの末尾に置き(選択は解除)、エディタへフォーカスを戻す
 */
export function applyToEditor(
  editor: ApplyTargetEditor,
  mode: ApplyMode,
  text: string
): ApplyResult {
  // 破棄済みのインスタンス(遅れて届いた呼び出し)は何もしない
  if (editor.getModel() === null) return 'unavailable'
  const selection = editor.getSelection()
  if (selection === null) return 'unavailable'
  if (mode === 'replace' && isEmptySelection(selection)) return 'unavailable'
  const range: IRange =
    mode === 'insert'
      ? {
          startLineNumber: selection.positionLineNumber,
          startColumn: selection.positionColumn,
          endLineNumber: selection.positionLineNumber,
          endColumn: selection.positionColumn
        }
      : {
          startLineNumber: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLineNumber: selection.endLineNumber,
          endColumn: selection.endColumn
        }
  // 挿入したテキストの範囲(改行コードの変換後)は、逆向きの編集の範囲として Monaco から受け取る。
  // カーソルは null を返して Monaco に任せ、編集の後で末尾へ置く(コールバックの中の代入を型の絞り込みが
  // 追跡しないよう、入れ物のオブジェクトに書く)
  const inserted: { end: IPosition | null } = { end: null }
  editor.pushUndoStop()
  const applied = editor.executeEdits(
    APPLY_EDIT_SOURCE,
    [{ range, text, forceMoveMarkers: true }],
    (inverseEditOperations) => {
      const insertedRange = inverseEditOperations[0]?.range
      if (insertedRange !== undefined) {
        inserted.end = { lineNumber: insertedRange.endLineNumber, column: insertedRange.endColumn }
      }
      return null
    }
  )
  if (!applied) return 'rejected'
  if (inserted.end !== null) {
    const { lineNumber, column } = inserted.end
    editor.setSelection({
      startLineNumber: lineNumber,
      startColumn: column,
      endLineNumber: lineNumber,
      endColumn: column
    })
  }
  editor.pushUndoStop()
  editor.focus()
  return 'applied'
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/applyToEditor.test.ts src/renderer/src/lib/__tests__/applyToEditor.monaco.test.ts
npm run typecheck
npx eslint src/renderer/src/lib/applyToEditor.ts src/renderer/src/lib/__tests__/applyToEditor.test.ts src/renderer/src/lib/__tests__/applyToEditor.monaco.test.ts src/renderer/src/types.ts
npx prettier --check src/renderer/src/lib/applyToEditor.ts src/renderer/src/lib/__tests__/applyToEditor.test.ts src/renderer/src/lib/__tests__/applyToEditor.monaco.test.ts src/renderer/src/types.ts
```

Expected: PASS（2 ファイル・23 件）。typecheck・eslint・prettier が通る。`Unhandled Errors` が出ない

- [ ] **Step 5: 変異で検知力を確かめる**

対象は `src/renderer/src/lib/applyToEditor.ts`。1 つずつ入れて、表のテストのファイル全体と `-t` 単独の両方で落ちることを確かめ、復元して `cmp` する（Global Constraints の手順）。

| #   | 変異                                                                                    | テストのファイル            | `-t`                               |
| --- | --------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------- |
| A1  | 先頭の `editor.pushUndoStop()`（`const applied` の直前）を消す                          | `applyToEditor.monaco.test` | `直前の入力とは別の undo`          |
| A1b | 先頭の `editor.pushUndoStop()`（`const applied` の直前）を消す                          | `applyToEditor.test`        | `の順に呼ぶ`                       |
| A2  | 挿入の範囲を `selection.startLineNumber`・`selection.startColumn` から作る              | `applyToEditor.monaco.test` | `選択範囲があるときの挿入`         |
| A2b | 挿入の範囲を `selection.startLineNumber`・`selection.startColumn` から作る              | `applyToEditor.test`        | `選択範囲があるときの挿入`         |
| A3  | `if (inserted.end !== null) {` を `if (inserted.end !== null && false) {` にする        | `applyToEditor.monaco.test` | `選択範囲があるときの挿入`         |
| A3b | `if (inserted.end !== null) {` を `if (inserted.end !== null && false) {` にする        | `applyToEditor.test`        | `カーソルを挿入したテキストの末尾` |
| A4  | `if (mode === 'replace' && isEmptySelection(selection)) return 'unavailable'` を消す    | `applyToEditor.test`        | `置換で選択が空なら`               |
| A5  | `if (editor.getModel() === null) return 'unavailable'` を消す                           | `applyToEditor.test`        | `モデルが無い`                     |
| A6  | `if (!applied) return 'rejected'` を消す                                                | `applyToEditor.test`        | `executeEdits が false`            |
| A6b | `if (!applied) return 'rejected'` を消す                                                | `applyToEditor.monaco.test` | `読み取り専用`                     |
| A7  | `editor.focus()` を消す                                                                 | `applyToEditor.monaco.test` | `フォーカスがある`                 |
| A8  | `[{ range, text, forceMoveMarkers: true }]` を `[{ range, text }]` にする               | `applyToEditor.test`        | `挿入はカーソルの位置に空の範囲`   |
| A9  | `mode === 'insert'` を `mode === 'insert' \|\| true` にする（置換も挿入の範囲）         | `applyToEditor.monaco.test` | `選択範囲を置換する`               |
| A10 | `isEmptySelection` の `selection.startLineNumber === selection.endLineNumber &&` を消す | `applyToEditor.test`        | `列か行が違えば空でない`           |

例（A5）:

```bash
BK="$(mktemp -d)"; F=src/renderer/src/lib/applyToEditor.ts; cp "$F" "$BK/"
python3 -c "import sys;p=sys.argv[1];s=open(p).read();o=\"  if (editor.getModel() === null) return 'unavailable'\n\";assert o in s;open(p,'w').write(s.replace(o,'',1))" "$F"
npx vitest run src/renderer/src/lib/__tests__/applyToEditor.test.ts
npx vitest run src/renderer/src/lib/__tests__/applyToEditor.test.ts -t 'モデルが無い'
cp "$BK/applyToEditor.ts" "$F"; cmp "$F" "$BK/applyToEditor.ts" && echo restored
```

Expected: 各変異で 2 つの実行がどちらも FAIL。復元後に `restored`

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は行わない）**

---

### Task 2: `getCodeBlockSource`（コードブロックの原文と言語名）

**Files:**

- Create: `src/renderer/src/lib/codeBlockSource.ts`, `src/renderer/src/lib/__tests__/codeBlockSource.test.tsx`

**Interfaces:**

- Consumes: `ExtraProps`（`react-markdown` の型だけ）
- Produces: `CodeBlockSource`・`getCodeBlockSource`（`lib/codeBlockSource.ts`）
- 注: テストは手で組み立てた木ではなく、実際の react-markdown（`remarkGfm`・`remarkBreaks`。`MarkdownRenderer` と同じ）で描画して `pre` に渡る `node` を使う（差異 14・確認の結果 3）。子が分かれた場合と code の無い `pre` だけは、手で組み立てる

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/codeBlockSource.test.tsx`（新規。全文）:

`````tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { getCodeBlockSource } from '../codeBlockSource'
import type { CodeBlockSource } from '../codeBlockSource'

// MarkdownRenderer と同じプラグインで実際に描画し、pre に渡る hast の要素から取り出す(hast の形は
// react-markdown 10.1.0 / mdast-util-to-hast の実際の出力に依存するため、手で組み立てた木では確かめない)
function extract(markdown: string): (CodeBlockSource | null)[] {
  const sources: (CodeBlockSource | null)[] = []
  render(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        pre: ({ node, children }) => {
          sources.push(getCodeBlockSource(node))
          return <pre>{children}</pre>
        }
      }}
    >
      {markdown}
    </ReactMarkdown>
  )
  return sources
}

describe('getCodeBlockSource', () => {
  it.each<[string, string, CodeBlockSource]>([
    [
      '言語付き',
      '```ts\nconst a = 1\nconst b = 2\n```',
      { code: 'const a = 1\nconst b = 2', language: 'ts' }
    ],
    ['言語なし', '```\nplain\n```', { code: 'plain', language: null }],
    ['情報文字列は先頭の語だけが言語', '```ts title="x.ts"\nx\n```', { code: 'x', language: 'ts' }],
    ['チルダのフェンス', '~~~py\nprint(1)\n~~~', { code: 'print(1)', language: 'py' }],
    ['空のコードブロック', '```js\n```', { code: '', language: 'js' }],
    [
      '末尾の空行は残す(足された改行を 1 つだけ除く)',
      '```js\na\n\n\n```',
      { code: 'a\n\n', language: 'js' }
    ],
    [
      'インデントのコードブロック',
      'para\n\n    indented\n    line2\n',
      { code: 'indented\nline2', language: null }
    ],
    [
      '引用の中(> を除く)',
      '> ```ts\n> quoted\n>   indented\n> ```',
      { code: 'quoted\n  indented', language: 'ts' }
    ],
    [
      'リストの中(リストのインデントを除く)',
      '- item\n\n  ```ts\n  in list\n    deeper\n  ```',
      { code: 'in list\n  deeper', language: 'ts' }
    ],
    [
      '長いフェンスの中のフェンス',
      '````md\n```ts\ninner\n```\n````',
      { code: '```ts\ninner\n```', language: 'md' }
    ],
    [
      '閉じていないフェンスは末尾まで',
      '```ts\nno close\nmore',
      { code: 'no close\nmore', language: 'ts' }
    ],
    [
      'タブと HTML の文字はそのまま',
      '```html\n\t<div>&amp;</div>\n```',
      { code: '\t<div>&amp;</div>', language: 'html' }
    ],
    ['言語名の大文字・記号はそのまま', '```c++\nx\n```', { code: 'x', language: 'c++' }],
    ['remark-breaks は改行を変えない', '```txt\na\nb\n```', { code: 'a\nb', language: 'txt' }]
  ])('%s', (_name, markdown, expected) => {
    expect(extract(markdown)).toEqual([expected])
  })

  it('インラインコードは pre にならない', () => {
    expect(extract('use `foo()` here')).toEqual([])
  })

  it('複数のコードブロックは出現順', () => {
    expect(extract('```a\n1\n```\n\ntext\n\n```b\n2\n```')).toEqual([
      { code: '1', language: 'a' },
      { code: '2', language: 'b' }
    ])
  })

  it('要素が無い・code の子を持たない pre は null', () => {
    expect(getCodeBlockSource(undefined)).toBeNull()
    expect(
      getCodeBlockSource({ type: 'element', tagName: 'pre', properties: {}, children: [] })
    ).toBeNull()
  })

  it('code の子が分かれていても(将来のハイライト等)、テキストをつなげて取り出す', () => {
    expect(
      getCodeBlockSource({
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            // language- で始まらない class(ハイライトの class 等)は言語名にしない
            properties: { className: ['code-highlight', 'language-js'] },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: {},
                children: [{ type: 'text', value: 'const' }]
              },
              { type: 'text', value: ' a\n' }
            ]
          }
        ]
      })
    ).toEqual({ code: 'const a', language: 'js' })
  })
})
`````

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/codeBlockSource.test.tsx
```

Expected: FAIL（`Failed to resolve import "../codeBlockSource"`）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/codeBlockSource.ts`（新規。全文）:

````ts
import type { ExtraProps } from 'react-markdown'

// hast(react-markdown が components に渡す構文木)の型。hast は react-markdown の依存で、このアプリの直接の
// 依存ではないため、react-markdown の公開の型から取り出す
type Element = NonNullable<ExtraProps['node']>
type ElementContent = Element['children'][number]

export interface CodeBlockSource {
  /** コードの原文(フェンスと言語名を除き、末尾の改行を 1 つだけ除いたもの) */
  code: string
  /** フェンスの言語名(```ts の ts)。無ければ null */
  language: string | null
}

const LANGUAGE_CLASS_PREFIX = 'language-'

const collectText = (nodes: ElementContent[]): string =>
  nodes
    .map((node) =>
      node.type === 'text' ? node.value : node.type === 'element' ? collectText(node.children) : ''
    )
    .join('')

const findLanguage = (code: Element): string | null => {
  const className = code.properties.className
  if (!Array.isArray(className)) return null
  for (const name of className) {
    if (typeof name === 'string' && name.startsWith(LANGUAGE_CLASS_PREFIX)) {
      const language = name.slice(LANGUAGE_CLASS_PREFIX.length)
      if (language !== '') return language
    }
  }
  return null
}

/**
 * react-markdown が pre に渡す hast の要素から、コードブロックの原文と言語名を取り出す。表示用の React の
 * children ではなく hast のテキストを使い、表示の加工(将来のハイライト等)の影響を受けない。
 * mdast-util-to-hast はコードが空でなければ末尾に改行を 1 つ足すため、それを 1 つだけ除く
 * (コードの中の末尾の空行は残す)。code の子を持たない pre(このアプリでは生の HTML を描画しないため
 * 実際には来ない)は null
 */
export function getCodeBlockSource(pre: Element | undefined): CodeBlockSource | null {
  if (pre === undefined) return null
  const code = pre.children.find(
    (child): child is Element => child.type === 'element' && child.tagName === 'code'
  )
  if (code === undefined) return null
  const text = collectText(code.children)
  return {
    code: text.endsWith('\n') ? text.slice(0, -1) : text,
    language: findLanguage(code)
  }
}
````

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run src/renderer/src/lib/__tests__/codeBlockSource.test.tsx
npm run typecheck
npx eslint src/renderer/src/lib/codeBlockSource.ts src/renderer/src/lib/__tests__/codeBlockSource.test.tsx
npx prettier --check src/renderer/src/lib/codeBlockSource.ts src/renderer/src/lib/__tests__/codeBlockSource.test.tsx
```

Expected: PASS（18 件）。typecheck・eslint・prettier が通る

- [ ] **Step 5: 変異で検知力を確かめる**

対象は `src/renderer/src/lib/codeBlockSource.ts`、テストは `codeBlockSource.test.tsx`。

| #   | 変異                                                                                          | `-t`                        |
| --- | --------------------------------------------------------------------------------------------- | --------------------------- |
| C1  | `code: text.endsWith('\n') ? text.slice(0, -1) : text,` を `code: text,` にする               | `言語付き`                  |
| C2  | 同じ行を `code: text.replace(/\n+$/, ''),` にする（末尾の改行をすべて除く）                   | `末尾の空行は残す`          |
| C3  | `const language = name.slice(LANGUAGE_CLASS_PREFIX.length)` を `const language = name` にする | `言語付き`                  |
| C4  | `node.type === 'element' ? collectText(node.children) : ''` を `''` にする                    | `code の子が分かれていても` |
| C5  | `name.startsWith(LANGUAGE_CLASS_PREFIX)` の条件を外す（`if (typeof name === 'string') {`）    | `code の子が分かれていても` |

Expected: 各変異でファイル全体と `-t` 単独の両方が FAIL。復元後に `cmp` が一致

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は行わない）**

---

### Task 3: `useApplyOutputToEditor`（反映先・無効の理由・反映・通知）と型

**Files:**

- Create: `src/renderer/src/hooks/useApplyOutputToEditor.ts`, `src/renderer/src/hooks/__tests__/useApplyOutputToEditor.test.ts`
- Modify: `src/renderer/src/types.ts`

**Interfaces:**

- Consumes: `applyToEditor`・`isEmptySelection`・`ApplySelection`・`ApplyTargetEditor`（Task 1）、`ApplyMode`（Task 1）
- Produces: `ApplyNotice`・`ApplyOutputState`（`types.ts`）、`APPLY_NOTICE_DURATION_MS`・`APPLY_DISABLED_REASONS`・`APPLY_NOTICES`・`TrackedEditor`・`UseApplyOutputToEditorOptions`・`ApplyOutputToEditor`・`useApplyOutputToEditor`
- 注: 購読は effect ではなく `attachEditor` の中で張り、前のエディタの購読を先に外す（差異 7）。通知のタイマーは effect の後始末で解除する。偽のタイマーは `afterEach` で戻す

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useApplyOutputToEditor.test.ts`（新規。全文）:

```ts
import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import {
  APPLY_DISABLED_REASONS,
  APPLY_NOTICE_DURATION_MS,
  APPLY_NOTICES,
  useApplyOutputToEditor
} from '../useApplyOutputToEditor'
import type { ApplyOutputToEditor, TrackedEditor } from '../useApplyOutputToEditor'
import type { ApplySelection } from '../../lib/applyToEditor'

const collapsed: ApplySelection = {
  startLineNumber: 1,
  startColumn: 1,
  endLineNumber: 1,
  endColumn: 1,
  positionLineNumber: 1,
  positionColumn: 1
}
const nonEmpty: ApplySelection = { ...collapsed, endColumn: 4, positionColumn: 4 }

// 偽のエディタ。選択の変更・破棄の通知をテストから起こせる。購読の数(listenerCount)で解除を確かめる
type FakeEditor = { [K in keyof TrackedEditor]: Mock<TrackedEditor[K]> }

interface FakeEditorHandle {
  editor: FakeEditor
  /** 利用者がエディタで範囲を選んだ代わり */
  select: (next: ApplySelection) => void
  /** エディタの破棄(ファイルの切り替え・diff タブ・ファイルを閉じる)の代わり */
  dispose: () => void
  /** 購読の数(解除を確かめる) */
  listenerCount: () => number
}

function makeEditor(
  options: { selection?: ApplySelection; model?: object | null } = {}
): FakeEditorHandle {
  let selection = options.selection ?? collapsed
  let model = options.model === undefined ? {} : options.model
  const selectionListeners = new Set<(event: { selection: ApplySelection }) => void>()
  const disposeListeners = new Set<() => void>()
  const editor = {
    getModel: vi.fn<TrackedEditor['getModel']>(() => model),
    getSelection: vi.fn<TrackedEditor['getSelection']>(() => selection),
    pushUndoStop: vi.fn<TrackedEditor['pushUndoStop']>(),
    executeEdits: vi.fn<TrackedEditor['executeEdits']>(() => true),
    setSelection: vi.fn<TrackedEditor['setSelection']>(),
    focus: vi.fn<TrackedEditor['focus']>(),
    onDidChangeCursorSelection: vi.fn<TrackedEditor['onDidChangeCursorSelection']>((listener) => {
      selectionListeners.add(listener)
      return { dispose: () => selectionListeners.delete(listener) }
    }),
    onDidDispose: vi.fn<TrackedEditor['onDidDispose']>((listener) => {
      disposeListeners.add(listener)
      return { dispose: () => disposeListeners.delete(listener) }
    })
  }
  return {
    editor,
    select(next: ApplySelection) {
      selection = next
      for (const listener of selectionListeners) listener({ selection: next })
    },
    dispose() {
      model = null
      for (const listener of [...disposeListeners]) listener()
    },
    listenerCount: () => selectionListeners.size + disposeListeners.size
  }
}

function renderApply(
  isExecuting = false
): RenderHookResult<ApplyOutputToEditor, { isExecuting: boolean }> {
  return renderHook((props: { isExecuting: boolean }) => useApplyOutputToEditor(props), {
    initialProps: { isExecuting }
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useApplyOutputToEditor — 有効になる条件', () => {
  it('エディタがマウントされるまでは挿入も置換もできない(理由はエディタが無いこと)', () => {
    const { result } = renderApply()

    expect(result.current.applyOutput.insertDisabledReason).toBe(APPLY_DISABLED_REASONS.noEditor)
    expect(result.current.applyOutput.replaceDisabledReason).toBe(APPLY_DISABLED_REASONS.noEditor)
  })

  it('マウントされれば挿入できる。選択が空なら置換はできない', () => {
    const { result } = renderApply()
    const { editor } = makeEditor()

    act(() => result.current.attachEditor(editor))

    expect(result.current.applyOutput.insertDisabledReason).toBeNull()
    expect(result.current.applyOutput.replaceDisabledReason).toBe(
      APPLY_DISABLED_REASONS.noSelection
    )
  })

  it('マウントの時点で選択範囲があれば置換できる', () => {
    const { result } = renderApply()
    const { editor } = makeEditor({ selection: nonEmpty })

    act(() => result.current.attachEditor(editor))

    expect(result.current.applyOutput.replaceDisabledReason).toBeNull()
  })

  it('選択範囲の変化に追従する', () => {
    const { result } = renderApply()
    const fake = makeEditor()
    act(() => result.current.attachEditor(fake.editor))

    act(() => fake.select(nonEmpty))
    expect(result.current.applyOutput.replaceDisabledReason).toBeNull()

    act(() => fake.select(collapsed))
    expect(result.current.applyOutput.replaceDisabledReason).toBe(
      APPLY_DISABLED_REASONS.noSelection
    )
  })

  it('実行中は、選択範囲があっても挿入も置換もできない(理由は実行中)', () => {
    const { result } = renderApply(true)
    act(() => result.current.attachEditor(makeEditor({ selection: nonEmpty }).editor))

    expect(result.current.applyOutput.insertDisabledReason).toBe(APPLY_DISABLED_REASONS.executing)
    expect(result.current.applyOutput.replaceDisabledReason).toBe(APPLY_DISABLED_REASONS.executing)
  })

  it('エディタが無いときの理由は、実行中より優先する', () => {
    const { result } = renderApply(true)

    expect(result.current.applyOutput.insertDisabledReason).toBe(APPLY_DISABLED_REASONS.noEditor)
  })

  it('破棄済みのインスタンス(遅れて届いたマウントの通知)は追わない', () => {
    const { result } = renderApply()
    const fake = makeEditor({ model: null, selection: nonEmpty })

    act(() => result.current.attachEditor(fake.editor))

    expect(result.current.applyOutput.insertDisabledReason).toBe(APPLY_DISABLED_REASONS.noEditor)
    expect(fake.listenerCount()).toBe(0)
  })
})

describe('useApplyOutputToEditor — エディタの差し替え', () => {
  it('エディタが破棄されると反映先から外れ、購読を解除する', () => {
    const { result } = renderApply()
    const fake = makeEditor({ selection: nonEmpty })
    act(() => result.current.attachEditor(fake.editor))

    act(() => fake.dispose())

    expect(result.current.applyOutput.insertDisabledReason).toBe(APPLY_DISABLED_REASONS.noEditor)
    expect(fake.listenerCount()).toBe(0)
  })

  it('次のエディタがマウントされたら、前のエディタの購読を解除し、前の破棄の通知で外れない', () => {
    const { result } = renderApply()
    const first = makeEditor({ selection: nonEmpty })
    const second = makeEditor()
    act(() => result.current.attachEditor(first.editor))

    act(() => result.current.attachEditor(second.editor))
    expect(first.listenerCount()).toBe(0)
    // 前のエディタの選択の変化・破棄は、新しい反映先の状態を変えない
    act(() => first.select(collapsed))
    act(() => first.dispose())

    expect(result.current.applyOutput.insertDisabledReason).toBeNull()
    expect(result.current.applyOutput.replaceDisabledReason).toBe(
      APPLY_DISABLED_REASONS.noSelection
    )
  })

  it('反映は最新のエディタへ行う', () => {
    const { result } = renderApply()
    const first = makeEditor()
    const second = makeEditor()
    act(() => result.current.attachEditor(first.editor))
    act(() => result.current.attachEditor(second.editor))

    act(() => result.current.applyOutput.apply('insert', 'X'))

    expect(first.editor.executeEdits).not.toHaveBeenCalled()
    expect(second.editor.executeEdits).toHaveBeenCalledOnce()
  })
})

describe('useApplyOutputToEditor — 反映と通知', () => {
  it('挿入すると編集し、「挿入しました」を通知する', () => {
    const { result } = renderApply()
    const { editor } = makeEditor()
    act(() => result.current.attachEditor(editor))

    act(() => result.current.applyOutput.apply('insert', 'XY'))

    expect(editor.executeEdits).toHaveBeenCalledWith(
      'apply-output',
      [expect.objectContaining({ text: 'XY' })],
      expect.any(Function)
    )
    expect(result.current.applyOutput.notice?.text).toBe(APPLY_NOTICES.insert)
  })

  it('置換すると編集し、「置換しました」を通知する', () => {
    const { result } = renderApply()
    const { editor } = makeEditor({ selection: nonEmpty })
    act(() => result.current.attachEditor(editor))

    act(() => result.current.applyOutput.apply('replace', 'Z'))

    expect(editor.executeEdits).toHaveBeenCalledOnce()
    expect(result.current.applyOutput.notice?.text).toBe(APPLY_NOTICES.replace)
  })

  it('無効な操作は何もしない(選択が空の置換・実行中・エディタなし)', () => {
    const { result, rerender } = renderApply()
    act(() => result.current.applyOutput.apply('insert', 'X'))
    expect(result.current.applyOutput.notice).toBeNull()

    const { editor } = makeEditor()
    act(() => result.current.attachEditor(editor))
    act(() => result.current.applyOutput.apply('replace', 'X'))
    expect(editor.executeEdits).not.toHaveBeenCalled()

    rerender({ isExecuting: true })
    act(() => result.current.applyOutput.apply('insert', 'X'))
    expect(editor.executeEdits).not.toHaveBeenCalled()
    expect(result.current.applyOutput.notice).toBeNull()
  })

  it('Monaco が編集を拒否したら「反映できませんでした」を通知する', () => {
    const { result } = renderApply()
    const { editor } = makeEditor()
    editor.executeEdits.mockReturnValueOnce(false)
    act(() => result.current.attachEditor(editor))

    act(() => result.current.applyOutput.apply('insert', 'X'))

    expect(result.current.applyOutput.notice?.text).toBe(APPLY_NOTICES.rejected)
  })

  it('反映先が使えなくなっていたら(モデルが無い)通知しない', () => {
    const { result } = renderApply()
    const fake = makeEditor()
    act(() => result.current.attachEditor(fake.editor))
    // 破棄の通知が届く前に、モデルだけが無くなった状態
    fake.editor.getModel.mockReturnValue(null)

    act(() => result.current.applyOutput.apply('insert', 'X'))

    expect(fake.editor.executeEdits).not.toHaveBeenCalled()
    expect(result.current.applyOutput.notice).toBeNull()
  })

  it('同じ操作を続けても、通知の id が進む(同じ文言でも読み上げ直すため)', () => {
    const { result } = renderApply()
    act(() => result.current.attachEditor(makeEditor().editor))

    act(() => result.current.applyOutput.apply('insert', 'X'))
    const firstId = result.current.applyOutput.notice?.id
    act(() => result.current.applyOutput.apply('insert', 'X'))

    expect(result.current.applyOutput.notice?.text).toBe(APPLY_NOTICES.insert)
    expect(result.current.applyOutput.notice?.id).not.toBe(firstId)
  })

  it('通知は一定時間で消える。続けて反映したら、最後の反映から数え直す', () => {
    vi.useFakeTimers()
    const { result } = renderApply()
    act(() => result.current.attachEditor(makeEditor().editor))

    act(() => result.current.applyOutput.apply('insert', 'X'))
    act(() => vi.advanceTimersByTime(APPLY_NOTICE_DURATION_MS - 1))
    act(() => result.current.applyOutput.apply('insert', 'Y'))
    act(() => vi.advanceTimersByTime(APPLY_NOTICE_DURATION_MS - 1))
    expect(result.current.applyOutput.notice).not.toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.applyOutput.notice).toBeNull()
  })

  it('アンマウントで通知のタイマーを解除する', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderApply()
    act(() => result.current.attachEditor(makeEditor().editor))
    act(() => result.current.applyOutput.apply('insert', 'X'))

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/renderer/src/hooks/__tests__/useApplyOutputToEditor.test.ts
```

Expected: FAIL（`Failed to resolve import "../useApplyOutputToEditor"`）

- [ ] **Step 3: 実装する**

`src/renderer/src/types.ts` の末尾（Task 1 で足した `ApplyMode` の後）に、空行を 1 行置いて追加:

```ts
// 反映の結果の通知。id は通知ごとに進め、同じ文言が続いても読み上げられるようにする(パターン 87)
export interface ApplyNotice {
  text: string
  id: number
}

// 出力パネル(ヘッダーとコードブロック)が使う、反映の可否と操作
export interface ApplyOutputState {
  /** 挿入できない理由。null なら挿入できる */
  insertDisabledReason: string | null
  /** 置換できない理由。null なら置換できる */
  replaceDisabledReason: string | null
  /** 反映する。無効な操作は何もしない */
  apply: (mode: ApplyMode, text: string) => void
  /** 直近の反映の結果の通知(数秒後に null へ戻る) */
  notice: ApplyNotice | null
}
```

Task 1 と合わせた `types.ts` の最終的な差分:

```diff
--- a/src/renderer/src/types.ts
+++ b/src/renderer/src/types.ts
@@ -145,3 +145,24 @@
   /** 現在のブランチを origin へ送り upstream を設定する。戻り値は実際に実行され成功したか */
   pushSetUpstream: () => Promise<boolean>
 }
+
+// AI の出力のエディタへの反映(useApplyOutputToEditor)。挿入はカーソルの位置へ、置換は選択範囲を置き換える
+export type ApplyMode = 'insert' | 'replace'
+
+// 反映の結果の通知。id は通知ごとに進め、同じ文言が続いても読み上げられるようにする(パターン 87)
+export interface ApplyNotice {
+  text: string
+  id: number
+}
+
+// 出力パネル(ヘッダーとコードブロック)が使う、反映の可否と操作
+export interface ApplyOutputState {
+  /** 挿入できない理由。null なら挿入できる */
+  insertDisabledReason: string | null
+  /** 置換できない理由。null なら置換できる */
+  replaceDisabledReason: string | null
+  /** 反映する。無効な操作は何もしない */
+  apply: (mode: ApplyMode, text: string) => void
+  /** 直近の反映の結果の通知(数秒後に null へ戻る) */
+  notice: ApplyNotice | null
+}
```

`src/renderer/src/hooks/useApplyOutputToEditor.ts`（新規。全文）:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { applyToEditor, isEmptySelection } from '../lib/applyToEditor'
import type { ApplySelection, ApplyTargetEditor } from '../lib/applyToEditor'
import type { ApplyMode, ApplyNotice, ApplyOutputState } from '../types'

// 反映の結果の通知を出しておく時間
export const APPLY_NOTICE_DURATION_MS = 3000

// 無効の理由(ボタンの title・aria-describedby と、出力パネルのヘッダーの案内)
export const APPLY_DISABLED_REASONS = {
  noEditor: '反映先のファイルが表示されていません',
  executing: '実行中は反映できません',
  noSelection: '選択範囲がありません'
} as const

export const APPLY_NOTICES = {
  insert: '挿入しました',
  replace: '置換しました',
  rejected: '反映できませんでした'
} as const

interface Disposable {
  dispose(): void
}

/** 反映先として追うエディタ。Monaco の IStandaloneCodeEditor はこの形を満たす */
export interface TrackedEditor extends ApplyTargetEditor {
  onDidChangeCursorSelection(listener: (event: { selection: ApplySelection }) => void): Disposable
  onDidDispose(listener: () => void): Disposable
}

export interface UseApplyOutputToEditorOptions {
  isExecuting: boolean
}

export interface ApplyOutputToEditor {
  applyOutput: ApplyOutputState
  /**
   * 現在のファイルのエディタがマウントされたときに呼ぶ(EditorPanel の onMount。useEditorFocusManager の
   * handleEditorMount が true を返したときだけ)。エディタが破棄されると(ファイルの切り替え・diff タブ・
   * ファイルを閉じる)、反映先から外れる
   */
  attachEditor: (instance: TrackedEditor) => void
}

const hasNonEmptySelection = (instance: TrackedEditor): boolean => {
  const selection = instance.getSelection()
  return selection !== null && !isEmptySelection(selection)
}

// 出力パネルからエディタへの反映。反映先のエディタと選択範囲の有無を状態として追う(editorRef は ref のため
// 再描画を起こさない)。購読はマウントの通知(attachEditor)で張り、破棄の通知・次のマウントで外す
export function useApplyOutputToEditor({
  isExecuting
}: UseApplyOutputToEditorOptions): ApplyOutputToEditor {
  const [target, setTarget] = useState<TrackedEditor | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const [notice, setNotice] = useState<ApplyNotice | null>(null)
  const subscriptionsRef = useRef<Disposable[]>([])
  const noticeIdRef = useRef(0)

  const detach = useCallback((): void => {
    for (const subscription of subscriptionsRef.current) subscription.dispose()
    subscriptionsRef.current = []
  }, [])

  const attachEditor = useCallback(
    (instance: TrackedEditor): void => {
      // 前のエディタの購読を外す。外さないと、前のエディタの破棄の通知が新しい反映先を消す
      detach()
      // 破棄済みのインスタンス(遅れて届いたマウントの通知)は追わない
      if (instance.getModel() === null) {
        setTarget(null)
        setHasSelection(false)
        return
      }
      subscriptionsRef.current = [
        instance.onDidChangeCursorSelection((event) => {
          setHasSelection(!isEmptySelection(event.selection))
        }),
        instance.onDidDispose(() => {
          detach()
          setTarget(null)
          setHasSelection(false)
        })
      ]
      setTarget(instance)
      setHasSelection(hasNonEmptySelection(instance))
    },
    [detach]
  )

  // 通知は数秒後に消す。次の通知が来たら、前のタイマーは解除して数え直す
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), APPLY_NOTICE_DURATION_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const insertDisabledReason =
    target === null
      ? APPLY_DISABLED_REASONS.noEditor
      : isExecuting
        ? APPLY_DISABLED_REASONS.executing
        : null
  const replaceDisabledReason =
    insertDisabledReason ?? (hasSelection ? null : APPLY_DISABLED_REASONS.noSelection)

  const apply = (mode: ApplyMode, text: string): void => {
    const reason = mode === 'insert' ? insertDisabledReason : replaceDisabledReason
    if (reason !== null || target === null) return
    const result = applyToEditor(target, mode, text)
    if (result === 'unavailable') return
    noticeIdRef.current += 1
    setNotice({
      text: result === 'applied' ? APPLY_NOTICES[mode] : APPLY_NOTICES.rejected,
      id: noticeIdRef.current
    })
  }

  return {
    applyOutput: { insertDisabledReason, replaceDisabledReason, apply, notice },
    attachEditor
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run src/renderer/src/hooks/__tests__/useApplyOutputToEditor.test.ts
npm run typecheck
npx eslint src/renderer/src/hooks/useApplyOutputToEditor.ts src/renderer/src/hooks/__tests__/useApplyOutputToEditor.test.ts src/renderer/src/types.ts
npx prettier --check src/renderer/src/hooks/useApplyOutputToEditor.ts src/renderer/src/hooks/__tests__/useApplyOutputToEditor.test.ts src/renderer/src/types.ts
```

Expected: PASS（18 件）。typecheck・eslint・prettier が通る

- [ ] **Step 5: 変異で検知力を確かめる**

対象は `src/renderer/src/hooks/useApplyOutputToEditor.ts`、テストは `useApplyOutputToEditor.test.ts`。

| #    | 変異                                                                                                                  | `-t`                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| H1   | `attachEditor` の先頭の `detach()`（とその上のコメント）を消す                                                        | `次のエディタがマウントされたら`       |
| H2   | `onDidDispose` の中の `setTarget(null)` を消す                                                                        | `エディタが破棄されると反映先から外れ` |
| H3   | `onDidDispose` の中の `detach()` を消す                                                                               | `エディタが破棄されると反映先から外れ` |
| H4   | `insertDisabledReason ?? (hasSelection ? null : APPLY_DISABLED_REASONS.noSelection)` を `insertDisabledReason` にする | `マウントされれば挿入できる`           |
| H5   | `: isExecuting` を `: false` にする                                                                                   | `実行中は、選択範囲があっても`         |
| H6   | 理由の三項演算子を `isExecuting` → `target === null` の順に入れ替える                                                 | `エディタが無いときの理由は`           |
| H7   | `setHasSelection(!isEmptySelection(event.selection))` を消す                                                          | `選択範囲の変化に追従する`             |
| H8   | `setHasSelection(hasNonEmptySelection(instance))` を `setHasSelection(false)` にする                                  | `マウントの時点で選択範囲があれば`     |
| H9   | `if (instance.getModel() === null) {` を `if (instance.getModel() === null && false) {` にする                        | `破棄済みのインスタンス`               |
| H10  | `return () => clearTimeout(timer)` を `void timer` にする                                                             | `アンマウントで通知のタイマー`         |
| H10b | `return () => clearTimeout(timer)` を `void timer` にする                                                             | `通知は一定時間で消える`               |
| H11  | `noticeIdRef.current += 1` を消す                                                                                     | `通知の id が進む`                     |
| H12  | `if (result === 'unavailable') return` を `if (result !== 'applied') return` にする                                   | `Monaco が編集を拒否したら`            |
| H13  | `if (result === 'unavailable') return` を消す                                                                         | `反映先が使えなくなっていたら`         |
| H14  | `if (reason !== null \|\| target === null) return` を `if (target === null) return` にする                            | `無効な操作は何もしない`               |
| H15  | `APPLY_NOTICES[mode]` を `APPLY_NOTICES.insert` にする                                                                | `置換すると編集し`                     |

Expected: 各変異でファイル全体と `-t` 単独の両方が FAIL。復元後に `cmp` が一致

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は行わない）**

---

### Task 4: `CodeBlock` と `MarkdownRenderer` の `codeBlockActions`

**Files:**

- Create: `src/renderer/src/components/output/codeBlockActions.ts`, `src/renderer/src/components/output/CodeBlock.tsx`, `src/renderer/src/components/output/__tests__/CodeBlock.test.tsx`
- Modify: `src/renderer/src/components/output/MarkdownRenderer.tsx`

**Interfaces:**

- Consumes: `getCodeBlockSource`（Task 2）、`ApplyOutputState`（Task 3）
- Produces: `CodeBlockActions`・`CodeBlockActionsContext`（`codeBlockActions.ts`）、`CodeBlock`（default export）、`MarkdownRenderer` の `codeBlockActions?: CodeBlockActions`
- 注: `components` はモジュールの定数（`components` と `componentsWithCodeBlock`）にし、描画ごとに変わる状態は context で渡す（差異 13）。`codeBlockActions` を渡さないときは従来の `components` をそのまま使う（既存の `MarkdownRenderer.test.tsx`・`HistoryDetail` は変更なしで通る）。CSS は Task 5 で足す（このタスクの見た目は未調整でよい）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/output/__tests__/CodeBlock.test.tsx`（新規。全文）:

````tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import MarkdownRenderer from '../MarkdownRenderer'
import type { CodeBlockActions } from '../codeBlockActions'
import type { ApplyOutputState } from '../../../types'

// CodeBlock は MarkdownRenderer の pre の差し替えとしてだけ使われるため、MarkdownRenderer を通して描画する
const REASON_ID = 'apply-reason'

function makeActions(overrides: Partial<CodeBlockActions> = {}): CodeBlockActions {
  return {
    insertDisabledReason: null,
    replaceDisabledReason: null,
    apply: vi.fn<ApplyOutputState['apply']>(),
    reasonId: REASON_ID,
    ...overrides
  }
}

const TWO_BLOCKS = '前置き\n\n```ts\nconst a = 1\n```\n\n間\n\n```\nplain\n\n```'

describe('CodeBlock', () => {
  it('コードブロックごとに言語名と「挿入」「置換」を、pre の外側に表示する', () => {
    const { container } = render(
      <MarkdownRenderer content={TWO_BLOCKS} codeBlockActions={makeActions()} />
    )
    const blocks = container.querySelectorAll('.code-block')
    expect(blocks).toHaveLength(2)
    expect(within(blocks[0] as HTMLElement).getByText('ts')).toBeInTheDocument()
    // 言語名の無いブロックは「コード」
    expect(within(blocks[1] as HTMLElement).getByText('コード')).toBeInTheDocument()
    for (const block of blocks) {
      const pre = block.querySelector('pre')
      expect(pre).not.toBeNull()
      // ボタンは pre の中に入れない(Markdown の構造を壊さない)
      expect(pre?.querySelector('button')).toBeNull()
      expect(within(block as HTMLElement).getAllByRole('button')).toHaveLength(2)
    }
  })

  it('アクセシブルネームは表示文言で始まる(パターン 76)', () => {
    render(<MarkdownRenderer content={'```ts\nx\n```'} codeBlockActions={makeActions()} />)

    const insert = screen.getByRole('button', {
      name: '挿入（このコードブロックをカーソル位置へ）'
    })
    const replace = screen.getByRole('button', { name: '置換（選択範囲をこのコードブロックで）' })
    expect(insert).toHaveTextContent('挿入')
    expect(replace).toHaveTextContent('置換')
  })

  it('「挿入」「置換」は、そのブロックの原文(末尾の改行を 1 つ除く)で apply を呼ぶ', async () => {
    const user = userEvent.setup()
    const actions = makeActions()
    const { container } = render(
      <MarkdownRenderer content={TWO_BLOCKS} codeBlockActions={actions} />
    )
    const second = container.querySelectorAll('.code-block')[1] as HTMLElement

    await user.click(within(second).getByRole('button', { name: /^挿入/ }))
    await user.click(within(second).getByRole('button', { name: /^置換/ }))

    expect(actions.apply).toHaveBeenNthCalledWith(1, 'insert', 'plain\n')
    expect(actions.apply).toHaveBeenNthCalledWith(2, 'replace', 'plain\n')
  })

  it('無効なボタンは disabled で、理由を title と aria-describedby で示す', () => {
    render(
      <>
        <p id={REASON_ID}>選択範囲がありません</p>
        <MarkdownRenderer
          content={'```ts\nx\n```'}
          codeBlockActions={makeActions({ replaceDisabledReason: '選択範囲がありません' })}
        />
      </>
    )

    const insert = screen.getByRole('button', { name: /^挿入/ })
    const replace = screen.getByRole('button', { name: /^置換/ })
    expect(insert).toBeEnabled()
    expect(insert).not.toHaveAttribute('title')
    expect(insert).not.toHaveAttribute('aria-describedby')
    expect(replace).toBeDisabled()
    expect(replace).toHaveAttribute('title', '選択範囲がありません')
    // title だけでも説明になるため、参照そのものを確かめる
    expect(replace).toHaveAttribute('aria-describedby', REASON_ID)
    expect(replace).toHaveAccessibleDescription('選択範囲がありません')
  })

  it('挿入が無効なら、挿入のボタンも理由を示す', () => {
    render(
      <MarkdownRenderer
        content={'```ts\nx\n```'}
        codeBlockActions={makeActions({
          insertDisabledReason: '反映先のファイルが表示されていません',
          replaceDisabledReason: '反映先のファイルが表示されていません'
        })}
      />
    )

    const insert = screen.getByRole('button', { name: /^挿入/ })
    expect(insert).toBeDisabled()
    expect(insert).toHaveAttribute('title', '反映先のファイルが表示されていません')
    expect(insert).toHaveAttribute('aria-describedby', REASON_ID)
  })

  it('空のコードブロックには言語名だけを出し、ボタンを出さない', () => {
    const { container } = render(
      <MarkdownRenderer content={'```js\n```'} codeBlockActions={makeActions()} />
    )

    expect(container.querySelector('.code-block')).not.toBeNull()
    expect(screen.getByText('js')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('インラインコードにはボタンを付けない', () => {
    render(<MarkdownRenderer content="use `foo()` here" codeBlockActions={makeActions()} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('反映の状態が変わっても、コードブロックを作り直さない(押したボタンのフォーカスを保つ)', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <MarkdownRenderer content={'```ts\nx\n```'} codeBlockActions={makeActions()} />
    )
    const insert = screen.getByRole('button', { name: /^挿入/ })
    await user.click(insert)

    rerender(
      <MarkdownRenderer
        content={'```ts\nx\n```'}
        codeBlockActions={makeActions({ replaceDisabledReason: '選択範囲がありません' })}
      />
    )

    expect(screen.getByRole('button', { name: /^挿入/ })).toBe(insert)
    expect(insert).toHaveFocus()
  })
})

describe('MarkdownRenderer — codeBlockActions を渡さないとき', () => {
  it('コードブロックは従来どおり pre だけで、見出しもボタンも付けない', () => {
    const { container } = render(<MarkdownRenderer content={'```ts\nconst x = 1\n```'} />)

    expect(container.querySelector('.code-block')).toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('const x = 1').closest('pre')?.parentElement).toHaveClass(
      'markdown-renderer'
    )
  })
})
````

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/renderer/src/components/output/__tests__/CodeBlock.test.tsx
```

Expected: FAIL（9 件中 7 件。`.code-block` もボタンも無い。「インラインコードにはボタンを付けない」と「codeBlockActions を渡さないとき」の 2 件は通る）

- [ ] **Step 3: 実装する**

`src/renderer/src/components/output/codeBlockActions.ts`（新規。全文）:

```ts
import { createContext } from 'react'
import type { ApplyOutputState } from '../../types'

/** コードブロックのボタンが使う、反映の可否と操作 */
export interface CodeBlockActions {
  insertDisabledReason: ApplyOutputState['insertDisabledReason']
  replaceDisabledReason: ApplyOutputState['replaceDisabledReason']
  apply: ApplyOutputState['apply']
  /** 無効の理由を表示している要素の id(無効なボタンの aria-describedby) */
  reasonId: string
}

// MarkdownRenderer の components(pre の差し替え)はモジュールの定数にし、描画ごとに作り直さない
// (作り直すと要素の型が変わり、コードブロックが毎回作り直されてボタンのフォーカスが失われる)。
// 描画ごとに変わる反映の状態は、この context で CodeBlock へ渡す
export const CodeBlockActionsContext = createContext<CodeBlockActions | null>(null)
```

`src/renderer/src/components/output/CodeBlock.tsx`（新規。全文）:

```tsx
'use client'

import { useContext } from 'react'
import type { ComponentProps } from 'react'
import type { ExtraProps } from 'react-markdown'
import { getCodeBlockSource } from '../../lib/codeBlockSource'
import { CodeBlockActionsContext } from './codeBlockActions'

type Props = ComponentProps<'pre'> & ExtraProps

// 出力のコードブロック(MarkdownRenderer の pre の差し替え)。pre の外側のラッパーに、言語名と
// 「挿入」「置換」を置く(Markdown の構造の中には入れない)。反映するのは hast から取り出した原文。
// コードが空のブロックは反映しても何も変わらないため、ボタンを出さない
export default function CodeBlock({ node, children, ...props }: Props): React.JSX.Element {
  const actions = useContext(CodeBlockActionsContext)
  const source = getCodeBlockSource(node)
  if (actions === null || source === null) {
    return <pre {...props}>{children}</pre>
  }
  const { code, language } = source
  return (
    <div className="code-block">
      <div className="code-block__toolbar">
        <span className="code-block__language">{language ?? 'コード'}</span>
        {code !== '' && (
          <span className="code-block__actions">
            <button
              type="button"
              className="code-block__button"
              // 名前は表示文言で始める(パターン 76)
              aria-label="挿入（このコードブロックをカーソル位置へ）"
              disabled={actions.insertDisabledReason !== null}
              title={actions.insertDisabledReason ?? undefined}
              aria-describedby={
                actions.insertDisabledReason !== null ? actions.reasonId : undefined
              }
              onClick={() => actions.apply('insert', code)}
            >
              挿入
            </button>
            <button
              type="button"
              className="code-block__button"
              aria-label="置換（選択範囲をこのコードブロックで）"
              disabled={actions.replaceDisabledReason !== null}
              title={actions.replaceDisabledReason ?? undefined}
              aria-describedby={
                actions.replaceDisabledReason !== null ? actions.reasonId : undefined
              }
              onClick={() => actions.apply('replace', code)}
            >
              置換
            </button>
          </span>
        )}
      </div>
      <pre {...props} className="code-block__pre">
        {children}
      </pre>
    </div>
  )
}
```

`src/renderer/src/components/output/MarkdownRenderer.tsx`（変更。全文。既存の lint の指摘（差異 18）もあわせて直す）:

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { Components } from 'react-markdown'
import CodeBlock from './CodeBlock'
import { CodeBlockActionsContext } from './codeBlockActions'
import type { CodeBlockActions } from './codeBlockActions'

interface Props {
  content: string
  /** 渡されたときだけ、コードブロックに言語名と「挿入」「置換」を付ける(出力パネル) */
  codeBlockActions?: CodeBlockActions
}

const LINK_SAFE_SCHEMES = ['http:', 'https:', 'mailto:']
const IMG_SAFE_SCHEMES = ['http:', 'https:']

const components: Components = {
  // node(hast)は DOM の属性へ渡さないよう、分割代入で取り除く(使わない)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  a: ({ href, children, node: _node, ...props }) => {
    const trimmedHref = href?.trim() ?? ''
    const isSafe = LINK_SAFE_SCHEMES.some((s) => trimmedHref.toLowerCase().startsWith(s))
    if (!isSafe) return <span>{children}</span>
    return (
      <a {...props} href={trimmedHref} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  img: ({ src, alt, node: _node, ...props }) => {
    const trimmedSrc = src?.trim() ?? ''
    const isSafe = IMG_SAFE_SCHEMES.some((s) => trimmedSrc.toLowerCase().startsWith(s))
    if (!isSafe) return <span>{alt ?? ''}</span>
    return <img {...props} src={trimmedSrc} alt={alt} />
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  table: ({ children, node: _node, ...props }) => (
    <div className="markdown-renderer__table-wrapper">
      <table {...props}>{children}</table>
    </div>
  )
}

// コードブロックに反映のボタンを付けるときの components。定数にし、描画ごとに作り直さない(codeBlockActions.ts)
const componentsWithCodeBlock: Components = { ...components, pre: CodeBlock }

export default function MarkdownRenderer({ content, codeBlockActions }: Props): React.JSX.Element {
  return (
    <div className="markdown-renderer">
      <CodeBlockActionsContext.Provider value={codeBlockActions ?? null}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={codeBlockActions === undefined ? components : componentsWithCodeBlock}
        >
          {content}
        </ReactMarkdown>
      </CodeBlockActionsContext.Provider>
    </div>
  )
}
```

差分:

```diff
--- a/src/renderer/src/components/output/MarkdownRenderer.tsx
+++ b/src/renderer/src/components/output/MarkdownRenderer.tsx
@@ -2,15 +2,22 @@
 import remarkGfm from 'remark-gfm'
 import remarkBreaks from 'remark-breaks'
 import type { Components } from 'react-markdown'
+import CodeBlock from './CodeBlock'
+import { CodeBlockActionsContext } from './codeBlockActions'
+import type { CodeBlockActions } from './codeBlockActions'

 interface Props {
   content: string
+  /** 渡されたときだけ、コードブロックに言語名と「挿入」「置換」を付ける(出力パネル) */
+  codeBlockActions?: CodeBlockActions
 }

 const LINK_SAFE_SCHEMES = ['http:', 'https:', 'mailto:']
 const IMG_SAFE_SCHEMES = ['http:', 'https:']

 const components: Components = {
+  // node(hast)は DOM の属性へ渡さないよう、分割代入で取り除く(使わない)
+  // eslint-disable-next-line @typescript-eslint/no-unused-vars
   a: ({ href, children, node: _node, ...props }) => {
     const trimmedHref = href?.trim() ?? ''
     const isSafe = LINK_SAFE_SCHEMES.some((s) => trimmedHref.toLowerCase().startsWith(s))
@@ -21,25 +28,35 @@
       </a>
     )
   },
+  // eslint-disable-next-line @typescript-eslint/no-unused-vars
   img: ({ src, alt, node: _node, ...props }) => {
     const trimmedSrc = src?.trim() ?? ''
     const isSafe = IMG_SAFE_SCHEMES.some((s) => trimmedSrc.toLowerCase().startsWith(s))
     if (!isSafe) return <span>{alt ?? ''}</span>
     return <img {...props} src={trimmedSrc} alt={alt} />
   },
+  // eslint-disable-next-line @typescript-eslint/no-unused-vars
   table: ({ children, node: _node, ...props }) => (
     <div className="markdown-renderer__table-wrapper">
       <table {...props}>{children}</table>
     </div>
-  ),
+  )
 }

-export default function MarkdownRenderer({ content }: Props) {
+// コードブロックに反映のボタンを付けるときの components。定数にし、描画ごとに作り直さない(codeBlockActions.ts)
+const componentsWithCodeBlock: Components = { ...components, pre: CodeBlock }
+
+export default function MarkdownRenderer({ content, codeBlockActions }: Props): React.JSX.Element {
   return (
     <div className="markdown-renderer">
-      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
-        {content}
-      </ReactMarkdown>
+      <CodeBlockActionsContext.Provider value={codeBlockActions ?? null}>
+        <ReactMarkdown
+          remarkPlugins={[remarkGfm, remarkBreaks]}
+          components={codeBlockActions === undefined ? components : componentsWithCodeBlock}
+        >
+          {content}
+        </ReactMarkdown>
+      </CodeBlockActionsContext.Provider>
     </div>
   )
 }
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run src/renderer/src/components/output src/renderer/src/components/history
npm run typecheck
npx eslint src/renderer/src/components/output/codeBlockActions.ts src/renderer/src/components/output/CodeBlock.tsx src/renderer/src/components/output/MarkdownRenderer.tsx src/renderer/src/components/output/__tests__/CodeBlock.test.tsx
npx prettier --check src/renderer/src/components/output/codeBlockActions.ts src/renderer/src/components/output/CodeBlock.tsx src/renderer/src/components/output/MarkdownRenderer.tsx src/renderer/src/components/output/__tests__/CodeBlock.test.tsx
```

Expected: PASS（`CodeBlock.test.tsx` 9 件、既存の `MarkdownRenderer.test.tsx` 30 件・`OutputPanel.test.tsx` 19 件と履歴のテストは変更なしで通る）。typecheck・eslint・prettier が通る

- [ ] **Step 5: 変異で検知力を確かめる**

テストは `CodeBlock.test.tsx`。

| #   | 対象                   | 変異                                                                                                                                                                                                            | `-t`                           |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| K1  | `MarkdownRenderer.tsx` | `components={codeBlockActions === undefined ? components : componentsWithCodeBlock}` を `components={codeBlockActions === undefined ? components : { ...components, pre: (p) => <CodeBlock {...p} /> }}` にする | `コードブロックを作り直さない` |
| K2  | `CodeBlock.tsx`        | 置換のボタンの `aria-describedby` を `undefined` にする                                                                                                                                                         | `無効なボタンは disabled で`   |
| K3  | `CodeBlock.tsx`        | 挿入のボタンの `aria-describedby` を `undefined` にする                                                                                                                                                         | `挿入が無効なら`               |
| K4  | `CodeBlock.tsx`        | `{code !== '' && (` を `{(` にする                                                                                                                                                                              | `空のコードブロック`           |
| K5  | `CodeBlock.tsx`        | 置換のボタンの `disabled={actions.replaceDisabledReason !== null}` を `disabled={actions.insertDisabledReason !== null}` にする                                                                                 | `無効なボタンは disabled で`   |
| K6  | `CodeBlock.tsx`        | `actions.apply('replace', code)` を `actions.apply('insert', code)` にする                                                                                                                                      | `のブロックの原文`             |
| K7  | `CodeBlock.tsx`        | `pre` の中の `{children}` の前に `<button type="button">x</button>` を入れる                                                                                                                                    | `pre の外側に表示する`         |

Expected: 各変異でファイル全体と `-t` 単独の両方が FAIL。復元後に `cmp` が一致

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は行わない）**

---

### Task 5: `OutputPanel` のヘッダー（出力全体の挿入・置換・無効の理由・通知）と CSS

**Files:**

- Create: `src/renderer/src/__tests__/makeApplyOutputState.ts`, `src/renderer/src/components/output/__tests__/OutputPanel.apply.test.tsx`, `src/renderer/src/components/output/__tests__/OutputPanel.styles.test.tsx`
- Modify: `src/renderer/src/components/output/OutputPanel.tsx`, `src/renderer/src/assets/main.css`

**Interfaces:**

- Consumes: `ApplyOutputState`（Task 3）、`MarkdownRenderer` の `codeBlockActions`（Task 4）
- Produces: `OutputPanel` の `applyOutput?: ApplyOutputState`、`makeApplyOutputState`（テスト用）、CSS の `.output-panel__actions`・`.output-panel__notice`・`.output-panel__apply-reason`・`.output-panel__apply-btn`・`.code-block*`
- 注: 既存の `OutputPanel.test.tsx` は変えない（新しい検証は別のファイル。パターン 31）。無効の理由は 1 つの要素に置換の理由を出し、無効なボタンだけが参照する（差異 9）。通知の要素は `applyOutput` があるときは常に置く（差異 12）。ゼロ幅スペースは `'\u200b'` のエスケープで書く

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/__tests__/makeApplyOutputState.ts`（新規。全文）:

```ts
import { vi } from 'vitest'
import type { ApplyOutputState } from '../types'

/**
 * テスト用の ApplyOutputState のモック。既定は「挿入も置換もできる・通知なし」。
 * apply は ApplyOutputState の型で vi.fn を作るため、契約から外れたモックは型検査で検出される(パターン 78)
 */
export const makeApplyOutputState = (
  overrides: Partial<ApplyOutputState> = {}
): ApplyOutputState => ({
  insertDisabledReason: null,
  replaceDisabledReason: null,
  apply: vi.fn<ApplyOutputState['apply']>(),
  notice: null,
  ...overrides
})
```

`src/renderer/src/components/output/__tests__/OutputPanel.apply.test.tsx`（新規。全文）:

````tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import OutputPanel from '../OutputPanel'
import { makeApplyOutputState } from '../../../__tests__/makeApplyOutputState'

const RESULT = '説明\n\n```ts\nconst a = 1\n```'

const baseProps = {
  isExecuting: false,
  result: RESULT as string | null,
  streamingText: '',
  executionError: null as Error | null,
  onClear: vi.fn(),
  onCancel: vi.fn()
}

const headerOf = (container: HTMLElement): HTMLElement =>
  container.querySelector('.output-panel__header') as HTMLElement

describe('OutputPanel — 出力全体の挿入・置換', () => {
  it('ヘッダーに、出力全体の「挿入」「置換」を出す(名前は表示文言で始まる)', () => {
    const { container } = render(
      <OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />
    )
    const header = headerOf(container)

    expect(
      within(header).getByRole('button', { name: '挿入（出力全体をカーソル位置へ）' })
    ).toHaveTextContent('挿入')
    expect(
      within(header).getByRole('button', { name: '置換（選択範囲を出力全体で）' })
    ).toHaveTextContent('置換')
  })

  it('押すと Markdown の原文(result)で apply を呼ぶ', async () => {
    const user = userEvent.setup()
    const applyOutput = makeApplyOutputState()
    render(<OutputPanel {...baseProps} applyOutput={applyOutput} />)

    await user.click(screen.getByRole('button', { name: '挿入（出力全体をカーソル位置へ）' }))
    await user.click(screen.getByRole('button', { name: '置換（選択範囲を出力全体で）' }))

    expect(applyOutput.apply).toHaveBeenNthCalledWith(1, 'insert', RESULT)
    expect(applyOutput.apply).toHaveBeenNthCalledWith(2, 'replace', RESULT)
  })

  it('コードブロックにも「挿入」「置換」を付け、そのブロックの原文で apply を呼ぶ', async () => {
    const user = userEvent.setup()
    const applyOutput = makeApplyOutputState()
    const { container } = render(<OutputPanel {...baseProps} applyOutput={applyOutput} />)
    const block = container.querySelector('.code-block') as HTMLElement

    await user.click(within(block).getByRole('button', { name: /^挿入/ }))

    expect(applyOutput.apply).toHaveBeenCalledWith('insert', 'const a = 1')
  })

  it('置換だけが無効なら、理由をヘッダーに表示し、置換のボタンだけがそれを参照する', () => {
    const { container } = render(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({ replaceDisabledReason: '選択範囲がありません' })}
      />
    )
    const header = headerOf(container)

    expect(within(header).getByText('選択範囲がありません')).toBeInTheDocument()
    const insert = within(header).getByRole('button', { name: /^挿入/ })
    const replace = within(header).getByRole('button', { name: /^置換/ })
    expect(insert).toBeEnabled()
    expect(insert).not.toHaveAttribute('aria-describedby')
    expect(replace).toBeDisabled()
    expect(replace).toHaveAttribute('title', '選択範囲がありません')
    // title だけでも説明になるため、参照先の要素がヘッダーの理由であることを確かめる
    expect(document.getElementById(replace.getAttribute('aria-describedby') ?? '')).toHaveClass(
      'output-panel__apply-reason'
    )
    expect(replace).toHaveAccessibleDescription('選択範囲がありません')
    // コードブロックの置換も同じ理由の要素を参照する
    const block = container.querySelector('.code-block') as HTMLElement
    expect(within(block).getByRole('button', { name: /^置換/ })).toHaveAccessibleDescription(
      '選択範囲がありません'
    )
  })

  it('挿入も無効なら、すべてのボタンが無効で、理由を示す', () => {
    const reason = '反映先のファイルが表示されていません'
    render(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({
          insertDisabledReason: reason,
          replaceDisabledReason: reason
        })}
      />
    )

    const buttons = screen.getAllByRole('button', { name: /^(挿入|置換)/ })
    expect(buttons).toHaveLength(4)
    for (const button of buttons) {
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(reason)
    }
  })

  it('すべて有効なら理由を表示しない', () => {
    const { container } = render(
      <OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />
    )

    expect(container.querySelector('.output-panel__apply-reason')).toBeNull()
  })

  it('実行中は挿入・置換を出さない(逐次出力は Markdown として表示しない)', () => {
    render(
      <OutputPanel
        {...baseProps}
        isExecuting={true}
        streamingText="```ts\nx"
        applyOutput={makeApplyOutputState()}
      />
    )

    expect(screen.queryByRole('button', { name: /^(挿入|置換)/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '実行をキャンセル' })).toBeInTheDocument()
  })

  it('エラーだけのとき・結果が空のときは挿入・置換を出さない', () => {
    const { rerender } = render(
      <OutputPanel
        {...baseProps}
        result={null}
        executionError={new Error('失敗')}
        applyOutput={makeApplyOutputState()}
      />
    )
    expect(screen.queryByRole('button', { name: /^(挿入|置換)/ })).not.toBeInTheDocument()

    rerender(<OutputPanel {...baseProps} result="" applyOutput={makeApplyOutputState()} />)
    expect(screen.queryByRole('button', { name: /^(挿入|置換)/ })).not.toBeInTheDocument()
  })

  it('applyOutput を渡さないときは、挿入・置換も通知の領域も出さない(従来の表示)', () => {
    const { container } = render(<OutputPanel {...baseProps} />)

    expect(screen.queryByRole('button', { name: /^(挿入|置換)/ })).not.toBeInTheDocument()
    expect(container.querySelector('.code-block')).toBeNull()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('OutputPanel — 反映の通知', () => {
  it('通知を role="status" で表示する', () => {
    render(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({ notice: { text: '挿入しました', id: 1 } })}
      />
    )

    expect(screen.getByRole('status')).toHaveTextContent('挿入しました')
  })

  it('同じ文言の通知が続いても、文字列を変えて読み上げ直させる', () => {
    const { rerender } = render(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({ notice: { text: '挿入しました', id: 1 } })}
      />
    )
    const first = screen.getByRole('status').textContent

    rerender(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({ notice: { text: '挿入しました', id: 2 } })}
      />
    )

    expect(screen.getByRole('status').textContent).not.toBe(first)
    expect(screen.getByRole('status')).toHaveTextContent('挿入しました')
  })

  it('通知が無いときも領域は残す(後から入る文言を読み上げさせるため)', () => {
    render(<OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />)

    expect(screen.getByRole('status')).toHaveTextContent('')
  })
})
````

`src/renderer/src/components/output/__tests__/OutputPanel.styles.test.tsx`（新規。全文）:

````tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import OutputPanel from '../OutputPanel'
import { makeApplyOutputState } from '../../../__tests__/makeApplyOutputState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// 「挿入」「置換」は共通の枠付きボタンのグループセレクタで宣言を共有する(パターン 30・77)。jsdom は :hover を計算しない
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const baseProps = {
  isExecuting: false,
  result: '```ts\nx\n```',
  streamingText: '',
  executionError: null,
  onClear: vi.fn(),
  onCancel: vi.fn()
}

describe('出力パネルの挿入・置換のスタイル(main.css)', () => {
  it('ヘッダーとコードブロックの「挿入」「置換」は 32px 四方以上の枠付きボタン', () => {
    render(<OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />)

    const buttons = screen.getAllByRole('button', { name: /^(挿入|置換)/ })
    expect(buttons).toHaveLength(4)
    for (const button of buttons) {
      const style = getComputedStyle(button)
      expect(style.minWidth).toBe('32px')
      expect(style.minHeight).toBe('32px')
      expect(style.borderTopStyle).toBe('solid')
      expect(style.cursor).toBe('pointer')
    }
  })

  it('無効なときは半透明で、カーソルが既定に戻る', () => {
    const reason = '反映先のファイルが表示されていません'
    render(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({
          insertDisabledReason: reason,
          replaceDisabledReason: reason
        })}
      />
    )

    for (const button of screen.getAllByRole('button', { name: /^(挿入|置換)/ })) {
      const style = getComputedStyle(button)
      expect(style.opacity).toBe('0.5')
      expect(style.cursor).toBe('default')
    }
  })

  it('コードブロックの見出しは折り返しを通常に戻し、pre は見出しとつながる(余白なし)', () => {
    const { container } = render(
      <OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />
    )

    const toolbar = container.querySelector('.code-block__toolbar') as HTMLElement
    expect(getComputedStyle(toolbar).whiteSpace).toBe('normal')
    expect(getComputedStyle(toolbar).display).toBe('flex')
    const pre = container.querySelector('.code-block pre') as HTMLElement
    expect(getComputedStyle(pre).marginTop).toBe('0px')
  })
})
````

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/renderer/src/components/output/__tests__/OutputPanel.apply.test.tsx src/renderer/src/components/output/__tests__/OutputPanel.styles.test.tsx
```

Expected: FAIL（15 件中 11 件。ヘッダーのボタン・理由・通知の領域・コードブロックが無い）

- [ ] **Step 3: 実装する**

`src/renderer/src/components/output/OutputPanel.tsx`（変更。全文）:

```tsx
import { useEffect, useId, useRef } from 'react'
import MarkdownRenderer from './MarkdownRenderer'
import type { ApplyOutputState } from '../../types'

interface Props {
  isExecuting: boolean
  result: string | null
  streamingText: string
  executionError: Error | null
  onClear: () => void
  onCancel: () => void
  /** エディタへの反映(EditorPanel の useApplyOutputToEditor)。渡されたときだけ反映のボタンと通知を出す */
  applyOutput?: ApplyOutputState
}

export default function OutputPanel({
  isExecuting,
  result,
  streamingText,
  executionError,
  onClear,
  onCancel,
  applyOutput
}: Props): React.JSX.Element | null {
  const contentRef = useRef<HTMLDivElement>(null)
  const reasonId = useId()

  // 逐次出力に追従して自動スクロールする(実行中のみ)
  useEffect(() => {
    if (isExecuting && contentRef.current !== null) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [isExecuting, streamingText])

  if (!isExecuting && result === null && executionError === null) {
    return null
  }

  // 反映できるのは、実行が終わって Markdown として表示している結果だけ(実行中は逐次出力を等幅で出すだけ)。
  // 空の結果は反映しても何も変わらないため、ボタンを出さない
  const canShowApply = applyOutput !== undefined && !isExecuting && result !== null && result !== ''
  // 無効の理由は 1 か所に表示し、無効なボタンの aria-describedby から参照する。置換の理由は挿入の理由を含む
  // (挿入できないときは置換も同じ理由で無効)ので、置換の理由を出せば両方を説明できる
  const reason = canShowApply ? applyOutput.replaceDisabledReason : null
  const notice = applyOutput?.notice ?? null

  return (
    <div className="output-panel">
      <div className="output-panel__header">
        <span className="output-panel__title">出力</span>
        {applyOutput !== undefined && (
          <span className="output-panel__notice" role="status">
            {/* 同じ文言が続いても読み上げが再実行されるよう、偶数回目はゼロ幅スペースを付けて文字列を変える
                (ConflictResolver と同じ) */}
            {notice === null ? '' : notice.text + (notice.id % 2 === 1 ? '' : '\u200b')}
          </span>
        )}
        <span className="output-panel__actions">
          {reason !== null && (
            <span id={reasonId} className="output-panel__apply-reason">
              {reason}
            </span>
          )}
          {canShowApply && (
            <>
              <button
                type="button"
                className="output-panel__apply-btn"
                aria-label="挿入（出力全体をカーソル位置へ）"
                disabled={applyOutput.insertDisabledReason !== null}
                title={applyOutput.insertDisabledReason ?? undefined}
                aria-describedby={applyOutput.insertDisabledReason !== null ? reasonId : undefined}
                onClick={() => applyOutput.apply('insert', result)}
              >
                挿入
              </button>
              <button
                type="button"
                className="output-panel__apply-btn"
                aria-label="置換（選択範囲を出力全体で）"
                disabled={applyOutput.replaceDisabledReason !== null}
                title={applyOutput.replaceDisabledReason ?? undefined}
                aria-describedby={applyOutput.replaceDisabledReason !== null ? reasonId : undefined}
                onClick={() => applyOutput.apply('replace', result)}
              >
                置換
              </button>
            </>
          )}
          {isExecuting ? (
            <button
              type="button"
              className="output-panel__cancel-btn"
              onClick={onCancel}
              aria-label="実行をキャンセル"
            >
              キャンセル
            </button>
          ) : (
            <button
              type="button"
              className="output-panel__clear-btn"
              onClick={onClear}
              aria-label="出力をクリア"
            >
              クリア
            </button>
          )}
        </span>
      </div>
      <div className="output-panel__content" ref={contentRef}>
        {isExecuting &&
          (streamingText.length === 0 ? (
            <p className="output-panel__loading">実行中...</p>
          ) : (
            // ストリーミング中は閉じていないコードフェンス等で表示が暴れるため
            // Markdown レンダリングせず等幅テキストで逐次表示する
            <pre className="output-panel__streaming">{streamingText}</pre>
          ))}
        {!isExecuting && result !== null && (
          <MarkdownRenderer
            content={result}
            codeBlockActions={
              canShowApply
                ? {
                    insertDisabledReason: applyOutput.insertDisabledReason,
                    replaceDisabledReason: applyOutput.replaceDisabledReason,
                    apply: applyOutput.apply,
                    reasonId
                  }
                : undefined
            }
          />
        )}
        {!isExecuting && executionError !== null && (
          <p className="output-panel__error">{executionError.message}</p>
        )}
      </div>
    </div>
  )
}
```

`src/renderer/src/assets/main.css`（変更。差分。挿入・置換は共通の枠付きボタンの 3 つのグループセレクタ（宣言・`:hover:not(:disabled)`・`:disabled`）に足し、出力パネルのヘッダーの並びと、コードブロックの見出しの規則を足す）:

```diff
--- a/src/renderer/src/assets/main.css
+++ b/src/renderer/src/assets/main.css
@@ -1223,7 +1223,7 @@
 }

 /* 枠付きの小さなボタンの共通の見た目(退避・マージのバナー・リモートのバナー・初期化・エクスプローラーの clone・
-   解決ビューのツールバー・ブロック)。
+   解決ビューのツールバー・ブロック・出力パネルとコードブロックの「挿入」「置換」)。
    タッチ操作で押しやすいよう 32px 以上のタップ領域を確保し、ホバー時だけ表示する作りにはしない。
    ホバー色は破壊的でない操作=青系、危険系(--danger: 退避を捨てる・マージを中止・削除する)=赤系
    (ブランチメニューのマージ・削除ボタンと同じ)。見た目を変えるときはここ 1 か所を直す */
@@ -1236,6 +1236,8 @@
 .remote-setup-banner__button,
 .source-control-panel__init-btn,
 .explorer-panel__clone-btn,
+.output-panel__apply-btn,
+.code-block__button,
 .create-tag-dialog__kind {
   flex: none;
   min-width: 32px;
@@ -1258,6 +1260,8 @@
 .remote-setup-banner__button:hover:not(:disabled),
 .source-control-panel__init-btn:hover:not(:disabled),
 .explorer-panel__clone-btn:hover:not(:disabled),
+.output-panel__apply-btn:hover:not(:disabled),
+.code-block__button:hover:not(:disabled),
 .create-tag-dialog__kind:hover:not(:disabled) {
   background: #094771;
   color: #ffffff;
@@ -1282,6 +1286,8 @@
 .explorer-panel__clone-btn:disabled,
 .explorer-panel__open-btn:disabled,
 .explorer-panel__change-btn:disabled,
+.output-panel__apply-btn:disabled,
+.code-block__button:disabled,
 .create-tag-dialog__kind:disabled,
 .name-input-dialog__ok:disabled,
 .name-input-dialog__cancel:disabled {
@@ -1614,8 +1620,31 @@
 .output-panel__cancel-btn:hover {
   color: #ffffff;
   border-color: #f48771;
+}
+
+/* ヘッダーの右側(無効の理由・挿入・置換・クリア/キャンセル)。挿入・置換の見た目は共通の枠付きボタンの規則 */
+.output-panel__actions {
+  display: flex;
+  align-items: center;
+  gap: 6px;
+  min-width: 0;
+}
+
+/* 反映の結果の通知(role="status")。タイトルと右側のボタンの間の余白を埋める */
+.output-panel__notice {
+  flex: 1;
+  min-width: 0;
+  margin: 0 12px;
+  font-size: 12px;
+  color: #89d185;
 }

+/* 挿入・置換が無効な理由(無効なボタンの aria-describedby)。タッチ操作では title が出ないため画面に表示する */
+.output-panel__apply-reason {
+  font-size: 11px;
+  color: #969696;
+}
+
 .output-panel__content {
   flex: 1;
   overflow-y: auto;
@@ -1691,6 +1720,40 @@
   margin: 6px 0;
 }

+/* 出力パネルのコードブロック(CodeBlock)。見出し(言語名・挿入・置換)を pre の上に付ける。
+   .markdown-renderer は white-space: pre-wrap のため、見出しは normal に戻す */
+.code-block {
+  margin: 6px 0;
+}
+
+.code-block__toolbar {
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  gap: 8px;
+  padding: 2px 4px 2px 12px;
+  background: #252526;
+  border-radius: 4px 4px 0 0;
+  white-space: normal;
+}
+
+.code-block__language {
+  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
+  font-size: 11px;
+  color: #969696;
+}
+
+.code-block__actions {
+  display: flex;
+  gap: 4px;
+}
+
+/* .markdown-renderer pre の余白・角丸を、見出しとつながる形に上書きする */
+.markdown-renderer .code-block__pre {
+  margin: 0;
+  border-radius: 0 0 4px 4px;
+}
+
 .markdown-renderer pre code {
   background: none;
   padding: 0;
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run src/renderer/src/components/output src/renderer/src/components/history
npm run typecheck
npx eslint src/renderer/src/components/output/OutputPanel.tsx src/renderer/src/__tests__/makeApplyOutputState.ts src/renderer/src/components/output/__tests__/OutputPanel.apply.test.tsx src/renderer/src/components/output/__tests__/OutputPanel.styles.test.tsx
npx prettier --check src/renderer/src/components/output/OutputPanel.tsx src/renderer/src/__tests__/makeApplyOutputState.ts src/renderer/src/components/output/__tests__/OutputPanel.apply.test.tsx src/renderer/src/components/output/__tests__/OutputPanel.styles.test.tsx src/renderer/src/assets/main.css
```

Expected: PASS（`OutputPanel.apply.test.tsx` 12 件・`OutputPanel.styles.test.tsx` 3 件。既存の `OutputPanel.test.tsx` 19 件は変更なしで通る）。typecheck・eslint・prettier が通る

- [ ] **Step 5: 変異で検知力を確かめる**

| #   | 対象              | 変異                                                                                                            | テストのファイル          | `-t`                           |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------ |
| O1  | `OutputPanel.tsx` | `notice.text + (notice.id % 2 === 1 ? '' : '\u200b')` を `notice.text` にする                                   | `OutputPanel.apply.test`  | `同じ文言の通知が続いても`     |
| O2  | `OutputPanel.tsx` | `canShowApply` の `!isExecuting &&` を消す                                                                      | `OutputPanel.apply.test`  | `実行中は挿入・置換を出さない` |
| O3  | `OutputPanel.tsx` | `applyOutput.replaceDisabledReason : null`（`const reason`）を `applyOutput.insertDisabledReason : null` にする | `OutputPanel.apply.test`  | `置換だけが無効なら`           |
| O4  | `OutputPanel.tsx` | 通知の `{applyOutput !== undefined && (` を `{notice !== null && (` にする                                      | `OutputPanel.apply.test`  | `通知が無いときも領域は残す`   |
| O5  | `OutputPanel.tsx` | `canShowApply` の ` && result !== ''` を消す                                                                    | `OutputPanel.apply.test`  | `結果が空のとき`               |
| O6  | `OutputPanel.tsx` | `applyOutput.apply('replace', result)` を `applyOutput.apply('insert', result)` にする                          | `OutputPanel.apply.test`  | `で apply を呼ぶ`              |
| O7  | `OutputPanel.tsx` | `codeBlockActions={ canShowApply ? … : undefined }` の `canShowApply` を `false` にする                         | `OutputPanel.apply.test`  | `コードブロックにも`           |
| O8  | `OutputPanel.tsx` | ヘッダーの置換の `aria-describedby` を `undefined` にする                                                       | `OutputPanel.apply.test`  | `置換だけが無効なら`           |
| S1  | `main.css`        | 共通の枠付きボタンの宣言のグループから `.output-panel__apply-btn,` と `.code-block__button,` を消す             | `OutputPanel.styles.test` | `32px 四方以上`                |
| S2  | `main.css`        | `:disabled` のグループから 2 つのセレクタを消す                                                                 | `OutputPanel.styles.test` | `無効なときは半透明`           |
| S3  | `main.css`        | `.code-block__toolbar` の `white-space: normal;` を消す                                                         | `OutputPanel.styles.test` | `コードブロックの見出し`       |

Expected: 各変異でファイル全体と `-t` 単独の両方が FAIL。復元後に `cmp` が一致

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は行わない）**

---

### Task 6: `EditorPanel` の配線と Monaco のモックの拡張

**Files:**

- Create: `src/renderer/src/components/__tests__/EditorPanel.applyOutput.test.tsx`
- Modify: `src/renderer/src/components/EditorPanel.tsx`, `src/renderer/src/__tests__/__mocks__/@monaco-editor/react.tsx`

**Interfaces:**

- Consumes: `useApplyOutputToEditor`・`APPLY_DISABLED_REASONS`（Task 3）、`OutputPanel` の `applyOutput`（Task 5）、`useEditorFocusManager` の `handleEditorMount`（既存。変えない）
- Produces: `EditorPanel` が出力パネルからの反映を配線する。モックの `mockEditor`（`MockEditorHandle`）・`MockSelection`
- 注: `useEditorFocusManager` と `App` は変えない（差異 7）。モックの拡張は既存の export・描画を変えない（差異 17）。既存の `EditorPanel.test.tsx` は変えない（新しい検証は別のファイル）。実物の Monaco での undo・改行コードは Task 1、実機は APL で確かめる

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/__tests__/__mocks__/@monaco-editor/react.tsx`（変更。全文。テストの基盤のため、このステップで足す）:

```tsx
import { useEffect, useLayoutEffect, useRef } from 'react'
import { afterEach, vi } from 'vitest'

// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockAddCommand = vi.fn()
// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockFocus = vi.fn()
// 破棄済みインスタンスは Monaco がモデルを失う。テストから状態を差し替えられるようにする
// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockEditorModel = { current: {} as object | null }

interface MockRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface MockSelection extends MockRange {
  positionLineNumber: number
  positionColumn: number
}

interface MockEdit {
  range: MockRange
  text: string
}

/** 最後にマウントされた偽のエディタ。テストから選択範囲を変え、編集の呼び出しを確かめる */
export interface MockEditorHandle {
  /** 利用者がエディタで範囲を選んだ代わり。選択範囲を変え、onDidChangeCursorSelection の購読者へ通知する */
  select: (selection: MockSelection) => void
  getSelection: () => MockSelection
  executeEdits: ReturnType<typeof vi.fn>
  pushUndoStop: ReturnType<typeof vi.fn>
}

// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
export const mockEditor = { current: null as MockEditorHandle | null }

afterEach(() => {
  mockAddCommand.mockClear()
  mockFocus.mockClear()
  mockEditorModel.current = {}
  mockEditor.current = null
})

interface EditorProps {
  value?: string
  options?: Record<string, unknown>
  onChange?: (value: string | undefined) => void
  onMount?: (editorInstance: unknown, monaco: unknown) => void
  [key: string]: unknown
}

const collapsedAt = (lineNumber: number, column: number): MockSelection => ({
  startLineNumber: lineNumber,
  startColumn: column,
  endLineNumber: lineNumber,
  endColumn: column,
  positionLineNumber: lineNumber,
  positionColumn: column
})

// 行・列(1 始まり)を文字列の位置へ。改行は \n だけを扱う(テストの内容は \n で書く)
const offsetAt = (text: string, lineNumber: number, column: number): number => {
  const lines = text.split('\n')
  let offset = 0
  for (let i = 0; i < lineNumber - 1; i++) offset += lines[i].length + 1
  return offset + column - 1
}

// 1 つの編集を当てた後の文字列と、挿入したテキストの末尾の位置(Monaco の逆向きの編集の範囲の末尾に当たる)
const applyEdit = (text: string, { range, text: inserted }: MockEdit): [string, MockRange] => {
  const start = offsetAt(text, range.startLineNumber, range.startColumn)
  const end = offsetAt(text, range.endLineNumber, range.endColumn)
  const lines = inserted.split('\n')
  const endLineNumber = range.startLineNumber + lines.length - 1
  const endColumn =
    lines.length === 1 ? range.startColumn + inserted.length : lines[lines.length - 1].length + 1
  return [
    text.slice(0, start) + inserted + text.slice(end),
    {
      startLineNumber: range.startLineNumber,
      startColumn: range.startColumn,
      endLineNumber,
      endColumn
    }
  ]
}

export default function Editor({
  options,
  value,
  onChange,
  onMount
}: EditorProps): React.JSX.Element {
  const mountedRef = useRef(false)
  const disposeRef = useRef<(() => void) | null>(null)
  // 編集は描画の外(テストの操作)から呼ばれるため、最新の value・onChange を ref で読む
  const valueRef = useRef(value ?? '')
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    valueRef.current = value ?? ''
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    let disposed = false
    let selection = collapsedAt(1, 1)
    const selectionListeners = new Set<(event: { selection: MockSelection }) => void>()
    const disposeListeners = new Set<() => void>()
    const setSelection = (next: MockSelection): void => {
      selection = next
      for (const listener of selectionListeners) listener({ selection })
    }
    const executeEdits = vi.fn(
      (
        _source: string,
        edits: MockEdit[],
        endCursorState?: (inverse: { range: MockRange }[]) => unknown
      ): boolean => {
        if (disposed) return false
        const [next, insertedRange] = applyEdit(valueRef.current, edits[0])
        valueRef.current = next
        // Monaco と同じく、カーソルは挿入したテキストの末尾へ動く(forceMoveMarkers)
        setSelection(collapsedAt(insertedRange.endLineNumber, insertedRange.endColumn))
        endCursorState?.([{ range: insertedRange }])
        onChangeRef.current?.(next)
        return true
      }
    )
    const pushUndoStop = vi.fn(() => true)
    mockEditor.current = {
      select: setSelection,
      getSelection: () => selection,
      executeEdits,
      pushUndoStop
    }
    disposeRef.current = () => {
      disposed = true
      for (const listener of disposeListeners) listener()
      disposeListeners.clear()
      selectionListeners.clear()
    }
    onMount?.(
      {
        addCommand: mockAddCommand,
        focus: mockFocus,
        getModel: () => (disposed ? null : mockEditorModel.current),
        getSelection: () => (disposed ? null : selection),
        setSelection: (range: MockRange) =>
          setSelection({
            ...range,
            positionLineNumber: range.endLineNumber,
            positionColumn: range.endColumn
          }),
        executeEdits,
        pushUndoStop,
        onDidChangeCursorSelection: (listener: (event: { selection: MockSelection }) => void) => {
          selectionListeners.add(listener)
          return { dispose: () => selectionListeners.delete(listener) }
        },
        onDidDispose: (listener: () => void) => {
          disposeListeners.add(listener)
          return { dispose: () => disposeListeners.delete(listener) }
        }
      },
      { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } }
    )
  }, [onMount])

  // アンマウントで破棄する(@monaco-editor/react はアンマウントでエディタとモデルを dispose する)
  useEffect(() => () => disposeRef.current?.(), [])

  return (
    <div data-testid="monaco-editor" data-readonly={String(options?.readOnly ?? false)}>
      <textarea
        data-testid="monaco-editor-textarea"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  )
}
```

差分:

```diff
--- a/src/renderer/src/__tests__/__mocks__/@monaco-editor/react.tsx
+++ b/src/renderer/src/__tests__/__mocks__/@monaco-editor/react.tsx
@@ -1,4 +1,4 @@
-import { useEffect, useRef } from 'react'
+import { useEffect, useLayoutEffect, useRef } from 'react'
 import { afterEach, vi } from 'vitest'

 // eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
@@ -9,10 +9,40 @@
 // eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
 export const mockEditorModel = { current: {} as object | null }

+interface MockRange {
+  startLineNumber: number
+  startColumn: number
+  endLineNumber: number
+  endColumn: number
+}
+
+export interface MockSelection extends MockRange {
+  positionLineNumber: number
+  positionColumn: number
+}
+
+interface MockEdit {
+  range: MockRange
+  text: string
+}
+
+/** 最後にマウントされた偽のエディタ。テストから選択範囲を変え、編集の呼び出しを確かめる */
+export interface MockEditorHandle {
+  /** 利用者がエディタで範囲を選んだ代わり。選択範囲を変え、onDidChangeCursorSelection の購読者へ通知する */
+  select: (selection: MockSelection) => void
+  getSelection: () => MockSelection
+  executeEdits: ReturnType<typeof vi.fn>
+  pushUndoStop: ReturnType<typeof vi.fn>
+}
+
+// eslint-disable-next-line react-refresh/only-export-components -- テスト専用モック。HMR 対象外
+export const mockEditor = { current: null as MockEditorHandle | null }
+
 afterEach(() => {
   mockAddCommand.mockClear()
   mockFocus.mockClear()
   mockEditorModel.current = {}
+  mockEditor.current = null
 })

 interface EditorProps {
@@ -23,18 +53,128 @@
   [key: string]: unknown
 }

-export default function Editor({ options, value, onChange, onMount }: EditorProps) {
+const collapsedAt = (lineNumber: number, column: number): MockSelection => ({
+  startLineNumber: lineNumber,
+  startColumn: column,
+  endLineNumber: lineNumber,
+  endColumn: column,
+  positionLineNumber: lineNumber,
+  positionColumn: column
+})
+
+// 行・列(1 始まり)を文字列の位置へ。改行は \n だけを扱う(テストの内容は \n で書く)
+const offsetAt = (text: string, lineNumber: number, column: number): number => {
+  const lines = text.split('\n')
+  let offset = 0
+  for (let i = 0; i < lineNumber - 1; i++) offset += lines[i].length + 1
+  return offset + column - 1
+}
+
+// 1 つの編集を当てた後の文字列と、挿入したテキストの末尾の位置(Monaco の逆向きの編集の範囲の末尾に当たる)
+const applyEdit = (text: string, { range, text: inserted }: MockEdit): [string, MockRange] => {
+  const start = offsetAt(text, range.startLineNumber, range.startColumn)
+  const end = offsetAt(text, range.endLineNumber, range.endColumn)
+  const lines = inserted.split('\n')
+  const endLineNumber = range.startLineNumber + lines.length - 1
+  const endColumn =
+    lines.length === 1 ? range.startColumn + inserted.length : lines[lines.length - 1].length + 1
+  return [
+    text.slice(0, start) + inserted + text.slice(end),
+    {
+      startLineNumber: range.startLineNumber,
+      startColumn: range.startColumn,
+      endLineNumber,
+      endColumn
+    }
+  ]
+}
+
+export default function Editor({
+  options,
+  value,
+  onChange,
+  onMount
+}: EditorProps): React.JSX.Element {
   const mountedRef = useRef(false)
+  const disposeRef = useRef<(() => void) | null>(null)
+  // 編集は描画の外(テストの操作)から呼ばれるため、最新の value・onChange を ref で読む
+  const valueRef = useRef(value ?? '')
+  const onChangeRef = useRef(onChange)
+  useLayoutEffect(() => {
+    valueRef.current = value ?? ''
+    onChangeRef.current = onChange
+  })

   useEffect(() => {
     if (mountedRef.current) return
     mountedRef.current = true
+    let disposed = false
+    let selection = collapsedAt(1, 1)
+    const selectionListeners = new Set<(event: { selection: MockSelection }) => void>()
+    const disposeListeners = new Set<() => void>()
+    const setSelection = (next: MockSelection): void => {
+      selection = next
+      for (const listener of selectionListeners) listener({ selection })
+    }
+    const executeEdits = vi.fn(
+      (
+        _source: string,
+        edits: MockEdit[],
+        endCursorState?: (inverse: { range: MockRange }[]) => unknown
+      ): boolean => {
+        if (disposed) return false
+        const [next, insertedRange] = applyEdit(valueRef.current, edits[0])
+        valueRef.current = next
+        // Monaco と同じく、カーソルは挿入したテキストの末尾へ動く(forceMoveMarkers)
+        setSelection(collapsedAt(insertedRange.endLineNumber, insertedRange.endColumn))
+        endCursorState?.([{ range: insertedRange }])
+        onChangeRef.current?.(next)
+        return true
+      }
+    )
+    const pushUndoStop = vi.fn(() => true)
+    mockEditor.current = {
+      select: setSelection,
+      getSelection: () => selection,
+      executeEdits,
+      pushUndoStop
+    }
+    disposeRef.current = () => {
+      disposed = true
+      for (const listener of disposeListeners) listener()
+      disposeListeners.clear()
+      selectionListeners.clear()
+    }
     onMount?.(
-      { addCommand: mockAddCommand, focus: mockFocus, getModel: () => mockEditorModel.current },
+      {
+        addCommand: mockAddCommand,
+        focus: mockFocus,
+        getModel: () => (disposed ? null : mockEditorModel.current),
+        getSelection: () => (disposed ? null : selection),
+        setSelection: (range: MockRange) =>
+          setSelection({
+            ...range,
+            positionLineNumber: range.endLineNumber,
+            positionColumn: range.endColumn
+          }),
+        executeEdits,
+        pushUndoStop,
+        onDidChangeCursorSelection: (listener: (event: { selection: MockSelection }) => void) => {
+          selectionListeners.add(listener)
+          return { dispose: () => selectionListeners.delete(listener) }
+        },
+        onDidDispose: (listener: () => void) => {
+          disposeListeners.add(listener)
+          return { dispose: () => disposeListeners.delete(listener) }
+        }
+      },
       { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } }
     )
   }, [onMount])

+  // アンマウントで破棄する(@monaco-editor/react はアンマウントでエディタとモデルを dispose する)
+  useEffect(() => () => disposeRef.current?.(), [])
+
   return (
     <div data-testid="monaco-editor" data-readonly={String(options?.readOnly ?? false)}>
       <textarea
```

`src/renderer/src/components/__tests__/EditorPanel.applyOutput.test.tsx`（新規。全文）:

````tsx
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  mockEditor,
  mockEditorModel,
  mockFocus
} from '../../__tests__/__mocks__/@monaco-editor/react'
import type { MockSelection } from '../../__tests__/__mocks__/@monaco-editor/react'
import type { OpenedFileEvent } from '../../hooks/useFileSystem'
import type { OpenFile } from '../../types'
import type { DiffTabKey } from '../../hooks/useDiffTabs'
import EditorPanel from '../EditorPanel'
import { makeConflictFileState } from '../../__tests__/makeConflictFileState'
import { APPLY_DISABLED_REASONS } from '../../hooks/useApplyOutputToEditor'

// EditorPanel.test.tsx と同じく、dnd-kit は jsdom 上でクリックの伝播を阻害するためモックする
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => [])
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: {},
  horizontalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false
  })
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } }
}))

// 偽のエディタ(@monaco-editor/react のモック)を通した配線の確認。実物の Monaco での undo・改行コード・
// カーソルは applyToEditor.monaco.test.ts、実機では manual-test-spec の APL で確かめる
const file: OpenFile = {
  path: '/project/src/index.ts',
  name: 'index.ts',
  content: 'const x = 1',
  savedContent: 'const x = 1',
  language: 'typescript'
}

const RESULT = '例です\n\n```ts\nconst y = 2\n```'

const onChangeContent = vi.fn<(content: string) => void>()

const baseProps = {
  openFiles: [file] as OpenFile[],
  activeFilePath: file.path as string | null,
  isDirty: false,
  isSaving: false,
  saveError: null as Error | null,
  onChangeContent,
  onSave: vi.fn(),
  onActivateTab: vi.fn(() => true),
  onCloseTab: vi.fn(),
  onReorderTabs: vi.fn(),
  isExecuting: false,
  result: RESULT as string | null,
  streamingText: '',
  executionError: null as Error | null,
  onClearResult: vi.fn(),
  onCancelExecution: vi.fn(),
  isOverlayOpen: false,
  openedFileSignal: { events: [] as OpenedFileEvent[] },
  diffTabs: [] as DiffTabKey[],
  activeDiffTab: null as DiffTabKey | null,
  onActivateDiffTab: vi.fn(),
  onCloseDiffTab: vi.fn(),
  onDeactivateDiffTab: vi.fn(),
  diffContent: null as string | null,
  diffStaged: false,
  diffError: null as Error | null,
  isHunkOperationInProgress: false,
  onStageHunk: vi.fn(),
  onUnstageHunk: vi.fn(),
  onDiscardHunk: vi.fn(),
  canDiscardHunk: false,
  isActiveFileUntracked: false,
  isActiveFileConflicted: false,
  conflictFile: makeConflictFileState(),
  isConflictBlocked: false
}

const select = (selection: MockSelection): void => {
  act(() => mockEditor.current?.select(selection))
}

const range = (startColumn: number, endColumn: number): MockSelection => ({
  startLineNumber: 1,
  startColumn,
  endLineNumber: 1,
  endColumn,
  positionLineNumber: 1,
  positionColumn: endColumn
})

const headerButton = (name: RegExp): HTMLElement =>
  within(document.querySelector('.output-panel__header') as HTMLElement).getByRole('button', {
    name
  })

const codeBlockButton = (name: RegExp): HTMLElement =>
  within(document.querySelector('.code-block') as HTMLElement).getByRole('button', { name })

beforeEach(() => {
  onChangeContent.mockReset()
})

describe('EditorPanel — 出力のエディタへの反映', () => {
  it('コードブロックの「挿入」で、カーソル位置にコードが入った内容を onChangeContent に渡し、エディタへフォーカスを戻す', async () => {
    const user = userEvent.setup()
    render(<EditorPanel {...baseProps} />)
    select(range(12, 12))
    mockFocus.mockClear()

    await user.click(codeBlockButton(/^挿入/))

    expect(onChangeContent).toHaveBeenCalledWith('const x = 1const y = 2')
    expect(mockEditor.current?.pushUndoStop).toHaveBeenCalledTimes(2)
    expect(mockFocus).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('挿入しました')
  })

  it('選択範囲があるときの「置換」で、選択範囲を置き換えた内容を onChangeContent に渡す', async () => {
    const user = userEvent.setup()
    render(<EditorPanel {...baseProps} />)
    // 「x」を選ぶ
    select(range(7, 8))

    await user.click(codeBlockButton(/^置換/))

    expect(onChangeContent).toHaveBeenCalledWith('const const y = 2 = 1')
    expect(screen.getByRole('status')).toHaveTextContent('置換しました')
  })

  it('ヘッダーの「挿入」は出力全体(Markdown の原文)を入れる', async () => {
    const user = userEvent.setup()
    render(<EditorPanel {...baseProps} />)

    await user.click(headerButton(/^挿入/))

    expect(onChangeContent).toHaveBeenCalledWith(`${RESULT}const x = 1`)
  })

  it('選択範囲が空の間は「置換」が無効で、選ぶと有効になる', () => {
    render(<EditorPanel {...baseProps} />)
    expect(headerButton(/^置換/)).toBeDisabled()
    expect(headerButton(/^置換/)).toHaveAccessibleDescription(APPLY_DISABLED_REASONS.noSelection)

    select(range(1, 6))

    expect(headerButton(/^置換/)).toBeEnabled()
    expect(codeBlockButton(/^置換/)).toBeEnabled()
  })

  it('ファイルを開いていない(Welcome)ときは無効', () => {
    render(<EditorPanel {...baseProps} openFiles={[]} activeFilePath={null} />)

    expect(headerButton(/^挿入/)).toBeDisabled()
    expect(headerButton(/^挿入/)).toHaveAccessibleDescription(APPLY_DISABLED_REASONS.noEditor)
  })

  it('diff タブをアクティブにすると無効になり、ファイルのタブへ戻ると有効になる', () => {
    const diff = { path: 'src/index.ts', staged: false }
    const { rerender } = render(<EditorPanel {...baseProps} diffTabs={[diff]} />)
    expect(headerButton(/^挿入/)).toBeEnabled()

    rerender(
      <EditorPanel
        {...baseProps}
        diffTabs={[diff]}
        activeDiffTab={diff}
        diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
      />
    )
    expect(headerButton(/^挿入/)).toBeDisabled()
    expect(headerButton(/^挿入/)).toHaveAccessibleDescription(APPLY_DISABLED_REASONS.noEditor)

    rerender(<EditorPanel {...baseProps} diffTabs={[diff]} />)
    expect(headerButton(/^挿入/)).toBeEnabled()
  })

  it('ファイルを切り替えると、新しいファイルのエディタへ反映する(選択範囲の状態も新しいエディタのもの)', async () => {
    const user = userEvent.setup()
    const other: OpenFile = { ...file, path: '/project/b.ts', name: 'b.ts', content: 'b' }
    const { rerender } = render(<EditorPanel {...baseProps} openFiles={[file, other]} />)
    select(range(1, 6))
    expect(headerButton(/^置換/)).toBeEnabled()

    rerender(<EditorPanel {...baseProps} openFiles={[file, other]} activeFilePath={other.path} />)
    expect(headerButton(/^置換/)).toBeDisabled()

    await user.click(headerButton(/^挿入/))
    expect(onChangeContent).toHaveBeenCalledWith(`${RESULT}b`)
  })

  it('マウントの時点でモデルが無い(破棄済み)エディタは反映先にしない', () => {
    mockEditorModel.current = null
    render(<EditorPanel {...baseProps} />)

    expect(headerButton(/^挿入/)).toBeDisabled()
  })

  it('実行中は挿入・置換を出さない', () => {
    render(<EditorPanel {...baseProps} isExecuting={true} />)

    expect(screen.queryByRole('button', { name: /^(挿入|置換)/ })).not.toBeInTheDocument()
  })
})
````

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run src/renderer/src/components/__tests__
```

Expected: `EditorPanel.applyOutput.test.tsx` だけが FAIL（9 件中 8 件。`EditorPanel` が `applyOutput` を渡さないため、ボタンもコードブロックも無い。「実行中は挿入・置換を出さない」の 1 件は通る）。既存の `EditorPanel.test.tsx`・`App*.test.tsx` 等は拡張したモックで変更なしで通る

- [ ] **Step 3: 実装する**

`src/renderer/src/components/EditorPanel.tsx`（変更。差分）:

```diff
--- a/src/renderer/src/components/EditorPanel.tsx
+++ b/src/renderer/src/components/EditorPanel.tsx
@@ -4,6 +4,7 @@
 import { registerSaveCommand } from '../lib/editorShortcuts'
 import { useLatestRef } from '../hooks/useLatestRef'
 import { useEditorFocusManager } from '../hooks/useEditorFocusManager'
+import { useApplyOutputToEditor } from '../hooks/useApplyOutputToEditor'
 import type { OpenFile } from '../types'
 import WelcomeView from './editor/WelcomeView'
 import EditorTabs from './editor/EditorTabs'
@@ -114,6 +115,9 @@
     openedFileSignal,
     isOverlayOpen
   })
+  // 出力パネルからの反映先は、現在のファイルのエディタ(onMount で渡す)。diff タブ・Welcome・ファイルを
+  // 閉じたときはエディタが破棄され、反映先から外れる
+  const { applyOutput, attachEditor } = useApplyOutputToEditor({ isExecuting })

   const { combinedTabs, activeTabPath, handleActivateTab, handleCloseTab } = useCombinedEditorTabs({
     openFiles,
@@ -189,6 +193,7 @@
                 onMount={(editorInstance, monaco) => {
                   const isCurrent = handleEditorMount(editorInstance, openFile.path)
                   if (!isCurrent) return
+                  attachEditor(editorInstance)
                   registerSaveCommand(editorInstance, monaco, () => onSaveRef.current())
                   focusEditorIfPending()
                 }}
@@ -210,6 +215,7 @@
         executionError={executionError}
         onClear={onClearResult}
         onCancel={onCancelExecution}
+        applyOutput={applyOutput}
       />
     </div>
   )
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run src/renderer/src/components src/renderer/src/hooks
npm run typecheck
npx eslint src/renderer/src/components/EditorPanel.tsx src/renderer/src/__tests__/__mocks__/@monaco-editor/react.tsx src/renderer/src/components/__tests__/EditorPanel.applyOutput.test.tsx
npx prettier --check src/renderer/src/components/EditorPanel.tsx src/renderer/src/__tests__/__mocks__/@monaco-editor/react.tsx src/renderer/src/components/__tests__/EditorPanel.applyOutput.test.tsx
```

Expected: PASS（`EditorPanel.applyOutput.test.tsx` 9 件。既存のテストはすべて変更なしで通る）。typecheck・eslint・prettier が通る（`EditorPanel.tsx` の `editorInstance`（`IStandaloneCodeEditor`）が `TrackedEditor` を満たすことは typecheck で確かめる）

- [ ] **Step 5: 変異で検知力を確かめる**

対象は `src/renderer/src/components/EditorPanel.tsx`、テストは `EditorPanel.applyOutput.test.tsx`。

| #   | 変異                                                | `-t`                           |
| --- | --------------------------------------------------- | ------------------------------ |
| E1  | `attachEditor(editorInstance)` の行を消す           | `コードブロックの「挿入」で`   |
| E2  | `OutputPanel` の `applyOutput={applyOutput}` を消す | `ヘッダーの「挿入」は出力全体` |

Expected: 各変異でファイル全体と `-t` 単独の両方が FAIL。復元後に `cmp` が一致

（参考: `attachEditor` を `handleEditorMount` の前に呼ぶ変異は、このテストでは検出しない。モックの `onMount` は同期で届き、現在のファイルでないエディタはアンマウントで破棄済み（`getModel()` が null）になっているため、`attachEditor` 自身の確認で弾かれ、結果が同じになる。順序は `handleEditorMount` が true のときだけ呼ぶ形で固定する）

- [ ] **Step 6: Commit（ユーザーの許可がある場合のみ。SDD 中は行わない）**

---

### Task 7: ROADMAP の更新・テスト仕様書への追記・全体検証

**Files:**

- Modify: `ROADMAP.md`, `docs/manual-test-spec.md`, `docs/superpowers/specs/2026-10-04-apply-output-to-editor-design.md`（実装で変わった点があれば）
- 生成: `.superpowers/manual-test-spec.html`（git 管理外）

**Interfaces:**

- Consumes: Task 1〜6 の実装（文言は実装のファイルと突き合わせる。パターン 65・89）
- Produces: ROADMAP の実装済みの項目・見送り項目・既知の制約・整理、実機テスト仕様書の領域 `APL`

- [ ] **Step 1: ROADMAP を更新する**

1. 「実装済み機能 → エクスプローラー（ファイル編集の起点）」の `- [x] ファイル / フォルダの新規作成・リネーム・削除（…）` の直後に追加（差異 19）:

```markdown
- [x] クイックオープン（Ctrl/Cmd+P でファイル名をあいまい検索して開く。PR #28）
```

2. 「実装済み機能 → Claude API 連携（プロンプト実行）」の `- [x] CLI 経由でのプロンプト実行（`cliService`）` の直後に追加（差異 19）:

```markdown
- [x] レスポンスのストリーミング表示（実行中は届いた分を出力パネルに等幅のテキストで逐次表示し、完了後に Markdown として
      整形する。Claude API・CLI の両方。PR #25）
```

3. 「実装済み機能 → 出力（実行結果の確認）」の `- [x] テーブルの横スクロール対応` の直後に追加:

```markdown
- [x] 結果のエディタへの反映（出力パネルのヘッダーの「挿入」「置換」で出力全体を、各コードブロックの見出しの「挿入」「置換」で
      そのコードの原文を、開いているファイルのカーソル位置へ挿入・選択範囲と置換する。Monaco の編集として 1 回の undo で
      戻せ、タブは未保存になる（自動保存しない）。反映後はエディタへフォーカスを戻し、結果を読み上げる。実行中・diff タブ・
      ファイルを開いていないときは押せず、理由を表示する）
```

4. 「今後実装した方がよい機能 → 結果の活用 / エディタ連携」の 4 行を、次の 3 行に置き換える（`結果をエディタ / ファイルに挿入` と `選択範囲を AI 出力で置換` を消し、見送りを足す。`結果から新規ファイル / プロンプトを作成` はそのまま残す）:

置き換える前:

```markdown
- [ ] 結果をエディタ / ファイルに挿入
- [ ] 出力を差分として適用（diff apply）
- [ ] 選択範囲を AI 出力で置換
- [ ] 出力コードをそのまま実行（コードランナー）
```

置き換えた後:

```markdown
- [ ] 出力を差分として適用（diff apply）
- [ ] 反映の拡張（反映前の変更前後の差分プレビュー、インデントの自動調整、複数カーソルへの反映、開いていないファイルへの反映）
- [ ] 出力コードをそのまま実行（コードランナー）
```

5. 未実装の一覧から、次の 3 行を消す（差異 19）: 「ファイル / ワークスペース管理」の `- [ ] クイックオープン（ファイル名であいまい検索して開く）`、「AI 実行（Claude）高度化」の `- [ ] レスポンスのストリーミング表示`、「出力 / 結果」の `- [ ] レスポンスのストリーミング表示`

6. 「改善・技術的負債」の末尾（clone の既知の制約の後）に追加（設計書の「既知の制約」と 1 対 1。同じ文・同じ順・同じ 8 項目）:

```markdown
- [ ] 既知の制約（AI 出力のエディタへの反映。設計書 `docs/superpowers/specs/2026-10-04-apply-output-to-editor-design.md` の「既知の制約」と 1 対 1）:
  - diff タブ・コンフリクトの解決ビューには反映できない（ファイルのタブへ切り替えてから反映する）
  - 実行中（逐次出力の表示中）は反映できない。実行中は出力を Markdown として表示しないため、ボタンも出さない（完了後に反映する）
  - 反映したテキストのインデントは調整しない（カーソル位置の既存のインデントと合わない場合がある）
  - 複数カーソルのときは、主カーソル（最初に置いたカーソル）の位置・選択範囲だけを対象にする
  - diff タブへ切り替えるとエディタが破棄されるため、反映を含む undo の履歴は失われる（既存の挙動。内容は保持される）
  - 出力全体の反映は、Markdown の原文（コードフェンス・見出しの記号を含む）をそのまま入れる
  - 無効なボタンは disabled のため Tab で止まらない。理由はホバーの title・出力パネルのヘッダーの表示・aria-describedby で示す
  - 「onChange → value の再同期で内容・カーソル・undo を壊さない」ことは、プラン作成時に実物の @monaco-editor/react 4.7.0 で実測し、自動テストには入れていない（vitest の alias がモックへ向けているため）。ライブラリを更新したときは APL の項目で確かめる
```

ROADMAP と設計書の既知の制約が一致することを確かめる（パターン 115）:

```bash
diff <(sed -n '/^- \[ \] 既知の制約（AI 出力のエディタへの反映/,$p' ROADMAP.md | grep '^  - ' | sed 's/^  - //') <(sed -n '/^## 既知の制約/,/^## /p' docs/superpowers/specs/2026-10-04-apply-output-to-editor-design.md | grep '^- ' | sed 's/^- //') && echo SAME
grep -n "クイックオープン\|ストリーミング表示\|エディタへの反映\|結果をエディタ\|AI 出力で置換" ROADMAP.md
npx prettier --check ROADMAP.md
```

Expected: `SAME`。grep は実装済みの 3 項目（クイックオープン・ストリーミング・反映）と既知の制約の見出しだけを出し、`結果をエディタ` と `AI 出力で置換` は出ない。prettier が通る（通らなければ `npx prettier --write ROADMAP.md`）

- [ ] **Step 2: 実機テスト仕様書に追記する**

`docs/manual-test-spec.md` の `## 出力` の領域の最後（`OUT-040` の後、`## ソース管理（基本）` の前）に、次の領域を追加する。書式は仕様書の冒頭と `scripts/build-manual-test-spec.mjs` に従う（1 行 1 項目、ID は `APL-001` から昇順、手順と期待結果は最初の「→」で区切る。ID は以後変えない）。文言は実装（`CodeBlock` / `OutputPanel` / `useApplyOutputToEditor` の `APPLY_DISABLED_REASONS`・`APPLY_NOTICES`）と突き合わせて確認する（パターン 65・89）。手順は、偽のエディタでは確かめられないもの（実際の Monaco での undo・dirty・選択範囲・フォーカス・タッチ・CRLF・読み上げ）を中心にする。

```markdown
## AI 出力のエディタへの反映

> 前提: 【要 API キー】フォルダを開き、テキストファイル(例: `memo.ts`。中身は `const a = 1` と `const b = 2` の 2 行)をエディタで開いておく。プロンプトに「次の Markdown をそのまま返して」と書き、その後に `説明` の段落・言語 `ts` のコードブロック(中身 `const x = 1`)・言語なしのコードブロック(中身 `plain`)・中身の無い言語 `js` のコードブロックを続けて実行し、結果を出力パネルに表示する(応答を制御できる `Claude CLI` でもよい)。
> 前提: 各項目は、特に断りがなければ、この結果を表示し、エディタで `memo.ts` を開いた状態から始める。反映の後は Cmd+Z で元に戻してから次の項目へ進む。

### 表示と押せる条件

- [ ] **APL-001** 結果を表示し、エディタでは何も選択していない状態で出力パネルを見る → `ts` と `コード` のコードブロックの上に、言語名と `挿入`・`置換` が表示される。ヘッダーには `挿入`・`置換`・`クリア` が並び、`置換` はすべて押せず(薄く表示)、ヘッダーに `選択範囲がありません` と表示される
- [ ] **APL-002** APL-001 の中身の無い `js` のコードブロックを見る → 言語名 `js` だけが表示され、`挿入`・`置換` は無い
- [ ] **APL-003** `挿入`・`置換` のボタンの大きさを見る → どれも 32px 四方以上で、枠付きのボタンとして表示される。コードブロックの見出しとコードの背景は隙間なくつながる
- [ ] **APL-004** 押せない `置換` にマウスカーソルを合わせる → `選択範囲がありません` のツールチップが出る
- [ ] **APL-005** エディタで `const` を選択する → ヘッダーの `選択範囲がありません` が消え、`置換` がすべて押せるようになる。選択を解除すると押せなくなる
- [ ] **APL-006** 長い回答を返させるプロンプトを実行し、実行中の出力パネルを見る → `挿入`・`置換` は表示されず、`キャンセル` だけがある(完了するとボタンが出る)
- [ ] **APL-007** タブをすべて閉じて Welcome 表示にする → `挿入`・`置換` はすべて押せず、ヘッダーに `反映先のファイルが表示されていません` と表示される
- [ ] **APL-008** 【要 Git リポジトリ】変更のあるファイルを `ソース管理` から開いて diff タブをアクティブにする → `挿入`・`置換` は押せず `反映先のファイルが表示されていません` と表示される。`memo.ts` のタブへ戻すと `挿入` が押せる

### 挿入

- [ ] **APL-009** `memo.ts` の 1 行目の末尾(`1` の後ろ)をクリックしてカーソルを置き、`ts` のコードブロックの `挿入` を押す → 1 行目が `const a = 1const x = 1` になり、カーソルは挿入した `const x = 1` の末尾にあり、そのまま文字を入力できる(エディタにフォーカスが戻る)。タブが未保存の表示になり、ヘッダーに `挿入しました` が数秒表示されて消える。ディスクのファイルは変わらない(保存はしない)
- [ ] **APL-010** APL-009 の後、Cmd+Z を 1 回押す → 挿入の前の内容に戻る(挿入した文字列が 1 文字ずつではなく一度に消える)。Cmd+Shift+Z で再び挿入される
- [ ] **APL-011** 1 行目の `a = 1` を左から右へドラッグして選択し、`ts` のコードブロックの `挿入` を押す → 選択していた `a = 1` は残り、その後ろ(カーソルのあった位置)に `const x = 1` が入る。選択は解除され、カーソルは挿入した文字列の末尾にある
- [ ] **APL-012** 2 行目の先頭にカーソルを置き、ヘッダーの `挿入` を押す → 出力全体の Markdown の原文(`説明` の段落と、バッククォート 3 つのフェンスと言語名を含むコードブロック)がそのまま入る
- [ ] **APL-013** `memo.ts` の末尾にカーソルを置き、ヘッダーの `挿入` を押してから Cmd+S で保存し、端末で `cat` で中身を見る → 画面の内容と同じ内容が保存されている

### 置換

- [ ] **APL-014** 1 行目の `a = 1` を選択し、`ts` のコードブロックの `置換` を押す → 1 行目が `const const x = 1` になり、カーソルは置き換えた文字列の末尾にある。タブが未保存になり、ヘッダーに `置換しました` が数秒表示されて消える
- [ ] **APL-015** APL-014 の後、Cmd+Z を 1 回押す → 置換の前の内容に戻り、`a = 1` が選択された状態に戻る
- [ ] **APL-016** 2 行にまたがって選択し、言語なしのコードブロックの `置換` を押す → 選択範囲が `plain` に置き換わる(コードブロックの末尾の改行は入らない)
- [ ] **APL-017** 1 行目の `a` をダブルクリックで選択し、Option を押しながら 2 行目の行末をクリックしてカーソルを足してから、`ts` のコードブロックの `置換` を押す → 最初に選んだ `a` だけが `const x = 1` に置き換わり、2 行目の行末には何も入らない

### 改行コード・切り替え

- [ ] **APL-018** 改行コードが CRLF のファイル(開いたフォルダの中で、端末から `printf 'a\r\nb\r\n' > crlf.txt` で作る)を開き、1 行目の末尾にカーソルを置いてヘッダーの `挿入` を押し(複数行の Markdown が入る)、Cmd+S で保存して端末で `od -c crlf.txt | head` を見る → 挿入した部分の改行もすべて `\r \n` になっている(`\n` だけの改行が混ざらない)
- [ ] **APL-019** `memo.ts` で範囲を選択した後、別のファイルのタブへ切り替える → `置換` が押せなくなる(新しいタブでは何も選択していない)。そのタブで `挿入` を押すと、切り替えた先のファイルに入る

### キーボード・タッチ・読み上げ

- [ ] **APL-020** エディタで `const` を選択し、Tab キーで出力パネルの `置換` までフォーカスを移して Enter を押す → 選択範囲が置き換わり、フォーカスがエディタに戻る(フォーカスを移しても選択は失われない)
- [ ] **APL-021** タッチ操作のできる環境で、エディタの範囲を指で選択してから、コードブロックの `置換` をタップする → 選択範囲が置き換わる(タップで選択が失われない)
- [ ] **APL-022** VoiceOver を有効にして、コードブロックの `挿入` を 2 回続けて押す → 2 回とも `挿入しました` が読み上げられる。ボタンは `挿入（このコードブロックをカーソル位置へ）` と読み上げられる
- [ ] **APL-023** 出力パネルの `クリア` を押してから、もう一度同じプロンプトを実行する → 出力パネルが閉じ、再実行の完了後に `挿入`・`置換` が再び表示される
```

```bash
node scripts/build-manual-test-spec.mjs
npx vitest run scripts
npx prettier --check docs/manual-test-spec.md
grep -c '^- \[ \] \*\*APL-' docs/manual-test-spec.md
```

Expected: 生成が `17 領域 / 912 項目` を出す（追記前は 16 領域・889 項目）。`scripts` のテスト（24 件）が通る（ID の一意性・接頭辞ごとの昇順・書式）。prettier が通る。APL は 23 項目

- [ ] **Step 3: 全体を検証する**

```bash
npm test
npm run typecheck
git diff --name-only --diff-filter=d | grep -E '\.(tsx?|mjs)$' | xargs npx eslint
git ls-files --others --exclude-standard | grep -E '\.(tsx?|mjs)$' | xargs npx eslint
(git diff --name-only --diff-filter=d; git ls-files --others --exclude-standard) | xargs npx prettier --check
python3 -c "import subprocess,sys;fs=subprocess.check_output(['git','ls-files','-m','-o','--exclude-standard','src']).decode().split();bad=[f for f in fs if chr(0x200b) in open(f,encoding='utf-8').read()];print(bad or 'no zwsp');sys.exit(1 if bad else 0)"
git status -s --untracked-files=all
git branch --show-current
```

Expected: すべて成功（`npm test` は 322 ファイル・6034 件。適用前は 314 ファイル・5942 件）。ソースに実際のゼロ幅スペースの文字が無い（`no zwsp`）。`git status` に、この機能に関係ないファイルや一時ファイル（変異の退避先など）が無いこと（`.superpowers/` は git 管理外）。ブランチは `feat/apply-output-to-editor`

- [ ] **Step 4: Artifact を再公開する（CLAUDE.md のルール）**

`.superpowers/manual-test-spec.html` を同じファイルパス・同じ URL（<manual-test-spec-artifact-url>）で再公開する。これはコントローラー（親エージェント）が行う（実装者のサブエージェントは行わない）。

- [ ] **Step 5: Commit（ユーザーの許可がある場合のみ）**

## Self-Review

**Spec coverage:**

- コードブロックの見出し（言語名・挿入・置換・32px・空のブロック）と原文（フェンスと言語名を除き、末尾の改行を 1 つ除く）: Task 2・Task 4・Task 5（CSS）
- 出力全体の挿入・置換（Markdown の原文）: Task 5
- 挿入（カーソル位置）・置換（選択範囲）・1 回の undo・カーソルを末尾へ・フォーカスを戻す・改行コード・モデル破棄済み・拒否: Task 1
- 有効になる条件（エディタのマウント・実行中・選択範囲）と無効の理由（`title`・`aria-describedby`・ヘッダーの表示）・ファイルの切り替え・diff タブ: Task 3・Task 4・Task 5・Task 6
- 通知（`role="status"`・同じ文言の読み上げ直し・3 秒で消える・タイマーの解除）: Task 3・Task 5
- dirty になる（`onChangeContent` が呼ばれる）・`useEditorFocusManager` を変えない: Task 6
- 設計書の確認事項 1〜8 の実測と、食い違いの本文への反映: 設計書（確認の結果）・差異 1〜20
- ROADMAP（実装済みへの移動・見送り・既知の制約・クイックオープンとストリーミングの整理）・実機テスト仕様書（`APL-001`〜`APL-023`）・全体検証・Artifact の再公開（親）: Task 7

**Placeholder scan:** TBD / TODO / 「同様に」なし。各タスクのテストと実装のコードは、新規のファイルは全文、既存のファイルは全文か差分（`diff -u` の出力）で示した。`types.ts` は Task 1・Task 3 の追記と、最終的な差分を示した。変異は、置き換える前と後の式と、落ちるテストを表にした。プランの整形（prettier）で、差分の空の文脈行の行頭の空白が落ちている（差分は `git apply` せず読んで当てる。全文を載せたファイルは全文に従う。全文と差分は、検証用の写しのファイルからプランへ機械的に埋め込み、整形の後も行末の空白を除いて一致することを確かめた）。

**Type consistency:** `ApplyMode`・`ApplySelection`・`ApplyTargetEditor`・`ApplyResult`・`applyToEditor`・`isEmptySelection`（Task 1）→ `CodeBlockSource`・`getCodeBlockSource`（Task 2）→ `ApplyNotice`・`ApplyOutputState`・`TrackedEditor`・`useApplyOutputToEditor`・`APPLY_DISABLED_REASONS`・`APPLY_NOTICES`・`APPLY_NOTICE_DURATION_MS`（Task 3）→ `CodeBlockActions`・`CodeBlockActionsContext`・`CodeBlock`・`MarkdownRenderer` の `codeBlockActions`（Task 4）→ `OutputPanel` の `applyOutput`・`makeApplyOutputState`（Task 5）→ `EditorPanel` の配線・`mockEditor`・`MockSelection`（Task 6）。`IStandaloneCodeEditor` が `TrackedEditor` を満たすことは Task 6 の typecheck で確かめる（プラン作成時に確認済み）。

**既存の名前の確認:** プランが使う既存の名前はすべて現行のコードで確認した: `EditorPanel` の props（`isExecuting`・`result`・`streamingText`・`executionError`・`onClearResult`・`onCancelExecution`・`onChangeContent`・`openFiles`・`activeFilePath`・`diffTabs`・`activeDiffTab`・`diffContent` など）と `Editor` の `key={openFile.path}`・`onMount`、`useEditorFocusManager` の `handleEditorMount`（現在のファイルでない・モデルが無いときに false）・`focusEditorIfPending`・`editorRef`、`useLatestRef`、`registerSaveCommand`、`OutputPanel` の props（`isExecuting`・`result`・`streamingText`・`executionError`・`onClear`・`onCancel`）と CSS の `.output-panel__header`・`__title`・`__clear-btn`・`__cancel-btn`・`__content`、`MarkdownRenderer` の `components`（`a`・`img`・`table`）と `HistoryDetail.tsx` からの利用、`ConflictResolver` の通知（`announcement`・ゼロ幅スペース）、`main.css` の共通の枠付きボタンの 3 つのグループセレクタ、`App.tsx` の `EditorPanel` への配線（変えない）、`useFileEditing.updateFileContent`（`onChangeContent` の実体）、`editorOptions`（`readOnly` なし）、モックの `mockAddCommand`・`mockFocus`・`mockEditorModel`、`makeConflictFileState`、`DiffTabKey`、`OpenedFileEvent`、`vitest.config.ts` の alias、`scripts/build-manual-test-spec.mjs`。

**検証の記録:** プラン作成時に、リポジトリの追跡ファイルを scratchpad の検証用の写し（`git ls-files` を rsync。`node_modules` はリンク）へ写し、Task 1〜6 のコードを順に当て直して、各タスクの Step 2 の失敗（件数を各タスクに記載）と Step 4 の成功・typecheck を確認した。最終の状態で `npx vitest run`（322 ファイル・6034 件。適用前の現行のリポジトリは 314 ファイル・5942 件）・`npm run typecheck`・変更したファイルへの `npx eslint` と `npx prettier --check` が通ることを確認した。追加・変更したテスト（9 ファイル・146 件）は `--sequence.shuffle` の seed 1〜5 で通り、実物の Monaco と `EditorPanel`・フックのテストは 3 本同時に流しても通った。各タスクの Step 5 の変異は、表のすべてを検証用の写しで 1 つずつ入れ、ファイル全体と `-t` 単独の両方で落ちることを確認した（生き残った K2・C5 に合わせてテストを直した後の結果。差異 20）。Task 7 の仕様書の追記と ROADMAP の更新も写しに適用し、`npx vitest run scripts`（24 件）・`node scripts/build-manual-test-spec.mjs`（17 領域・912 項目）・`npx prettier --check` が通ることを確認した。実機（Electron）での確認はしていない（実機テスト仕様書の `APL-001`〜`APL-023`）。
