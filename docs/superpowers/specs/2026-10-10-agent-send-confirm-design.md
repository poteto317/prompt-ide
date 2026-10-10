# エージェントへの送信前の確認 設計書

- 日付: 2026-10-10
- ROADMAP の項目: 「エージェント実行の支援（MVP の次）」→「送信前の確認 / プレビュー（変数を差し込んだ後のプロンプトを確かめてから送る）」
- 前提の設計書: `2026-10-04-agent-terminal-mvp-design.md`（プロンプトの送信）、`2026-10-09-agent-multi-session-tabs-design.md`（送り先は押した時点のタブ）、`2026-10-10-agent-activity-notification-design.md`（設定の保存の形）

## 目的

プロンプトの `実行` を押してからエージェント（`claude`）へ送るまでの間に、変数を差し込んだ後の全文と送り先のタブを確かめられるようにする。
意図しない内容（変数の入れ間違い・別のプロンプト）や意図しないタブへ送るのを防ぐ。

## 決めたこと（利用者の確認済み）

| 項目 | 決定                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 形   | 確認のダイアログ。差し込んだ後の全文・送り先のタブ・文字数を出し、`送信` と `キャンセル` を選ぶ。送れない理由（空・長すぎる・先頭が `!`）はここで先に出す |
| 条件 | 設定画面にオン・オフ（既定はオン）。オンなら変数の有無に関わらず毎回確認する                                                                              |
| 編集 | 読むだけ。直したいときはキャンセルしてプロンプト（または変数）を直す                                                                                      |
| 対象 | エージェント CLI 方式だけ。従来の方式（API・非対話 CLI）は今のまま                                                                                        |

## 範囲

含めるもの:

- 送る文字列の確認のダイアログ（全文・送り先・文字数・送れない理由）
- 送信の流れへの差し込み（設定がオンのとき、送る前にダイアログを開く）
- 設定（保存・IPC・hook・設定画面の節）

含めないもの:

- 確認の画面での本文の編集
- 従来の方式での確認
- 送信のキーボードショートカットの追加（今は存在しない）

## 流れ

1. プロンプトの `実行`（変数があれば変数のフォームの `実行`）で、変数を差し込んだ文字列ができる（今のまま。`PromptItem` → `usePromptRunner.runPrompt`）。
2. `usePromptRunner.runPrompt` はエージェント CLI 方式なら今のとおり `sendToAgent` を呼ぶ（戻り先を探すためにプロンプトの `id` も渡す以外は変えない）。`useAgentWorkspace` の `sendToAgent` は、設定がオン（読み込み中〈`null`〉は既定の `DEFAULT_AGENT_SEND_CONFIRM_ENABLED` に従う。既定はオン）なら、すぐには送らず確認を開き、`undefined` ですぐに resolve する（戻り値の型は今と同じ `useAgentPromptSender.send` の戻り値〈`Promise<AgentSendOutcome | undefined>`〉。`usePromptRunner` は結果を見ない）。確認を開いた時点の選択中のタブを送り先（`useAgentPromptSender` の `AgentSendTarget` = `{ slotId, controller }`）と、その時点のタブの名前として控える。
   - 設定がオフなら、今のとおりすぐ送る。
   - 確認がすでに開いていれば、新しい依頼は無視する（二重に開かない）。
3. ダイアログで `送信` を押すと、控えた送り先へ送る（既存の `useAgentPromptSender.send` を、控えた送り先で呼ぶ）。ダイアログは押した時点で閉じる。フォーカスは送信が終わるのを待ってから移す（送れたら送り先のターミナル、失敗したら同じプロンプトの `実行`。送信中に利用者が別の場所へ移していれば移さない。「ダイアログ」の閉じたときのフォーカス）。送った結果（成功・失敗の文言）は今のとおりプロンプトパネルに出る。確認を開いた時点で、前の送信の結果（失敗の文言・成功の通知）は消す（`useAgentPromptSender.clearResult`。確認を挟むと `send` の `setError(null)` が `送信` まで呼ばれず、前の失敗の文言が今のプロンプトの文言に見えて残るため。ローカルレビュー第 21 周で追加）。
4. `キャンセル`・`Esc`・背景を押す、で閉じる。何も送らない。

