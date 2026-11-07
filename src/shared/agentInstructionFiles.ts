// エージェント CLI が読む指示ファイルの表(設計書 2026-11-05「指示ファイルの表」)。main(作成のパスと雛形)と renderer(一覧・有無の判定)が
// 同じ表を読む。renderer は id だけを IPC で送り、パスと中身は main がこの表から決める(L-018・L-019)
import type { AgentCliKind } from './agentCliKinds'

export type AgentInstructionFileId =
  | 'claude-root'
  | 'claude-dot'
  | 'claude-local'
  | 'copilot-agents'
  | 'copilot-github'

/** フォルダからの相対パスを区切りごとに分けたもの。2 つのときの 1 つ目は、作成のときに作ってよいフォルダ */
export type AgentInstructionSegments = readonly [string] | readonly [string, string]

export interface AgentInstructionFile {
  /** IPC で送る識別子(表の全体で一意) */
  id: AgentInstructionFileId
  segments: AgentInstructionSegments
  /** 一覧に出す短い説明 */
  description: string
  /** 作成したときに書く雛形(見出しだけ。末尾は改行) */
  template: string
}

const TEMPLATE_SECTIONS = '\n## 概要\n\n## よく使うコマンド\n\n## コーディングのルール\n'
const PROJECT_TEMPLATE = `# プロジェクトの指示\n${TEMPLATE_SECTIONS}`
const PERSONAL_TEMPLATE = `# 個人の指示\n${TEMPLATE_SECTIONS}`

export const AGENT_INSTRUCTION_FILES: Record<AgentCliKind, readonly AgentInstructionFile[]> = {
  claude: [
    {
      id: 'claude-root',
      segments: ['CLAUDE.md'],
      description: '共有の指示',
      template: PROJECT_TEMPLATE
    },
    {
      id: 'claude-dot',
      segments: ['.claude', 'CLAUDE.md'],
      description: '共有の指示(.claude フォルダ)',
      template: PROJECT_TEMPLATE
    },
    {
      id: 'claude-local',
      segments: ['CLAUDE.local.md'],
      description: '個人の指示',
      template: PERSONAL_TEMPLATE
    }
  ],
  copilot: [
    {
      id: 'copilot-agents',
      segments: ['AGENTS.md'],
      description: '共有の指示',
      template: PROJECT_TEMPLATE
    },
    {
      id: 'copilot-github',
      segments: ['.github', 'copilot-instructions.md'],
      description: '共有の指示(.github フォルダ)',
      template: PROJECT_TEMPLATE
    }
  ]
}

/** その CLI の表にある id なら行を返す。表に無い・不正な値は null(既定の行に読み替えない。L-044) */
export function findAgentInstructionFile(
  cliKind: AgentCliKind,
  id: unknown
): AgentInstructionFile | null {
  return AGENT_INSTRUCTION_FILES[cliKind].find((file) => file.id === id) ?? null
}

/** 一覧と aria-label に出す相対パス(区切りは /) */
export function agentInstructionRelativePath(file: AgentInstructionFile): string {
  return file.segments.join('/')
}

/** サブフォルダの中で探すファイル名(設計書 2026-11-07「表」)。名前は完全一致で比べる(L-009) */
export interface AgentInstructionSubfolderFileName {
  name: string
  /** 一覧に出す短い説明 */
  description: string
}

export interface AgentInstructionSubfolderSpec {
  /** 探すファイル名。同じフォルダの中はこの順に並べる */
  names: readonly AgentInstructionSubfolderFileName[]
  /** 一覧の上に出す注(無ければ null) */
  note: string | null
}

// renderer だけが読む(サブフォルダの行は作成しない)。CLI の対応を今の表と 1 か所で見比べられるよう、ここに置く
export const AGENT_INSTRUCTION_SUBFOLDER_FILES: Record<
  AgentCliKind,
  AgentInstructionSubfolderSpec
> = {
  claude: {
    names: [
      { name: 'CLAUDE.md', description: '共有の指示' },
      { name: 'CLAUDE.local.md', description: '個人の指示' }
    ],
    // Claude Code はサブフォルダの CLAUDE.md を、そのフォルダのファイルを読んだときに読む
    note: null
  },
  copilot: {
    names: [{ name: 'AGENTS.md', description: '共有の指示' }],
    // copilot は cwd から git root までの分だけを読み、根で起動すると子孫のフォルダの AGENTS.md は読まない(1.0.106 で確かめた)
    note: 'GitHub Copilot CLI は、サブフォルダの AGENTS.md を読まないことがあります(このアプリはフォルダの根で CLI を起動するため)'
  }
}
