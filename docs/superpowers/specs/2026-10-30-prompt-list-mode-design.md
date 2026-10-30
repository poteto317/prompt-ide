# プロンプト一覧の編集モード / 表示モード 設計書

- 日付: 2026-10-30
- ROADMAP の項目: なし（利用者の依頼による新規。誤タップの防止が目的）
- 前提の設計書: なし（プロンプト管理は実装済み機能の「プロンプト管理」）

## 目的

プロンプトの一覧は、各項目に `編集` と `削除` のボタンが常に並ぶ。タッチ操作では、実行のつもりで隣の `削除` を押してしまう誤タップが起きる。
一覧の最上部に「編集モード / 表示モード」のトグルを置き、表示モードでは `編集` と `削除` を押せないだけでなく表示もしないことで、誤って編集・削除するのを防ぐ。

## 決めたこと

利用者の確認済み（2026-10-30）:

| 項目             | 決定                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 保存と既定       | モードを設定として保存し、アプリを再起動しても保つ。保存が無い初回の既定は編集モード（今の見た目と挙動を変えない）                      |
| 並び替えとピン   | 表示モードでも、ドラッグの並び替え（検索・タグの絞り込み中は今も無効）とピン留め（★）は残す。表示モードで隠すのは `編集` と `削除` だけ |
| 編集中の切り替え | 編集フォームを開いたまま表示モードへ切り替えたら、フォームを閉じて入力を破棄する（確認は出さない）                                      |
| トグルの場所     | プロンプトのパネル最上部に専用の行を作り、その中に置く（インポート / エクスポートの行の上）                                             |

推奨案を採用したもの（利用者の指定が無かった細部）:

| 項目                      | 決定                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 読み込み前                | 設定の読み込みが終わるまで（モードが `null` の間）はトグルを押せなくし、`編集` と `削除` は出さない（保存が表示モードのとき、一瞬だけ削除が見えて押せるのを避ける） |
| 読み込みの失敗            | 既定（編集モード）で続ける。既存の設定の流儀（`useSavedSetting`）と同じ                                                                                             |
| 保存の失敗                | 楽観的に切り替え、失敗したら直前の値へ戻し、トグルの下に固定の文言を出す（例外の中身は出さない）。既存の設定の流儀と同じ                                            |
| トグルの表示              | 1 つのボタン。見える文言は `編集モード: オン` / `編集モード: オフ`（現在の状態を表す。「押した後の状態」ではない）。`aria-pressed` で状態を伝える                   |
| 追加                      | 追加フォームは両方のモードで使える（変更しない）                                                                                                                    |
| インポート / エクスポート | 両方のモードで使える（変更しない。インポートは既存を消さず追加するだけ）                                                                                            |
| 実行                      | 両方のモードで使える（変更しない）。変数の入力フォーム・送信前の確認も今のとおり                                                                                    |

## 範囲

含めるもの:

- モードの型・既定値・型ガード（shared）と、保存・読み込み（main のストア、IPC、preload、renderer の薄いラッパー、hook）
- プロンプトのパネルのトグルの行と、`PromptItemView` の `編集`・`削除` の出し分け、`PromptItem` の編集フォームの閉じ方
- 実機テスト仕様書への項目の追加
- ROADMAP・README・docs/developer-guide.md（設定の読み書きのフックの節）・`useSavedSetting.ts` のコメントの、実装に合わせた更新

含めないもの:

- 設定画面にモードの項目を足すこと（トグルはパネルの最上部だけ）
- 表示モードでの並び替え・ピン留めの制限
- モードごとの `追加` の制限
- 履歴・ほかのパネルのモード
- キーボードショートカット

## 設定

`settings.json`（`userData`）に `promptListMode`（`'edit' | 'view'`）を保存する。実行方式（`promptExecutionMode`）と同じ形で足す。

