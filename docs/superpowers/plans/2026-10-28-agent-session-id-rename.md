# エージェント CLI の会話の ID の名前を CLI の種類を問わない名前にそろえる 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェント CLI（claude・copilot）の会話の ID を表すコード上の名前（`claudeSessionId` とその仲間の変数・欄・関数・型・ファイル名）と、doc コメント・テストの題・ログ・例外の文言を、CLI の種類を問わない名前（`cliSessionId` など）にそろえる。保存の欄名 `agent.claudeSessionId`（実行履歴の `AgentHistoryInfo.claudeSessionId`）は変えず、古い版のアプリとの読み書きでデータが消えないことを、文字列でディスクの形を固定するテストで確かめる。アプリの挙動は変えない。

**Architecture:** 先に保存の欄名を固定するテストを足し（Task 1）、shared の形式の検証（Task 2）→ IPC の 4 つの型の欄と、それにスプレッドされる starter の欄（Task 3）→ main の中の名前とファイル名（Task 4）→ renderer の中の名前（Task 5）の順に改名する。各タスクの終わりで型検査とテストが通る境界にした（L-609）。置き換えは、計画の時点で写しに順にかけて確かめた Python のスクリプト（共通のエンジン + タスクごとの表）で行う。エンジンは語の単位（`grep -w` と同じ）で当て、ファイルの件数・行の件数が表と合うことを全部確かめてから書き込む。型検査で見つからない値（型の付かないテストの値・文字列で書いた欄名）は、表の行の指定と各タスクの終わりの grep で捕まえる。

**Tech Stack:** TypeScript 5.9, Vitest 4, ESLint 9, Prettier, Python 3（置き換えのスクリプト）, git（`git mv` だけ）

**設計書:** `docs/superpowers/specs/2026-10-28-agent-session-id-rename-design.md`（承認済み。実装の前に必ず読む）。このプランは設計書の「実装の分割」の 1〜6 を、そのまま Task 1〜6 に割り当てた（境界の細部は下の「計画の時点で設計書から調整した細部」）。各タスクで読む節はタスクの冒頭に書いた。書き方の参考は `docs/superpowers/plans/2026-10-28-test-recursive-rm-guard.md`。

**実装の前に読むもの:** `$DEV_FLOW_KIT/lessons/review-lessons.md` の「優先度 A のチェックリスト」（CLAUDE.md の「実装前の確認」）と、L-618（489 行付近）・L-609（4699 行付近）・L-624（4455 行付近）・L-310（6390 行付近）の本文。

**反映する知見（dev-flow-kit の `lessons/review-lessons.md`）:** 設計書の「気をつける知見」の L-310・L-203・L-459・L-618・L-609・L-624・L-017・L-015・L-065（各タスクの冒頭の「気をつける知見」に、そのタスクで効くものを書いた）

> **計画の時点で設計書から調整した細部（実装の前に読む）:**
>
> - **starter のローカル変数・引数を Task 3 に移した（L-609）:** 設計書は `agentSessionStarter.ts` のローカル変数（307 行の `let claudeSessionId`・414 行の分割代入・460 行の `const`）を Task 4 に置いているが、これらは `{ cliKind: plan.cliKind, claudeSessionId }`（367 行）・`{ kind: 'started', sessionId, cliKind, claudeSessionId }`（432 行）・`{ cliKind, claudeSessionId }`（461 行）の**短縮記法**で IPC の値と `AgentSessionInfo` を作り、414 行は `CreatedAgentSession` の欄を分割代入する。欄だけを Task 3 で改名すると、Task 3 の間だけ `cliSessionId: claudeSessionId` と書き下す必要があり、Task 4 で戻すことになる。そこで **`agentSessionStarter.ts` の `claudeSessionId` 21 か所は全部 Task 3 で改名する**。Task 4 に残る starter の分は、注入の option `createClaudeSessionId`・`selectClaudeSessionId`・`ClaudeSessionReservations`・コメントのファイル名・例外とログの文言
> - **renderer の短縮記法の 2 か所も Task 3 に移した（L-609）:** `useAgentSessions.ts` の `resumeInNewTab` の実装の引数（615・618・622 行。622 行の `{ kind: 'resume', claudeSessionId, cliKind }` が `AgentLaunchRequest` を作る）と、`useAgentSessions.test.ts:40` の補助 `resumeOf` の引数（44 行の短縮記法で `AgentLaunchRequest` を作る）。設計書は (c) として Task 5 に置いているが、上と同じ理由で Task 3 で改名する。`AgentSessionsState` の型の上の引数名（`useAgentSessions.ts:118` の `resumeInNewTab: (claudeSessionId: string, …)`）は型の欄ではないので Task 5 のまま
> - **1 行に 2 つあって、タスクが分かれる行:** `useAgentLastSession.ts:60`（`{ kind: 'found', …, claudeSessionId: last.claudeSessionId }`。後ろの `last.…` は `AgentLastSession` で Task 3、前の欄は `AgentLastSessionLookup` で Task 5）、`useAgentResume.ts:84`（前の欄は `AgentLaunchRequest` で Task 3、後ろの `current.…` は `AgentLastSessionLookup` で Task 5）、`agentTabSessionInfo.ts:30`（前の欄は履歴の欄で残す、後ろの `tab.…` は Task 5）。スクリプトの表で、行の中の何個目を直すかまで指定した
> - **日本語の文言は前の空白ごと消す:** 「種類と claude の会話の ID」を「種類と会話の ID」にする（「種類と 会話の ID」にしない）。前が `(`・`、`・`。` の 3 か所（`agentSessionRegistry.ts:19`・`:26`、`agentSessionStarter.test.ts:434`）と `(claude のセッション ID`（`agentSessionStarter.test.ts:381`）は空白が無いので、それぞれの形で当てる
> - **Task 3 の終わりの main のテストの grep:** 設計書の「`historyUtils.test.ts`・`historyHandlers.test.ts` の 2 ファイルだけ」は、Task 1 で足す `historyStore.test.ts` を含めて **3 ファイル**になる
> - **最後の件数:** 設計書の「計 53 か所・51 行・24 ファイル」に、Task 1 で足す 4 行（`historyStore.test.ts` の 3 行と `history.ts` の doc コメントの 1 行。どれも 1 行に 1 か所）を足して、**57 か所・55 行・25 ファイル**（`grep -rnw claudeSessionId src` で 55 行）。計画の時点で、写しに Task 1〜5 を順にかけて、この数になることを確かめた
> - **`git mv` はインデックスを変える:** 設計書の決めたこと 4（L-624）と利用者の指示に従い、ファイル名の変更だけ `git mv` を使う。`git mv` の後に中身を書き換えるので、`git status --short` では `RM`（ステージ済みの改名 + 作業ツリーの変更）と出る。コミットはしない（commit-ja でまとめる）
> - **IPC の値の形の grep の期待:** 設計書の Task 3 の「IPC の値の形の grep」は、残る行（Task 4・5 の対象）の前後の行にも当たる。計画の時点で、当たるのが 8 行で、どれも IPC の値を書いた行ではないことを確かめた（Task 3 Step 6）
> - **退避先:** 設計書の `$HOME/prompt-ide-rename-backup/` ではなく、利用者の指示どおり scratchpad の `backup/<ラベル>/` に置く。scratchpad（`/private/tmp/claude-<UID>/…`）はリポジトリの外で、`os.tmpdir()`（`/var/folders/…/T`）の外でもある（計画の時点で確かめた）ので、ガードを通る削除にも巻き込まれない。退避の手順で毎回これを確かめる

## Global Constraints

- コメント・文言は日本語。既存のコメントの密度と書き方に合わせる。型だけの import は `import type`。`any` を使わない
- **コミット・プッシュはしない**（CLAUDE.md。利用者の明示の指示があるまで行わない）。各タスクの最後の Step は「コミットしない（dev-flow の commit-ja でまとめてコミットする）」。`git add`・`git stash`・`git commit` もしない。**`git mv` だけは使う**（Task 4。L-624）
- **アプリの挙動は変えない。保存の欄 `agent.claudeSessionId` には触れない。** `AgentHistoryInfo.claudeSessionId` の欄、それを型で指す読み書き（`HistoryEntry.agent`・`sentTo`・`describeSession()`・`recorded` など）、ディスクの形を直接扱う `historyUtils.ts:25` の `a.claudeSessionId` と `:90` の正規化は、名前を変えない。変えてよい文言は、設計書の「新しい名前の表」の文言の行だけ（例外の文言 4 つ・ログ 1 つ・コメント・テストの題）
- **`sessionId`（pty のセッションの ID）・`parseAgentSessionId`・`sessionIdBySlotRef`・`AgentSession*`・`classifyClaudeScreen`・`buildClaudeArgs` は変えない。** CLI の種類が claude と決まっている文脈の「claude のセッション」（`AgentTerminalPanel.test.tsx:405`・`:522`、`agentSessionMessages.test.ts:191`・`:200`、`agentTerminalHandlers.test.ts:951`）も変えない
- **安全の手順（2026-10-26 に、改名の途中でテストを流してリポジトリが `.git` ごと消えた事故〈L-618〉の再発防止）。** 各タスクの冒頭の「安全の手順」を、そのタスクで最初に読む。どのタスクも次の順に進める:
  1. **改名の途中ではテストを流さない。** スクリプトの実行・`git mv`・prettier・手での直しが全部終わるまで、`npx vitest` を 1 回も流さない
  2. **テストより先に `npm run typecheck` を通す**（`tsconfig.node.json`・`tsconfig.web.json` はテストのファイルも含む）
  3. **型検査の外の直し漏れを grep で捕まえる。** 各タスクの「完了の条件の grep」を流し、期待どおりであることを確かめる（型の付かないテストの値・文字列の欄名・`as unknown as` の値は型検査を通ってしまう）
  4. **テストの再帰削除がガードを通っていることを grep で確かめる**（下の「素の再帰削除の grep」が `素の再帰削除なし`）
  5. **作業をリポジトリの外へ退避する**（下の「退避の手順」）
  6. 退避の後に、そのタスクの指定のテストを流す（`npx vitest run <ファイル…>`）。全体は Task 6 だけで流す
  7. テストが落ちたら、テストの期待を直して通さない。まず型検査と grep に戻る（改名は挙動を変えないので、落ちるのは直し漏れ）

  手順 2〜4 のどれかが期待と違えば、テストを流さずに止まって報告する。例外は Task 1 Step 4 の 1 回だけ（効いていることの確かめのために実装を一時的に壊して流す。流すのは `node:fs/promises` を差し替えた `historyStore.test.ts` の 1 ファイルだけで、退避の後に流す）

- **素の再帰削除の grep（以下「素の再帰削除の grep」）。** 追跡中と未追跡の両方のテストのコードから、ガードの実装と規則のテストを除いて探す:

  ```bash
  cd <repo-root>
  { git ls-files; git ls-files --others --exclude-standard; } | sort -u \
    | grep -E '(__tests__/|\.test\.(ts|tsx|mjs)$)' \
    | while read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done \
    | xargs grep -nE '\b(rm|rmSync|rmdir|rmdirSync)\(.*recursive' \
    | grep -vE '^src/shared/__tests__/helpers/tempDirGuard(\.lint\.test)?\.ts:' \
    || echo "素の再帰削除なし"
  ```

  期待: `素の再帰削除なし`（計画の時点〈`ac0f7f5`〉で確かめた。この作業はテストの再帰削除を足さないので、どのタスクの後も同じ）

- **退避の手順（以下「退避の手順」。`<ラベル>` はタスクごとに指定する）。** `git diff --binary HEAD` のパッチ（`git mv` のステージ済みの改名を含む）と、未追跡のファイル（この設計書・実装プランなど。パッチに入らない）の tar を、scratchpad の下に置く:

  ```bash
  cd <repo-root>
  S=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad
  B="$S/backup/<ラベル>"
  T=$(node -p "require('os').tmpdir()")
  case "$B" in "$T"*|<repo-root>*) echo "退避先が一時ディレクトリかリポジトリの中です。止まる" ;; *) echo "退避先は外" ;; esac
  mkdir -p "$B"
  git rev-parse HEAD > "$B/base-commit.txt"
  git status --short > "$B/status.txt"
  git diff --binary HEAD > "$B/changes.patch"
  git ls-files --others --exclude-standard -z | tar -cf "$B/untracked.tar" --null -T -
  git ls-files --others --exclude-standard | wc -l
  tar -tf "$B/untracked.tar" | wc -l
  wc -c < "$B/changes.patch"
  ```

  期待: `退避先は外`。未追跡の件数と tar の件数が一致し（少なくとも設計書と実装プランの 2 件）、`changes.patch` の大きさが 0 より大きい。違えばテストを流さずに止まって報告する。戻し方（リポジトリの根で。リポジトリごと消えていたら、先に `git clone` し直してその根で）: `git checkout "$(cat "$B/base-commit.txt")" && git apply --index "$B/changes.patch" && tar -xf "$B/untracked.tar"`（`base-commit.txt` は push 済みの `ac0f7f5` の子孫）

- **置き換えの方法。** 機械的な置き換えは、下の「共通の置き換えのエンジン」と各タスクのスクリプトで行う（手で一括置換しない。`sed -i` の部分一致を使わない）。
  - スクリプトは scratchpad の `rename/` に置く（`S=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad`。エンジンが無ければ、このセクションの内容で `$S/rename/rename_engine.py` を作る）。日本語を含むので `# -*- coding: utf-8 -*-` 付きのファイルにして `python3 <ファイル> <repo-root>` で流す（`python3 -c` に日本語を書かない）
  - エンジンは**語の単位**（英数字と `_` を語の文字とする。`grep -w` と同じ）で当てる。`isClaudeSessionId` は `isClaudeSessionIdActiveElsewhere` に、`claudeSessionId` は `claudeSessionIdSelection`・`claudeSessionIdBySlotRef` に、`CLAUDE_SESSION_ID` は `CLAUDE_SESSION_ID_PATTERN` に当たらない
  - `claudeSessionId` は、ファイルの全部（`'*'`）か、行と「行の中の何個目」を表で指定して直す。指定の無い行（履歴の欄など）には触れない
  - エンジンは、ファイルの件数・行の件数・文言の有無が表と全部合うことを確かめてから書き込む。1 つでも違えば `中止(何も書いていません)` と出して何も書かない。違ったら、表を直さずに止まって報告する（行の番号は計画の時点〈`ac0f7f5`〉のもので、前のタスクの prettier の折り返しまで含めて写しで確かめてある。違うのは前提が崩れたとき）
  - スクリプトの後に、変更したファイルを明示して `npx prettier --write` をかける（引数が空だとリポジトリ全体を整形してしまう）
