# ソース管理のパネルの配置(第 3 段階)

## 背景

ソース管理を VS Code と同じ形にする作業の最後の段階。第 1 段階(ステータスバーのブランチ)と第 2 段階(履歴のグラフ)は完了している。ここではパネルの配置を VS Code に合わせる。

利用者の選択:

- パネルのブランチ欄は消し、作成・削除・マージは左下の一覧へ移す
- コミットボタンの場所に「変更の同期」を入れる
- amend はコミットボタンの ▾ に置く

## 要件

### ツールバー

1. パネルの先頭の行に、見出し `ソース管理`、右に `更新` のアイコンのボタンと `…` のボタンを置く。`Sidebar` の `sidebar__header` が同じ見出しを出しているので、ソース管理のときだけ `sidebar__header` を出さない。`更新` のクラス `source-control-panel__refresh-btn` と `aria-label="更新"` は保つ(`useAgentChangesClearFocus` が探す)。
2. `…` を押すとメニューが開き、`プル`、`プッシュ`、`フェッチ` が並ぶ。無効の条件と、実行中の文言(`プル中...` など)は今と同じ。項目の名前は今の `aria-label` を保つ。
3. 初回 push の成功の後のフォーカスの移し先は `…` のボタンにする(`data-remote-setup-focus="push"` を移す)。`useRemoteSetupFocus.ts` のコメントと `RemoteSetupFlow.test.tsx` も直す。

### メニューの共通の動き

4. `ActionMenu` を新しく作り、`…` と ▾ の両方で使う。ボタンは `aria-haspopup="menu"`、`aria-expanded`。メニューは `role="menu"`、項目は `role="menuitem"` か `role="menuitemcheckbox"`。
5. 有効な項目が 0 件ならボタンを押せなくする。開いたら最初の有効な項目へフォーカスする。↑↓ で有効な項目を循環し、Home・End で先頭と末尾へ移す。Enter・Space で実行する。Escape で閉じてボタンへ戻す。外側のクリックで閉じ、フォーカスは奪わない。外側の判定はボタンを含むルート要素で行う(開いたままボタンを押して閉じるとき、開き直さない)。Tab は閉じて、次の要素へ移すのを止めない。メニューは右端をボタンに揃える(パネルの横スクロールを防ぐ)。
6. ボタンでも項目でも Enter のリピート(`event.repeat`)は `preventDefault` する。項目を実行すると閉じてボタンへフォーカスを戻す。戻す処理は `useDialogFocusReturn` の方式(閉じて押せるようになった描画の後、フォーカスが body のときだけ)とする。

### コミット欄

7. 入力欄を先頭に置き、その下に主ボタンと ▾ を横に並べる。主ボタンは幅いっぱいに広げる。
8. 主ボタンは `✓ コミット`。amend のときは `✓ コミット (amend)`。実行中は `コミット中...`。有効の条件は今と同じ。`✓` と `↻` は `aria-hidden` で、ボタンの名前は `コミット` / `コミット (amend)` にする。
9. ▾ のメニューに `前回のコミットを修正 (amend)` の `menuitemcheckbox` を置く。無効の条件と、選んだときのメッセージの扱いは今の amend のチェックボックスと同じ。チェックボックスは消す。
10. 次のすべてを満たすときは、主ボタンを `変更の同期` にする。ステージ済みが 0 件、`message.trim() === ''`、amend でない、マージ中でない(`mergeInProgress`)、`ahead > 0` または `behind > 0`。`isSyncing` の間はこの判定より先に `同期中...` を出す。文言は `↻ 変更の同期 ↓<behind> ↑<ahead>` で、0 の側は出さない。`aria-label` は `変更を同期(プル <behind> 件、プッシュ <ahead> 件)`。
11. 実行中は `同期中...` で押せない。`isSyncBlocked` の間も押せない。コミットの直後に同じ位置のボタンが同期に変わるため、同期の実行は `event.detail > 1` を無視し、主ボタンの Enter の `repeat` を `preventDefault` する(ダブルクリックやリピートで確認なしにプッシュしない)。押した側だけがフォーカスの戻しを予約する。パネルの主ボタンから実行したときは、完了後にフォーカスが body ならメッセージ欄へ移す。

