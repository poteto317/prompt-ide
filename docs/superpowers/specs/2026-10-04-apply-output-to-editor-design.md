# AI 出力のエディタへの挿入・置換 設計書

作成日: 2026-10-04 / 対象: ROADMAP の「結果をエディタ / ファイルに挿入」「選択範囲を AI 出力で置換」のうち、コードブロック単位の挿入と置換

## 目的

「プロンプトの実行から編集までを、別画面を開かずアプリの中で完結する」というコンセプトに対し、実行結果（`OutputPanel`）をエディタへ反映する手段が無く、結果のコードを
コピーしてエディタに貼り付ける手間があった。出力のコードブロックを、開いているファイルのカーソル位置への挿入、または選択範囲の置換として、ワンタップで反映できるようにする。

## 範囲

### 含める

- 出力パネルの各コードブロックの上に、言語名と `挿入`・`置換` のボタンを常時表示する（タッチ操作を前提に 32px 四方以上）。中身の無いコードブロックには言語名だけを出し、ボタンを出さない（確認事項の検討で追加）
- 出力パネルのヘッダーに、出力全体（Markdown の原文）に対する `挿入`・`置換` のボタンを置く（結果が空のときは出さない）
- `挿入`: 開いているファイルのカーソル位置にテキストを挿入する。`置換`: 選択範囲をテキストで置き換える（選択が空のときは無効）
- 反映は Monaco の編集操作として行い、undo の履歴に 1 回分として積む。反映後にタブが未保存（dirty）になる。保存は自動で行わない
- 反映後はエディタにフォーカスを戻し、`挿入しました` / `置換しました` を `role="status"` で通知する

### 含めない（ROADMAP に見送り項目として残す）

- 変更前後の差分プレビュー、出力を差分として適用（diff apply）
- 出力コードの実行（コードランナー）、結果から新規ファイル・プロンプトを作成
- インデントの自動調整、複数カーソルへの反映、diff タブ（読み取り専用）への反映
- ストリーミング中の反映（実行中は無効）

## 設計の前提（利用者の決定）

- 範囲は「コードブロック単位で、カーソル位置に挿入／選択範囲を置換」。差分プレビューは見送り
- 反映は Monaco の編集操作（undo で戻せる）。自動保存はしない

## 振る舞い

### 有効になる条件

- `挿入`: 現在のファイルのエディタ（Monaco）がマウントされていて、実行中でない（`isExecuting` が false）。diff タブ・コンフリクトの解決ビュー・Welcome 表示・非アクティブな diff タブだけが残っている状態・エディタのマウント前は、ファイルのエディタが無いので無効（確認事項の結果で変更: 条件は「アクティブなファイルの有無」ではなく、エディタのマウントと破棄から追う）
- `置換`: 上に加えて、主カーソルの選択範囲が空でない
- 無効のとき、理由を `title` と `aria-describedby` で示し、出力パネルのヘッダーにも表示する（タッチ操作では `title` が出ないため。確認事項の検討で追加）。文言は `反映先のファイルが表示されていません`（エディタが無い）・`実行中は反映できません`・`選択範囲がありません`（確認事項の検討で確定。当初の例は `ファイルを開いていません`。diff タブ・マウント前も同じ理由で表すため変更）。理由の優先順位は「エディタが無い → 実行中 → 選択範囲が無い」。無効な操作は何もしない
- 実行中は結果を Markdown として表示しない（逐次出力を等幅のテキストで出す既存の作り）ため、挿入・置換のボタン自体を出さない（確認事項の結果で変更）。`実行中は反映できません` はフックが防御として持つ

### 反映するテキスト

- コードブロック: コードの原文（フェンスと言語名を除く。末尾の改行は 1 つだけ除く）。表示用の整形（ハイライト・空白の正規化）の影響を受けない原文を使う。原文は react-markdown が `pre` に渡す hast の要素（`node`）の `code` の子のテキストから取り出す（mdast-util-to-hast は中身があれば末尾に改行を 1 つ足すため、それを 1 つだけ除く。中の末尾の空行は残す）
- 出力全体: 実行結果の Markdown の原文（`result`）
- 改行コードは、エディタのモデルの改行コード（`\n` / `\r\n`）に Monaco が合わせて変換する（実測で確認）