- 各タスクの終わりで次が通る状態を保つ: `npm run typecheck`・そのタスクの指定のテスト・変更したファイルへの `npx eslint --max-warnings 0 <ファイル…>` と `npx prettier --check <ファイル…>`（L-609）。全体の `npx vitest run --reporter=dot` は Task 6 で流す
- **このマシンは負荷が高く、`npx vitest run` の全体でテストが時間切れ（`Test timed out`・`waitFor` の打ち切り）で落ちることがある。** 落ちたら、落ちたファイルを `npx vitest run <ファイル>` で単体で流し直し、単体で通れば負荷によるものとして報告に書いて先へ進む。単体でも落ちれば本当の失敗として、型検査と grep に戻る
- **シェルで `path` を変数名に使わない**（zsh では `PATH` と結び付いている）。**zsh では変数に入れたファイル名の並びが単語に分かれない。** 複数のファイルは `set -- a.ts b.ts` と `"$@"` を使う。**シェルの変数は Bash の呼び出しをまたいで残らない。** コードブロックごとに先頭で設定し直す
- **サブエージェントの「改名した」「残りは 0」という報告を信じない（L-065）。** レビューでは、各タスクの「完了の条件の grep」をレビューの側で流し直す

### 共通の置き換えのエンジン（`$S/rename/rename_engine.py`）

Task 2 の Step 1 で作る（Task 3〜5 は同じファイルを使う。無ければここから作る）。計画の時点で、このエンジンと Task 2〜5 のスクリプトを写しに順にかけ、各タスクの後に型検査・eslint が通り、最後の件数が 57 か所・55 行・25 ファイルになることを確かめた。

```python
# -*- coding: utf-8 -*-
# 改名の置き換えのエンジン(タスク 2〜5 のスクリプトが import する)。
# すべての置き換えを確かめてから書き込む。1 つでも期待と違えば、何も書かずに止まる(半端な状態を残さない)。
# 語の単位(grep -w と同じ。英数字と _ を語の文字とする)で当て、部分一致で別の名前を壊さない。
import os
import re
import sys

WORD_CHARS = 'A-Za-z0-9_'


def word_re(name):
    return re.compile('(?<![' + WORD_CHARS + '])' + re.escape(name) + '(?![' + WORD_CHARS + '])')


CSID = 'claudeSessionId'
CSID_NEW = 'cliSessionId'
CSID_RE = word_re(CSID)


def fail(msg):
    print('中止(何も書いていません): ' + msg)
    sys.exit(1)


def run(root, words, csid, texts):
    """
    words: {ファイル: [(旧, 新, 期待の件数)]}  ファイルの全体で、旧の語をすべて新にする(件数は置き換えの前の数)
    csid:  {ファイル: (置き換えの前のファイルの claudeSessionId の件数, '*' か [(行, その行の件数, [置き換える何個目(0 始まり)])])}
    texts: {ファイル: [(行, 置き換え前の部分文字列, 置き換え後)]}  行の中にちょうど 1 回あること
    """
    files = sorted(set(words) | set(csid) | set(texts))
    out = {}
    for f in files:
        p = os.path.join(root, f)
        if not os.path.isfile(p):
            fail(f + ' がありません')
        with open(p, encoding='utf-8', newline='') as fh:
            lines = fh.read().split('\n')
        # 1. 行を指定した文言(行の番号を先に使うので最初に当てる。文言の置き換えは行を増やさない)
        for (ln, old, new) in texts.get(f, []):
            line = lines[ln - 1]
            if line.count(old) != 1:
                fail('%s:%d に %r がちょうど 1 回ありません: %r' % (f, ln, old, line))
            lines[ln - 1] = line.replace(old, new)
        # 2. claudeSessionId(行と何個目を指定)
        if f in csid:
            expected_total, spec = csid[f]
            total = sum(len(CSID_RE.findall(l)) for l in lines)
            if total != expected_total:
                fail('%s の claudeSessionId が %d 件(期待 %d 件)' % (f, total, expected_total))
            if spec == '*':
                lines = [CSID_RE.sub(CSID_NEW, l) for l in lines]
            else:
                for (ln, n, idxs) in spec:
                    line = lines[ln - 1]
                    ms = list(CSID_RE.finditer(line))
                    if len(ms) != n:
                        fail('%s:%d の claudeSessionId が %d 件(期待 %d 件): %r' % (f, ln, len(ms), n, line))
                    for i in sorted(idxs, reverse=True):
                        m = ms[i]
                        line = line[:m.start()] + CSID_NEW + line[m.end():]
                    lines[ln - 1] = line
        # 3. ほかの名前(ファイルの全体)
        for (old, new, expected) in words.get(f, []):
            r = word_re(old)
            count = sum(len(r.findall(l)) for l in lines)
            if count != expected:
                fail('%s の %s が %d 件(期待 %d 件)' % (f, old, count, expected))
            lines = [r.sub(new, l) for l in lines]
        out[f] = '\n'.join(lines)
    for f in files:
        with open(os.path.join(root, f), 'w', encoding='utf-8', newline='') as fh:
            fh.write(out[f])
    for f in files:
        left = sum(len(CSID_RE.findall(l)) for l in out[f].split('\n'))
        print('%s: 書き換え済み(残りの claudeSessionId %d 件)' % (f, left))
    print('完了: %d ファイル' % len(files))
```

### 設計書の決めたこと（要点）

| 項目                       | 決定                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新しい名前                 | `cliSessionId`（`agentHookSessions.ts` の `cliSessionId` とそろう。`agentSessionId` は pty のセッションと取り違えるので採らない）                                   |
| 保存の欄                   | `AgentHistoryInfo.claudeSessionId` は型の上でも欄名でもそのまま（案 B）。doc コメントで理由を書く                                                                   |
| IPC の 4 つの型の欄        | `AgentLaunchRequest`（resume）・`AgentStartResult`・`AgentSessionSnapshotEntry`・`AgentLastSession` の欄を改名する（ディスクに書かれず、main と renderer は同じ版） |
| ファイル名                 | `git mv` で `claudeSessionIdSelection.ts` → `cliSessionIdSelection.ts`・`claudeSessionReservations.ts` → `cliSessionReservations.ts`（テストも）                    |
| 例外・ログの文言           | 「claude のセッション ID」→「会話の ID」。`'claudeSessionId は小文字の UUID v4 である必要があります'` → `'cliSessionId は…'`                                        |
| 保存の欄名を固定するテスト | `historyStore.test.ts` に 1 件（文字列でディスクの形を書く）                                                                                                        |
| 過去の設計書・プラン       | 直さない                                                                                                                                                            |
| ROADMAP・実機テスト仕様書  | 変えない（挙動を変えない。変わる文言は通常の操作で出ない例外の 4 つだけで、仕様書に書いた項目は無い）                                                               |

### 新しい名前の表（後のタスクはこの名前で使う）

| 旧                                                                                                                                                | 新                                                                                                                 | タスク  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------- |
| `AgentHistoryInfo.claudeSessionId`                                                                                                                | **変えない**                                                                                                       | —       |
| `CLAUDE_SESSION_ID_PATTERN`・`isClaudeSessionId`                                                                                                  | `CLI_SESSION_ID_PATTERN`・`isCliSessionId`                                                                         | 2       |
| IPC の 4 つの型の欄・`AgentSessionInfo`・`CreatedAgentSession`・`CliSessionIdSelection` の selected の欄 `claudeSessionId`                        | `cliSessionId`                                                                                                     | 3       |
| `createClaudeSessionId`（注入の option）                                                                                                          | `createCliSessionId`                                                                                               | 4       |
| `selectClaudeSessionId`・`ClaudeSessionIdSelection`                                                                                               | `selectCliSessionId`・`CliSessionIdSelection`                                                                      | 4       |
| `createClaudeSessionReservations`・`ClaudeSessionReservations`                                                                                    | `createCliSessionReservations`・`CliSessionReservations`                                                           | 4       |
| `CLAUDE_SESSION_ID`（`agentHookSessions.test.ts`）                                                                                                | `CLI_SESSION_ID`                                                                                                   | 4       |
| `src/main/claudeSessionIdSelection.ts`（とテスト）                                                                                                | `src/main/cliSessionIdSelection.ts`（とテスト）                                                                    | 4       |
| `src/main/claudeSessionReservations.ts`（とテスト）                                                                                               | `src/main/cliSessionReservations.ts`（とテスト）                                                                   | 4       |
| main の引数名 `claudeSessionId`（`agentCliLaunchSpecs.ts`・`agentSessionRecordStore.ts`・`cliSessionReservations.ts`）                            | `cliSessionId`                                                                                                     | 4       |
| renderer の型の欄（`AgentTabSessionFields`・`AgentSessionTabView`・`AgentResumeTab`・`AgentTabSessionSource`・`AgentLastSessionLookup` の found） | `cliSessionId`                                                                                                     | 5       |
| `setTabClaudeSessionId`・`findActiveAgentTabByClaudeSessionId`・`isClaudeSessionIdActiveElsewhere`・`claudeSessionIdBySlotRef`                    | `setTabCliSessionId`・`findActiveAgentTabByCliSessionId`・`isCliSessionIdActiveElsewhere`・`cliSessionIdBySlotRef` | 5       |
| 「claude の会話の ID」（コメント・題）                                                                                                            | 「会話の ID」                                                                                                      | 3・4・5 |
| 「claude のセッション ID」（例外・ログ・題）                                                                                                      | 「会話の ID」                                                                                                      | 4       |

### 型の付かないテストの値（設計書の「テストの中の型の付かない値の分け方」の表）の扱い

| 分類                              | 行数 | 扱うタスク      | このプランでの直し方                                                                                                                                                                                                                                                          |
| --------------------------------- | ---: | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) 履歴の欄                      |   19 | どれも変えない  | スクリプトの表に入れない。Task 3・5 の行の指定から外してある                                                                                                                                                                                                                  |
| (b) IPC の欄（main のテスト）     |   72 | 3               | main のテストのファイル（`historyUtils.test.ts`・`historyHandlers.test.ts`・`historyStore.test.ts` を除く）は `claudeSessionId` が全部 Task 3 の対象なので、ファイルの全部（`'*'`）で直す                                                                                     |
| (b) IPC の欄（renderer のテスト） |   12 | 3               | 行で指定する（`App.agentReferences.test.tsx:85` は `'*'`、`App.agentSessionResume.test.tsx:76・82・151・263・271・285`、`useAgentResume.test.ts:174・227・247`、`useAgentWorkspace.test.ts:2414・2846`）                                                                      |
| (c) renderer の中の欄・引数       |   31 | 5（1 行だけ 3） | `useAgentSessions.test.ts:40` は短縮記法のため Task 3（上の「調整した細部」）。残りの 30 行は Task 5 で、ファイルの全部か行の指定で直す（`useAgentLastSession.test.ts`・`useAgentSessions.test.ts`・`agentSessionTabState.test.ts` は Task 5 の時点で全部が対象なので `'*'`） |

### 件数の推移（計画の時点で写しに順にかけて数えた）

| 時点        | `grep -rnw claudeSessionId src \| wc -l` | `grep -row claudeSessionId src \| wc -l` | `grep -rlw claudeSessionId src \| wc -l` | 仲間の名前・文言の grep（下）の行数 |
| ----------- | ---------------------------------------: | ---------------------------------------: | ---------------------------------------: | ----------------------------------: |
| 計画の時点  |                                      405 |                                      419 |                                       48 |                                 134 |
| Task 1 の後 |                                      409 |                                      423 |                                       49 |                                 134 |
| Task 2 の後 |                                      409 |                                      423 |                                       49 |                                 113 |
| Task 3 の後 |                                      179 |                                      186 |                                       35 |                                 107 |
| Task 4 の後 |                                      154 |                                      158 |                                       32 |                                  33 |
| Task 5 の後 |                                       55 |                                       57 |                                       25 |                                   0 |

仲間の名前・文言の grep（以下「仲間の grep」）:

```bash
cd <repo-root>
grep -rnE 'ClaudeSession|CLAUDE_SESSION_ID|claudeSessionIdSelection|claudeSessionReservations|claude の会話の ID|claude のセッション ID' src | wc -l
```

### ファイルの構成（変えるもの）

| ファイル                                                                                                                                                                                                                                                                     | 責務・変えること                                                               | タスク |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------ |
| `src/main/__tests__/historyStore.test.ts`・`src/shared/types/history.ts`                                                                                                                                                                                                     | 保存の欄名を固定するテスト・`AgentHistoryInfo.claudeSessionId` の doc コメント | 1      |
| `src/shared/types/agentTerminal.ts`・`src/shared/types.ts`・main の 4 ファイル・テスト 2 つ                                                                                                                                                                                  | 形式の検証の定数と関数の改名                                                   | 2      |
| `src/shared/types/agentTerminal.ts`・`agentSessionStarter.ts`・`claudeSessionIdSelection.ts`・`agentTerminalPayloadParser.ts`・renderer の 3 フック・テスト 15 ファイル                                                                                                      | IPC の欄と starter の欄の改名、型の付かないテストの値 (b)                      | 3      |
| `cliSessionIdSelection.ts`・`cliSessionReservations.ts`（`git mv`）・`agentSessionStarter.ts`・`agentCliLaunchSpecs.ts`・`agentSessionRecordStore.ts`・`ipcHandlers.ts`・`agentSessionRegistry.ts`・`agentSessionSnapshot.ts`・`agentTerminalHandlers.ts`・テスト 9 ファイル | main の中の名前・ファイル名・文言                                              | 4      |
| renderer の 7 ファイル（`useAgentSessions.ts`・`useAgentLastSession.ts`・`useAgentResume.ts`・`useAgentPromptSender.ts`・`agentResumeAvailability.ts`・`agentSessionTabState.ts`・`agentTabSessionInfo.ts`）・テストの補助・テスト 7 ファイル                                | renderer の中の名前・文言、型の付かないテストの値 (c)                          | 5      |
| なし（検証だけ）                                                                                                                                                                                                                                                             | 全体の検証・最後の件数                                                         | 6      |

---

### Task 1: 保存の欄名を固定するテストと doc コメント