- shared（`src/shared/types/settings.ts`）: `PROMPT_LIST_MODES = ['edit', 'view'] as const`、`PromptListMode`、`DEFAULT_PROMPT_LIST_MODE: PromptListMode = 'edit'`、`isPromptListMode`（`isOneOf` を使う）。`src/shared/types.ts` から再エクスポートする。
- main: `src/main/promptListModeStore.ts`（`executionModeStore.ts` と同じ形）。`getPromptListMode()` は、保存が無い・列挙の値でなければ既定を返す。`setPromptListMode(mode: unknown)` は、列挙の値でなければ値を入れない固定文言で投げる。`settingsFileStore.ts` の `SettingsFile` に `promptListMode?: string` を足す。
- IPC: `settings:getPromptListMode` / `settings:setPromptListMode`（`src/main/handlers/settingsHandlers.ts`。set は検証せず store に渡す）。`preload/api.ts`・`preload/index.d.ts`・`renderer/src/lib/settingsApi.ts` に get / set を足す。
- renderer: `usePromptListMode`（`useSavedSetting` を使う。`useExecutionMode` と同じ形。保存の失敗の接頭辞は固定文言）。戻り値は `PromptListModePanelState { mode: PromptListMode | null; saveError: string | null; isSaving: boolean; onChange: (mode: PromptListMode) => void }`（`types.ts`。`isSaving` は保存の途中。最終レビューで足した）。`useSavedSetting` の `change` は `Promise<boolean>` を返すので、`onChange` はそれを `void` で捨てる包みにする（`useAgentWorkspace` の通知・送信前の確認の `onChange` と同じ捨て方。実行方式の `onSelect` は `runSwitching` の中で待って `.catch` で握る別の形）。包みは薄くなく、保存の途中は `useRef` と `isSaving` で `onChange` を無視する（「失敗の扱い」の連打の項）。
- 結線: `useAppState` が `usePromptListMode` を呼び、`promptListMode: PromptListModePanelState` を返す。`App` → `Sidebar` → `PromptsPanel` へ props で渡す（`Sidebar`・`PromptsPanel` では必須の props にする。L-060）。
- テストの土台: `src/renderer/src/__tests__/setup.ts` の `window.api` のスタブに get / set を足す。

## 画面

### トグルの行（`PromptsPanel`）

- `PromptsPanel` の先頭（`PromptsToolbar` の上）に、`PromptListModeToggle`（新しいコンポーネント）を置く。
- 中身は 1 つのボタン。`type="button"`、`aria-pressed={mode === 'edit'}`、`aria-label="編集モード"`（固定。状態は `aria-pressed` で伝える。L-154・L-497）。見える文言は `編集モード: オン` / `編集モード: オフ`（現在の状態。L-511）。
- 専用のクラス（`prompts-panel__mode-toggle`）を作る。誤タップの防止が目的なので、`min-height: 32px`・`min-width: 32px` を持たせ、見た目（背景・枠・文字色・フォーカス・`:hover`・`:disabled`・保存中の `[aria-disabled='true']`〈`:disabled` と同じ半透明・カーソル・hover の抑止〉）は `prompts-panel__toolbar-button` と同じ値を書く。`prompts-panel__toolbar-button` 自体は変えない（インポート / エクスポートの見た目を変えない）。
- `mode === null`（読み込み中）は `disabled` で、文言は `編集モード: オフ`、`aria-pressed={false}`（読み込み中は `編集`・`削除` を出さないので、実態と合う）。
- 保存に失敗したときは、ボタンの下に `aria-live="polite"` の段落（クラス `prompts-panel__mode-error`）でエラーの文言を出す（`PromptListModePanelState.saveError`）。常設の領域（`saveError` が `null` のときも空の段落を置く）にして、文言の出し入れで読み上げが欠けないようにする（L-153）。`role="status"` にしないのは、パネルは `Sidebar` で常にマウントされ（隠すのは CSS だけ）、空の `status` が常に DOM にあると、画面に `status` が 1 つだけ（または 0 個）であることを前提にした既存のテスト（`PromptsPanel.test.tsx`・`Sidebar.test.tsx`）が壊れるため。読み上げの挙動は同じ（`aria-live="polite"`）。
- トグルは、プロンプトが 0 件でも、検索中でも、常に表示する（条件で隠さない。隠すとモードが解除できなくなる。L-475）。

### 一覧の項目（`PromptItemView` / `PromptItem`）

