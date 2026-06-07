import type { StageStatus } from '../types'

export function statusIcon(status: StageStatus): string {
  switch (status) {
    case 'done':
      return '●'
    case 'in_progress':
      return '◐'
    case 'skipped':
      return '⊘'
    default:
      return '○'
  }
}

export function statusLabel(status: StageStatus): string {
  switch (status) {
    case 'done':
      return '完了'
    case 'in_progress':
      return '進行中'
    case 'skipped':
      return 'スキップ'
    default:
      return '未着手'
  }
}
