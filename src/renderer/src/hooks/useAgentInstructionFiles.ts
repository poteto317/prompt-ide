// エクスプローラーの「エージェントの指示ファイル」の節の状態(設計書 2026-11-05「renderer の流れ」)。CLI の種類は useAgentWorkspace の
// appCliKind を受け取る(この hook の中で useAgentCliKind を呼び直さない。L-466)
import { useMemo, useRef, useState } from 'react'
import type { AgentCliKind } from '@shared/agentCliKinds'
import {
  AGENT_INSTRUCTION_FILES,
  AGENT_INSTRUCTION_SUBFOLDER_FILES,
  agentInstructionRelativePath
} from '@shared/agentInstructionFiles'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import type {
  AgentInstructionFileRow,
  AgentInstructionSubfolderRow,
  AgentInstructionsPanelState,
  FileTreeNode
} from '../types'
import { findAgentInstructionFileNode } from '../lib/agentInstructionFileLookup'
import { findAgentInstructionSubfolderFiles } from '../lib/agentInstructionSubfolderLookup'
import {
  AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED,
  AGENT_INSTRUCTION_REFRESH_FAILED,
  agentInstructionCreateFailureMessage
} from '../lib/agentInstructionMessages'
import type { AgentInstructionCreateOutcome } from './agentInstructionFileCreation'
import { useLatestRef } from './useLatestRef'
import { useOnChange } from './useOnChange'

export interface UseAgentInstructionFilesOptions {
  folderPath: string | null
  fileTree: FileTreeNode[]
  cliKind: AgentCliKind
  /** useAppState の包んだもの(作成の後に git の状態も取り直す) */
  createFile: (
    cliKind: AgentCliKind,
    file: AgentInstructionFile
  ) => Promise<AgentInstructionCreateOutcome>
  /** useAppState の selectFile(diff タブを非アクティブにする処理が付く。未保存の変更の確認は無い) */
  openFile: (node: FileTreeNode) => Promise<boolean>
  /** useFileSystem.refreshTree(反映したら true。失敗は folderLoadError に書いてから投げ直す。エクスプローラーの赤字には出ない) */
  refreshTree: () => Promise<boolean>
}

export function useAgentInstructionFiles({
  folderPath,
  fileTree,
  cliKind,
  createFile,
  openFile,
  refreshTree
}: UseAgentInstructionFilesOptions): AgentInstructionsPanelState {
  const [isCreating, setIsCreating] = useState(false)
  // 押せるかは ref で判定する(state の反映を待つと連打で 2 回作る。L-653)
  const creatingRef = useRef(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  // 多重の読み直しは ref で止める(state の反映を待たない。L-653)
  const refreshingRef = useRef(false)
  const [message, setMessage] = useState<string | null>(null)
  // 前のフォルダ・前の CLI の失敗の文言を、切り替え後の節に残さない(文言にはどの行の失敗かが入っていない)
  useOnChange(folderPath, () => setMessage(null))
  useOnChange(cliKind, () => setMessage(null))
  // 作成の結果を待つ間(git の状態の取り直しを含む)にフォルダが切り替わったかを、await の後に最新の値で確かめる
  const folderPathRef = useLatestRef(folderPath)
  // 同じく CLI の切り替え(設定は別の画面なので作成中の disabled では防げない)。文言だけを止め、作れたファイルは開く
  const cliKindRef = useLatestRef(cliKind)

  const rows: AgentInstructionFileRow[] = AGENT_INSTRUCTION_FILES[cliKind].map((file) => ({
    file,
    relativePath: agentInstructionRelativePath(file),
    node: findAgentInstructionFileNode(fileTree, file.segments)
  }))

  // ツリーは読み直すたびに新しい配列になるので、読み直しに連動して探し直す(一覧を別に控えない。L-037・L-040)
  const subfolder = useMemo(
    () =>
      findAgentInstructionSubfolderFiles(
        fileTree,
        AGENT_INSTRUCTION_SUBFOLDER_FILES[cliKind],
        AGENT_INSTRUCTION_FILES[cliKind].map((file) => file.segments)
      ),
    [fileTree, cliKind]
  )

  // このフォルダの行・サブフォルダの行で共通。作成の途中は開かない(作成の結果で開くファイルと競わせない)
  const openNode = (node: FileTreeNode): void => {
    if (creatingRef.current) return
    setMessage(null)
    // selectFile は読み込みの失敗を自分でエクスプローラーのエラーに出し、拒否せず false を返す
    void openFile(node)
  }

  const open = (row: AgentInstructionFileRow): void => {
    if (row.node === null) return
    openNode(row.node)
  }

  const openSubfolderFile = (row: AgentInstructionSubfolderRow): void => {
    openNode(row.node)
  }

  const create = async (row: AgentInstructionFileRow): Promise<void> => {
    if (creatingRef.current) return
    creatingRef.current = true
    setIsCreating(true)
    setMessage(null)
    const folderAtStart = folderPath
    // 切り替え先の節に前のフォルダの文言を出したり、前のフォルダのノードを開いたりしない(開くと読み込みの拒否でパスが画面に出る)
    const isFolderChanged = (): boolean => folderPathRef.current !== folderAtStart
    const cliKindAtStart = cliKind
    const showMessage = (text: string): void => {
      if (isFolderChanged() || cliKindRef.current !== cliKindAtStart) return
      setMessage(text)
    }
    try {
      const outcome = await createFile(cliKind, row.file)
      if (outcome.status === 'skipped' || isFolderChanged()) return
      if (outcome.status === 'failed') {
        showMessage(agentInstructionCreateFailureMessage(outcome.reason))
        return
      }
      const node =
        outcome.tree === null ? null : findAgentInstructionFileNode(outcome.tree, row.file.segments)
      if (node === null) {
        showMessage(AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED)
        return
      }
      await openFile(node)
    } catch (err) {
      console.error('[useAgentInstructionFiles] create failed:', err)
      showMessage(agentInstructionCreateFailureMessage('failed'))
    } finally {
      creatingRef.current = false
      setIsCreating(false)
    }
  }

  const refresh = async (): Promise<void> => {
    // 作成は終わりに自分でツリーを読み直すので、重ねて読まない
    if (creatingRef.current || refreshingRef.current) return
    refreshingRef.current = true
    setIsRefreshing(true)
    setMessage(null)
    const folderAtStart = folderPath
    const cliKindAtStart = cliKind
    try {
      // false(走査中で抑止した・古い結果・フォルダが無い)は失敗ではない。走査中の分は走査の後に useFileSystem が読み直す
      await refreshTree()
    } catch (err) {
      // refreshTree は失敗を folderLoadError にしか書かず、エクスプローラーの赤字に出ないので、節で伝える(L-001)。
      // 切り替え先の節に前のフォルダ・前の CLI の失敗を出さない(作成の showMessage と同じ扱い)
      console.error('[useAgentInstructionFiles] refresh failed:', err)
      if (folderPathRef.current === folderAtStart && cliKindRef.current === cliKindAtStart) {
        setMessage(AGENT_INSTRUCTION_REFRESH_FAILED)
      }
    } finally {
      refreshingRef.current = false
      setIsRefreshing(false)
    }
  }

  return {
    cliKind,
    rows,
    isCreating,
    message,
    open,
    create,
    subfolderRows: subfolder.rows,
    subfolderTotal: subfolder.total,
    subfolderNote: AGENT_INSTRUCTION_SUBFOLDER_FILES[cliKind].note,
    openSubfolderFile,
    isRefreshing,
    refresh
  }
}