- `PromptsPanel` は `mode === 'edit'` のときだけ `canEdit = true` を `PromptItem` へ渡す（`null`・`'view'` は `false`）。`PromptItem` と `PromptItemView` の `canEdit` は必須の props にする（省略できると、渡し忘れで表示モードでも `編集`・`削除` が出る不具合を型が見逃す。L-060）。
- `PromptItemView` は `canEdit` が `false` のとき、`編集` と `削除` のボタンを描かない（DOM に出さない。`disabled` にもしない）。`実行` は常に出す。ドラッグのハンドルとピン留めも今のまま。
- `PromptItem` は、`canEdit` が `false` になった時点で、編集中（`isEditing`）なら `false` に戻す（フォームを閉じ、入力は破棄する）。描画の最中に `if (!canEdit && isEditing) setIsEditing(false)` で戻す（`isEditing` を残したまま非表示にすると、編集モードへ戻ったときに初期値のフォームが突然開く隠れた状態になる。L-475）。変数の入力フォーム（`isFillingVariables`）は変えない。
- 切り替えのとき、フォーカスはトグルのボタンにあるので、フォームを閉じてもフォーカスは失われない。

### 変えないもの

- `AddPromptForm`（追加）、`PromptsToolbar`（インポート / エクスポート）、検索、タグの絞り込み、実行ツールの選択、参照のチップ。
- `PromptEditForm` の中身。

## 失敗の扱い

- 保存の失敗: 画面は直前のモードへ戻り、トグルの下に固定文言を出す。文言は `useSavedSetting` の流儀（`${PROMPT_LIST_MODE_SAVE_ERROR_PREFIX}${SETTINGS_FILE_ERROR_REASON}`）で、接頭辞は `モードの設定を保存できませんでした: `（方向に依らない。表示モードへの切り替えの失敗にも、編集モードへ戻す失敗にも使うため、モードの名前を入れない）。例外の中身は画面に出さず `console.error` に記録する（L-017）。
- 読み込みの失敗: `console.error` に記録し、既定（編集モード）で続ける。
- 連打（最終レビューで足した）: 保存の途中は `onChange` を無視する（hook が `useRef` で同期的に二重の保存を止め、`isSaving` を画面へ出す）。トグルは `isSaving` の間 `aria-disabled="true"` にしてクリックを無視する（`disabled` にはしない。押したボタンが無効になるとフォーカスが `body` へ落ちるため。L-157）。2 回目を無視するので、保存が失敗したときの戻り先は 1 回目の前のモードで一意になり、画面と保存のモードが食い違わない（`useSavedSetting` は失敗で「呼んだ時点の値」へ戻すため、ロックが無いと連打の両方の失敗で食い違う。L-406）。
- キーのリピート（ローカルレビューで足した）: Enter・Space の押しっぱなしで keydown のリピートごとに click が合成されると、保存が終わった直後のリピートが新しい操作として通り、モードが往復して編集フォームの破棄が繰り返される（`isSaving` のガードでは、保存の完了後のリピートは防げない）。トグルは、リピートの keydown（`e.repeat`）の Enter・Space では押さない（`onKeyDown` で `preventDefault`。`PromptItemView` の `実行` と同じ。`isActivationKey`）。最初の keydown と、ほかのキー（Tab・矢印・Escape など）は止めない。
- 編集中の切り替えが保存の失敗で戻る場合: 表示モードへの切り替えは楽観的に反映されて編集フォームが閉じ、入力が捨てられる。保存が失敗するとモードは編集モードへ戻るが、閉じたフォームの入力は戻らない（設計どおり。破棄を決めたため。確認や復元は出さない）。

## テスト

