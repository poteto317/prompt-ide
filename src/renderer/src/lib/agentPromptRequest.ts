import type { PreparedAgentReferences } from './agentReferenceCandidates'
import { appendAgentReferences } from './agentReferences'

// プロンプトの「実行」でエージェントへ送る依頼(本文と送信の options)の組み立て。変数を差し込んだ後の本文の末尾へ、押した時点の
// 参照の写しを足す(送信前の確認には足した後の全文が出る)。純粋な関数だけを置き、送るのは usePromptRunner

/**
 * エージェントへの送信の依頼に添える値(usePromptRunner → useAgentWorkspace.sendToAgent → useAgentSendConfirm.request)。
 * hook どうしの受け渡しだけで UI へは渡らない(確認のダイアログへは useAgentWorkspace が AgentSendConfirmPending に写す)ため、
 * 組み立てる場所に置く
 */
export interface AgentSendOptions {
  /** 送る元のプロンプトの id(確認をキャンセルで閉じたとき・確認からの送信が失敗したときのフォーカスの戻り先を探す) */
  promptId: string | null
  /** 未保存の変更がある、参照として添えたファイル(表示用の相対パス)。送信前の確認のダイアログに注意として出す */
  unsavedPaths: readonly string[]
  /** 送れた(結果が sent)ときだけ呼ぶ。確認のキャンセル・閉じた(フォルダの切り替えなど)・送信の失敗では呼ばない */
  onSent?: () => void
}

export interface AgentPromptRequest {
  text: string
  options: AgentSendOptions
}

export function buildAgentPromptRequest(
  content: string,
  promptId: string,
  prepared: PreparedAgentReferences,
  onSent: () => void
): AgentPromptRequest {
  return {
    text: appendAgentReferences(content, prepared.references),
    options: {
      promptId,
      // 確認は options を浅くコピーして持つだけのため、写し(描画をまたいで同じ値になり得る)と配列を共有しない
      unsavedPaths: [...prepared.unsavedPaths],
      onSent
    }
  }
}
