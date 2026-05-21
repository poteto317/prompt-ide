import { Panel } from '../types'

export const sidebarTitles: Record<Panel, string> = {
  explorer: 'エクスプローラー',
  'source-control': 'ソース管理',
  prompts: 'プロンプト',
}

export const sidebarPlaceholders: Record<Panel, string> = {
  explorer: 'フォルダを開くと、ファイルツリーがここに表示されます。',
  'source-control': 'Git の変更がここに表示されます。',
  prompts: 'プロンプトを登録すると、ここに一覧が表示されます。',
}