### 反映の手順（`applyToEditor`）

1. エディタのモデルが無ければ何もしない（破棄済みインスタンスの遅延呼び出しへの対策）。選択範囲が取れなければ何もしない
2. `挿入`: 主カーソルの位置（`positionLineNumber`・`positionColumn`）に空の範囲を作る。選択範囲があっても、選択された文字列は残し、カーソルの位置に挿入する（確認事項の結果で変更: 当初は「選択範囲の開始位置（カーソル位置）」。前向きの選択ではカーソルは選択の終わりにあり、開始とは違う）。`置換`: 主カーソルの選択範囲（空なら何もしない）
3. `pushUndoStop()` → `executeEdits('apply-output', [{ range, text, forceMoveMarkers: true }], endCursorState)` → `pushUndoStop()`。これで 1 回の undo で元に戻る（前の `pushUndoStop` が無いと、直前の入力とまとめて戻ることを実測で確認）
4. 反映後のカーソルは挿入したテキストの末尾に置き、選択を解除する。末尾の位置は `endCursorState` のコールバックが受け取る逆向きの編集の範囲（改行コードの変換後の、挿入したテキストの範囲）の末尾から求め、コールバックはその位置の空の選択（素の `ISelection`）を返す（確認事項の結果で変更: `forceMoveMarkers` だけでは、選択範囲の終わりに挿入したときに選択が広がり、解除されない。コードレビュー 1 巡目で変更: 当初はコールバックが `null` を返し、編集の後に `setSelection` で置いていた。`setSelection` は undo の履歴に残らないため、undo → redo の後に反映したテキスト全体が選択された状態で戻り、続けて打鍵すると反映が消えていた。コールバックの戻り値は履歴の「編集の後のカーソル」に残るため、redo の後も末尾の空の選択に戻る）。編集の後は、その末尾が見えるように `revealPosition` でスクロールする（コードレビュー 2 巡目で追加: `executeEdits` は入力・貼り付けと違ってカーソルの位置までスクロールしないため、長い出力を入れると末尾とカーソルが画面の外に出たままだった。`revealPosition` は表示範囲の中なら動かさず、外なら最小限スクロールする。貼り付けと同じ動き。`revealPositionInCenterIfOutsideViewport` は末尾を画面の中央へ寄せ、貼り付けより大きく動くため使わない。実物の Monaco で実測）
5. `focus()` でエディタにフォーカスを戻す
6. Monaco が `onChange` を発火し、アプリの状態（`openFile.content`）が更新されてタブが dirty になる。アプリが `value` を制御していても、`@monaco-editor/react` は `value` が `getValue()` と同じなら何もしないため、内容・カーソル・undo の履歴は食い違わない（確認事項の結果で変更: 当初は結合テストで確かめるとしていたが、vitest の alias が `@monaco-editor/react` をモックへ向けているため、プラン作成時に実物で実測し、自動テストでは配線だけを確かめる）

### 通知

