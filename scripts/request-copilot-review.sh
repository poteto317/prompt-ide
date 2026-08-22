#!/bin/bash
# Copilot にレビューを依頼し、依頼が登録されたことまで確認する。
#
# usage:
#   bash scripts/request-copilot-review.sh <owner> <repo> <pr-number>
#
# REST の `pulls/:number/requested_reviewers` は bot を返さないため、依頼も確認も
# GraphQL で行う。bot の node id は PR の履歴（過去のレビュー投稿者・依頼イベント）から
# 探し、見つからなければ Copilot の既定 id にフォールバックする。
#
# GITHUB_TOKEN（GitHub Actions）からは Copilot レビューをトリガーできないため、
# 必ずローカルターミナルから実行すること。
set -eu

usage() {
  echo "usage: bash $0 <owner> <repo> <pr-number>" >&2
  exit 2
}

if [ "$#" -lt 3 ]; then
  usage
fi

OWNER="$1"
REPO="$2"
PR="$3"

# 数値以外を渡されると GraphQL エラーになり、原因が分かりにくい
case "$PR" in
  '' | *[!0-9]*)
    echo "pr-number は数値で指定してください（受け取った値: ${PR}）" >&2
    usage
    ;;
esac

# copilot-pull-request-reviewer[bot] の node id（アカウント固有ではなくアプリ固有）
DEFAULT_BOT_LOGIN="copilot-pull-request-reviewer"
DEFAULT_BOT_ID="BOT_kgDOCnlnWA"
# login の末尾で見ると dependency-reviewer のような別の reviewer 系 Bot まで
# 拾ってしまうため、厳密一致で判定する
COPILOT_LOGIN="${COPILOT_REVIEWER_LOGIN:-$DEFAULT_BOT_LOGIN}"