- shared: `isPromptListMode`・既定値。
- main: `promptListModeStore`（保存値・無い・不正値・文字列でない値、不正値の保存の拒否で値を文言に入れない）、`settingsHandlers`（get の返却、set が値をそのまま渡すこと）。
- preload / lib: チャンネル名と引数、`settingsApi` のラッパー。
- hook: `usePromptListMode`（読み込み、変更、失敗で戻す、読み込み前）。`useExecutionMode` のテストと同じ観点。加えて、保存の途中の `onChange` の無視（二重に保存しない）・`isSaving` の遷移・失敗または成功のあとの解除。
- 画面:
  - `PromptListModeToggle`: リピートの Enter・Space の keydown は既定の動作を止め、最初の keydown と別のキーは止めない（jsdom は keydown から click を合成しないので、`fireEvent.keyDown` の戻り値で固定する。`PromptItemView` の `実行` のテストと同じ）。文言（オン / オフ）、`aria-pressed`、`mode === null` で disabled、`isSaving` で `aria-disabled="true"`（`disabled` 属性は付けず、押しても `onChange` を呼ばない）、保存失敗の文言、押すと `onChange` が逆のモードで呼ばれる。
  - `PromptItemView`: `canEdit` が `false` のとき `編集`・`削除` が DOM に無く、`実行`・ピン・並び替えのハンドルは在る。
  - `PromptItem`: 編集中に `canEdit` が `false` になるとフォームが閉じ、`true` に戻してもフォームは開かない（入力は破棄される）。
  - `PromptsPanel`: `mode` が `'edit'` のときだけ `編集`・`削除` が出て、`'view'`・`null` では出ない（`canEdit` の渡し忘れを落とす）・追加フォームとインポート / エクスポートは使える・プロンプトが 0 件でもトグルが出る。
  - 結線: `Sidebar`・`App`・`useAppState` の props の素通し。
- スタイル（`main.css` の検査）: トグルのボタンが 32px 四方以上で枠付き。見た目が `.prompts-panel__toolbar-button` と同じ値であること（jsdom が計算できる背景色・文字色・文字サイズ・カーソル・枠の種類と太さと色など。`:hover`・`:focus` の値は CSS 側で同じ値を書くが、テストでは `:hover` の背景の規則が当たるかだけを見る）、`disabled` と `aria-disabled="true"` の見た目（半透明・カーソル）、`aria-disabled` のとき hover の規則が当たらないこと（押せるときは当たる対のテスト）、行の `flex-shrink: 0` と下線、空のエラー段落に余白が無く、文言が出ると上に余白が付くこと（`:empty` の規則。外すと落ちる）。
- 既存のテストのひな形（`Sidebar`・`PromptsPanel` の props、`setup.ts` のスタブ）に新しい props・API を足す。

## 実機テスト仕様書

`docs/manual-test-spec.md` の「プロンプト管理」に、節「プロンプト一覧の編集モード / 表示モード」を足す。置き場所は、領域「プロンプト管理」の最後（`### プロンプト管理の見た目(ダークテーマ)` の節の後）で、ID は `PRM-087` から連番にする（`scripts` の検査が、接頭辞ごとの ID が文書の出現順に昇順であることを求める）。再起動後もモードが保たれるため、領域の先頭に `> 前提: 一覧は編集モード（既定）にしておく。表示モードのままだと、編集・削除の項目を手順どおりに実行できない（切り替えは PRM-087 以降）` を足す。確認の項目:

- 既定（初回）が編集モードで、今までどおり `編集`・`削除` が出る。
- トグルを押すと表示モードになり、`編集`・`削除` が消え、`実行`・ピン・並び替え・`追加`・インポート / エクスポートは使える。
- 表示モードのまま再起動しても、サイドバーを閉じて開いても、表示モードが保たれる。
- 編集フォームを開いたまま表示モードへ切り替えると、フォームが閉じ、編集モードへ戻しても入力は戻らない。
- プロンプトが 0 件でも、検索で 0 件でも、トグルが出る。
- 狭いパネルの幅でトグルの行が崩れない。
- トグルにフォーカスして Enter を押しっぱなしにしても、モードが往復しない（PRM-100）。
- 最後に編集モードへ戻し、`編集`・`削除` が再び出る（以降の項目のために編集モードへ戻す）。

実装後に、領域の先頭の前提（一覧は編集モード）、節の前提（8 本。内容は仕様書が正）、RUN-005 の前提も足した。項目の最終の本文は `docs/manual-test-spec.md` が正（PRM-087〜100）。

## 気をつける知見

- L-060: `Sidebar`・`PromptsPanel` の新しい props は必須にし、テストのひな形の足し忘れを型エラーにする。
- L-017: 保存の失敗の文言に例外の中身を出さない。
- L-475: トグルを条件で隠さない。`isEditing` のように見えなくなる状態を残さず、`canEdit` が `false` の間は閉じる。
- L-511・L-154・L-497: トグルの文言は現在の状態、ラベルは固定、状態は `aria-pressed`。
- L-153: エラー文言の領域は常設にする。