- 成功したら `挿入しました` / `置換しました`（`role="status"`）を出力パネルのヘッダーに表示し、3 秒後に消す（`APPLY_NOTICE_DURATION_MS`。タイマーは effect の後始末で解除し、テストでは偽のタイマーを `afterEach` で戻す。CLAUDE.md）
- 連続して同じ操作をしても毎回読み上げられるよう、通知の id を進め、偶数回目はゼロ幅スペース（U+200B）を付けて文字列を変える（パターン 87。確認事項の検討で変更: 当初は「通知の要素を作り直す」。ライブリージョンは要素が先に在る必要があるため、要素は出力パネルの表示中ずっと置き、文言だけを変える。`ConflictResolver` と同じ作り）
- Monaco が編集を拒否した（`executeEdits` が false）ときは `反映できませんでした` を同じ領域に出す（確認事項の結果で確定）
- 実行が始まったら（`isExecuting` が true）、表示中の通知を消す（コードレビュー 1 巡目で追加: 反映の直後にクリアして再実行すると、作り直された出力パネルの実行中のヘッダーに、前の反映の結果が最大 3 秒残っていた。パターン 87-1）。消すのは `useApplyOutputToEditor` が持つ状態で、描画で隠すだけにはしない（3 秒以内に完了すると前の通知が戻るため）
- ヘッダーは狭い幅でも 1 行に収め、高さ（41px）を変えない（PR #45 のレビュー 1 周目で追加: 反映の直後は通知と `選択範囲がありません` が必ず並び、ウィンドウ幅が約 730px 未満では通知・理由・タイトル・`クリア` が折り返して、ヘッダーが伸び本文が 3 秒間上下に動いていた）。通知・無効の理由は `white-space: nowrap` で 1 行にし、はみ出しは `…` で省略する。タイトル・`クリア`・`キャンセル` は `flex: none` で縮めない（`.editor-tabs__error`・`.editor-tabs__save-btn` と同じ扱い）。ヘッダーが 312px 以下（サイドバーを開いたままウィンドウ 600px 以下）では通知が画面上で見えなくなるが、`role="status"` の読み上げは残り、無効の理由は `title`・`aria-describedby` でも分かる（APL-027）

### フォーカスと a11y

- ボタンは `aria-label` を可視の文言で始める（パターン 76）。コードブロック: `挿入（このコードブロックをカーソル位置へ）`・`置換（選択範囲をこのコードブロックで）`。ヘッダー: `挿入（出力全体をカーソル位置へ）`・`置換（選択範囲を出力全体で）`（確認事項の検討で確定）
- コードブロックのボタンは、出力の Markdown の構造を壊さない（`pre` の外側のラッパーに置く）
- ボタンを押してもエディタの選択範囲を失わない（Monaco は非フォーカス時も選択状態を保持する。実測で、フォーカスの無いエディタへの `executeEdits` も成功する）。ボタンの `onMouseDown` で `preventDefault` しない（キーボード・タッチで通常のフォーカス移動を保つ）。エディタの選択は `getSelection()` で取得する
- 反映の状態が変わっても、コードブロックを作り直さない（押したボタンのフォーカスを保つ。`MarkdownRenderer` の `components` は定数にし、描画ごとに変わる反映の状態は context で渡す。確認事項の検討で追加）

## アーキテクチャ

### renderer

