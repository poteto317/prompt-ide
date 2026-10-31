# 送信前の確認の引数欄 設計書

## 目的

プロンプトの実行時に、その回だけの値を渡せるようにする。送信前の確認のダイアログに自由入力の `引数` 欄を置き、`/review` というプロンプトに `123` を渡して `/review 123` と送れるようにする。

プロンプトの保存内容は変えない。

## 決めたこと

- 引数は自由入力の欄 1 つ。`{{変数}}` の入力フォームはそのまま残し、確認画面へは移さない(ユーザーの選択)
- 引数を渡せるのは確認のダイアログが出るときだけ。設定の「送信前の確認」がオフのとき、従来の方式では何も変えない(ユーザーの選択)
- 1 行の入力欄にする。改行を入力できない。貼り付けた改行の扱いは `<input type="text">` の既定の動作に任せる
- 引数は本文の直後に、半角空白 1 つで繋ぐ。参照として添えたファイルの一覧より前に置く(`/review 123` の形を崩さないため)
- 引数は前後の空白を除く。空なら本文を 1 文字も変えない
- 開いたときのフォーカスは、送れるなら引数欄へ移す。入力欄の `Enter` は `送信` と同じ。送れない理由があるときは今までどおり `キャンセル` へ移す
- 引数は保存しない。キャンセルすると捨てる
- 履歴の詳細の `再実行` で開いた確認にも欄を出す。履歴に記録されるのは引数を含む全文で、次の `再実行` では欄は空になる

## 画面

`送信前の確認` のダイアログの文字数の下、`送信` の上に `引数（任意）` のラベルと入力欄を置く。

- 入力に合わせて、本文(`送る内容`)と文字数を更新する。送れない理由(空・長すぎる・先頭の文字)も入力後の全文で判定し直す
- 送り先のタブが送れない理由は今までどおり
- 送れない理由が出ていても入力欄は押せる(引数で解消できる場合があり、入力中にフォーカスを奪わない)
- 開いている間に送信を押せなくなっても、フォーカスが入力欄にあれば移さない
- 入力欄の見た目は `.agent-send-confirm__body` と同じ背景・枠・文字色・文字サイズにする

## 組み立て

新しい純粋関数 `appendAgentPromptArgument(text, argument)`(`lib/agentPromptArgument.ts`):

- `argument.trim()` が空なら `text` をそのまま返す
- `text` の末尾の空白を除き、空なら引数だけ、そうでなければ `本文 引数` を返す

`AgentSendOptions` に任意の `composeText?: (argument: string) => string` を足す。

- `buildAgentPromptRequest` は、変数を差し込んだ本文へ引数を付けてから参照の写しを足す関数を渡す
- 渡されないとき(履歴の `再実行`)は、`useAgentSendConfirm` が `appendAgentPromptArgument(text, argument)` を使う
- `PendingAgentSend` と `AgentSendConfirmPending` は `text` を外して必須の `composeText` を持つ。全文の出どころをこの関数の 1 つにし、ダイアログの表示と `confirm` は同じ関数で全文を作る
- `sendToAgent` の引数 `text` は残す(すぐ送る経路が使う)。`buildAgentPromptRequest` の `text` は `composeText('')` で作る

`AgentSendConfirmDialogState.onConfirm` と `useAgentSendConfirm.confirm` は `(argument: string) => void` に変える。引数の値はダイアログの中の state で持つ。確認を経由しない送信の内容は変えない。

## 履歴の記録

実際に送った全文を履歴に残す。今は `usePromptRunner` が組み立て時の本文を記録するため、そのままでは引数が履歴に入らない。

- `AgentSentHandler` を `(sentTo, cliKind, sentText)` に変える
- `notifyAgentSent(outcome, onSent, text)` は `send` へ渡した全文(正規化の前)を受け取る。確認の経路は `composeText(argument)` の結果、すぐ送る経路は `text` を渡す
- `usePromptRunner` の一覧の実行と履歴の `再実行` の 2 か所は `sentText` を記録する

入力欄は `AgentSendArgumentField`(`components/agent/`)に分ける。値と確定の処理はダイアログから受け取る。

## キーボード

- 入力欄の `Enter` は、IME の変換中(`nativeEvent.isComposing` または `keyCode === 229`)とキーリピートでは送らない。送れない理由があるときも送らない
- 確定の `Enter` は既定の動作を止める
- ダイアログの `onKeyDownCapture` のキーリピートの止め方を入力欄にも広げる。`実行` で押し続けた `Enter`・`Space` が、開いた直後の欄に届いて送信や空白の入力にならないようにする(L-408)
- `Esc` は今までどおりダイアログを閉じる。変換の取り消しの `Esc` では閉じない
- Tab の順は 本文 → 引数欄 → `送信` → `キャンセル`。フォーカスはダイアログの中で回る

## 既知の制約

- 改行を含む引数は渡せない
- キャンセルすると入力した引数は残らない
- `再実行` は履歴の全文の末尾へ付ける。参照の一覧を含む履歴では一覧の後ろに付く
- 確認がオフのときは引数を渡せない
- 本文が空のとき、引数の先頭の空白は保てない(先頭の `!` は送れない理由のまま)

## テスト

- `appendAgentPromptArgument`: 空、空白だけ、末尾の空白・改行、空の本文、前後の空白
- `buildAgentPromptRequest`: 参照があるとき引数が一覧より前に入る
- `useAgentSendConfirm`: `confirm(argument)` が `composeText` の結果を送る。既定の組み立て
- `notifyAgentSent` の第 3 引数と、`usePromptRunner` の一覧の実行・`再実行` が引数を含む全文を履歴に記録すること
- ダイアログ: 入力で本文と文字数が変わる、送れない理由の判定し直し、開いたときのフォーカス、`Enter`、変換中(`isComposing`・`keyCode` 229 の両方)とリピートの `Enter`、`送信` が引数を渡す
- `main.css`: 入力欄が本文の枠と同じ背景・枠・文字色・文字サイズ
- 既存の `AgentSendConfirmDialog.test.tsx` の `送信` へのフォーカスの検査と、`agentSendCallbacks`・`onSent` のテストを新しい動作に直す
- `text` の除去と `confirm(argument)` に合わせて、`useAgentSendConfirm.test.ts`・`useAgentWorkspace.test.ts`・`AgentSendConfirmDialog.test.tsx` の `makePending` を直す(既存の検査の意味は変えない)
- 実装を戻すと落ちることを確かめる

`AgentSendConfirmDialog.tsx` の、本文の理由は「キャンセルして直すしかない」、開いたときのフォーカス、Tab の対象を説明するコメントも直す。

実機の確認は `docs/manual-test-spec.md` に追記する。既存の項目は ID を変えずに直す: AGT-151(開いたときのフォーカス)、AGT-155(Tab の順)、AGT-156(読み上げ)、AGT-160・AGT-171(引数欄に残る)、AGT-169(引数欄にある)。
