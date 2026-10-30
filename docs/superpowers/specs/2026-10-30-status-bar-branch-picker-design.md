# ステータスバーのブランチ表示と切り替え

## 背景

- ステータスバー左下のブランチ名は `main` の固定文字列で、実際のブランチを表していなかった(`StatusBar.tsx`)。
- 履歴セクションの上部には、全ブランチの名前がバッジで並んでいるが、コミットと結びついておらず、利用者には意味が分かりにくい。
- 利用者の要望: 左下のブランチ名をクリックしたら、VS Code と同じようにブランチの一覧を出して切り替えたい。履歴のブランチ名は不要。

## 全体の進め方

利用者の要望は、ソース管理全体を VS Code と同じ形にすること。範囲が広いため、PR を分けて段階的に進める(利用者が選択)。

1. 第 1 段階(この設計書): ステータスバーのブランチ表示と切り替え、履歴のブランチ名のバッジの削除
2. 第 2 段階: 履歴を VS Code の Source Control Graph と同じ形にする(別の設計書)
3. 第 3 段階: パネルの配置(コミット欄・変更一覧・ツールバー)を VS Code に合わせる(別の設計書)

第 2・3 段階はこの設計書の範囲外。

## 要件

### ステータスバーの表示

1. `gitStatus` が null、または `isRepo` が false のときは、ブランチの項目を出さない。
2. リポジトリのときは、ブランチのアイコンと現在のブランチ名を出す。文言は既存の `getBranchTriggerLabel` で決める(ブランチ操作の実行中は `切り替え中...` など)。
3. 現在のブランチは `gitStatus.detached ? null : gitStatus.branch` とする。detached HEAD のとき `gitStatus.branch` は `'HEAD'` になるが、ステータスバーには `(no branch)` と出す。ソース管理パネルの `BranchSwitcher` の表示は変えない(範囲外)。
4. 項目はボタンにする。ブランチ操作の実行中(`pendingBranchOperation !== null`)と、他の操作中(`stagingPaths.size > 0 || isAnyLocked()`。`GitRepoView` と同じ判定)は押せない。この 2 つをまとめた値を「押せない状態」と呼ぶ。
5. `aria-haspopup="dialog"`、`aria-expanded`、`getBranchTriggerLabel` の `ariaLabel` を付ける。
6. ボタンの `onKeyDown` で、`event.key === 'Enter' && event.repeat` を `preventDefault` する。未保存の確認の既定のボタンを Enter で押したまま切り替えが終わり、ボタンへ戻ったときなどに、リピートで開き直すのを防ぐ。

### ブランチの一覧(クイックピック)

開閉:

1. ボタンを押すと、画面上部中央に、絞り込みの入力欄とブランチの一覧を持つダイアログを開く。見た目は既存の `quick-open*` のクラスを流用する。
2. 開閉は `useDialogFocusReturn({ isRunning: 押せない状態, openerRef })` で行う。閉じる操作はすべて `close()` を使い、フォーカスは閉じてボタンが押せるようになった描画の後で、フォーカスが body のときだけ戻す(パターン 73・86)。
3. 開いたら入力欄にフォーカスする。
4. Escape とオーバーレイのクリックで閉じる。Escape は `QuickOpenDialog` と同じく document で受ける。オーバーレイの click は `event.detail > 1` なら無視する(ボタンのダブルクリックの 2 回目が、全画面のオーバーレイに落ちて、開いた直後に閉じるのを防ぐ)。
5. Tab はダイアログの外へ移さず入力欄に留める。
6. IME の変換中(`isComposing`)は、↑↓・Enter・Tab・Escape を横取りしない。
7. ダイアログ内の項目を押してもフォーカスは入力欄に残す。オーバーレイを押して閉じなかった場合も同じで、`QuickOpenDialog` と同じくオーバーレイの `onMouseUp` で入力欄へ戻す。スクロールバーの操作は妨げない。
8. リポジトリでなくなって項目が消えたときは、アンマウントで閉じる。戻し先は無い。

ARIA:

9. ダイアログに `role="dialog"`、`aria-modal="true"`、`aria-label="ブランチを切り替え"` を付ける。Quick Open は `[role="dialog"]` の有無で重ねて開くのを防いでいるため、必須。
10. 入力欄は `role="combobox"`、一覧は `role="listbox"`、項目は `role="option"` とし、`aria-activedescendant` で選択を示す。ID は Quick Open と別の `branch-picker-listbox`・`branch-picker-option-<添字>` にする。

一覧:

11. 候補は `buildBranchPickerItems(branches, currentBranch, query)` で作る。現在のブランチの判定は `currentBranch` だけで行い、`GitBranch.current` は使わない(`branches` は履歴の再取得でしか更新されず、`gitStatus` より遅れることがある)。
12. ブランチ上にいないときに `branchLocal` が返す疑似項目(`4fd2759`、`refs/heads/main`、rebase 中・bisect 中の `(no` など)は、`currentBranch` の値によらず、取得元の `getBranches` が付けた `isDetachedHead` で除く。`GitBranch.current` では判定しない。要件 11 と同じ理由で、`branches` が古いと、疑似項目が `currentBranch` のあるときに残ったり、実在のブランチが `current: true` のまま残ったりするため。
13. `currentBranch` が `branches` に無いときは、候補に足す。
14. 現在のブランチを先頭に置き、残りは `branches` の順に並べる。現在のブランチには `現在` の印を付ける。長い名前は省略記号で切り詰めて全文を `title` に入れ、印は押し出さない。
15. 入力すると、大文字小文字を区別しない部分一致でブランチ名を絞り込む。
16. 候補が 0 件のとき、絞り込みの文字があれば `一致するブランチがありません`、無ければ `ブランチがありません` と出す。コミットの無いリポジトリでは、要件 13 により現在のブランチ 1 件が候補になる。この文言が出るのは `currentBranch` が null で他に候補が無い場合だけ。

選択:

17. 選択は添字ではなくブランチ名で持つ。
18. 開いたときの選択は、現在のブランチの次の候補にする。別の候補が無ければ現在のブランチ、`currentBranch` が null なら先頭。計算は開いたときの 1 回だけとする。
19. 絞り込みの文字を変えたら、選択を先頭の候補へ戻す。
20. 開いている間に一覧が変わり、選択中の名前が候補から消えたら、先頭の候補を選択として扱う。
21. ↑↓ で選択を循環して動かす。

確定:

22. Enter かクリックで確定する。候補が 0 件の Enter は何もしない。
23. Enter は離したときに確定する。この入力欄で押し始めた Enter だけを対象にし、キーリピート(`event.repeat`)は押し始めとして扱わない。keyup を取り逃した場合に備え、IME の変換中の keydown とフォーカスが外れたときに押し始めの印を消す。押した時点で確定すると、未保存の確認(ネイティブのダイアログ)が開いた後も続くリピートが既定のボタンを押し、未保存の編集を破棄してしまう。
24. 押せない状態の間の確定は、閉じずに無視する。押せない状態の間は、確定を試みなくても常に一覧の上に `他の操作が完了するまで切り替えられません` を出し、解けたら消す。
25. 現在のブランチを確定したときは、切り替えずに閉じる。
26. 別のブランチを確定したときは、`close()` の後に `onCheckoutBranch(name)` を呼ぶ。切り替えの実体は既存の `checkoutBranch`(`useAppState`。未保存の確認・成功時だけの再読込を含む)をそのまま使う。

### ブランチ操作の失敗の表示

`branchOperationError` はソース管理パネルにしか出ないため、別のパネルを開いたままステータスバーから切り替えて失敗すると、利用者に伝わらない。

1. ステータスバーのブランチの項目の右に、`branchOperationError` があるときだけ、`role="alert"` の項目でメッセージを出す。対象はブランチの切り替えに限らず、作成・削除・マージの失敗とコンフリクトの通知も含む(同じ state のため)。
2. 幅が足りないときは省略記号で切り詰め、全文を `title` に入れる。
3. メッセージの寿命は `branchOperationError` に従う。次のブランチ操作の成功で消え、失敗なら置き換わり、コンフリクトの通知はマージ中の解除で消える。
4. ステータスバーは常に見えるため、フォルダの切り替えで `branchOperationError` を消す。`useGitBranchOperations` に `clearBranchOperationError` を足し(コンフリクトの通知の控え `conflictNoticeRef` も消す)、`useAppState` の `useOnChange(fileSystem.folderPath, ...)` から呼ぶ。

### 履歴セクション

1. ブランチ名のバッジを削除する。タグのバッジは残し、タグが 0 件ならバッジの枠も出さない。
2. `HistorySection` の `branches` prop は、タグ作成ダイアログの名前の重複の検証に使うため残す。
3. 使わなくなった CSS(`.history-section__badge--branch-current`、`.history-section__badge--branch`)を消し、タグの色の説明のコメントを実態に合わせる。

## 構成