## ダイアログ

- `role="dialog"`・`aria-modal="true"`・`aria-labelledby`（見出し `送信前の確認`）・`aria-describedby`（送り先の段落。開いたときのフォーカスは `送信` なので送り先を説明として読ませる。送れない理由があるときはフォーカスが `キャンセル` になるので理由の段落も含める。本文は長くなりうるので含めない）。Tab の閉じ込めは既存の `useDialogFocusTrap`、背景のクリックは `useOverlayDismiss` を使う（開閉は `useAgentSendConfirm.pending` が持つので、開閉の state を自分で持つ `useDialogFocusReturn` は使わない）。開いたら `送信` ボタンにフォーカスを置く。
- キーリピートの `Enter`・`Space` の keydown は、ボタン（`送信`・`キャンセル`）が対象のときだけ、ダイアログの capture で既定の動作を止める（`e.repeat` のとき `preventDefault()`）。本文の領域の `Space` のリピートはスクロールなので止めない。一覧の `実行`・変数のフォームで押した `Enter` を押し続けると、リピートの keydown が開いた直後の `送信` を押し、全文を読む前に送られるため。逆向きも止める: 一覧の `実行` ボタン（`PromptItemView`）にも、リピートの `Enter`・`Space` の keydown で `preventDefault()` する `onKeyDown` を付ける。`キャンセル` を `Enter` で押し続けると、フォーカスが戻った `実行` にリピートが届いて確認が開き直り、閉じないように見えるため（ローカルレビュー第 12 周で追加）。
- 背景（オーバーレイ自体）の mousedown は `preventDefault()` してフォーカスを動かさない。背景はフォーカスできない要素なので、押すとフォーカスが body へ落ちて `Esc`（ダイアログの `onKeyDown`）が届かなくなる。右クリック・中クリックや、背景で押して中で離したとき（閉じない押し方）も、フォーカスは `送信`（またはキャンセル）に残り、続けて `Esc` で閉じられる。閉じる判定（`useOverlayDismiss`）は mousedown・mouseup の target を記録するだけなので影響しない。
- 背景の click で閉じる判定から、連続のクリックの 2 回目以降（`e.detail > 1`）を除く（このダイアログの `onClick` で `useOverlayDismiss` の `onClick` の前に return する。共通の hook は変えない）。`実行` をダブルクリックすると、1 回目で開いた確認の背景に 2 回目の mousedown・mouseup・click が届き、開いた直後に閉じて変数の値も失われるため（ローカルレビュー第 10 周で追加）。同じ判定を `送信`・`キャンセル` の `onClick` にも入れる（`e.detail > 1` なら何もしない）。狭いウィンドウでは 2 回目の click が `送信`・`キャンセル` の上に落ち、全文を読む前に送られる・開いた直後に閉じて変数の値が失われるため。キーボードで押した click は detail が 0 なので影響しない（第 11 周で追加）。
- 寸法: `.agent-send-confirm` は `max-height: 100%` と `overflow-y: auto` を持ち、本文の領域は `min-height: 6em`（3 行分。これより縮まない）・`flex: 1 1 auto`・`max-height: 50vh`。ウィンドウが低く中身が収まらないときは、本文は 3 行分より縮まず、収まらない分はダイアログの中をスクロールして `送信`・`キャンセル` へ届く（オーバーレイはスクロールしないので、はみ出すとボタンが画面の外に出て押せなくなるため。ローカルレビュー第 12 周で追加）。
- 閉じたときのフォーカス:
  - `送信` で閉じたら、送信が終わるのを待ってからフォーカスを移す。送れた（`sent`）なら送り先のタブのターミナルへ（既存の `activateAgentTab(slotId)`）。失敗した（`failed`）・結果が無い（`undefined`。例外・ほかを送信中）なら、ターミナルへは移さず、同じプロンプトの `実行` ボタン（`data-prompt-run`）へ戻す（`usePromptRunFocus`。送信中は `実行` が disabled なので、送信中が解けた描画の後に移す。ボタンが無い・押せないなら何もしない）。
    - 送信の完了を待つのは、送信の前の準備（エージェントの変更の記録。最大 `AGENT_BEFORE_SEND_TIMEOUT_MS` = 10 秒）の間は sender がキー入力を保留しない（`beginSending` はその後）ため。先にターミナルへ移すと、その間に打った文字が `claude` へ直接届き、送信が失敗したとき（許可の確認や選択の画面が出ている）は、押し直した `Enter`・数字が選択肢を確定してしまう。
    - 送信の途中（ダイアログが閉じてから結果が出るまで）は、フォーカスはどこにも移さない（閉じたダイアログの中にあったフォーカスは body に落ちる）。
    - 利用者が移したフォーカスは奪わない。送信が終わった時点で、フォーカスが body へ落ちたままのときだけ移す。送信中に利用者が別の場所（エディタ・`Cmd+P` のクイックオープン・通知やステータスバーのまとめで選んだ別のタブ など）へ移していれば、送れた（`sent`）ときもタブの選択を戻さず（`activateAgentTab` を呼ばない。パネルを開くのは sender の `onSettled`）、ターミナルへも移さない。失敗のときも `実行` へ移さない。`usePromptRunFocus` も、送信中が解けた描画の後に移す直前に同じ条件を見る（結果が出てから送信中が解けるまでの間に移された場合のため）。見えているモーダルの背後や別のタブへ、続けて打った文字（`Enter` を含む）が届かないようにするため（`useAgentDiffFocusRestore` と同じ方針）。
  - `キャンセル`・`Esc`・背景で閉じたら、開いた時点の `document.activeElement` を控えておき、それがまだ DOM にあり disabled でなければそこへ戻す。外れている（変数のフォームの `実行` から開いた場合、フォームは閉じている）・disabled のときは、同じプロンプトの `実行` ボタン（`PromptItemView` の実行ボタンに新しく付ける `data-prompt-run={prompt.id}` で探す。変数のフォームの中の実行ボタンではない）へ戻す。それも無ければ何もしない（送り先のセッションが終わって `実行` が押せない状態など。フォーカスは body に残り、Tab で一覧から操作を続けられる。押せない `実行` の代わりの戻り先は設けない）。