- `lib/applyToEditor.ts`（新規）: `applyToEditor(editor, mode, text): ApplyResult`（`'applied' | 'unavailable' | 'rejected'`）。エディタを最小のインターフェース `ApplyTargetEditor`（`getModel`・`getSelection`・`pushUndoStop`・`executeEdits`・`revealPosition`・`focus`。Monaco の `IStandaloneCodeEditor` が満たす。コードレビュー 1 巡目で `setSelection` を外し、2 巡目で `revealPosition` を足した。`executeEdits` の第 3 引数は、素の `ISelection[] | null` を返すコールバック。Monaco の型（`ICursorStateComputer | Selection[]`）と比べられるよう、コールバックはメソッドの形で宣言して双変にし、選択の配列も型に含める）で受け取る純粋に近い関数。`isEmptySelection`、`APPLY_EDIT_SOURCE = 'apply-output'`
- `lib/codeBlockSource.ts`（新規。当初の名前は `lib/extractCodeBlocks.ts`）: `getCodeBlockSource(pre)` が hast の `pre` 要素から `{ code, language }` を取り出す。hast の型は react-markdown の公開の型（`ExtraProps['node']`）から取る（hast はこのアプリの直接の依存ではない）
- `hooks/useApplyOutputToEditor.ts`（新規）: `useApplyOutputToEditor({ isExecuting })` が `{ applyOutput: ApplyOutputState, attachEditor }` を返す（確認事項の結果で変更: 当初は `editorRef` と有効条件を受け取り `{ canInsert, canReplace, disabledReason(mode), insert(text), replace(text), notice }` を返す形）。`ApplyOutputState = { insertDisabledReason, replaceDisabledReason, apply(mode, text), notice }`（`types.ts`）。反映先のエディタと選択範囲の有無を状態として持ち、`attachEditor` で `onDidChangeCursorSelection` と `onDidDispose` を購読する（`editorRef` は ref なので再描画を起こさない）。次のエディタの `attachEditor`・破棄の通知で購読を外す
- `components/output/codeBlockActions.ts`（新規）: `CodeBlockActionsContext`（値の型は `ApplyButtons.tsx` の `ApplyActions`）
- 単一責任のリファクタ（実装後、2026-10-04）で次を分けた: 反映先のエディタと選択範囲の追跡を `hooks/useTrackedEditorSelection.ts`（`TrackedEditor` の型も）、一定時間で消える通知を `hooks/useTransientNotice.ts`（通知の型は `Announcement` に改名）、無効の理由の規則（`APPLY_DISABLED_REASONS`・`getApplyDisabledReasons`）とヘッダーに出す理由の選択（`getShownDisabledReason`）を `lib/applyDisabledReason.ts`、読み上げ直しの文字列を `lib/announcementText.ts`（`ConflictResolver` と共有）、挿入・置換のボタンの対を `components/output/ApplyButtons.tsx`（ヘッダーとコードブロックで共有。props の型 `ApplyActions` もここ）。挙動は変えていない
- `components/output/CodeBlock.tsx`（新規）: コードブロックの見出し（言語名・ボタン）。`MarkdownRenderer` の `pre` を差し替える
- `components/output/MarkdownRenderer.tsx`: `codeBlockActions`（省略可能）を受け取り、渡されたときだけ `CodeBlock` を使う（既存の使い方・既存のテストの挙動を変えない）
- `components/output/OutputPanel.tsx`: ヘッダーの `挿入`・`置換`（出力全体）・無効の理由・通知。props に `applyOutput?: ApplyOutputState` を足す（省略時は従来の表示）
- `components/EditorPanel.tsx`: `useApplyOutputToEditor({ isExecuting })` を呼び、ファイルのエディタの `onMount` で `handleEditorMount` が true を返したときに `attachEditor(editorInstance)` を呼び、`OutputPanel` へ `applyOutput` を渡す
- `hooks/useEditorFocusManager.ts`: 変更しない（確認事項の結果で変更: 当初はマウント通知を足す案。`EditorPanel` の `onMount` から直接 `attachEditor` を呼べば足り、破棄は Monaco の `onDidDispose` で分かる）
- `assets/main.css`: コードブロックの見出しとボタンの規則。ボタンは共通の枠付きボタンのグループセレクタに足す（パターン 30・77）。見出しは `user-select: none`（出力を範囲選択してコピーしたとき、言語名・ボタンの文言が本文に混ざらないように。コードレビュー 1 巡目で追加）
- テスト用: `@monaco-editor/react` のモック（`__tests__/__mocks__/@monaco-editor/react.tsx`）に、選択範囲・編集・破棄の通知を足す（既存の export と挙動は変えない）。リファクタで、偽のエディタを `__tests__/__mocks__/createMockEditorInstance.ts`、テキストの編集を `__tests__/__mocks__/fakeTextBuffer.ts` に分け、反映のテストが共有する偽物を `__tests__/makeFakeApplyEditor.ts` にまとめた

## エラーハンドリング

| 状況                                                    | 挙動                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ファイルが開いていない・diff タブ・エディタのマウント前 | ボタンは無効。理由（`反映先のファイルが表示されていません`）を `title`・`aria-describedby`・ヘッダーで示す                                                                                                             |
| 実行中                                                  | ボタンを出さない（フックは `実行中は反映できません` で無効にする）                                                                                                                                                     |
| 選択範囲が空で `置換`                                   | 無効（`選択範囲がありません`）                                                                                                                                                                                         |
| エディタのモデルが破棄済み（遅延呼び出し）              | 何もしない（通知も出さない）                                                                                                                                                                                           |
| `executeEdits` が false を返す（読み取り専用など）      | 何も変わらず、カーソル・フォーカスも動かさない。`反映できませんでした` を通知する（確認事項の結果で確定。このアプリのファイルのエディタは読み取り専用でなく、diff タブは Monaco を使わないため、実際には起きない防御） |