- `src/main/gitService.ts`: `getBranches` が `getCurrentBranchRef` も取得し、ブランチ上にいないとき(`ref === null`)の `summary.current` の項目に `isDetachedHead: true` を付ける。`summary.detached` は rebase 中・bisect 中に false になるため使わない。疑似項目は返し続ける。
- `src/shared/types/git.ts`: `GitBranch` に任意の欄 `isDetachedHead?: boolean` を足す。印が無い項目には欄を付けない。
- `src/renderer/src/lib/branchPicker.ts`(新規): 純粋関数 `buildBranchPickerItems(branches, currentBranch, query)` と `initialBranchPickerSelection(items)`。
- `src/renderer/src/components/source-control/BranchQuickPick.tsx`(新規): ダイアログ本体。
- `src/renderer/src/components/StatusBarBranch.tsx`(新規): ステータスバーのボタンと開閉、失敗の表示。
- `src/renderer/src/components/StatusBar.tsx`: 固定の `main` をやめ、必須の prop `branch: StatusBarBranchState | null` が null でなければ `StatusBarBranch` を出す。
- `src/renderer/src/hooks/useGitBranchOperations.ts`・`useAppState.ts`: `clearBranchOperationError` の追加とフォルダの切り替えでの呼び出し。
- `src/renderer/src/App.tsx`: `StatusBarBranchState` を組み立てて渡す。

## 決めたこと

- 表示の形は、既存の `BranchSwitcherMenu`(下向きのドロップダウン)ではなく、VS Code と同じ画面上部のクイックピックにする。利用者が VS Code と同じ動きを求めたため。
- 一覧から行える操作は切り替えだけにする。作成・削除・マージは今までどおりソース管理パネルで行う。第 3 段階で扱いを見直す。
- リモートだけにあるブランチは出さない。既存の `getBranches` がローカルブランチのみのため。
- `branches` と `gitStatus` は既存の取得のタイミングのまま使い、開くときに取り直さない。

## 既知の制約

- アプリの外で切り替えた場合、ステータスバーに反映されるのは Git の状態を取り直した後になる(ソース管理パネルと同じ)。
- 端末で作ったブランチは、履歴の再取得まで一覧に出ない。
- 同じ文言で再び失敗すると DOM が変わらないため、`role="alert"` は読み上げられない。

## テスト

新規:

- `branchPicker.ts`: 並び、絞り込み、大文字小文字、0 件、`currentBranch` と `GitBranch.current` のずれ、疑似項目の除外(`currentBranch` が null のときと、`branches` が古く非 null のとき。後者は初期選択にもならない)、`currentBranch` が null のときに古い `current: true` の実在のブランチが残ること、`branches` に無い場合の追加、初期選択。
- `BranchQuickPick`: 開いたときのフォーカス、↑↓ の循環、Enter・クリックの確定、現在のブランチの確定、0 件の Enter、押せない状態の確定、Escape、オーバーレイ(`detail: 0` の click で閉じ、`detail: 2` で閉じず、そのとき mouseup で入力欄へフォーカスが戻る)、Tab、IME、Enter のキーリピート(`fireEvent.keyDown` の `repeat: true`)、絞り込みの変更と一覧の変更後の選択、ARIA。
- `StatusBarBranch`: ブランチ名の動的表示、detached の表示、実行中の文言、押せない状態、失敗の表示、`pendingBranchOperation` が解けた後に `activeElement` がボタンになること、ボタンの Enter のリピートの抑止(jsdom は keydown から click を合成しないため、`fireEvent.keyDown` の戻り値で固定する。`repeat` の Enter は false、`repeat` の無い Enter と `repeat` の Space は true)。
- `useGitBranchOperations`: `clearBranchOperationError`。

既存の更新:

- `gitService.test.ts`・`gitService.status.integration.test.ts`: `getBranches` の `isDetachedHead`。detached(SHA・`refs/heads/main` の形)、rebase 中、bisect 中に疑似項目だけに印が付くこと、ブランチ上では欄が付かないこと(実 git で固定)。
- `StatusBar.test.tsx`: 必須の `branch` prop を渡す。リポジトリ外で出ないことを足す。
- `HistorySection.test.tsx`: ブランチ名を出さず、タグを出す。
- `GitRepoView.test.tsx`: ブランチのバッジのクラスの参照をやめる。
- `docs/manual-test-spec.md`: BASE-015 の固定表示の記述を直す。GIT-070 をタグだけの内容に直し、GIT-071・GIT-072 を消す(欠番は許容)。ブランチのバッジに依存する BRN-042、RMT-025、前提の `「履歴」のバッジは、ブランチ名に続けてすべてのタグ名を並べる` も直す。新機能の項目を足す。未保存の確認に Enter のリピートが届かないかの確認もここに含める。