- 表示:
  - 送り先: `送り先: claude 2`（`formatAgentTabLabel`）。
  - 本文: 送る全文（`normalizeAgentPrompt` と同じ正規化〈`cleanAgentPromptText`〉の後の文字列。`\r\n` を `\n` にそろえ、制御文字を除いたもの）を等幅で、改行を保って表示する（読むだけ。長い場合は枠の中でスクロールし、`tabIndex=0` でキーボードでもスクロールできるようにする。`aria-label="送る内容"`）。
  - 文字数: `1,234 文字`（正規化した後の文字列の `length`。上限 `AGENT_PROMPT_MAX_LENGTH` の判定と同じ基準）。
  - 送れない理由: 送る前の検査（`normalizeAgentPrompt` の `rejected` の `reason`。空・長すぎる・先頭が `!`）に当たれば、既存の文言（`AGENT_SEND_FAILURE_MESSAGES[reason]`）を `role="alert"` で出し、`送信` を押せなくする（`aria-describedby` で理由を参照）。
  - 送り先のタブが今は送れない状態（終了した・閉じる途中・ほかを送信中など）なら、その理由を出し、`送信` を押せなくする。送り先の状態は、控えた `slotId` で `agentSessions.tabs` から引き直し（`status`・`isClosing`）、送信中かどうか（`useAgentPromptSender` の全体で 1 つの `isSending`）と合わせて既存の `getPromptRunAvailability` に渡して求める。ダイアログを開いている間にタブの状態が変わった場合も追従する。送り先の名前は開いた時点の名前で固定する。
- 見た目は既存のダイアログ（`QuickOpenDialog`）と同じ系統の CSS。ダークテーマ・`prefers-reduced-motion` に合わせる。タッチで押せる大きさ（32px 以上）。

## 構成

### 送信前の確認の状態（新規 `src/renderer/src/hooks/useAgentSendConfirm.ts`）