## 既知の制約（設計時点。実装で追記する）

ROADMAP の「改善・技術的負債」の既知の制約（AI 出力のエディタへの反映）と 1 対 1（同じ文・同じ順・同じ項目数）。

- diff タブ・コンフリクトの解決ビューには反映できない（ファイルのタブへ切り替えてから反映する）
- 実行中（逐次出力の表示中）は反映できない。実行中は出力を Markdown として表示しないため、ボタンも出さない（完了後に反映する）
- 反映したテキストのインデントは調整しない（カーソル位置の既存のインデントと合わない場合がある）
- 複数カーソルのときは、主カーソル（最初に置いたカーソル）の位置・選択範囲だけを対象にし、反映の後はほかのカーソルは解除される（undo で戻る）
- diff タブ・ファイルのタブを切り替えるとエディタが作り直されるため、反映を含む undo の履歴は失われ、カーソルの位置は先頭（1 行 1 列）に戻る（既存の挙動。内容は保持される。切り替えた直後の挿入はファイルの先頭に入る）
- 出力全体の反映は、Markdown の原文（コードフェンス・見出しの記号を含む）をそのまま入れる
- 無効なボタンは disabled のため Tab で止まらない。理由はホバーの title・出力パネルのヘッダーの表示・aria-describedby で示す
- 「onChange → value の再同期で内容・カーソル・undo を壊さない」ことは、プラン作成時に実物の @monaco-editor/react 4.7.0 で実測し、自動テストには入れていない（vitest の alias がモックへ向けているため）。ライブラリを更新したときは APL の項目で確かめる

## テスト方針

- `applyToEditor`: 偽のエディタで、挿入（カーソル位置の空の範囲）・選択範囲があるときの挿入・置換（選択範囲）・置換で選択が空・モデル無し・選択無し・呼び出しの順序（`pushUndoStop` → `executeEdits` → `pushUndoStop` → `revealPosition` → `focus`）・`executeEdits` の引数・カーソルを末尾へ（`endCursorState` の戻り値）・拒否。実物の Monaco（`monaco-editor/esm/vs/editor/editor.api.js` の `editor.create`。jsdom に `matchMedia` と canvas の 2D コンテキストの偽物を足す）で、1 回の undo・undo → redo の後のカーソル（挿入・置換。コードレビュー 1 巡目で追加）・直前の入力と別の undo・2 回の反映・CRLF・複数カーソル・フォーカス・読み取り専用・破棄済み（確認事項の結果で追加）・長い挿入の末尾が見える位置までスクロールし、末尾がすでに見えていれば動かさないこと（`revealPosition`。コードレビュー 2 巡目で追加）
- `getCodeBlockSource`: 実際の react-markdown（`remarkGfm`・`remarkBreaks`）で描画して、言語・フェンスの種類・空・末尾の空行・インデント・引用とリストの中・入れ子のフェンス・閉じていないフェンス・インラインコード
- `useApplyOutputToEditor`: 有効条件の組み合わせ、選択範囲の変化の購読、インスタンスの差し替えと購読の解除、破棄、通知の表示と解除（偽のタイマーは `afterEach` で戻す）、実行中・エディタ無しでの無効
- `CodeBlock`・`MarkdownRenderer`・`OutputPanel`: ボタンの有無、`aria-label`・`aria-describedby`、無効のときの理由、押したときの呼び出し、状態が変わってもボタンのフォーカスを保つこと、`codeBlockActions`・`applyOutput` を渡さないときの従来の挙動、main.css（32px・無効の見た目）
- `EditorPanel`: 偽のエディタ（`@monaco-editor/react` のモック）で、挿入・置換から `onChangeContent` が呼ばれること、diff タブ・ファイル無し・マウント時にモデルが無いときは無効なこと、ファイルの切り替え
- 手動テスト仕様: 新しい接頭辞 `APL-` を `docs/manual-test-spec.md` に追記する（実際の Monaco での undo・dirty・選択範囲・フォーカス・タッチでの操作・CRLF・VoiceOver）