> **設計書の読む節:** 「層ごとの分類」の「(a) ディスクに保存される欄」、「保存の欄の扱いの比較」、「古い版のアプリとの読み書き」、「テストの方針」の「保存の欄名を固定するテスト」、「実装の分割」の 1。
>
> **気をつける知見:** L-459（保存の欄名を変えると古い版の読み込みで `agent` が不正になり、エントリごと捨てられる。型を通さずに文字列でディスクの形を固定する）・L-203（doc コメントに「変えない理由」を書く）・L-618（実装を壊して流すのは `node:fs/promises` を差し替えたテストの 1 ファイルだけ。流す前に退避する）。
>
> **安全の手順（このタスクで最初に読む）:** このタスクは名前を変えない。テストを流すのは Step 4（実装を一時的に壊して落ちることを確かめる）と Step 6 の 2 回だけで、どちらも `historyStore.test.ts`（`node:fs/promises` を `vi.mock` で丸ごと差し替え、実際のファイルを読み書きしない）と `historyUtils.test.ts`（純粋な関数）だけ。Step 4 の前に型検査・素の再帰削除の grep・退避を済ませる。Step 4 の間だけ型検査が落ちる状態になる（壊した 1 行のため）ので、ほかのテストは流さない。

**Files:**

- Modify: `src/main/__tests__/historyStore.test.ts`（末尾に describe を 1 つ足す）
- Modify: `src/shared/types/history.ts:8`（doc コメント）
- 一時的に変えて戻す: `src/main/historyUtils.ts:90`（Step 4 だけ）

**Interfaces:**

- Consumes: なし
- Produces: 保存の欄名のテスト（Task 2〜6 の各テストの実行で、ディスクのキーが `claudeSessionId` のままであることを確かめ続ける）。`AgentHistoryInfo.claudeSessionId` は変えない（後のタスクはこの欄に触れない）

- [ ] **Step 1: 保存の欄名を固定するテストを書く**

`src/main/__tests__/historyStore.test.ts` の末尾（最後の `describe('saveHistory', …)` の後）に、次をそのまま足す（`HistoryEntry` の型を使わない。既存の `mockReadFile`・`mockWriteFile`・`loadHistory`・`saveHistory` を使う）:

```ts
describe('保存の欄名(古い版のアプリとの互換)', () => {
  // HistoryEntry の型を通さず、ディスクの形を文字列で書く。型の欄名を変えても、ディスクのキーが変わればここで落ちる(L-459)
  const DISK_JSON =
    '[{"id":"h1","promptId":"p1","promptTitle":"タイトル","promptContent":"全文","fileContent":null,' +
    '"toolId":"claude","status":"sent","resultText":null,"errorMessage":null,"executedAt":1,' +
    '"agent":{"claudeSessionId":"11111111-1111-4111-8111-111111111111","cliKind":"claude","tabLabel":"claude 1","folderPath":"/w"}}]'

  it('古い版が書いた agent.claudeSessionId を捨てずに読み、書き戻しても同じキーで書く', async () => {
    mockReadFile.mockResolvedValue(DISK_JSON)
    const loaded = await loadHistory()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].agent).not.toBeNull()
    await saveHistory(loaded)
    const written: unknown = mockWriteFile.mock.calls[0][1]
    expect(written).toContain('"claudeSessionId":"11111111-1111-4111-8111-111111111111"')
    expect(written).not.toContain('"cliSessionId"')
    expect(written).toBe(DISK_JSON)
  })
})
```

（`toBe(DISK_JSON)` は、読み込みの正規化〈`sanitizeHistoryEntry`〉が作り直す欄の順〈`id`…`agent`、`agent` の中は `claudeSessionId`・`cliKind`・`tabLabel`・`folderPath`〉と同じ順で書いてあるので成り立つ。`saveHistory` は渡した値をそのまま `JSON.stringify` する）

- [ ] **Step 2: doc コメントを直す（`src/shared/types/history.ts`）**

8 行目の次の 1 行:

```ts
/** 送り先のタブで動いていたエージェント CLI の会話の ID(UUID。claude・copilot)。欄名は古い版との互換のため claude のまま */
```

を、次の 4 行にする（欄の宣言 `claudeSessionId: string` は変えない）:

```ts
/**
 * 送り先のタブで動いていたエージェント CLI の会話の ID(UUID。claude・copilot)。コード上のほかの場所では cliSessionId と呼ぶ。
 * 保存の欄名(history.json の agent.claudeSessionId)なので、古い版のアプリとの互換のため変えない(変えると古い版の読み込みで agent が不正になり、エントリごと捨てられる)
 */
```

```bash
cd <repo-root>
npx prettier --write src/main/__tests__/historyStore.test.ts src/shared/types/history.ts
```

- [ ] **Step 3: 安全の確かめ（テストを流す前に）**

```bash
cd <repo-root>
npm run typecheck
grep -nw claudeSessionId src/main/__tests__/historyStore.test.ts src/shared/types/history.ts
grep -rnw claudeSessionId src | wc -l
grep -n "vi.mock('node:fs/promises'" src/main/__tests__/historyStore.test.ts
```

Expected:

- 型検査が通る
- 1 つ目の grep が 5 行: `historyStore.test.ts` の `DISK_JSON` の 3 行目・`it` の題・`toContain` の 3 行と、`history.ts` の doc コメントの 2 行目・欄の宣言の 2 行
- 2 つ目が `409`（計画の時点の 405 に 4 行を足した数）
- 3 つ目が 1 行（`node:fs/promises` を差し替えていて、実際のファイルを読み書きしない）

続けて、Global Constraints の「素の再帰削除の grep」が `素の再帰削除なし` であることを確かめ、「退避の手順」を `<ラベル>` = `task1-red` で行う。

- [ ] **Step 4: 実装を一時的に壊し、テストが落ちることを確かめる（Red）**

`src/main/historyUtils.ts` の 90 行目（`sanitizeHistoryEntry` の中）を、手で次のように変える（保存の欄名を改名してしまった状態を作る）:

```ts
            cliSessionId: agent.claudeSessionId,
```

（元は `            claudeSessionId: agent.claudeSessionId,`。この状態では型検査が落ちるので、型検査は流さず、この 1 ファイルのテストだけを流す）

Run: `npx vitest run src/main/__tests__/historyStore.test.ts`
Expected: FAIL（「古い版が書いた agent.claudeSessionId を捨てずに読み、書き戻しても同じキーで書く」の `toContain('"claudeSessionId":"1111…"')` で落ちる。ほかのテストは通る）

落ちたら、90 行目を手で `            claudeSessionId: agent.claudeSessionId,` に戻し、`git diff src/main/historyUtils.ts` が何も出さないことを確かめる。落ちなければ、戻してから止まって報告する（テストが効いていない）。

- [ ] **Step 5: 戻した後の型検査**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: テストが通ることを確かめる（Green）**

Run: `npx vitest run src/main/__tests__/historyStore.test.ts src/main/__tests__/historyUtils.test.ts`
Expected: すべて PASS

- [ ] **Step 7: lint と整形**

```bash
cd <repo-root>
set -- src/main/__tests__/historyStore.test.ts src/shared/types/history.ts
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
git status --short
```

Expected: 通る。`git status --short` は ` M` の 2 ファイルと、`??` の設計書・実装プランだけ（`historyUtils.ts` が無い）

- [ ] **Step 8: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 2: shared の形式の検証の改名

> **設計書の読む節:** 「層ごとの分類」の「(c) main・renderer の中だけの変数・関数・型・ファイル名」の shared、「新しい名前の表」、「実装の分割」の 2。
>
> **気をつける知見:** L-618（スクリプトと prettier の途中でテストを流さない）・L-310（再 export の旧い名前を残さない。使う側を全部直す）。
>
> **安全の手順（このタスクで最初に読む）:** Step 1〜3（エンジンとスクリプトの作成・実行・整形）の間は、テストを 1 回も流さない。Step 4 で型検査・完了の条件の grep・素の再帰削除の grep・退避を済ませてから、Step 5 でテストを流す。期待と違えば、テストを流さずに止まって報告する。

**Files（置き換えの全件。すべて語の単位で、ファイルの全体）:**

| ファイル                                                                 | `CLAUDE_SESSION_ID_PATTERN` → `CLI_SESSION_ID_PATTERN` | `isClaudeSessionId` → `isCliSessionId` |
| ------------------------------------------------------------------------ | -----------------------------------------------------: | -------------------------------------: |
| `src/shared/types/agentTerminal.ts`（25・29・30 行）                     |                                                      2 |                                      1 |
| `src/shared/types.ts`（32・38 行。再 export）                            |                                                      1 |                                      1 |
| `src/shared/__tests__/agentTerminal.test.ts`（4・9・84・90・91・106 行） |                                                      2 |                                      4 |
| `src/main/agentCliLaunchSpecs.ts`（3・75 行）                            |                                                      0 |                                      2 |
| `src/main/agentSessionRecordStore.ts`（1・64 行）                        |                                                      0 |                                      2 |
| `src/main/historyUtils.ts`（2・25 行）                                   |                                                      0 |                                      2 |
| `src/main/handlers/agentTerminalPayloadParser.ts`（12・71 行）           |                                                      0 |                                      2 |
| `src/main/__tests__/ipcHandlers.test.ts`（187・482 行）                  |                                                      0 |                                      2 |

`historyUtils.ts:25` は `isCliSessionId(a.claudeSessionId)` になる（中の `a.claudeSessionId` はディスクの欄名なので変えない）。`agentTerminal.ts` の doc コメントは既に「エージェント CLI(claude・copilot)の会話の ID」なので変えない。

**Interfaces:**

- Consumes: なし
- Produces: `@shared/types` の `CLI_SESSION_ID_PATTERN: RegExp`・`isCliSessionId(value: unknown): value is string`（Task 3〜5 は旧い名前を使わない）。`$S/rename/rename_engine.py`（Task 3〜5 が使う）

- [ ] **Step 1: エンジンとスクリプトを書く**

`$S/rename/rename_engine.py` を Global Constraints の「共通の置き換えのエンジン」の内容で作り、`$S/rename/rename_task2.py` を次の内容で作る（`S=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad`）:

```python
# -*- coding: utf-8 -*-
# Task 2: shared の形式の検証の名前(CLAUDE_SESSION_ID_PATTERN・isClaudeSessionId)を改名する。
# 使い方: python3 rename_task2.py <リポジトリの根>   (rename_engine.py と同じフォルダに置く)
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rename_engine import run

P = ('CLAUDE_SESSION_ID_PATTERN', 'CLI_SESSION_ID_PATTERN')
F = 'isClaudeSessionId', 'isCliSessionId'
words = {
    'src/shared/types/agentTerminal.ts': [P + (2,), F + (1,)],
    'src/shared/types.ts': [P + (1,), F + (1,)],
    'src/shared/__tests__/agentTerminal.test.ts': [P + (2,), F + (4,)],
    'src/main/agentCliLaunchSpecs.ts': [F + (2,)],
    'src/main/agentSessionRecordStore.ts': [F + (2,)],
    'src/main/historyUtils.ts': [F + (2,)],
    'src/main/handlers/agentTerminalPayloadParser.ts': [F + (2,)],
    'src/main/__tests__/ipcHandlers.test.ts': [F + (2,)],
}
run(sys.argv[1], words, {}, {})
```

- [ ] **Step 2: スクリプトを流す**

```bash
S=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad
python3 "$S/rename/rename_task2.py" <repo-root>
```

Expected: 8 ファイルが `書き換え済み` で、最後に `完了: 8 ファイル`。`中止(何も書いていません)` が出たら、何も書かれていないので、表を直さずに止まって報告する

- [ ] **Step 3: 整形**

```bash
cd <repo-root>
set -- src/shared/types/agentTerminal.ts src/shared/types.ts src/shared/__tests__/agentTerminal.test.ts src/main/agentCliLaunchSpecs.ts src/main/agentSessionRecordStore.ts src/main/historyUtils.ts src/main/handlers/agentTerminalPayloadParser.ts src/main/__tests__/ipcHandlers.test.ts
npx prettier --write "$@"
```

Expected: 8 ファイルとも `(unchanged)`（計画の時点で写しで確かめた。折り返しは変わらない）

- [ ] **Step 4: 安全の確かめ（テストを流す前に）**

```bash
cd <repo-root>
npm run typecheck
grep -rnw 'isClaudeSessionId\|CLAUDE_SESSION_ID_PATTERN' src || echo "旧い名前なし"
grep -rnw 'isCliSessionId\|CLI_SESSION_ID_PATTERN' src | wc -l
grep -rnw claudeSessionId src | wc -l
git diff --stat | tail -1
```

Expected（完了の条件の grep）:

- 型検査が通る
- `旧い名前なし`（再 export も含めて 0 行）
- `21`（上の表の 8 ファイルの 21 か所。1 行に 2 つの行は無い）
- `409`（Task 1 の後と同じ。`claudeSessionId` は増えも減りもしない）
- `10 files changed, 45 insertions(+), 22 deletions(-)`（Task 2 の 8 ファイル・21 行の置き換えと、Task 1 の 2 ファイル）

続けて、「素の再帰削除の grep」が `素の再帰削除なし` であることを確かめ、「退避の手順」を `<ラベル>` = `task2` で行う。

- [ ] **Step 5: テストが通ることを確かめる**

```bash
cd <repo-root>
npx vitest run src/shared/__tests__/agentTerminal.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentCliLaunchSpecs.test.ts src/main/__tests__/agentSessionRecordStore.test.ts src/main/__tests__/historyUtils.test.ts src/main/__tests__/historyStore.test.ts src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts
```

Expected: すべて PASS

- [ ] **Step 6: lint と整形の確かめ**