# owner / repo は変数で渡す。クエリ文字列に直接埋めると、引用符やバックスラッシュを
# 含む名前でクエリ自体が壊れ、原因が GraphQL の構文エラーに化ける
if ! info=$(gh api graphql -f query='
query($owner:String!,$repo:String!,$pr:Int!){
  repository(owner:$owner,name:$repo){pullRequest(number:$pr){
    id
    # スレッドへの返信も review として記録され、長いループでは直近が人間側の返信で
    # 埋まる。取りこぼすと bot id を特定できないため GraphQL の上限まで取る
    reviews(last:100){nodes{author{__typename login ... on Bot{id}}}}
    timelineItems(last:50, itemTypes:[REVIEW_REQUESTED_EVENT]){nodes{
      ... on ReviewRequestedEvent{requestedReviewer{__typename ... on Bot{id login}}}
    }}
  }}
}' -f owner="$OWNER" -f repo="$REPO" -F pr="$PR"); then
  echo "PR の情報取得に失敗した（owner / repo / pr-number と gh の認証を確認）" >&2
  exit 1
fi

# 応答の解釈は 1 回にまとめ、失敗は理由を出して終了する。直接添字でたどると
# errors を返すケースや pullRequest が null のケースで例外のスタックトレースになる
if ! ids=$(printf '%s' "$info" | COPILOT_LOGIN="$COPILOT_LOGIN" python3 -c '
import sys, json, os
copilot_login = os.environ["COPILOT_LOGIN"]

try:
    payload = json.load(sys.stdin)
except Exception as error:
    print("応答が JSON として読めない: %s" % error, file=sys.stderr)
    sys.exit(3)

if payload.get("errors"):
    print("GraphQL がエラーを返した: %s" % json.dumps(payload["errors"], ensure_ascii=False)[:300],
          file=sys.stderr)
    sys.exit(3)

pr = ((payload.get("data") or {}).get("repository") or {}).get("pullRequest")
if pr is None:
    print("応答に pullRequest が含まれていない（PR 番号や権限を確認）", file=sys.stderr)
    sys.exit(3)

candidates = []
for node in pr["reviews"]["nodes"]:
    author = node.get("author") or {}
    if author.get("__typename") == "Bot" and author.get("login") == copilot_login:
        candidates.append(author["id"])
for node in pr["timelineItems"]["nodes"]:
    reviewer = node.get("requestedReviewer") or {}
    if reviewer.get("__typename") == "Bot" and reviewer.get("login") == copilot_login:
        candidates.append(reviewer["id"])
# 1 行目に PR の node id、2 行目に bot id（見つからなければ空行）
print(pr["id"])
print(candidates[-1] if candidates else "")
'); then
  echo "PR の情報を取得できなかったため中止する" >&2
  exit 1
fi

pr_id=$(printf '%s' "$ids" | sed -n '1p')
bot_id=$(printf '%s' "$ids" | sed -n '2p')

# 既定値は DEFAULT_BOT_LOGIN の id なので、login を差し替えているときに使うと
# login と id が食い違ったまま別の Bot へ依頼してしまう。その場合は中止する
if [ -z "$bot_id" ]; then
  if [ "$COPILOT_LOGIN" != "$DEFAULT_BOT_LOGIN" ]; then
    echo "PR の履歴から $COPILOT_LOGIN の bot id を特定できなかった。" >&2
    echo "既定値 $DEFAULT_BOT_ID は $DEFAULT_BOT_LOGIN のものなので流用できない。" >&2
    echo "対象の Bot が一度でもレビュー依頼されている PR で実行するか、login を見直すこと。" >&2
    exit 1
  fi
  bot_id="$DEFAULT_BOT_ID"
  echo "PR の履歴から bot id を特定できなかったため既定値を使う: $bot_id"
fi

# 変数は単一 ID で受け、クエリ側で配列に包む。[ID!]! として宣言すると
# gh の -f が渡す単一文字列と型が食い違う
# 応答を一度受けてから解釈する。パイプで直接つなぐと、依頼そのものが失敗しても
# 解釈側の「JSON として読めない」に化けて、原因が API 側だと分からなくなる
if ! result=$(gh api graphql -f query='mutation($p:ID!,$b:ID!){
  requestReviews(input:{pullRequestId:$p, botIds:[$b], union:true}){
    pullRequest{reviewRequests(last:100){nodes{requestedReviewer{__typename ... on Bot{login}}}}}
  }
}' -f p="$pr_id" -f b="$bot_id"); then
  echo "レビュー依頼の API 呼び出しに失敗した（bot id / 権限 / ネットワークを確認）" >&2
  exit 1
fi

# 依頼はもう飛んでいる。確認に失敗しても baseline を出さないと監視を張れず、
# やり直すと二重に依頼することになるため、終了前に必ず出す。
# 同じ理由で終了コードも 0 にする（request && watch の連結を止めない）
verify_status=0
printf '%s' "$result" |
  COPILOT_LOGIN="$COPILOT_LOGIN" python3 -c '
import sys, json, os
copilot_login = os.environ["COPILOT_LOGIN"]

# 取得フェーズと同じ扱いに揃える。直接添字でたどると、errors を返すケースや
# 想定外の形で例外のスタックトレースになり、原因が分からない
try:
    payload = json.load(sys.stdin)
except Exception as error:
    print("依頼結果が JSON として読めない: %s" % error, file=sys.stderr)
    sys.exit(3)

if payload.get("errors"):
    print("GraphQL がエラーを返した: %s" % json.dumps(payload["errors"], ensure_ascii=False)[:300],
          file=sys.stderr)
    sys.exit(3)

requested = ((payload.get("data") or {}).get("requestReviews") or {}).get("pullRequest")
if requested is None:
    print("依頼結果に pullRequest が含まれていない", file=sys.stderr)
    sys.exit(3)

nodes = (requested.get("reviewRequests") or {}).get("nodes") or []
logins = [(n.get("requestedReviewer") or {}).get("login") for n in nodes]
print("依頼済み:", logins)
if copilot_login not in logins:
    # Copilot は依頼を受け取った直後に reviewRequests から外れることがあるため、
    # 空でも失敗とは限らない。監視側で新着レビューを待つこと
    print("注意: 依頼直後は pending に現れないことがある。監視で新着を待つこと")
' || verify_status=$?

if [ "$verify_status" -ne 0 ]; then
  echo "注意: 依頼結果を確認できなかった（依頼そのものは送信済み）。監視側で新着を待つこと" >&2
fi

date -u +'baseline: %Y-%m-%dT%H:%M:%SZ'
