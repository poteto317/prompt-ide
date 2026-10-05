# `agentScreens.json`（`claude` の画面の台帳）

`agentInputBox.test.ts` が、`claude` の入力欄の判定（`findInputBox`・`isInputBoxEmpty`・`isPasteEchoed`）を実物の画面で固定するための台帳。
`claude` 2.1.288・node-pty 1.1.0・`@xterm/headless` 6.0.0 で、28 の画面（空・書きかけ・複数行・`[Pasted text #N]`・シェルのモード・`/` の候補・
入力欄が画面を超えた・作業中・送信待ち・信頼の確認・全画面の表示の案内・許可の確認・応答の表示中・ツールの実行中など）を記録した。

形式: `screens.<名前>.lines` は 行番号 → `[文字列, dim の範囲, 反転の範囲]`（範囲は `[開始, 終わり)` のセルの位置）。文字列は幅 0 のセル
（全角の文字の右半分）を除いたセルの文字を連結し、末尾の空白（dim・反転でないもの）を除いたもの。入力欄の記号の後ろの U+00A0 は
JSON のエスケープ（`\u00a0`）で書かれている。**prettier やエディタで整形しない**（実物の文字に変わる・差分が大きくなる）。`.prettierignore` で `npm run format` の対象から外している。

## `claude` の版を上げたら記録し直す

入力欄の見え方（罫線・記号・U+00A0・字下げ・カーソルの反転・案内の dim）は `claude` の版で変わりうる。版を上げたら、記録用のスクリプト
（プランの作成時の `.superpowers/agent-terminal-mvp/agent-screens-recorder/`。隔離した設定ディレクトリ・ダミーの API キー・閉じたポートで、
Anthropic の API に接続せずに記録する）で記録し直し、下の「個人情報の置き換え」をかけてから写し、`agentScreensFixture.test.ts` の
`AGENT_SCREENS_SHA256` を更新してテストを流す。

## 個人情報の置き換え（この台帳の作り方）

記録した画面には、記録した端末のユーザー名・UID・ホームのパス（記録時の一時ディレクトリ）と、セッションの UUID が出ていた
（ヘッダーの作業ディレクトリ、信頼の確認・許可の確認の画面のパス）。リポジトリには、それらを**同じ長さの ASCII の中立な文字列**に
置き換えたものを置く。置き換えるのは文字列の中身だけで、行の位置・セルの位置・罫線・入力欄の記号・U+00A0・dim と反転の範囲は変えない
（置き換えたのは ASCII のパスの部分だけなので、表示幅も変わらない）。JSON は読み直さず、ファイルの文字列のまま置き換える（整形・エスケープを保つ）。

- 元の台帳: `.superpowers/agent-terminal-mvp/agent-screens.json`（リポジトリの外。SHA-256 `95518dc8e65f2deb885a50e323053a65bf5fc0d15e9436b66c897c7893af800d`。プランの差異 22 の値と一致することを、写す前に確かめた）
- 置き換えた後（このディレクトリの `agentScreens.json`）: SHA-256 `6e9c974e411fcff545460a5b739089ca3c6ce5d309823453889556d8eda36c8d`（`agentScreensFixture.test.ts` で固定）
- 変わった行: 30 行（ヘッダーの作業ディレクトリ 25 行・信頼の確認のパス 1 行・許可の確認の 2 画面で折り返されたパス 4 行）。ファイルの大きさは同じ

置換の規則（決定的。この順にかける）:

1. 記録時の一時ディレクトリ `/private/tmp/claude-<UID>/-Users-<ユーザー名>-<…>`（正規表現 `/private/tmp/claude-\d+/-Users-[^/"]+`）を、
   `/home/user/project/` の後ろを `x` で埋めた同じ長さの文字列にする
2. UUID（`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`）の 16 進の文字をすべて `0` にする（`-` は残す）
3. 画面の右端で 2 行に折り返された UUID（ある行の文字列の末尾と、次の行の文字列の字下げの後をつなげると UUID になるもの）も、
   両方の 16 進の文字を `0` にする

置換のスクリプト（`python3 sanitize.py <元の agent-screens.json> <写し先の agentScreens.json>`）:

```python
import re
import sys

src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding='utf-8').read()
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
NEUTRAL_PREFIX = '/home/user/project/'


def zero_hex(s):
    return re.sub(r'[0-9a-f]', '0', s)


def neutral_path(m):
    n = len(m.group(0))
    assert n >= len(NEUTRAL_PREFIX)
    return NEUTRAL_PREFIX + 'x' * (n - len(NEUTRAL_PREFIX))


# 1. 記録時の一時ディレクトリ
text = re.sub(r'/private/tmp/claude-\d+/-Users-[^/"]+', neutral_path, text)
# 2. UUID
text = UUID.sub(lambda m: zero_hex(m.group(0)), text)


# 3. 折り返された UUID。JSON では画面の行ごとに別の配列なので、間の `"` `],` `"<行番号>": [` `"` と字下げを挟んでつなげて判定する
def wrapped(m):
    head, gap, tail = m.group(1), m.group(2), m.group(3)
    if UUID.fullmatch(head + tail) is None:
        return m.group(0)
    return zero_hex(head) + gap + zero_hex(tail)


text = re.sub(r'([0-9a-f-]+)("\n\s*\],\n\s*"\d+": \[\n\s*" *)([0-9a-f-]+)', wrapped, text)

open(dst, 'w', encoding='utf-8', newline='').write(text)
```

置き換えの後、元の台帳と置き換えた台帳の両方に同じ判定（全画面の `findInputBox` の記号・行数、`isInputBoxEmpty`）をかけ、結果が
一致することを確かめた。個人情報（`/Users/`・`-Users-`・`/home/user/` 以外のホーム・`claude-<UID>`・`/private/tmp`・ゼロ以外の UUID・メールアドレス・`sk-`・`ghp_` など。ユーザー名や UID の実値はテストにも書かない）が
含まれないことは `agentScreensFixture.test.ts` で固定している。記録し直したときに新しい種類の個人情報（別のパスの形など）が出たら、
規則とテストの両方に足す。