- 引数: `{ selected, send, onSendSettled }`。`selected` は選択中のタブ（`AgentSendTarget` と名前 `label`）、`send` は控えた送り先へ送る関数（`useAgentPromptSender.send`）、`onSendSettled({ slotId, promptId, outcome })` は確認からの送信が終わった後に呼ぶ関数（`useAgentWorkspace` は、`outcome.kind === 'sent'` なら `activateAgentTab(slotId)`、それ以外は `usePromptRunFocus` で同じプロンプトの `実行` へ戻す関数を渡す）。
- 状態: `pending: { text: string; target: AgentSendTarget; label: string; promptId: string | null } | null`（型 `PendingAgentSend`）。`request` は参照が変わらないようにする（`sendToAgent` が `usePromptRunner` の `useCallback` の依存に入るため）。
- `request(text, promptId)`: 確認を開く（すでに開いていれば無視）。開いた時点の選択中のタブを `target` に、開いた元のプロンプトの `id` を `promptId` に控える。
- `confirm()`: `pending` をすぐ閉じて、控えた `target` で送る。送信が終わったら `onSendSettled` を呼ぶ（`send` が同期で投げても・拒否しても、`outcome: undefined` で `finally` で呼ぶ。L-053）。
- `cancel()`: 閉じる。
- 確認を開くか・すぐ送るかの判断（設定がオフなら `request` を呼ばずにすぐ送る。読み込み中は既定に従う）と、閉じる契機（方式・フォルダ・タブ）は呼び出し側（`useAgentWorkspace`）が持つ。

### 送る前の検査

- 長すぎる本文・先頭が `!` の本文でも全文と文字数を出すため、`normalizeAgentPrompt` の前半（改行の統一と制御文字の除去）を `cleanAgentPromptText` として `src/shared/agentPasteText.ts` に切り出し、`normalizeAgentPrompt` はそれを使う（振る舞いは変えない）。表示用の値（正規化した後の本文・文字数・送れない理由）は lib の純粋な関数 `buildAgentSendPreview`（新規 `src/renderer/src/lib/agentSendPreview.ts`）が求める。本文と文字数は `cleanAgentPromptText` の結果、送れない理由は `normalizeAgentPrompt` の `reason` から `AGENT_SEND_FAILURE_MESSAGES` の文言を引く（拒否の判定は `normalizeAgentPrompt` の 1 か所に保つ）。`sendAgentPrompt` は変えない。
- 送れない理由は 1 つだけ出し、本文の理由（空・長すぎる・先頭が `!`）を送り先の状態の理由より優先する。理由があるときは、開いたときのフォーカスを `送信` ではなく `キャンセル` に置く。

### 戻り先の目印（`PromptItemView.tsx`）

- プロンプトの一覧の `実行` ボタンに `data-prompt-run={prompt.id}` を新しく付ける（キャンセルで閉じたとき・送信が失敗したときのフォーカスの戻り先を探すため。探すのは `src/renderer/src/lib/promptRunButton.ts` の `findPromptRunButton`）。確認の `pending` には、開いた元のプロンプトの `id` も控える（`runPrompt` から `sendToAgent` へプロンプトの `id` を渡す。`usePromptRunner` は引数を増やすだけで、流れは変えない）。

### ダイアログ（新規 `src/renderer/src/components/agent/AgentSendConfirmDialog.tsx`）

- 外側は `pending` が `null` なら何も描画せず、開いている間だけ本体をマウントする。本体は表示の値を `buildAgentSendPreview` から求め、送れない理由は本文の理由（`preview.rejection`）を送り先の理由（`targetBlockedReason`）より優先して 1 つだけ出す。
- キャンセル・`Esc`・背景で閉じたときの戻り先は、DOM だけを見る関数 `findReturnFocusTarget(opener, promptId)` が探す（開いた時点の要素 → 同じプロンプトの `data-prompt-run`〈`findPromptRunButton`〉 → `null`）。

### 送信の流れの差し込み（`useAgentWorkspace.ts`）