### 変更の同期

12. `useGitRemoteOperations` に `syncChanges()` を足す。`behind > 0` ならプルし、失敗・未実行・コンフリクトならプッシュしない。成功し、開始時に `ahead > 0` ならプッシュする。プルの間にフォルダが切り替わったらプッシュしない。マージ中は実行しない。`isSyncing` を持ち、両方の完了まで true にする。`isSyncBlocked` を `isRemoteOperationDisabled || isPulling || isPushing || mergeInProgress || (behind > 0 && isPullBlocked) || (ahead > 0 && isPushBlocked)` として返す。
13. simple-git の `git.pull()` は、コンフリクトで例外になる場合とならない場合がある(マージで fetch 前と rebase は例外、マージで fetch 済みと autostash の復元は例外なし。git 2.50.1 で実測)。main の `pull` は例外の有無によらず `status.conflicted` で判定し、`{ conflicted: boolean; errorMessage?: string }` を返す。公開の `pull` は `errorMessage` があれば今までどおり表示する。`syncChanges` はコンフリクトのとき `remoteOperationError` に `プルでコンフリクトが発生しました。解決してからもう一度同期してください` を出す。この通知は、`gitStatus.files` の未解決のファイルが無くなったら消す(別のエラーに置き換わっていれば消さない。rebase は `mergeInProgress` が true にならないため、ファイルで判定する)。失敗も `remoteOperationError` に出る。
    13a. 実行中の操作がフォルダの切り替えの後に終わった場合、前のフォルダの失敗やコンフリクトの文言は新しいフォルダに出さない。
14. VS Code の初回の確認ダイアログは入れない。

### ステータスバー

15. ブランチの項目の右に、`ahead > 0` または `behind > 0` のとき同期のボタン `↓<behind> ↑<ahead>` を出す(0 の側は出さない)。押すと `syncChanges` を実行する。`aria-label` は要件 10 と同じ。押せない条件は要件 11 と同じで、`event.detail > 1` と Enter の `repeat` も同じく無視する。押した側だけがフォーカスの戻しを予約する。完了後にフォーカスが body なら、ボタンが残っていれば同期のボタンへ、消えていればブランチの項目へ移す。
15a. ステータスバーの失敗の表示に `remoteOperationError` も出す。両方あれば、別の項目として両方出す。同期の失敗が、別のパネルのときも分かるようにする。フォルダの切り替えで `remoteOperationError` も消す(`clearRemoteOperationError` を足す)。

### ブランチの操作

16. パネルのブランチ欄(`BranchSwitcher`、`ahead` / `behind` の表示)を消す。`BranchSwitcher.tsx`、`BranchSwitcherMenu.tsx`、`BranchMenuItem.tsx`、`branchMenuShortcut.ts` を消す。
17. 一覧の先頭に `＋ 新しいブランチを作成…` の項目を置く。絞り込みの影響を受けない。`↑↓` の循環に含む。開いたときの選択は今のまま(第 1 段階の要件 18)。確定すると一覧を `closeWithoutReturn` で閉じ、既存の `CreateBranchDialog` を開く。ダイアログを閉じたらブランチの項目へフォーカスを戻す。ダブルクリックの 2 回目でダイアログが閉じないよう、`NameInputDialog` のオーバーレイの閉じ方を `event.detail > 1` を無視する形にする。ダイアログに `isBlocked` を渡し、押せない状態の間は OK を押せなくして案内を出す(`CreateTagDialog` と同じ)。第 1 段階の要件 22(候補が 0 件の Enter は何もしない)は、この要件で上書きする。ブランチの候補が 0 件のときは作成の項目が選択中になり、Enter で作成のダイアログを開く。絞り込みの文字は、前後の空白を除いてダイアログの初期値に引き継ぐ。0 件の Enter でも、作成の項目を確定した場合でも同じ。初期値の動きは `NameInputDialog` の `initialValue` に合わせ、全選択にはしない。
18. 現在のブランチ以外の行の右に、`マージ` と `削除` のボタンを出す。ボタンは Tab の停止点にしない。押してもフォーカスは入力欄に残り、一覧は閉じてから操作を呼ぶ。行の `onClick` へ伝えない(`stopPropagation`。押せない状態の押下も同じ)。確認は既存のとおりフック側が出す。
19. キーボードでは、選択中の行に対して `Alt+M` でマージ、`Shift+Delete` または `Shift+Backspace` で削除する。絞り込みの入力と衝突しないよう、修飾キーを付ける。macOS の `Alt+M` は `e.key` が `µ` になるため、`e.code === 'KeyM' && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey` で判定する。削除は `Shift` だけを押したときに限る。判定に当たったキーは、何もしない場合も含めて必ず `preventDefault` し、`e.repeat` は無視する。IME の変換中は反応しない。入力欄に `aria-keyshortcuts="Alt+M Shift+Delete"` を付ける。現在のブランチと `＋ 新しいブランチを作成…` が選択中のときは何もしない。
20. 押せない状態の間は、作成・マージ・削除も実行しない(第 1 段階の要件 24 と同じ)。