```bash
cd <repo-root>
set -- src/shared/types/agentTerminal.ts src/shared/types.ts src/shared/__tests__/agentTerminal.test.ts src/main/agentCliLaunchSpecs.ts src/main/agentSessionRecordStore.ts src/main/historyUtils.ts src/main/handlers/agentTerminalPayloadParser.ts src/main/__tests__/ipcHandlers.test.ts
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: 通る

- [ ] **Step 7: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 3: IPC の型の欄の改名（main・renderer・テストをまとめて）

> **設計書の読む節:** 「層ごとの分類」の「(b) IPC の型と欄」、「`claudeSessionId` の 419 か所が指すもの」、「テストの中の型の付かない値の分け方」、「層ごとの方針」の (b)、「実装の分割」の 3。このプランの冒頭の「計画の時点で設計書から調整した細部」の 1〜3 つ目（starter のローカル変数・renderer の短縮記法・1 行に 2 つある行）。
>
> **気をつける知見:** L-609（IPC の型の欄と、スプレッドで結果に入る `AgentSessionInfo`・`CreatedAgentSession`、それを読む main・renderer・テストを 1 つのタスクで直す。分けると型検査が落ちる）・L-310（文字列で書いた欄名〈`hasOnlyKeys` の配列・例外の文言〉と `as unknown as` の値は型検査で見つからない。grep で確かめる）・L-618（型の付かないテストの値の直し漏れは、テストで偽物の `cliSessionId` が undefined になり、ID を確かめていないテストはそのまま通る。テストより先に grep で捕まえる）・L-203（doc コメントの「claude の会話の ID」を同じタスクで直す）・L-065（残った行を 1 行ずつ読む）。
>
> **安全の手順（このタスクで最初に読む）:** このタスクは差分が大きい（22 ファイル・237 か所）。Step 1〜3（スクリプトの作成・実行・整形）の間は、テストを 1 回も流さない。Step 4〜6 の型検査・完了の条件の grep を全部済ませ、素の再帰削除の grep と退避の後に、Step 7 でテストを流す。期待と違えば、テストを流さずに止まって報告する。

**Files（置き換えの全件。行は計画の時点〈`ac0f7f5`〉のもの。Task 1・2 はこれらのファイルの行の番号を変えない）:**

- shared: `src/shared/types/agentTerminal.ts`（57・77・137・144 行の欄。4 か所すべて）
- main の実装:
  - `src/main/agentSessionStarter.ts`（21 か所すべて。`AgentSessionInfo.claudeSessionId`〈86 行〉・`CreatedAgentSession.claudeSessionId`〈128 行〉・211 行の初期値・307 行のローカル変数とその利用〈316・322・323・341・367・376・381〉・414 行の分割代入とその利用〈420・425・429・432〉・460・461 行）と、「claude の会話の ID」のコメント 6 か所（83・92・124・162・210・385 行）→「会話の ID」（前の空白ごと）
  - `src/main/claudeSessionIdSelection.ts`（5 か所すべて。10・22・27 行の selected の欄、24・27 行の `launch.claudeSessionId`）
  - `src/main/handlers/agentTerminalPayloadParser.ts`（6 か所すべて。18 行のコメント・68 行の `hasOnlyKeys(launch, ['kind', 'claudeSessionId', 'cliKind'])` の文字列・71 行・72 行の例外の文言 `'claudeSessionId は小文字の UUID v4 である必要があります'` → `'cliSessionId は…'`・76 行の 2 か所）
- main のテスト（どれもファイルの全部。型の付かない値 (b) の 72 行を含む）: `agentCliLaunch.integration.test.ts`（4）・`agentCliLaunchSpecs.test.ts`（2。13 行の `as unknown as` を含む）・`agentSessionSnapshot.test.ts`（7）・`agentSessionStarter.capabilities.test.ts`（3）・`agentSessionStarter.test.ts`（40。1130・1133 行の補助 `copilotResume` の引数を含む）・`claudeSessionIdSelection.test.ts`（5。52 行の `as unknown as` を含む）・`handlers/agentTerminalHandlers.test.ts`（12）・`handlers/agentTerminalPayloadParser.test.ts`（17）
- shared のテスト: `src/shared/__tests__/agentTerminal.test.ts`（45・55 行。2 か所すべて）
- renderer の実装（IPC の欄の読みと、短縮記法の引数だけ。名前の `setTabClaudeSessionId` などは Task 5）:
  - `src/renderer/src/hooks/useAgentSessions.ts`: 350 行 `entry.claudeSessionId`（`AgentSessionSnapshotEntry`）・411・423 行 `launch.claudeSessionId`・453 行 `result.claudeSessionId`・615・618・622 行（`resumeInNewTab` の実装の引数と、622 行の `{ kind: 'resume', claudeSessionId, cliKind }`）。残る 13 か所（63・64・115・118・172・173・261〜264・279・281・283 行）は Task 5
  - `src/renderer/src/hooks/useAgentLastSession.ts:60`: 2 つ目（`last.claudeSessionId`）だけ → `{ kind: 'found', cliKind: last.cliKind, claudeSessionId: last.cliSessionId }`
  - `src/renderer/src/hooks/useAgentResume.ts:84`: 1 つ目（launch の欄）だけ → `cliSessionId: current.claudeSessionId,`（116 行の `entry.agent.claudeSessionId` は履歴の欄で残す）
- renderer のテスト（行の指定。表に無い行は (a) の履歴の欄か Task 5 の対象）:
  - `App.agentReferences.test.tsx:85`（`startAgentSession` の `mockResolvedValue`。ファイルの全部）
  - `App.agentSessionResume.test.tsx:76・82・271`（起動の結果の偽物）・`:263`（`getLastAgentSession` の `mockResolvedValue`）・`:151・285`（`launch` の `objectContaining`）。122・172・236 行は (a) で残す
  - `useAgentLastSession.test.ts`: `getLastAgentSession` の偽物と `resolve` の 15 行（62・105・110・117・133・140・158・163・170・180・189・204・211・227・235）。`toEqual` の 14 行は Task 5
  - `useAgentResume.test.ts:174・227・247`（`sessions.start` に渡る `launch`）
  - `useAgentSessions.test.ts`: 40・44 行（補助 `resumeOf`）と、起動の結果・状態の取得の偽物の 63 行（下のスクリプトの表）。Task 5 に残すのは 1267・1284・1292・1297・1303・1308・1322・1330・1353・1411・1469・1475・1901 行（タブの欄と題）
  - `useAgentWorkspace.test.ts:2414・2846`（`launch`）と、型の付く起動の結果・launch の 8 行（2635・2758・2833・2899・2953・2968・3065・3116）

**Interfaces:**

- Consumes: Task 2 の `isCliSessionId`（`agentTerminalPayloadParser.ts` の 71 行で使う）。`$S/rename/rename_engine.py`
- Produces:
  - `AgentLaunchRequest = { kind: 'new' } | { kind: 'resume'; cliSessionId: string; cliKind: AgentCliKind }`
  - `AgentStartResult` の started・already-running の `cliSessionId: string | null`
  - `AgentSessionSnapshotEntry.cliSessionId: string | null`・`AgentLastSession.cliSessionId: string`
  - main の `AgentSessionInfo.cliSessionId: string | null`・`CreatedAgentSession.cliSessionId: string | null`・`ClaudeSessionIdSelection` の `{ kind: 'selected'; cliSessionId: string }`（型名は Task 4 で `CliSessionIdSelection` になる）
  - IPC の起動の指定の検証: `hasOnlyKeys(launch, ['kind', 'cliSessionId', 'cliKind'])`

- [ ] **Step 1: スクリプトを書く（`$S/rename/rename_task3.py`）**

```python
# -*- coding: utf-8 -*-
# Task 3: IPC の型の欄(AgentLaunchRequest・AgentStartResult・AgentSessionSnapshotEntry・AgentLastSession)と、
# 結果にスプレッドされる starter の欄(AgentSessionInfo・CreatedAgentSession)・選んだ ID の戻り値の欄の claudeSessionId を cliSessionId にする。
# 型の付かないテストの値(mockResolvedValue・toEqual・toMatchObject・objectContaining・as unknown as の中)も行で指定して直す。
# 履歴の欄(AgentHistoryInfo.claudeSessionId)の行と、タスク 4・5 で直す行には触れない。
# 使い方: python3 rename_task3.py <リポジトリの根>   (rename_engine.py と同じフォルダに置く)
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rename_engine import run