- `sendToAgent(content, promptId)` は、設定がオン（読み込み中は `DEFAULT_AGENT_SEND_CONFIRM_ENABLED` に従う）なら `useAgentSendConfirm.request(content, promptId)`、オフなら今のとおり送る。
- 送り先を控えて送れるよう、`useAgentPromptSender.send(text, target)` をそのまま使う（今も送り先を引数で受ける）。
- ダイアログの状態（`AgentSendConfirmDialogState` = `pending`〈描画用の `AgentSendConfirmPending` = `{ text, slotId, label, promptId }`。controller は App へ出さない〉・`targetBlockedReason`〈送り先の今の状態の理由〉・`onConfirm`・`onCancel`。本文の送れない理由はダイアログが求める）を `AgentWorkspaceState` の `agentSendConfirmDialog` に足し、`App` で描画する。ダイアログの props と設定の節の props は省略できない形にし、配線の漏れを型と配線のテストで検出する（L-060）。

### 設定

- 型と既定値: `src/shared/types/settings.ts` に `DEFAULT_AGENT_SEND_CONFIRM_ENABLED = true`。
- 保存: `settingsFileStore.ts` の `SettingsFile` に `agentSendConfirmEnabled?: boolean`、`agentSendConfirmSettingStore.ts`（新規。通知の設定と同じ形）。
- IPC: `settings:getAgentSendConfirmEnabled`・`settings:setAgentSendConfirmEnabled`（`boolean` 以外は例外）。`src/main/handlers/settingsHandlers.ts`・`src/preload/api.ts`・`src/preload/index.d.ts`・`src/shared/types.ts`（再 export）・`settingsApi.ts` に足す。
- hook: `useAgentSendConfirmSetting`（`useAgentNotificationSetting` と同じ形。巻き戻しの処理を 2 か所に持たないよう、共通の `useBooleanSetting`〈`load`・`save`・既定値・失敗の文言の接頭辞を注入で受ける〉に切り出し、`useAgentNotificationSetting` もこれを使う。読み込み中は `null`。楽観的に反映し、保存に失敗したら最後に保存できた値へ戻す。続けて変えたときは後の変更の結果に任せる〈review-lessons L-406〉）。
- 設定画面: `SettingsPanel` に「送信前の確認」の節（チェックボックス `エージェントへ送る前に、送る内容を確認する`。説明 `変数を差し込んだ後の全文と送り先のタブを確かめてから送ります`）。節の名前とチェックボックスは `role="group"`・`aria-labelledby` で結び付ける（通知の設定の節と同じ）。表示と状態の出し分け（読み込み中は押せない・保存の失敗の `role="alert"`・ARIA の結び付け・タッチで押せる 32px の高さ）は共通の `BooleanSettingSection`〈値と操作は `BooleanSettingPanelState`〉が持ち、「送信前の確認」の節（`AgentSendConfirmSection`）と通知の設定の節（`AgentNotificationSection`）は文言だけを渡す。

## エラーと境界の扱い

- ダイアログを開いている間に実行方式が従来の方式へ変わった・フォルダが変わった場合は、ダイアログを閉じる（送らない）。
- ダイアログを開いている間に送り先のタブが閉じた場合は、ダイアログを閉じる（送らない）。
- ダイアログを開いている間に送り先のセッションが終了した（タブは残る）場合は、閉じずに理由を出して `送信` を押せなくする（キャンセルで閉じる）。
- ダイアログを開いている間に設定をオフにした場合は、開いたままにする（次の `実行` から確認しない）。
- ダイアログを開いている間に OS の通知を押した（通知の設計書「タブへ移る」）場合は、送らずに先にダイアログを閉じてから、そのタブへ移る（利用者が別の作業へ移ったので L-405 の契機とみなす。`useAgentWorkspace` が通知へ渡す `activateTab` を包む）。開いたままターミナルへフォーカスを移すと、閉じるつもりの `Esc`・`Enter` が覆われた背後の `claude` へ届くため。ステータスバーのまとめは、ダイアログの背景に覆われて押せないため対象外。
- 上の各行のうち画面から通れるもの（送り先のセッションの終了など）は実機テスト仕様書の項目と 1 対 1 で対応させる（L-297）。ダイアログを開いている間は背景が覆われるため画面から通れないもの（方式・フォルダの切り替え・送り先のタブを閉じる・設定をオフにする。OS の通知は画面の外から押せるので仕様書の項目にする）は、単体テストで確かめ、仕様書の項目にはしない。
- `送信` を押した後の失敗（入力欄が見つからない・貼り付けが反映されない など）は、今のとおりプロンプトパネルの `role="alert"` に出す。フォーカスはターミナルへ移さず、同じプロンプトの `実行` へ戻す。
- 二重送信: ダイアログは 1 つだけ開き、`送信` を押したら閉じる。送信中の二重送信は既存の `useAgentPromptSender` の守りのまま。

