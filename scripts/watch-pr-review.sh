#!/bin/bash
# PR のレビュー到着を一定間隔で確認する。
#
#   - 新しいレビューが届いたら内容（未解決スレッドと suppressed comments の件数）を
#     出力して終了する
#   - レビュー依頼が保留中（レビュー中）の間は静かに待ち続ける
#   - 依頼も保留も無く新着も無ければ「指摘なし」を出力して終了する
#     ただし最低待機時間を過ぎるまでは終了しない（理由は下記）
#
# usage:
#   scripts/watch-pr-review.sh <owner> <repo> <pr-number> <baseline-iso8601> [min-wait-sec] [interval-sec]
#
# 例:
#   scripts/watch-pr-review.sh poteto317 prompt-ide 28 "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
#
# baseline より後に投稿されたレビューだけを「新着」とみなす。レビューを依頼した
# 直後の時刻を渡すこと。
#
# 注意（実際に踏んだ落とし穴）:
#   - GraphQL の reviews / reviewThreads は first ではなく last を使う。レビューを
#     重ねると first は古い方から埋まり、最新の到着がページの外に出て検知できない。
#   - Copilot は依頼を受け取ると reviewRequests から外れるため、依頼直後でも
#     pending が空に見える。その状態を「新着なし」と判断して終了すると、数分後に
#     届くレビューを取りこぼす。そのため最低待機時間（既定 1500 秒）を設けている。
#   - 実行中にこのファイルを上書きしないこと。bash は実行中もファイルを読み進めるため、
#     動作が壊れる。編集する場合は別名にコピーしたものを実行する。
set -u

if [ "$#" -lt 4 ]; then
  echo "usage: $0 <owner> <repo> <pr-number> <baseline-iso8601> [min-wait-sec] [interval-sec]" >&2
  exit 2
fi

OWNER="$1"
REPO="$2"
PR="$3"
BASELINE="$4"
MIN_WAIT="${5:-1500}"
INTERVAL="${6:-120}"
STARTED=$(date +%s)

while true; do
  out=$(gh api graphql -f query="
  {repository(owner:\"$OWNER\",name:\"$REPO\"){pullRequest(number:$PR){
    reviews(last:10){nodes{author{login} submittedAt body}}
    reviewRequests(first:20){nodes{requestedReviewer{__typename ... on Bot {login} ... on User {login}}}}
    reviewThreads(last:60){nodes{isResolved path line}}
  }}}" 2>/dev/null)

  if [ -n "$out" ]; then
    verdict=$(printf '%s' "$out" | BASELINE="$BASELINE" python3 -c '
import sys, json, os, re

baseline = os.environ["BASELINE"]
try:
    pr = json.load(sys.stdin)["data"]["repository"]["pullRequest"]
except Exception:
    sys.exit(0)

# Copilot のレビュアー名は "copilot-pull-request-reviewer"。人間のレビューと
# 区別するため、末尾が "reviewer" のアカウントだけを対象にする
reviews = [r for r in pr["reviews"]["nodes"] if r["author"]["login"].endswith("reviewer")]
new = [r for r in reviews if r["submittedAt"] > baseline]
pending = [n for n in pr["reviewRequests"]["nodes"]
           if (n.get("requestedReviewer") or {}).get("login", "").endswith("reviewer")]
threads = pr["reviewThreads"]["nodes"]
unresolved = [t for t in threads if not t["isResolved"]]

if new:
    r = new[-1]
    body = r["body"] or ""
    m = re.search(r"Suppressed comments \((\d+)\)", body)
    suppressed = int(m.group(1)) if m else 0
    print("REVIEW ARRIVED: %s %s" % (r["author"]["login"], r["submittedAt"]))
    print("unresolved threads: %d / suppressed: %d" % (len(unresolved), suppressed))
    for t in unresolved:
        print("  - %s:%s" % (t["path"], t["line"]))
    if len(unresolved) == 0 and suppressed == 0:
        print("NO FINDINGS")
    print("__EXIT__")
elif pending:
    pass  # レビュー中。静かに待つ
else:
    print("NO PENDING REVIEW / NO NEW REVIEW")
    print("__EXIT__")
')
    # 依頼が pending に載る前の静かな状態で終了しないよう、最低待機時間の
    # 内側では「新着なし」の判定だけ無効化する（新着そのものは即座に扱う）
    if printf '%s' "$verdict" | grep -q 'NO PENDING REVIEW' &&
       [ $(( $(date +%s) - STARTED )) -lt "$MIN_WAIT" ]; then
      verdict=""
    fi
    if [ -n "$verdict" ]; then
      printf '%s\n' "$verdict" | grep -v '^__EXIT__'
      printf '%s' "$verdict" | grep -q '^__EXIT__' && exit 0
    fi
  fi
  sleep "$INTERVAL"
done