# {ファイル: (置き換えの前の claudeSessionId の件数, '*'〈全部〉か [(行, その行の件数, [置き換える何個目])])}
csid = {
    'src/main/__tests__/agentCliLaunch.integration.test.ts': (4, '*'),
    'src/main/__tests__/agentCliLaunchSpecs.test.ts': (2, '*'),
    'src/main/__tests__/agentSessionSnapshot.test.ts': (7, '*'),
    'src/main/__tests__/agentSessionStarter.capabilities.test.ts': (3, '*'),
    'src/main/__tests__/agentSessionStarter.test.ts': (40, '*'),
    'src/main/__tests__/claudeSessionIdSelection.test.ts': (5, '*'),
    'src/main/__tests__/handlers/agentTerminalHandlers.test.ts': (12, '*'),
    'src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts': (17, '*'),
    'src/main/agentSessionStarter.ts': (21, '*'),
    'src/main/claudeSessionIdSelection.ts': (5, '*'),
    'src/main/handlers/agentTerminalPayloadParser.ts': (6, '*'),
    'src/renderer/src/components/__tests__/App.agentReferences.test.tsx': (1, '*'),
    # 122・172・236 行は履歴の欄(loadHistory の偽物)で残す
    'src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx': (9, [
        (76, 1, [0]), (82, 1, [0]), (151, 1, [0]), (263, 1, [0]), (271, 1, [0]), (285, 1, [0])
    ]),
    # toEqual の 14 行(AgentLastSessionLookup)はタスク 5
    'src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts': (29, [
        (62, 1, [0]), (105, 1, [0]), (110, 1, [0]), (117, 1, [0]), (133, 1, [0]), (140, 1, [0]),
        (158, 1, [0]), (163, 1, [0]), (170, 1, [0]), (180, 1, [0]), (189, 1, [0]), (204, 1, [0]),
        (211, 1, [0]), (227, 1, [0]), (235, 1, [0])
    ]),
    # 69 行は履歴の欄で残す。ほかの 13 か所(補助の引数・タブ・AgentLastSessionLookup)はタスク 5
    'src/renderer/src/hooks/__tests__/useAgentResume.test.ts': (17, [
        (174, 1, [0]), (227, 1, [0]), (247, 1, [0])
    ]),
    # タスク 5 に残す: 1267・1284・1292・1297・1303・1308・1322・1330・1353・1411・1469・1475・1901 行(タブの欄と題)
    'src/renderer/src/hooks/__tests__/useAgentSessions.test.ts': (78, [
        (40, 1, [0]), (44, 1, [0]), (132, 1, [0]), (138, 1, [0]), (170, 1, [0]), (232, 1, [0]),
        (252, 1, [0]), (271, 1, [0]), (294, 1, [0]), (310, 1, [0]), (324, 1, [0]), (351, 1, [0]),
        (370, 1, [0]), (413, 1, [0]), (423, 1, [0]), (437, 1, [0]), (454, 1, [0]), (463, 1, [0]),
        (488, 1, [0]), (505, 1, [0]), (520, 1, [0]), (552, 1, [0]), (570, 1, [0]), (611, 1, [0]),
        (617, 1, [0]), (650, 1, [0]), (708, 1, [0]), (725, 1, [0]), (810, 1, [0]), (830, 1, [0]),
        (858, 1, [0]), (874, 1, [0]), (1144, 1, [0]), (1157, 1, [0]), (1224, 1, [0]), (1225, 1,
        [0]), (1255, 1, [0]), (1273, 1, [0]), (1294, 1, [0]), (1305, 1, [0]), (1316, 1, [0]), (1336,
        1, [0]), (1373, 1, [0]), (1396, 1, [0]), (1455, 1, [0]), (1471, 1, [0]), (1509, 1, [0]),
        (1572, 1, [0]), (1603, 1, [0]), (1684, 1, [0]), (1703, 1, [0]), (1777, 1, [0]), (1893, 1,
        [0]), (1912, 1, [0]), (1932, 1, [0]), (1950, 1, [0]), (1968, 1, [0]), (1985, 1, [0]), (2004,
        1, [0]), (2010, 1, [0]), (2031, 1, [0]), (2049, 1, [0]), (2061, 1, [0]), (2178, 1, [0]),
        (2191, 1, [0])
    ]),
    # 履歴の欄の 9 か所(566・619・692・2436・2447・2488・2518・2733・3194)は残す。タブ・前回の 11 か所はタスク 5
    'src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts': (30, [
        (2414, 1, [0]), (2635, 1, [0]), (2758, 1, [0]), (2833, 1, [0]), (2846, 1, [0]), (2899, 1,
        [0]), (2953, 1, [0]), (2968, 1, [0]), (3065, 1, [0]), (3116, 1, [0])
    ]),
    # 60 行の 2 つ目(last.claudeSessionId。AgentLastSession)だけ。1 つ目(AgentLastSessionLookup の欄)はタスク 5
    'src/renderer/src/hooks/useAgentLastSession.ts': (2, [
        (60, 2, [1])
    ]),
    # 84 行の 1 つ目(AgentLaunchRequest の欄)だけ。2 つ目(current.…)はタスク 5、116 行は履歴の欄で残す
    'src/renderer/src/hooks/useAgentResume.ts': (3, [
        (84, 2, [0])
    ]),
    # 615・618・622 行は resumeInNewTab の実装の引数(622 行の短縮記法で AgentLaunchRequest を作る)
    'src/renderer/src/hooks/useAgentSessions.ts': (20, [
        (350, 1, [0]), (411, 1, [0]), (423, 1, [0]), (453, 1, [0]), (615, 1, [0]), (618, 1, [0]),
        (622, 1, [0])
    ]),
    'src/shared/__tests__/agentTerminal.test.ts': (2, '*'),
    'src/shared/types/agentTerminal.ts': (4, '*'),
}
# starter の「claude の会話の ID」のコメント 6 か所(AgentSessionInfo・CreatedAgentSession・sessionInfoOf・finishStart などの説明)
C = (' claude の会話の ID', '会話の ID')  # 前の空白ごと消す(「種類と claude の会話の ID」→「種類と会話の ID」)
texts = {
    'src/main/agentSessionStarter.ts': [(83,) + C, (92,) + C, (124,) + C, (162,) + C, (210,) + C, (385,) + C],
}
run(sys.argv[1], {}, csid, texts)
```

- [ ] **Step 2: スクリプトを流す**

```bash
S=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad
python3 "$S/rename/rename_task3.py" <repo-root>
```

Expected: 22 ファイルが `書き換え済み` で、最後に `完了: 22 ファイル`。残りの件数は、main・shared の 14 ファイルが 0 件、`App.agentSessionResume.test.tsx` 3 件・`useAgentLastSession.test.ts` 14 件・`useAgentResume.test.ts` 14 件・`useAgentSessions.test.ts` 13 件・`useAgentWorkspace.test.ts` 20 件・`useAgentLastSession.ts` 1 件・`useAgentResume.ts` 2 件・`useAgentSessions.ts` 13 件。`中止(何も書いていません)` が出たら、表を直さずに止まって報告する

- [ ] **Step 3: 整形**

```bash
cd <repo-root>
git diff --name-only -- src | grep -E '\.(ts|tsx)$' > $AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/rename/task3-files.txt
wc -l < $AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/rename/task3-files.txt
xargs npx prettier --write < $AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/rename/task3-files.txt
```

Expected: `task3-files.txt` が **29 行**（`git diff --name-only` は Task 1〜3 の変更をまとめて出す。Task 1 の 2 + Task 2 の 8 + Task 3 の 22 − Task 2 と 3 の重なり 3〈`agentTerminalPayloadParser.ts`・`shared/types/agentTerminal.ts`・`shared/__tests__/agentTerminal.test.ts`〉）。prettier は `agentSessionSnapshot.test.ts`・`useAgentSessions.test.ts`・`useAgentSessions.ts` の 3 ファイルだけを書き換え（名前が短くなり、行が畳まれる）、ほかは `(unchanged)`

- [ ] **Step 4: 型検査（テストより先に）**

Run: `npm run typecheck`
Expected: エラーなし。落ちたら、落ちた行を表と照らし、IPC の欄・starter の欄なのに直っていない行（スクリプトの表の漏れ）か、直してはいけない行（履歴の欄・Task 5 の欄）を直してしまったかを確かめて止まって報告する（手で直して進めない）

- [ ] **Step 5: 完了の条件の grep（型検査の外の直し漏れ）**

```bash
cd <repo-root>
grep -rlw claudeSessionId src/main/__tests__ | sort
grep -cw claudeSessionId src/shared/__tests__/agentTerminal.test.ts src/renderer/src/components/__tests__/App.agentReferences.test.tsx
grep -nw claudeSessionId src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx
grep -nE "hasOnlyKeys\(launch, \['kind', |UUID v4 である必要" src/main/handlers/agentTerminalPayloadParser.ts
grep -nw claudeSessionId src/main/__tests__/agentCliLaunchSpecs.test.ts src/main/__tests__/claudeSessionIdSelection.test.ts || echo "as unknown as の値も直った"
grep -c '会話の ID' src/main/agentSessionStarter.ts
grep -c 'claude の会話の ID' src/main/agentSessionStarter.ts
grep -rnw claudeSessionId src | wc -l
grep -rcw claudeSessionId src | grep -v ':0$' | sort
```

Expected:

- 1 つ目: `src/main/__tests__/handlers/historyHandlers.test.ts`・`src/main/__tests__/historyStore.test.ts`・`src/main/__tests__/historyUtils.test.ts` の 3 ファイルだけ（main のテストの (a) はこの 3 つだけ）
- 2 つ目: どちらも `0`
- 3 つ目: (a) の 3 行（122・172・236 行。`loadHistory` の偽物の履歴）だけ
- 4 つ目: `hasOnlyKeys(launch, ['kind', 'cliSessionId', 'cliKind'])` と `'cliSessionId は小文字の UUID v4 である必要があります'` の 2 行（文字列の欄名。型検査で見つからない）
- 5 つ目: `as unknown as の値も直った`
- 6 つ目が `14`・7 つ目が `0`（starter の「会話の ID」は、直した 6 行と元からの 8 行。「claude のセッション ID」の 4 行は「会話の ID」を含まず、Task 4 で直すので、ここでは残る）
- 8 つ目: `179`
- 9 つ目: 次の 35 ファイル（このほかに出るファイルがあれば、直し漏れか直しすぎ）:

  ```text
  src/main/__tests__/handlers/historyHandlers.test.ts:1
  src/main/__tests__/historyStore.test.ts:3
  src/main/__tests__/historyUtils.test.ts:9
  src/main/agentCliLaunchSpecs.ts:11
  src/main/agentSessionRecordStore.ts:7
  src/main/claudeSessionReservations.ts:7
  src/main/historyUtils.ts:2
  src/renderer/src/__tests__/makeAgentSessionsState.ts:1
  src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx:3
  src/renderer/src/components/__tests__/Sidebar.test.tsx:1
  src/renderer/src/components/history/HistoryDetail.tsx:1
  src/renderer/src/components/history/__tests__/HistoryDetail.styles.test.tsx:1
  src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx:1
  src/renderer/src/components/history/__tests__/HistoryItem.test.tsx:1
  src/renderer/src/components/history/__tests__/HistoryPanel.test.tsx:2
  src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts:14
  src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts:2
  src/renderer/src/hooks/__tests__/useAgentResume.test.ts:14
  src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts:1
  src/renderer/src/hooks/__tests__/useAgentSessions.test.ts:13
  src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts:20
  src/renderer/src/hooks/__tests__/usePromptRunner.test.ts:3
  src/renderer/src/hooks/useAgentLastSession.ts:1
  src/renderer/src/hooks/useAgentResume.ts:2
  src/renderer/src/hooks/useAgentSessions.ts:13
  src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts:16
  src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts:2
  src/renderer/src/lib/__tests__/agentSessionTabState.test.ts:4
  src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts:6
  src/renderer/src/lib/__tests__/historyEntryFactory.test.ts:1
  src/renderer/src/lib/__tests__/historyFormatters.test.ts:1
  src/renderer/src/lib/agentResumeAvailability.ts:4
  src/renderer/src/lib/agentSessionTabState.ts:6
  src/renderer/src/lib/agentTabSessionInfo.ts:3
  src/shared/types/history.ts:2
  ```

  （行の数。main の `agentCliLaunchSpecs.ts`・`agentSessionRecordStore.ts`・`claudeSessionReservations.ts` は Task 4、renderer の (a) 以外は Task 5 の対象）

- [ ] **Step 6: IPC の値の形の grep（複数行に分けた偽物の値の直し漏れ）**

前後の行を含めるのは、複数行に分けた偽物の値（`kind: 'started'` の数行後に `claudeSessionId:` がある形）を拾うため。

```bash
cd <repo-root>
grep -rnw -B4 -A1 claudeSessionId src | grep -E "kind: '(resume|started|already-running|selected)'|startAgentSession|getLastAgentSession|getAgentSessions|launch:"
```

Expected: 次の 8 行だけ（順は問わない）。どれも `-`（前後の行）で、IPC の値を書いた行ではない:

- `src/renderer/src/hooks/useAgentResume.ts-82-` と `-83-`（84 行の残りは `current.claudeSessionId`。`AgentLastSessionLookup` の読みで Task 5。84 行の launch の欄は `cliSessionId` に直っている）
- `src/renderer/src/hooks/__tests__/useAgentSessions.test.ts-1277-`・`-1291-`・`-1302-`（近くの残りはタブの `toMatchObject` と題で Task 5。1291・1302 行の `resolveStart` は `cliSessionId` に直っている）
- `src/main/agentCliLaunchSpecs.ts-27-`・`-43-`・`-67-`（`launch: AgentLaunchRequest,` の次の行の引数名 `claudeSessionId` で Task 4）

このほかの行が出たら、1 行ずつ読み、IPC の値（起動の結果・前回・状態の取得・launch）に旧い欄が残っていれば、テストを流さずに止まって報告する

続けて、「素の再帰削除の grep」が `素の再帰削除なし` であることを確かめ、「退避の手順」を `<ラベル>` = `task3` で行う。

- [ ] **Step 7: テストが通ることを確かめる**

```bash
cd <repo-root>
set -- src/shared/__tests__/agentTerminal.test.ts src/main/__tests__/agentCliLaunch.integration.test.ts src/main/__tests__/agentCliLaunchSpecs.test.ts src/main/__tests__/agentSessionSnapshot.test.ts src/main/__tests__/agentSessionStarter.capabilities.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/claudeSessionIdSelection.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/handlers/agentTerminalPayloadParser.test.ts src/main/__tests__/ipcHandlers.test.ts
npx vitest run "$@"
set -- src/renderer/src/components/__tests__/App.agentReferences.test.tsx src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts
npx vitest run "$@"
```

Expected: すべて PASS（落ちたら Global Constraints の手順 7。時間切れは単体で流し直す）

- [ ] **Step 8: lint と整形の確かめ**

```bash
cd <repo-root>
xargs npx eslint --max-warnings 0 < $AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/rename/task3-files.txt
xargs npx prettier --check < $AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad/rename/task3-files.txt
```

Expected: 通る

- [ ] **Step 9: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 4: main の中の改名とファイル名の変更

> **設計書の読む節:** 「層ごとの分類」の「(c) main・renderer の中だけの変数・関数・型・ファイル名」の main、「(d) doc コメント・テストの題・ログ・画面に出る文言」、「画面に出る文言」、「新しい名前の表」、「実装の分割」の 4。
>
> **気をつける知見:** L-624（`git mv` で移す。`mv` + `git add -u` は移動先が漏れる。終わりに `git status --short` で `RM` になり、移動先が `??` に無いことを確かめる）・L-310（import のパス・ファイル名を書いたコメント〈`agentSessionStarter.ts:36-37`〉・describe の題を同じタスクで直す）・L-017（直す例外の文言に ID・パスを入れない）・L-203（main のコメントの「claude の会話の ID」を直す）。
>
> **安全の手順（このタスクで最初に読む）:** Step 1〜4（`git mv`・スクリプトの作成と実行・整形）の間は、テストを 1 回も流さない。Step 5〜6 の型検査・完了の条件の grep・`git status` を済ませ、素の再帰削除の grep と退避の後に、Step 7 でテストを流す。期待と違えば、テストを流さずに止まって報告する。

**Files:**

- Rename（`git mv`）:
  - `src/main/claudeSessionIdSelection.ts` → `src/main/cliSessionIdSelection.ts`
  - `src/main/claudeSessionReservations.ts` → `src/main/cliSessionReservations.ts`
  - `src/main/__tests__/claudeSessionIdSelection.test.ts` → `src/main/__tests__/cliSessionIdSelection.test.ts`
  - `src/main/__tests__/claudeSessionReservations.test.ts` → `src/main/__tests__/cliSessionReservations.test.ts`
- Modify（名前。すべて語の単位で、ファイルの全体。件数は置き換えの前の数）:

| ファイル（`src/main/` の下）                         | 置き換え                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentSessionStarter.ts`                             | `createClaudeSessionId` 3（68・157・313 行）・`selectClaudeSessionId` 2（27・309 行）・`ClaudeSessionReservations` 2（26・63 行）・ファイル名 `claudeSessionIdSelection` 2（27 行の import・36 行のコメント）・`claudeSessionReservations` 2（26 行の import・37 行のコメント） |
| `cliSessionIdSelection.ts`                           | `createClaudeSessionId` 2・`selectClaudeSessionId` 1・`ClaudeSessionIdSelection` 2                                                                                                                                                                                              |
| `cliSessionReservations.ts`                          | `createClaudeSessionReservations` 1・`ClaudeSessionReservations` 2、引数名 `claudeSessionId` 8 か所すべて（7・9・15〜17・23・26 行）                                                                                                                                            |
| `ipcHandlers.ts`                                     | `createClaudeSessionId` 1（123 行）・`createClaudeSessionReservations` 2（31・122 行）・`claudeSessionReservations` 1（31 行の import）                                                                                                                                         |
| `agentCliLaunchSpecs.ts`                             | 引数名 `claudeSessionId` 11 か所すべて（22 行のコメント・28・44・47・51・53・68・71・75・85・87 行）                                                                                                                                                                            |
| `agentSessionRecordStore.ts`                         | 引数名 `claudeSessionId` 9 か所すべて（31・39・93・96〈2〉・154〈2〉・156・157 行）                                                                                                                                                                                             |
| `__tests__/agentCliLaunch.integration.test.ts`       | `createClaudeSessionId` 2・`createClaudeSessionReservations` 3・`claudeSessionReservations` 1                                                                                                                                                                                   |
| `__tests__/agentHookSessions.test.ts`                | `CLAUDE_SESSION_ID` 7 → `CLI_SESSION_ID`                                                                                                                                                                                                                                        |
| `__tests__/agentSessionStarter.capabilities.test.ts` | `createClaudeSessionId` 4・`createClaudeSessionReservations` 2・`ClaudeSessionReservations` 2・`claudeSessionReservations` 2                                                                                                                                                    |
| `__tests__/agentSessionStarter.test.ts`              | `createClaudeSessionId` 2・`selectClaudeSessionId` 1・`createClaudeSessionReservations` 2・`ClaudeSessionReservations` 2・`claudeSessionReservations` 2                                                                                                                         |
| `__tests__/cliSessionIdSelection.test.ts`            | `selectClaudeSessionId` 6・`claudeSessionIdSelection` 1                                                                                                                                                                                                                         |
| `__tests__/cliSessionReservations.test.ts`           | `createClaudeSessionReservations` 5・`claudeSessionReservations` 1                                                                                                                                                                                                              |
| `__tests__/handlers/agentTerminalHandlers.test.ts`   | `createClaudeSessionId` 1・`createClaudeSessionReservations` 2・`claudeSessionReservations` 1                                                                                                                                                                                   |
| `__tests__/ipcHandlers.test.ts`                      | `createClaudeSessionId` 4                                                                                                                                                                                                                                                       |

- Modify（文言。前に空白がある所は空白ごと消す）:

| ファイル（`src/main/` の下）             | 行  | 旧 → 新                                                                                                                                       |
| ---------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentSessionStarter.ts`                 | 421 | `'起動したセッションの claude のセッション ID がありません'` → `'起動したセッションの会話の ID がありません'`                                 |
| `agentSessionStarter.ts`                 | 430 | `'再開に対応しない CLI のセッションに claude のセッション ID があります'` → `'…セッションに会話の ID があります'`                             |
| `agentSessionStarter.ts`                 | 440 | ログ `'[agentSessionStarter] 動いているセッションの種類と claude のセッション ID が見つかりません:'` → `'…種類と会話の ID が見つかりません:'` |
| `agentSessionStarter.ts`                 | 443 | `'動いているセッションの種類と claude のセッション ID が見つかりません'` → `'…種類と会話の ID が見つかりません'`                              |
| `agentSessionRegistry.ts`                | 19  | `(claude の会話の ID は` → `(会話の ID は`                                                                                                    |
| `agentSessionRegistry.ts`                | 26  | `。claude の会話の ID は` → `。会話の ID は`                                                                                                  |
| `agentSessionSnapshot.ts`                | 5   | `CLI の種類と claude の会話の ID を` → `CLI の種類と会話の ID を`                                                                             |
| `handlers/agentTerminalHandlers.ts`      | 35  | `種類と claude の会話の ID(starter の Map)` → `種類と会話の ID(starter の Map)`                                                               |
| `__tests__/agentSessionSnapshot.test.ts` | 16  | 題 `各セッションに種類と claude の会話の ID(…)` → `各セッションに種類と会話の ID(…)`                                                          |
| `__tests__/agentSessionStarter.test.ts`  | 381 | describe `createAgentSessionStarter(claude のセッション ID・記録・予約)` → `createAgentSessionStarter(会話の ID・記録・予約)`                 |
| `__tests__/agentSessionStarter.test.ts`  | 434 | 題 `…pty の sessionId で、claude の会話の ID や知らない sessionId では引けない` → `…で、会話の ID や…`                                        |

（例外・ログの文言には ID・パスを入れない。今も入れていない。L-017。ログの第 2 引数の pty の `sessionId` は変えない）

**Interfaces:**

- Consumes: Task 3 の `AgentSessionInfo.cliSessionId`・`ClaudeSessionIdSelection` の `{ kind: 'selected'; cliSessionId: string }`。`$S/rename/rename_engine.py`
- Produces:
  - `src/main/cliSessionIdSelection.ts` の `selectCliSessionId(launch, folderKey, records, createCliSessionId: () => string): CliSessionIdSelection`・`type CliSessionIdSelection`
  - `src/main/cliSessionReservations.ts` の `createCliSessionReservations(): CliSessionReservations`・`interface CliSessionReservations { tryReserve(cliSessionId: string): (() => void) | null; has(cliSessionId: string): boolean }`
  - starter の注入の option `createCliSessionId?: () => string`（`ipcHandlers.ts` は `createCliSessionId: randomUUID`）

- [ ] **Step 1: ファイルを `git mv` で移す**

```bash
cd <repo-root>
git mv src/main/claudeSessionIdSelection.ts src/main/cliSessionIdSelection.ts
git mv src/main/claudeSessionReservations.ts src/main/cliSessionReservations.ts
git mv src/main/__tests__/claudeSessionIdSelection.test.ts src/main/__tests__/cliSessionIdSelection.test.ts
git mv src/main/__tests__/claudeSessionReservations.test.ts src/main/__tests__/cliSessionReservations.test.ts
git status --short | grep -E '^R'
```

Expected: 4 行の `R`（Task 3 で `claudeSessionIdSelection.ts`・`claudeSessionIdSelection.test.ts` を直してあるので、その 2 つは `RM`）

- [ ] **Step 2: スクリプトを書く（`$S/rename/rename_task4.py`）**

```python
# -*- coding: utf-8 -*-
# Task 4: main の中の名前を改名する(git mv の後に流す。ファイルのパスは移した後のもの)。
# 注入の option・選択と予約の関数と型・import のパス・テストの定数・main の中の引数名(agentCliLaunchSpecs・agentSessionRecordStore・
# cliSessionReservations の claudeSessionId)と、main の文言(例外・ログ・コメント・テストの題の「claude の会話の ID」「claude のセッション ID」)。
# 使い方: python3 rename_task4.py <リポジトリの根>   (rename_engine.py と同じフォルダに置く)
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rename_engine import run

CREATE_ID = ('createClaudeSessionId', 'createCliSessionId')
SELECT = ('selectClaudeSessionId', 'selectCliSessionId')
SELECTION_T = ('ClaudeSessionIdSelection', 'CliSessionIdSelection')
CREATE_RES = ('createClaudeSessionReservations', 'createCliSessionReservations')
RES_T = ('ClaudeSessionReservations', 'CliSessionReservations')
CONST = ('CLAUDE_SESSION_ID', 'CLI_SESSION_ID')
SELECTION_F = ('claudeSessionIdSelection', 'cliSessionIdSelection')  # ファイル名(import のパス・コメント)
RES_F = ('claudeSessionReservations', 'cliSessionReservations')  # ファイル名(import のパス・コメント)

# {ファイル: [(旧, 新, 置き換えの前の件数)]}
M = 'src/main/'
T = 'src/main/__tests__/'
words = {
    M + 'agentSessionStarter.ts': [CREATE_ID + (3,), SELECT + (2,), RES_T + (2,), SELECTION_F + (2,), RES_F + (2,)],
    M + 'cliSessionIdSelection.ts': [CREATE_ID + (2,), SELECT + (1,), SELECTION_T + (2,)],
    M + 'cliSessionReservations.ts': [CREATE_RES + (1,), RES_T + (2,)],
    M + 'ipcHandlers.ts': [CREATE_ID + (1,), CREATE_RES + (2,), RES_F + (1,)],
    T + 'agentCliLaunch.integration.test.ts': [CREATE_ID + (2,), CREATE_RES + (3,), RES_F + (1,)],
    T + 'agentHookSessions.test.ts': [CONST + (7,)],
    T + 'agentSessionStarter.capabilities.test.ts': [CREATE_ID + (4,), CREATE_RES + (2,), RES_T + (2,), RES_F + (2,)],
    T + 'agentSessionStarter.test.ts': [CREATE_ID + (2,), SELECT + (1,), CREATE_RES + (2,), RES_T + (2,), RES_F + (2,)],
    T + 'cliSessionIdSelection.test.ts': [SELECT + (6,), SELECTION_F + (1,)],
    T + 'cliSessionReservations.test.ts': [CREATE_RES + (5,), RES_F + (1,)],
    T + 'handlers/agentTerminalHandlers.test.ts': [CREATE_ID + (1,), CREATE_RES + (2,), RES_F + (1,)],
    T + 'ipcHandlers.test.ts': [CREATE_ID + (4,)],
}
# main の中の引数名(ファイルの claudeSessionId を全部。どれも IPC・保存の欄ではない)
csid = {
    M + 'agentCliLaunchSpecs.ts': (11, '*'),
    M + 'agentSessionRecordStore.ts': (9, '*'),
    M + 'cliSessionReservations.ts': (8, '*'),
}
# 前に空白がある所は空白ごと消す(「種類と claude の会話の ID」→「種類と会話の ID」)。( や 、・。の後は空白が無いので C0・S0
C = (' claude の会話の ID', '会話の ID')
C0 = ('claude の会話の ID', '会話の ID')
S = (' claude のセッション ID', '会話の ID')
S0 = ('(claude のセッション ID', '(会話の ID')
texts = {
    M + 'agentSessionRegistry.ts': [(19,) + C0, (26,) + C0],
    M + 'agentSessionSnapshot.ts': [(5,) + C],
    M + 'handlers/agentTerminalHandlers.ts': [(35,) + C],
    M + 'agentSessionStarter.ts': [(421,) + S, (430,) + S, (440,) + S, (443,) + S],
    T + 'agentSessionSnapshot.test.ts': [(16,) + C],
    T + 'agentSessionStarter.test.ts': [(381,) + S0, (434,) + C0],
}
run(sys.argv[1], words, csid, texts)
```

- [ ] **Step 3: スクリプトを流す**

```bash
S=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad
python3 "$S/rename/rename_task4.py" <repo-root>
```

Expected: 18 ファイルが `書き換え済み`（どれも残りの `claudeSessionId` 0 件）で、最後に `完了: 18 ファイル`。`中止(何も書いていません)` が出たら、表を直さずに止まって報告する

- [ ] **Step 4: 整形**

```bash
cd <repo-root>
set -- src/main/agentSessionStarter.ts src/main/cliSessionIdSelection.ts src/main/cliSessionReservations.ts src/main/ipcHandlers.ts src/main/agentCliLaunchSpecs.ts src/main/agentSessionRecordStore.ts src/main/agentSessionRegistry.ts src/main/agentSessionSnapshot.ts src/main/handlers/agentTerminalHandlers.ts src/main/__tests__/agentCliLaunch.integration.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentSessionSnapshot.test.ts src/main/__tests__/agentSessionStarter.capabilities.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/cliSessionIdSelection.test.ts src/main/__tests__/cliSessionReservations.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts
npx prettier --write "$@"
```

Expected: 18 ファイルとも `(unchanged)`（計画の時点で写しで確かめた）

- [ ] **Step 5: 型検査（テストより先に）**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: 完了の条件の grep と `git status`**

```bash
cd <repo-root>
grep -rnE 'ClaudeSession|CLAUDE_SESSION_ID|claudeSessionIdSelection|claudeSessionReservations|claude の会話の ID|claude のセッション ID' src/main src/shared src/preload || echo "main・shared の仲間の名前・文言なし"
grep -rlw claudeSessionId src/main src/shared | sort
grep -rnw claudeSessionId src | wc -l
grep -rn '会話の ID' src/main/agentSessionStarter.ts | grep -c 'Error\|console.error\|agentSessionStarter\]'
grep -rnE '(と|の|に|で|、) 会話の ID' src || echo "余計な空白なし"
git status --short | grep -E '^(R|\?\?)'
ls src/main/claudeSession* src/main/__tests__/claudeSession* 2>/dev/null || echo "旧いファイル名なし"
```

Expected:

- 1 つ目: `main・shared の仲間の名前・文言なし`
- 2 つ目: `src/main/__tests__/handlers/historyHandlers.test.ts`・`src/main/__tests__/historyStore.test.ts`・`src/main/__tests__/historyUtils.test.ts`・`src/main/historyUtils.ts`・`src/shared/types/history.ts` の 5 ファイルだけ（(a) と Task 1 の分）
- 3 つ目: `154`
- 4 つ目: `4`（例外 3 つとログ 1 つの文言が「会話の ID」になった。`console.error(` の行と文言の行が分かれているので、文言の行だけを数える）
- 5 つ目: `余計な空白なし`（「種類と 会話の ID」のように、消した「claude」の前の空白が残っていない。計画の時点の `src` にも当たる行は無い）
- 6 つ目: `R` か `RM` の 4 行（`claudeSessionIdSelection.ts -> cliSessionIdSelection.ts` など）と、`??` の設計書・実装プランの 2 行だけ（移動先が `??` に無い。L-624）
- 7 つ目: `旧いファイル名なし`

続けて、「素の再帰削除の grep」が `素の再帰削除なし` であることを確かめ、「退避の手順」を `<ラベル>` = `task4` で行う（`git diff --binary HEAD` は `git mv` のステージ済みの改名も含む）。

- [ ] **Step 7: テストが通ることを確かめる**

```bash
cd <repo-root>
set -- src/main/__tests__/agentCliLaunch.integration.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentSessionSnapshot.test.ts src/main/__tests__/agentSessionStarter.capabilities.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/cliSessionIdSelection.test.ts src/main/__tests__/cliSessionReservations.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts src/main/__tests__/agentCliLaunchSpecs.test.ts src/main/__tests__/agentSessionRecordStore.test.ts src/main/__tests__/agentSessionRegistry.test.ts
npx vitest run "$@"
```

Expected: すべて PASS

- [ ] **Step 8: lint と整形の確かめ**

```bash
cd <repo-root>
set -- src/main/agentSessionStarter.ts src/main/cliSessionIdSelection.ts src/main/cliSessionReservations.ts src/main/ipcHandlers.ts src/main/agentCliLaunchSpecs.ts src/main/agentSessionRecordStore.ts src/main/agentSessionRegistry.ts src/main/agentSessionSnapshot.ts src/main/handlers/agentTerminalHandlers.ts src/main/__tests__/agentCliLaunch.integration.test.ts src/main/__tests__/agentHookSessions.test.ts src/main/__tests__/agentSessionSnapshot.test.ts src/main/__tests__/agentSessionStarter.capabilities.test.ts src/main/__tests__/agentSessionStarter.test.ts src/main/__tests__/cliSessionIdSelection.test.ts src/main/__tests__/cliSessionReservations.test.ts src/main/__tests__/handlers/agentTerminalHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: 通る

- [ ] **Step 9: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 5: renderer の中の改名

> **設計書の読む節:** 「層ごとの分類」の「(c) main・renderer の中だけの変数・関数・型・ファイル名」の renderer、「テストの中の型の付かない値の分け方」の (a)・(c)、「保存の欄の扱いの比較」の「renderer の中の送り先の控え」、「実装の分割」の 5。
>
> **気をつける知見:** L-609（`AgentResumeTab`・`AgentTabSessionSource` は `AgentSessionTabView` を写した構造的な型なので、renderer の型の欄を 1 つのタスクでまとめて改名する）・L-310（題・コメント・テストの補助〈`makeAgentSessionsState.ts`〉を同じタスクで直す）・L-618（型の付かない `toEqual`・`toMatchObject` の値の直し漏れを grep で捕まえてからテストを流す）・L-065（残った各行が履歴の欄であることを 1 行ずつ確かめる）。
>
> **安全の手順（このタスクで最初に読む）:** Step 1〜3（スクリプトの作成・実行・整形）の間は、テストを 1 回も流さない。Step 4〜5 の型検査・完了の条件の grep を済ませ、素の再帰削除の grep と退避の後に、Step 6 でテストを流す。期待と違えば、テストを流さずに止まって報告する。

**Files（行は Task 3 の後のもの。表のファイルは Task 3 の prettier で行が動かないことを写しで確かめた。`useAgentSessions.ts`・`useAgentSessions.test.ts` は Task 3 の prettier で行が畳まれたので、ファイルの全部〈`'*'`〉と、畳まれた所より前の文言の行だけを使う）:**

- Modify（名前。語の単位で、ファイルの全体）:
  - `src/renderer/src/hooks/useAgentSessions.ts`: `setTabClaudeSessionId` 11 → `setTabCliSessionId`、`isClaudeSessionIdActiveElsewhere` 5 → `isCliSessionIdActiveElsewhere`、`claudeSessionIdBySlotRef` 5 → `cliSessionIdBySlotRef`
  - `src/renderer/src/lib/agentSessionTabState.ts`（1）・`agentResumeAvailability.ts`（3）・`__tests__/agentSessionTabState.test.ts`（6）: `findActiveAgentTabByClaudeSessionId` → `findActiveAgentTabByCliSessionId`
- Modify（`claudeSessionId` → `cliSessionId`）:
  - ファイルの全部: `useAgentSessions.ts`（13。`AgentSessionTabView` の欄・`resumeInNewTab` の型の引数・`setTabCliSessionId` の引数・`isCliSessionIdActiveElsewhere` の引数・コメント）、`useAgentLastSession.ts`（1。60 行の `AgentLastSessionLookup` の欄）、`agentSessionTabState.ts`（7。`AgentTabSessionFields` の欄・初期値・`findActiveAgentTabByCliSessionId` の型の引数とコメント）、`makeAgentSessionsState.ts`（1）、`useAgentLastSession.test.ts`（14。`toEqual` の (c)）、`useAgentSessions.test.ts`（13。タブの `toMatchObject` の (c)・欄の読み・題 4 つ）、`agentSessionTabState.test.ts`（4。(c)）
  - 行の指定（指定の無い行は履歴の欄で残す）: `useAgentResume.ts:84`（`current.…`）、`agentResumeAvailability.ts:31・37・63`（111 行の `recorded.claudeSessionId` は残す）、`agentTabSessionInfo.ts:15・28・30 の 2 つ目`（30 行は `claudeSessionId: tab.cliSessionId` になり、欄名は残す）、`useAgentResume.test.ts`（58・75・76 行の補助の引数と、タブ・前回の 10 行）、`useAgentWorkspace.test.ts`（2370・2375・2406・2428・2442・2455・2466・2479・2556・2586・2827 行）、`agentResumeAvailability.test.ts`（107・194・273 行を除く 13 行）、`agentTabSessionInfo.test.ts:13・19・30・42`（21・33 行は残す）
  - 短縮記法の書き下し: `useAgentResume.test.ts:69` の `agent: { claudeSessionId, cliKind` → `agent: { claudeSessionId: cliSessionId, cliKind`（補助の引数を `cliSessionId` にするため。欄名は履歴の欄で残す）
- Modify（文言。前の空白ごと「claude の会話の ID」→「会話の ID」）: `useAgentSessions.ts:63・172・259`、`useAgentPromptSender.ts:49`、`agentSessionTabState.ts:28`、`useAgentWorkspace.test.ts:2423・2450`（題）

**Interfaces:**

- Consumes: Task 3 の IPC の欄（`AgentLastSession.cliSessionId`・`AgentLaunchRequest` の `cliSessionId` など）。`$S/rename/rename_engine.py`
- Produces（renderer の中の名前）:
  - `AgentTabSessionFields.cliSessionId: string | null`・`AgentSessionTabView.cliSessionId: string | null`・`AgentResumeTab.cliSessionId: string | null`・`AgentTabSessionSource.cliSessionId: string | null`
  - `AgentLastSessionLookup` の `{ kind: 'found'; cliKind: AgentCliKind; cliSessionId: string }`
  - `AgentSessionsState.resumeInNewTab: (cliSessionId: string, cliKind: AgentCliKind) => string | null`
  - `findActiveAgentTabByCliSessionId<T extends { status: AgentSessionStatus; cliSessionId: string | null }>(tabs: readonly T[], cliSessionId: string): T | undefined`
  - `describeAgentTabSession` の戻り値は `AgentHistoryInfo` のまま（`claudeSessionId: tab.cliSessionId`）

- [ ] **Step 1: スクリプトを書く（`$S/rename/rename_task5.py`）**

```python
# -*- coding: utf-8 -*-
# Task 5: renderer の中の名前を改名する。タブの欄(AgentTabSessionFields・AgentSessionTabView・AgentResumeTab・AgentTabSessionSource)・
# 前回の見つかった結果(AgentLastSessionLookup)の欄・resumeInNewTab の引数・ref・関数と、テストの値・補助の引数・題、renderer の文言。
# 履歴の欄(AgentHistoryInfo.claudeSessionId。HistoryEntry.agent・sentTo・describeSession()・recorded)の行には触れない。
# 使い方: python3 rename_task5.py <リポジトリの根>   (rename_engine.py と同じフォルダに置く)
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rename_engine import run

R = 'src/renderer/src/'
SET_TAB = ('setTabClaudeSessionId', 'setTabCliSessionId')
FIND_TAB = ('findActiveAgentTabByClaudeSessionId', 'findActiveAgentTabByCliSessionId')
ACTIVE = ('isClaudeSessionIdActiveElsewhere', 'isCliSessionIdActiveElsewhere')
REF = ('claudeSessionIdBySlotRef', 'cliSessionIdBySlotRef')
# {ファイル: [(旧, 新, 置き換えの前の件数)]}
words = {
    R + 'hooks/useAgentSessions.ts': [SET_TAB + (11,), ACTIVE + (5,), REF + (5,)],
    R + 'lib/agentSessionTabState.ts': [FIND_TAB + (1,)],
    R + 'lib/agentResumeAvailability.ts': [FIND_TAB + (3,)],
    R + 'lib/__tests__/agentSessionTabState.test.ts': [FIND_TAB + (6,)],
}
# {ファイル: (置き換えの前の claudeSessionId の件数, '*'〈全部〉か [(行, その行の件数, [置き換える何個目])])}
# 行を指定したファイルは、指定していない行に履歴の欄(残す)がある
csid = {
    'src/renderer/src/__tests__/makeAgentSessionsState.ts': (1, '*'),
    'src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts': (14, '*'),
    # 69 行は履歴の欄(texts で短縮記法を書き下す)
    'src/renderer/src/hooks/__tests__/useAgentResume.test.ts': (14, [
        (58, 1, [0]), (75, 1, [0]), (76, 1, [0]), (103, 1, [0]), (121, 1, [0]), (129, 1, [0]), (166,
        1, [0]), (183, 1, [0]), (190, 1, [0]), (217, 1, [0]), (236, 1, [0]), (309, 1, [0]), (393, 1,
        [0])
    ]),
    'src/renderer/src/hooks/__tests__/useAgentSessions.test.ts': (13, '*'),
    # 566・619・692・2436・2447・2488・2518・2733・3194 行は履歴の欄で残す
    'src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts': (20, [
        (2370, 1, [0]), (2375, 1, [0]), (2406, 1, [0]), (2428, 1, [0]), (2442, 1, [0]), (2455, 1,
        [0]), (2466, 1, [0]), (2479, 1, [0]), (2556, 1, [0]), (2586, 1, [0]), (2827, 1, [0])
    ]),
    'src/renderer/src/hooks/useAgentLastSession.ts': (1, '*'),
    # 116 行(entry.agent.claudeSessionId)は履歴の欄で残す
    'src/renderer/src/hooks/useAgentResume.ts': (2, [
        (84, 1, [0])
    ]),
    'src/renderer/src/hooks/useAgentSessions.ts': (13, '*'),
    # 107・194・273 行(recorded・履歴のエントリ)は履歴の欄で残す
    'src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts': (16, [
        (44, 1, [0]), (54, 1, [0]), (86, 1, [0]), (87, 1, [0]), (98, 1, [0]), (99, 1, [0]), (132, 1,
        [0]), (204, 1, [0]), (211, 1, [0]), (222, 1, [0]), (237, 1, [0]), (264, 1, [0]), (318, 1,
        [0])
    ]),
    'src/renderer/src/lib/__tests__/agentSessionTabState.test.ts': (4, '*'),
    # 21・33 行(describeAgentTabSession の戻り値の toEqual)は履歴の欄で残す
    'src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts': (6, [
        (13, 1, [0]), (19, 1, [0]), (30, 1, [0]), (42, 1, [0])
    ]),
    # 111 行(recorded.claudeSessionId)は履歴の欄で残す
    'src/renderer/src/lib/agentResumeAvailability.ts': (4, [
        (31, 1, [0]), (37, 1, [0]), (63, 1, [0])
    ]),
    'src/renderer/src/lib/agentSessionTabState.ts': (7, '*'),
    # 30 行の 1 つ目(戻り値の AgentHistoryInfo の欄)は残し、2 つ目(tab.…)だけ直す
    'src/renderer/src/lib/agentTabSessionInfo.ts': (4, [
        (15, 1, [0]), (28, 1, [0]), (30, 2, [1])
    ]),
}
C = (' claude の会話の ID', '会話の ID')  # 前の空白ごと消す(「タブの claude の会話の ID」→「タブの会話の ID」)
texts = {
    R + 'hooks/useAgentSessions.ts': [(63,) + C, (172,) + C, (259,) + C],
    R + 'hooks/useAgentPromptSender.ts': [(49,) + C],
    R + 'lib/agentSessionTabState.ts': [(28,) + C],
    R + 'hooks/__tests__/useAgentWorkspace.test.ts': [(2423,) + C, (2450,) + C],
    # 補助の引数を cliSessionId にするので、履歴の欄の短縮記法を書き下す(欄名 claudeSessionId は残す)
    R + 'hooks/__tests__/useAgentResume.test.ts': [
        (69, 'agent: { claudeSessionId, cliKind', 'agent: { claudeSessionId: cliSessionId, cliKind')
    ],
}
run(sys.argv[1], words, csid, texts)
```

- [ ] **Step 2: スクリプトを流す**

```bash
S=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad
python3 "$S/rename/rename_task5.py" <repo-root>
```

Expected: 15 ファイルが `書き換え済み` で、最後に `完了: 15 ファイル`。残りの件数は、`useAgentResume.test.ts` 1・`useAgentWorkspace.test.ts` 9・`useAgentResume.ts` 1・`agentResumeAvailability.test.ts` 3・`agentTabSessionInfo.test.ts` 2・`agentResumeAvailability.ts` 1・`agentTabSessionInfo.ts` 1 で、ほかは 0 件。`中止(何も書いていません)` が出たら、表を直さずに止まって報告する

- [ ] **Step 3: 整形**

```bash
cd <repo-root>
set -- src/renderer/src/__tests__/makeAgentSessionsState.ts src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/useAgentLastSession.ts src/renderer/src/hooks/useAgentPromptSender.ts src/renderer/src/hooks/useAgentResume.ts src/renderer/src/hooks/useAgentSessions.ts src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/lib/__tests__/agentSessionTabState.test.ts src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts src/renderer/src/lib/agentResumeAvailability.ts src/renderer/src/lib/agentSessionTabState.ts src/renderer/src/lib/agentTabSessionInfo.ts
npx prettier --write "$@"
```

Expected: `useAgentResume.test.ts` だけが書き換わり（69 行の `agent` のオブジェクトが 1 行に収まらなくなり、複数行に開く）、ほかは `(unchanged)`

- [ ] **Step 4: 型検査（テストより先に）**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 5: 完了の条件の grep**

```bash
cd <repo-root>
grep -cw claudeSessionId src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/lib/__tests__/agentSessionTabState.test.ts
grep -rnE 'ClaudeSession|CLAUDE_SESSION_ID|claude の会話の ID|claude のセッション ID' src/renderer || echo "renderer の仲間の名前・文言なし"
grep -rnE '(と|の|に|で|、) 会話の ID' src || echo "余計な空白なし"
grep -rnw claudeSessionId src/renderer | wc -l
grep -rlw claudeSessionId src/renderer | wc -l
grep -nw claudeSessionId src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/lib/agentTabSessionInfo.ts src/renderer/src/hooks/useAgentResume.ts src/renderer/src/lib/agentResumeAvailability.ts
grep -rnw claudeSessionId src | wc -l
```

Expected:

- 1 つ目: 3 ファイルとも `0`（(c) の `toEqual`・`toMatchObject` が直った）
- 2 つ目: `renderer の仲間の名前・文言なし`
- 3 つ目: `余計な空白なし`
- 4 つ目: `38`・5 つ目: `20`（renderer に残るのは (a) の履歴の欄だけ。ファイルは Task 6 Step 1 の一覧の renderer の 20 ファイル）
- 6 つ目: 次の 4 行（どれも履歴の欄）:
  - `useAgentResume.test.ts:70:    claudeSessionId: cliSessionId,`（69 行から開いた `agent` の中）
  - `agentTabSessionInfo.ts:30:    claudeSessionId: tab.cliSessionId,`
  - `useAgentResume.ts:116:` の `entry.agent.claudeSessionId`
  - `agentResumeAvailability.ts:111:` の `recorded.claudeSessionId`（`findActiveAgentTabByCliSessionId(tabs, recorded.claudeSessionId)`）
- 7 つ目: `55`

続けて、「素の再帰削除の grep」が `素の再帰削除なし` であることを確かめ、「退避の手順」を `<ラベル>` = `task5` で行う。

- [ ] **Step 6: テストが通ることを確かめる**

```bash
cd <repo-root>
set -- src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/lib/__tests__/agentSessionTabState.test.ts src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx
npx vitest run "$@"
set -- src/renderer/src/__tests__/__tests__/makeAgentTerminalPanelState.test.ts src/renderer/src/components/agent/__tests__/AgentSessionTabList.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.styles.test.tsx src/renderer/src/components/agent/__tests__/AgentTerminalPanel.test.tsx src/renderer/src/hooks/__tests__/useAgentInterrupt.test.ts src/renderer/src/hooks/__tests__/useAgentStatusBar.test.ts src/renderer/src/hooks/__tests__/useAgentTabActivation.test.ts src/renderer/src/hooks/__tests__/useAppState.agent.test.ts
npx vitest run "$@"
```

Expected: すべて PASS（2 つ目は、直した補助 `makeAgentSessionsState.ts` を使うテスト）

- [ ] **Step 7: lint と整形の確かめ**

```bash
cd <repo-root>
set -- src/renderer/src/__tests__/makeAgentSessionsState.ts src/renderer/src/hooks/__tests__/useAgentLastSession.test.ts src/renderer/src/hooks/__tests__/useAgentResume.test.ts src/renderer/src/hooks/__tests__/useAgentSessions.test.ts src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts src/renderer/src/hooks/useAgentLastSession.ts src/renderer/src/hooks/useAgentPromptSender.ts src/renderer/src/hooks/useAgentResume.ts src/renderer/src/hooks/useAgentSessions.ts src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts src/renderer/src/lib/__tests__/agentSessionTabState.test.ts src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts src/renderer/src/lib/agentResumeAvailability.ts src/renderer/src/lib/agentSessionTabState.ts src/renderer/src/lib/agentTabSessionInfo.ts
npx eslint --max-warnings 0 "$@"
npx prettier --check "$@"
```

Expected: 通る

- [ ] **Step 8: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

---

### Task 6: 全体の検証（ROADMAP・実機テスト仕様書は変えない）

> **設計書の読む節:** 「テストの方針」の「grep の確かめ（最後のタスク）」、「画面に出る文言」、「実機テスト仕様書について」、「決めたこと」の 7・8、「実装の分割」の 6。
>
> **気をつける知見:** L-310（旧い名前の全ファミリーを grep し、残りが期待どおりであることを確かめる）・L-065（残った各行を 1 行ずつ読む）・L-618（全体のテストの前に grep と退避）・L-609（最後に全体で型検査・テスト・lint を通す）・L-624（`git status` で改名が `R` のまま、移動先が `??` に無いこと）。
>
> **安全の手順（このタスクで最初に読む）:** 全体のテストを流す前に、Step 1 の grep で残りが期待どおりであることと、素の再帰削除が 0 行であることを確かめ、退避する。期待と違えば、全体のテストを流さずに止まって報告する。

**Files:**

- 変更なし（検証だけ）。`ROADMAP.md`・`docs/manual-test-spec.md` は変えない

**Interfaces:**

- Consumes: Task 1〜5 のすべて
- Produces: なし

- [ ] **Step 1: 最後に残る旧名の件数を確かめる（テストを流す前に）**

```bash
cd <repo-root>
grep -rnE 'ClaudeSession|CLAUDE_SESSION_ID|claudeSessionIdSelection|claudeSessionReservations|claude の会話の ID|claude のセッション ID' src || echo "仲間の名前・文言なし"
grep -rhoiE '[A-Za-z_]*claude_?session[A-Za-z_]*' src | sort | uniq -c
grep -rn 'claudeSessionId' src | wc -l
grep -rnw 'claudeSessionId' src | wc -l
grep -row 'claudeSessionId' src | wc -l
grep -rln 'claudeSessionId' src | sort
grep -rnw 'claudeSessionId' src | sort -t: -k1,1 -k2,2n
grep -rn 'claude のセッション' src
```

Expected:

- 1 つ目: `仲間の名前・文言なし`
- 2 つ目: `57 claudeSessionId` の 1 行だけ（ほかの仲間の名前が無い）
- 3 つ目と 4 つ目: `55`（設計書の 51 行に Task 1 の 4 行を足した数）
- 5 つ目: `57`（設計書の 53 か所に Task 1 の 4 か所を足した数。`historyUtils.ts:90` と `historyUtils.test.ts:234` は 1 行に 2 か所）
- 6 つ目: 次の 25 ファイル（設計書の 24 ファイルに `historyStore.test.ts` を足したもの）:
  - shared・main: `src/shared/types/history.ts`、`src/main/historyUtils.ts`、`src/main/__tests__/historyUtils.test.ts`、`src/main/__tests__/historyStore.test.ts`、`src/main/__tests__/handlers/historyHandlers.test.ts`
  - renderer の実装: `src/renderer/src/components/history/HistoryDetail.tsx`、`src/renderer/src/hooks/useAgentResume.ts`、`src/renderer/src/lib/agentResumeAvailability.ts`、`src/renderer/src/lib/agentTabSessionInfo.ts`
  - renderer のテスト（`components`）: `Sidebar.test.tsx`・`App.agentSessionResume.test.tsx`、`history/__tests__/HistoryDetail.styles.test.tsx`・`HistoryDetail.test.tsx`・`HistoryItem.test.tsx`・`HistoryPanel.test.tsx`
  - renderer のテスト（`hooks`）: `useAgentPromptSender.test.ts`・`useAgentResume.test.ts`・`useAgentSendConfirm.test.ts`・`useAgentWorkspace.test.ts`・`usePromptRunner.test.ts`
  - renderer のテスト（`lib`）: `agentResumeAvailability.test.ts`・`agentSendCallbacks.test.ts`・`agentTabSessionInfo.test.ts`・`historyEntryFactory.test.ts`・`historyFormatters.test.ts`
- 7 つ目: 次の 55 行（計画の時点で写しに Task 1〜5 をかけた結果。各行は `AgentHistoryInfo` の欄〈`HistoryEntry.agent`・`sentTo`・`describeSession()`・`recorded`〉か、ディスクの形の値・欄名。1 行ずつ読んで確かめる。L-065）:

  ```text
  src/main/__tests__/handlers/historyHandlers.test.ts:48      claudeSessionId: '11111111-…'（履歴のエントリ）
  src/main/__tests__/historyStore.test.ts:135                 '"agent":{"claudeSessionId":"1111…"…（ディスクの形の文字列。Task 1）
  src/main/__tests__/historyStore.test.ts:137                 it('古い版が書いた agent.claudeSessionId を…（題。Task 1）
  src/main/__tests__/historyStore.test.ts:144                 toContain('"claudeSessionId":"1111…"')（Task 1）
  src/main/__tests__/historyUtils.test.ts:26・171・180・189   claudeSessionId: '11111111-…'（履歴のエントリ）
  src/main/__tests__/historyUtils.test.ts:161・165            'claudeSessionId が UUID の形式でない'・'claudeSessionId が - 始まり'（ディスクの形の題）
  src/main/__tests__/historyUtils.test.ts:162・166            { claudeSessionId: 'abc' … }・{ claudeSessionId: '--resume' … }（型を付けない agent の値）
  src/main/__tests__/historyUtils.test.ts:234                 sanitized.agent?.claudeSessionId … agentEntry.agent?.claudeSessionId（1 行に 2 か所）
  src/main/historyUtils.ts:25                                 isCliSessionId(a.claudeSessionId) &&（ディスクの形の読み）
  src/main/historyUtils.ts:90                                 claudeSessionId: agent.claudeSessionId,（正規化。1 行に 2 か所）
  src/renderer/src/components/__tests__/App.agentSessionResume.test.tsx:122・172・236   claudeSessionId: ID,（loadHistory の偽物の履歴）
  src/renderer/src/components/__tests__/Sidebar.test.tsx:432
  src/renderer/src/components/history/HistoryDetail.tsx:43    セッション: {entry.agent.claudeSessionId}
  src/renderer/src/components/history/__tests__/HistoryDetail.styles.test.tsx:33
  src/renderer/src/components/history/__tests__/HistoryDetail.test.tsx:145
  src/renderer/src/components/history/__tests__/HistoryItem.test.tsx:99
  src/renderer/src/components/history/__tests__/HistoryPanel.test.tsx:210・243
  src/renderer/src/hooks/__tests__/useAgentPromptSender.test.ts:485・615
  src/renderer/src/hooks/__tests__/useAgentResume.test.ts:70  claudeSessionId: cliSessionId,（agentEntry の agent。Task 5 で書き下した）
  src/renderer/src/hooks/__tests__/useAgentSendConfirm.test.ts:13
  src/renderer/src/hooks/__tests__/useAgentWorkspace.test.ts:566・619・692・2436・2447・2488・2518・2733・3194
  src/renderer/src/hooks/__tests__/usePromptRunner.test.ts:59・66・460
  src/renderer/src/hooks/useAgentResume.ts:116                sessions.resumeInNewTab(entry.agent.claudeSessionId, entryCliKind)
  src/renderer/src/lib/__tests__/agentResumeAvailability.test.ts:107・194・273
  src/renderer/src/lib/__tests__/agentSendCallbacks.test.ts:22・67
  src/renderer/src/lib/__tests__/agentTabSessionInfo.test.ts:21・33
  src/renderer/src/lib/__tests__/historyEntryFactory.test.ts:39
  src/renderer/src/lib/__tests__/historyFormatters.test.ts:49
  src/renderer/src/lib/agentResumeAvailability.ts:111         findActiveAgentTabByCliSessionId(tabs, recorded.claudeSessionId)
  src/renderer/src/lib/agentTabSessionInfo.ts:30              claudeSessionId: tab.cliSessionId,（戻り値は AgentHistoryInfo）
  src/shared/types/history.ts:10                              * 保存の欄名(history.json の agent.claudeSessionId)なので、…（doc コメント。Task 1）
  src/shared/types/history.ts:12                              claudeSessionId: string（保存の欄）
  ```

  （行の数を数えると、main 15・shared 2・renderer 38 の計 55 行）

- 8 つ目: 次の 5 行だけ（CLI の種類が claude と決まっている文脈。変えない）: `AgentTerminalPanel.test.tsx:405`・`:522`、`agentSessionMessages.test.ts:191`・`:200`、`agentTerminalHandlers.test.ts:951`

続けて、次を確かめる:

```bash
cd <repo-root>
git status --short
git diff --name-only -- docs/manual-test-spec.md ROADMAP.md
grep -rn 'claudeSessionId\|会話の ID\|セッション ID' docs/manual-test-spec.md || echo "仕様書に該当の項目なし"
```

Expected:

- `git status --short`: `R`/`RM` の 4 行（Task 4 の改名）、` M` の変更、`??` の設計書・実装プランの 2 行だけ（移動先が `??` に無い。L-624）
- 2 つ目: 何も出ない
- 3 つ目: `仕様書に該当の項目なし`

最後に、「素の再帰削除の grep」が `素の再帰削除なし` であることを確かめ、「退避の手順」を `<ラベル>` = `task6` で行う。

- [ ] **Step 2: 全体の検証**

```bash
cd <repo-root>
S=$AGENT_TMP/938c3431-ec1c-437b-91b6-3d162fd19c49/scratchpad
npm run typecheck
npx vitest run --reporter=dot
{ git diff --name-only --diff-filter=d HEAD; git ls-files --others --exclude-standard; } | sort -u | grep -E '^src/.*\.(ts|tsx)$' > "$S/rename/changed.txt"
wc -l < "$S/rename/changed.txt"
xargs npx eslint --max-warnings 0 < "$S/rename/changed.txt"
xargs npx prettier --check < "$S/rename/changed.txt"
npx prettier --check docs/superpowers/plans/2026-10-28-agent-session-id-rename.md docs/superpowers/specs/2026-10-28-agent-session-id-rename-design.md
```

Expected: すべて通る。`changed.txt` は 44 行（Task 1〜5 で変えた `src` のファイル。移す前のパスは `--diff-filter=d` で除き、移した後の 4 つを含む。計画の時点で写しで数えた。違えば、`git diff --name-status HEAD` を見て、変えたファイルに漏れ・余計なものが無いかを確かめて報告する）。全体のテストが時間切れで落ちたら、Global Constraints のとおり単体で流し直す

- [ ] **Step 3: 実機テスト仕様書・ROADMAP は変えない（記録だけ）**

この変更は名前・コメント・テストの題と、通常の操作では出ない 4 つの例外の文言（starter の内部の不変条件が破れたときの 3 つと、renderer が形の不正な ID を送ったときの 1 つ）だけを変え、アプリの画面・挙動・保存の形を変えない。設計書の「実機テスト仕様書について」のとおり、`docs/manual-test-spec.md` には追記せず、既存の項目の期待結果も直さない（仕様書に「セッション ID」「会話の ID」「claudeSessionId」を書いた項目は無い。Step 1 で確かめた）。`node scripts/build-manual-test-spec.mjs` の再生成と Artifact（`<manual-test-spec-artifact-url>`）の再公開もしない。ROADMAP も更新しない（ROADMAP の項目ではなく、旧い名前も出てこない）。

報告に「実機テスト仕様書・ROADMAP は変えていない（理由: アプリの挙動を変えないため。変わる文言は通常の操作では出ない例外の 4 つだけ）」と書く。

- [ ] **Step 4: コミットしない（dev-flow の commit-ja でまとめてコミットする）**

コミットするとき（利用者の指示があってから）は、未追跡の設計書と実装プランを `git add <パス>` で明示的に足す（`git add -u` では入らない。L-624）。`git mv` の改名はステージ済みなので、`git add -u` で中身の変更も入る。

---

## 自己レビューの結果（計画の時点）

- **設計書の網羅:** 「決めたこと」1（`cliSessionId`）→ Task 2〜5、2（保存の欄は変えない）→ 全タスクの表から履歴の欄を外し、Task 1 の doc コメント、3（IPC の 4 つの型）→ Task 3、4（`git mv`）→ Task 4、5（例外・ログの文言）→ Task 4、6（保存の欄名を固定するテスト）→ Task 1、7（過去の設計書・プランは直さない）→ どのタスクも `docs/superpowers` の過去のファイルに触れない、8（ROADMAP は更新しない）→ Task 6 Step 3。「実装の分割」の 1〜6 → Task 1〜6（境界の調整は冒頭の「計画の時点で設計書から調整した細部」）。「安全の手順」→ Global Constraints と各タスクの冒頭。「grep の確かめ」→ Task 6 Step 1。「実機テスト仕様書について」→ Task 6 Step 3
- **件数:** 計画の時点（`ac0f7f5`）で、TypeScript の language service で `claudeSessionId` の 419 か所の宣言を引き直し、設計書の (a)・(b)・(c) の表と合わせて各か所をタスクに振った（Task 3: 237 か所、Task 4: 28 か所、Task 5: 101 か所と短縮記法の書き下し 1 か所、残す: 53 か所）。リポジトリの写しに Task 1 の変更とエンジン・Task 2〜5 のスクリプトを順にかけ（各タスクの後に prettier）、各タスクの後に `npm run typecheck`・変更したファイルへの eslint が通ること、件数が「件数の推移」の表のとおりになること、最後に 57 か所・55 行・25 ファイルになり、仲間の grep が 0 行になることを確かめた（テストは流していない）
- **型の一貫性:** 新しい名前は「新しい名前の表」と各タスクの Interfaces・スクリプトの定数で同じにした（`cliSessionId`・`CLI_SESSION_ID_PATTERN`・`isCliSessionId`・`createCliSessionId`・`selectCliSessionId`・`CliSessionIdSelection`・`createCliSessionReservations`・`CliSessionReservations`・`CLI_SESSION_ID`・`setTabCliSessionId`・`findActiveAgentTabByCliSessionId`・`isCliSessionIdActiveElsewhere`・`cliSessionIdBySlotRef`）
- **安全:** 各タスクで、スクリプト・prettier の途中ではテストを流さず、型検査 → 完了の条件の grep → 素の再帰削除の grep → scratchpad への退避（パッチと未追跡の tar。件数の一致と、退避先が一時ディレクトリとリポジトリの外であることを確かめる）→ テストの順にした。エンジンは全部を確かめてから書き込み、期待と違えば何も書かない。テストを型検査の落ちた状態で流すのは Task 1 Step 4 の 1 回だけで、`node:fs/promises` を差し替えたテストの 1 ファイルに限った