## ドキュメント

- ROADMAP: 「結果をエディタ / ファイルに挿入」「選択範囲を AI 出力で置換」を実装済みへ。見送り（差分プレビュー・diff apply・コードランナー・新規ファイル作成）と既知の制約を追記。実装済みの「クイックオープン」（PR #28）と「レスポンスのストリーミング表示」（PR #25。未実装の一覧の 2 か所に重複）が未実装の一覧に残っているので、あわせて実装済みへ移す
- `docs/manual-test-spec.md` の追記と Artifact の再公開（CLAUDE.md の共通ルール）

## 確認の結果（プラン作成時に実測。2026-10-04）

`@monaco-editor/react` 4.7.0・`monaco-editor` 0.55.1・`react-markdown` 10.1.0・`remark-gfm` 4.0.1・`remark-breaks` 4.0.0・vitest 4.1.7（jsdom）で、scratchpad のリポジトリの写しを使って確かめた。実装の詳細はプラン（`docs/superpowers/plans/2026-10-04-apply-output-to-editor.md`）の「設計書との差異」。

1. **`executeEdits` と制御された `value`**: `@monaco-editor/react` の `Editor`（`node_modules/@monaco-editor/react/dist/index.mjs.map` の `src/Editor/Editor.tsx`）は、`onChange` を `editor.onDidChangeModelContent` で購読して `getValue()` を渡す（自分の `value` の同期中は `preventTriggerChangeEvent` で抑える）。`value` の変更時は、読み取り専用なら `setValue`、そうでなく `value !== editor.getValue()` のときだけ全体を `executeEdits('', [全範囲])` → `pushUndoStop()` で置き換え、同じなら何もしない。(a) 実物の `Editor` を jsdom で `value`・`onChange` で制御して（`loader.config({ monaco })`、依存をインライン化した実験用の vitest の設定）`executeEdits` を呼ぶと、`onChange` が 1 回、新しい内容で呼ばれた。(b) その値を state に戻して再描画しても、追加の `executeEdits`・`setValue` は呼ばれず、モデルは同じ、選択範囲も保たれた。(c) `pushUndoStop` → `executeEdits` → `pushUndoStop` はエディタの undo（`trigger('…', 'undo')`）1 回で戻り、選択範囲も反映前に戻った（モデルの `undo()` は内容だけ戻し、選択は戻さない）。redo も 1 回で戻る。実物の `monaco-editor` は jsdom で動く: `editor.createModel` は DOM 無しで動き、`editor.create` には `matchMedia`（テーマの判定）と canvas の 2D コンテキスト（文字幅の計測・概観ルーラーの描画）の偽物が要る（`automaticLayout: true` なら `ResizeObserver` も）。`editor.main` ではなく `editor.api` を読めば言語・worker を読まない。よって実モデルでの undo の検証を自動テストに入れる（`applyToEditor.monaco.test.ts`）。実物の `@monaco-editor/react` を通す確認は、vitest の alias がモックへ向けていて、実物を読むには全体の設定（`server.deps.inline`）を変える必要があるため自動テストに入れず、実機（APL-009〜APL-015）で確かめる
2. **`executeEdits` の細部**: 第 1 引数（source）は出どころの記録だけで挙動に影響しない。`forceMoveMarkers: true` で、挿入の位置にあるカーソルは挿入したテキストの末尾へ動く。ただし前向きの選択の終わりに挿入すると、選択の終わりだけが動いて選択が広がる（`(1,2)-(1,4)` → `(1,4)-(1,6)`）ため、カーソルを末尾へ置き直す必要がある。第 3 引数のコールバックには逆向きの編集（挿入したテキストの範囲。改行コードの変換後）が渡り、`null` を返すとカーソルは Monaco に任される。戻り値は undo の履歴の「編集の後のカーソル」になり、redo で復元される（`null` だと redo の後は挿入したテキスト全体が選択される。編集の後の `setSelection` は履歴に残らない。コードレビュー 1 巡目で実測）。Monaco の型は `Selection` のクラスを返す形だが、実行時に読むのは `ISelection` の 4 つの値だけで、素のオブジェクトを返しても undo・redo は正しく動く（同じく実測。当初は「型の上で素のオブジェクトは返せない」として `null` を返していた）。`getSelection()` はモデルが無いエディタ・破棄後のエディタで `null`。複数カーソルでは `getSelection()` は `setSelections` の先頭（主カーソル）を返し、`getSelections()` は全部を返す。`executeEdits` は渡した範囲（主カーソルの範囲）だけを編集する。プラン作成時の実測（`endCursorState` が `null`）では、他のカーソルは残っていた。今の実装はコールバックが選択を 1 つだけ返すため（コードレビュー 1 巡目の変更以降）、反映の後は選択が 1 つ（反映したテキストの末尾）になり、主カーソル以外のカーソル・選択は解除される。undo で内容と元の複数のカーソルが戻る（PR #45 のレビュー 1 周目で実測し、`applyToEditor.monaco.test.ts` で固定）。`onDidChangeCursorSelection` は `IDisposable` を返し、`dispose()` の後は通知されない。編集・`setSelection`・undo でも通知される。モデルが `\r\n` のとき、`\n`・`\r\n`・`\r` を含むテキストはすべて `\r\n` になり、`\n` のモデルでは `\r\n` が `\n` になる。読み取り専用のエディタでは `executeEdits` は false で内容は変わらない。破棄済みのエディタでは false（例外は出ない。`pushUndoStop`・`focus` も例外を出さない）。空のテキストの編集は true を返す。`onDidDispose` は `dispose()` で呼ばれる。フォーカスの無いエディタへの `executeEdits` も成功し、`focus()` の後は `hasTextFocus()` が true。`executeEdits` と `focus()` はスクロールしない（入力・貼り付けはカーソルの位置までスクロールする。コードレビュー 2 巡目で実測）
3. **react-markdown のコードブロック**: `components.pre` の `node` は hast の `pre` 要素で、子は `code` 要素 1 つ（`properties.className` が `['language-<言語>']`、言語なしは無し）、その子は text 1 つ。text は中身があれば末尾に `\n` が 1 つ足され（`a\n\n` の中身は `a\n\n\n`）、空のコードブロックは `''`。情報文字列は先頭の語だけが言語になる（`ts title="x"` → `language-ts`）。チルダのフェンス・インデントのコードブロックも同じ形。引用・リストの中のコードブロックは `>`・リストのインデントが除かれる。長いフェンスの中のフェンスはそのまま中身になる。閉じていないフェンスは末尾までが中身。CRLF の入力では中の `\r` が残る（Monaco が変換する）。`remarkBreaks` はコードの改行を変えず、`remarkGfm` も影響しない。インラインコードは `pre` を通らず `code` だけ。rehype-highlight 等は使っていない（`node_modules` に無い）。React の `children` は `code` のコンポーネントの要素で、その `props.children` が同じ文字列だが、`code` を差し替えると変わるため hast から取る（子が分かれた場合に備えて text を再帰で集める）
4. **`EditorPanel` の配線**: `useEditorFocusManager` の `editorRef` は ref で、ファイルを閉じたときだけ null にする（diff タブへの切り替えでは古いインスタンスが残る）。エディタは `key={openFile.path}` で、ファイルの切り替え・リネーム・diff タブからの復帰で作り直され、アンマウントで `@monaco-editor/react` がエディタとモデルを `dispose` する（`onDidDispose` が呼ばれる）。`onMount` は非同期に届き、`handleEditorMount` は現在のファイルでない・モデルが無いときに false を返す。よって、フックは `handleEditorMount` が true のときの `attachEditor` でエディタを state に入れ、`onDidDispose` で外す（マウント通知の state。`useSyncExternalStore` は要らない）。`useEditorFocusManager` とそのテストは変えない。`App` は `isExecuting`・`result` を既に `EditorPanel` へ渡しているため、`App` の変更は要らない
5. **`OutputPanel`**: props は `isExecuting`・`result`・`streamingText`・`executionError`・`onClear`・`onCancel`。実行中は `streamingText` を `pre` で出し、`MarkdownRenderer` は `!isExecuting && result !== null` のときだけ使う。`MarkdownRenderer` を使うのは `OutputPanel` だけでなく `history/HistoryDetail.tsx`（実行履歴の詳細）もで（確認事項の前提と違った）、どちらも `content` だけを渡す。履歴の詳細には反映のボタンを付けない（`codeBlockActions` を渡さない）。`codeBlockActions` を渡さない使い方では従来の `components` をそのまま使うため、既存の `OutputPanel.test.tsx`（19 件）・`MarkdownRenderer.test.tsx`（30 件）・履歴のテストは変更なしで通った。CSS は `.output-panel__*` と `.markdown-renderer pre` 等（`white-space: pre-wrap`）
6. **既存のテストのモック**: `vitest.config.ts` の alias が `@monaco-editor/react` を `src/renderer/src/__tests__/__mocks__/@monaco-editor/react.tsx` へ向ける。モックの `Editor` は textarea を描画し、初回の effect で `onMount({ addCommand, focus, getModel: () => mockEditorModel.current }, { KeyMod, KeyCode })` を呼ぶ（`mockAddCommand`・`mockFocus`・`mockEditorModel` を export）。`useEditorFocusManager.test.ts` は `{ focus, getModel }` だけの偽のエディタを使う。`attachEditor` が購読するため、モックに `getSelection`・`setSelection`・`executeEdits`・`pushUndoStop`・`onDidChangeCursorSelection`・`onDidDispose` とアンマウントでの破棄を足す（既存の 3 つの export と挙動は変えない。足した後も既存のコンポーネント・フックのテスト 2473 件が通った）。コードレビュー 2 巡目で変更: モックの `executeEdits` は、実物と同じく `endCursorState` の戻り値（コールバックなら戻り値、配列ならそのもの）の先頭を編集の後の選択にし、無い・`null` なら選択を変えない（当初は戻り値を捨てて常にカーソルを挿入したテキストの末尾へ置いており、`applyToEditor` のカーソルの置き方が壊れても結合テストで気づけなかった）。使われなくなった `setSelection` を外し、`revealPosition`（呼び出しの記録だけ）を足した
7. **a11y とタッチ**: 32px のタップ領域・枠・ホバー・無効の見た目は、`main.css` の共通の枠付きボタンの 3 つのグループセレクタ（宣言・`:hover:not(:disabled)`・`:disabled`）に足す。既存の `.output-panel__clear-btn` は 32px 未満だが、この機能の範囲外として変えない。通知は `ConflictResolver` の作り（常に置く `role="status"` と、id の偶奇でゼロ幅スペースを付ける）に合わせる。タイマーは `useEffect` の後始末で `clearTimeout` し、テストは `vi.useFakeTimers()` を `afterEach` の `vi.useRealTimers()` で戻し、アンマウントで `vi.getTimerCount()` が 0 であることを確かめる。無効のボタンの理由は、`aria-label` があるため `title` も説明として計算される（`aria-describedby` を外しても `toHaveAccessibleDescription` は通る）ので、テストでは `aria-describedby` の参照先を直接確かめる
8. **ROADMAP の整理**: 「クイックオープン」は PR #28（2026-08-21 マージ。`components/quick-open/QuickOpenDialog.tsx`・`hooks/useQuickOpen.ts`、Cmd/Ctrl+P。仕様書の BASE-018 以降）で実装済みなのに、未実装の「ファイル / ワークスペース管理」に残っている。「レスポンスのストリーミング表示」は PR #25（`feat/settings-streaming-explorer`。`hooks/useStreamingText.ts`、`OutputPanel` の `streamingText`、Claude API と CLI の両方。仕様書の RUN-017・OUT-014）で実装済みなのに、未実装の「AI 実行（Claude）高度化」と「出力 / 結果」の 2 か所に重複して残っている。どれも未実装の一覧から消し、実装済みの「エクスプローラー」（クイックオープン）と「Claude API 連携」（ストリーミング）に足す