### セクション

21. `CollapsibleSection` を新しく作り、`ステージされている変更`、`変更`、`退避`、`履歴` で使う。見出しは `AgentChangesSection` と同じ `h3 > button` で、`aria-expanded` と `aria-controls` を持つ。左に開閉の印、右に件数のバッジ(0 件や無いときは出さない)と、操作のボタンの枠を持つ。操作のボタンは見出しのボタンの外に置く。`.source-control-panel__section-title` は `AgentChangesSection` も使うので消さない。
22. 既定は開いた状態。閉じても中身はアンマウントせず `hidden` にする(入力中の状態を失わない)。`CollapsibleSection` は `alwaysVisible` の枠(見出しと本体の間)を持ち、見出しの操作のエラー(`role="alert"`)をここに置く(閉じていても見える)。ダイアログは `section` の外(Fragment の中)に置く。履歴の `history-section__error` はログの取得の失敗で、閉じていると失敗が見えないので `alwaysVisible` に置く。開閉の状態は保存しない。
23. `履歴` の見出しの操作に `タグを作成`、`変更` の見出しの操作に `すべて取り消す`、`退避` の見出しの操作に `退避する` を置く。
24. `変更はありません` の文は消す。

### ファイルの行

25. 1 行は高さ 22px で、左から、ファイル名、薄い色のフォルダのパス、操作のボタン、状態の文字の順に並べる。構造は `li` の中に `button`(差分を開く)、操作の枠、状態の文字を兄弟として並べ、`button::after` を `li` いっぱいに広げて行の全体を押せるようにし、操作の枠は `z-index` で上に置く(button の入れ子はできない)。省略記号は内側の `span` に付ける。全文を `title` に入れる。エージェントの行へ波及しないよう、新しいクラスで分ける。
26. 操作のボタンは、行の hover と `:focus-within` のときだけ見える。`@media (hover: none)` では常に見える。`opacity` で隠し、Tab の順は変えない。`aria-label` は今のまま。
27. 状態の文字の色は VS Code の既定に合わせる。`isConflictedFile` を先に判定してコンフリクトは `#F48771`(`U`・`A`・`D` の文字でも)。それ以外は `M`・`R`・`C`・`T` が `#E2C08D`、`A`・`U` が `#73C991`、`D` が `#F48771`、その他は `#CCCCCC`。背景 `#252526` と hover の背景の両方で 4.5:1 を満たす。
28. 状態の文字は「変更」「ステージされている変更」の両方で同じ形にする。

## 構成