## 既知の制約（ROADMAP・実機テスト仕様書に反映する）

- 変数のフォームから開いた確認をキャンセルすると、入力した変数の値は残らない（もう一度 `実行` から入力する）。
- 確認の画面では本文を直せない。

## テスト

- 送れない理由の判定（`buildAgentSendPreview` が `normalizeAgentPrompt` の結果から文言を引く）: 空・長すぎる（正規化した後の長さで上限ちょうど・超える）・先頭が `!`・正常。
- `useAgentSendConfirm`: 開く・二重に開かない・送信で控えた送り先へ送って閉じる・送信が終わってから結果を知らせる（拒否・同期の例外でも結果なしで知らせる）・キャンセルで送らない。
- `useAgentWorkspace`: 設定がオンなら送らずに確認を開く、オフ（読み込み後）ならすぐ送る、読み込み中は既定に従う（既定がオンなら確認を開く・オフならすぐ送る）、従来の方式では確認しない、方式・フォルダの切り替えとタブを閉じたとき・通知を押したときに確認を閉じる、送れたら送信の完了の後にターミナルへ・失敗したら送信中が解けた後に同じプロンプトの `実行` へフォーカスを移す。送信が終わった時点でフォーカスが body 以外にあれば、タブの選択もフォーカスも変えない（ローカルレビュー第 2 周で追加）。確認を開いた時点で前の送信の結果を消す（`clearResult`。ローカルレビュー第 21 周で追加）。
- `useAgentPromptSender`: `clearResult` で前の送信の失敗の文言と成功の通知が消える（ローカルレビュー第 21 周で追加）。
- ダイアログ: 見出し・送り先・本文（正規化した後の文字列、改行を保つ）・文字数、送れない理由で `送信` を押せない、送り先の状態の理由（終了・閉じる途中・送信中）、`Esc`・背景・キャンセル、開いたときのフォーカス、キーリピートの `Enter`・`Space` で押さない、閉じたときの戻り（キャンセル → 控えた要素、変数のフォームから開いた場合 → 同じプロンプトの `実行` ボタン）、フォーカスの閉じ込め。説明（`aria-describedby`）に送り先を結び付ける、開いている間に `送信` を押せなくなったら `キャンセル` へフォーカスを移す、本文の領域のリピートの `Space` は止めない、背景の押下でフォーカスを動かさない（右クリック・外で押して中で離した後も `Esc` で閉じる）（ローカルレビュー第 5・7・8 周で追加）。連続のクリックの 2 回目（`detail > 1`）の背景・`送信`・`キャンセル` の click では閉じず・送らない（キーボードの `detail: 0` と 1 回目は動く）（ローカルレビュー第 10・11 周で追加）。ダイアログが `overflow-y: auto`・本文が `min-height: 6em`（3 行分。スタイルのテスト。第 13 周で `0` から `4.5em` に、第 14 周で border-box の padding と枠を含めて `6em` に変更）。一覧の `実行` へのリピートの `Enter`・`Space` の keydown は既定の動作を止める（`PromptItemView` のテスト。第 12 周で追加）。送れない理由があるときは、ダイアログの説明に送り先と理由の両方を含める（ローカルレビュー第 17 周で追加）。
- 設定: ストアの既定値・不正値・保存、IPC の検証、hook（楽観的な反映・失敗時の戻し・続けて変えたとき）、設定画面の節。
- 配線: `App` でダイアログが描画される、`useAppState` の受け渡し。

## 気をつける知見（dev-flow-kit の review-lessons.md）

- L-406（楽観的な更新の巻き戻しの競合）、L-156（見える文字を含むアクセシブルな名前）、L-053（途中の例外で後続が止まらない）、L-405（開いた UI を元の状態が終わる契機〈方式・フォルダ・タブ〉で閉じる）、L-060（配線の漏れを検出するテスト）、L-297（実機テスト仕様書の項目が確かめたい経路を通ること）。