- `src/renderer/src/components/source-control/ActionMenu.tsx`(新規)
- `src/renderer/src/components/source-control/CollapsibleSection.tsx`(新規)
- `src/renderer/src/lib/filePathParts.ts`(新規): `splitFilePath(path)`
- `src/renderer/src/components/source-control/GitFileRow.tsx`(新規): 「変更」と「ステージされている変更」の共通の行
- `src/renderer/src/components/StatusBarSyncButton.tsx`(新規): ステータスバーの同期のボタン
- `src/renderer/src/lib/syncChangesLabel.ts`(新規): 同期の文言の共通化
- `src/renderer/src/hooks/useRunExclusiveGitOperation.ts`: フォルダの切り替えの後の結果を捨てる `isResultStale`
- `SourceControlToolbar.tsx`、`CommitSection.tsx`、`ChangesSection.tsx`、`ChangesFileItem.tsx`、`StagedSection.tsx`、`StashSection.tsx`、`HistorySection.tsx`、`GitRepoView.tsx`、`SourceControlPanel.tsx`
- `BranchQuickPick.tsx`、`StatusBarBranch.tsx`、`src/renderer/src/lib/branchPicker.ts`
- `src/renderer/src/hooks/useGitRemoteOperations.ts`、`useAppState.ts`、`App.tsx`、`Sidebar.tsx`
- `src/main/gitService.ts`、`src/renderer/src/lib/gitApi.ts` など: `pull` の結果
- `NameInputDialog` の閉じ方、`CreateBranchDialog`
- `src/renderer/src/assets/main.css`

## 決めたこと

- `すべてステージ`・`すべてアンステージ`、コミットメッセージの自動の高さ、開閉の状態の保存、右クリックのメニュー、ツリー表示、ファイルの種類のアイコンは入れない。1 つの PR に収めるため。`ROADMAP.md` に残す。
- `主ボタンの同期` の確認ダイアログは入れない。プッシュはプルの成功の後だけ行う。
- 行の `マージ`・`削除` のキーは `Alt+M`・`Shift+Delete` にする。今の `M`・`Delete` は入力欄の文字入力と衝突する。

## 既知の制約

- 同期の途中でプルに成功してプッシュに失敗すると、プルの分だけ反映された状態で止まる。エラーはパネルとステータスバーで分かる。
- 分岐した状態(`↓1 ↑1`)で `pull.rebase` などが未設定だと、Git が `divergent branches` のエラーを返し、同期は止まる。
- コミットしていない変更があるとプルが失敗することがある。エラーを出して止まる。

## テスト

- `ActionMenu`: 開閉、フォーカス、↑↓・Home・End、無効の項目の飛ばし、Escape、外側のクリック、Tab、`menuitemcheckbox`、閉じた後の戻り。
- `CollapsibleSection`: `aria-expanded`、`hidden`、中身の state が残ること、件数、操作のボタンが見出しのボタンの外にあること。
- `splitFilePath`: 直下、フォルダ、日本語、末尾。
- `useGitRemoteOperations.syncChanges`: プルだけ、プッシュだけ、両方、プルの失敗でプッシュしない、未実行でプッシュしない、コンフリクトでプッシュしない、フォルダの切り替えでプッシュしない、マージ中に実行しない、前のフォルダの失敗を残さない、通知の消え方、`isSyncing`。
- `gitService.pull`: 実 git のマージと rebase、fetch 前と後の 4 通りのコンフリクト。
- `CommitSection`: 主ボタンの切り替え(要件 10 の条件の 1 つずつ)、▾ の amend、無効の条件、同期の文言。
- `BranchQuickPick`: 作成の項目、絞り込みの影響を受けないこと、`Alt+M`、`Shift+Delete`、現在のブランチと作成の項目で反応しないこと、IME、押せない状態、行のボタン。
- `StatusBarBranch`: 同期のボタン、作成のダイアログ、閉じた後のフォーカス。
- `SourceControlToolbar`、`ChangesFileItem`、`StagedSection`、`HistorySection`、`GitRepoView`、`SourceControlPanel`、App 系: 新しい配置に合わせる。初回 push の後のフォーカスの移し先。
- CSS: 行の高さ、hover のときだけの表示、`hover: none`、状態の色のコントラスト。
- `docs/manual-test-spec.md`: 操作の場所が変わる項目(`amend`、`プル`、`プッシュ`、`フェッチ`、ブランチの操作の BRN、`ステージ済み`、`変更はありません` など)を ID を変えずに直し、新しい項目を足す。
