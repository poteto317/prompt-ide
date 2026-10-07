import { describe, it, expect } from 'vitest'
import {
  AGENT_BASELINE_EXCLUDE_FILE_BYTES,
  AGENT_BASELINE_MAX_UNTRACKED_BYTES,
  AGENT_BASELINE_MAX_UNTRACKED_FILES
} from '../agentBaselineSnapshot'
import { MAX_UNTRACKED_DIFF_FILE_SIZE_BYTES } from '../gitService'

describe('記録の上限', () => {
  it('除外の閾値は diff の未追跡の上限と同じ値(片方だけ変わったら気づく)', () => {
    expect(AGENT_BASELINE_EXCLUDE_FILE_BYTES).toBe(MAX_UNTRACKED_DIFF_FILE_SIZE_BYTES)
    expect(AGENT_BASELINE_EXCLUDE_FILE_BYTES).toBe(5 * 1024 * 1024)
  })

  it('未追跡の数と合計の大きさの上限', () => {
    expect(AGENT_BASELINE_MAX_UNTRACKED_FILES).toBe(5_000)
    expect(AGENT_BASELINE_MAX_UNTRACKED_BYTES).toBe(100 * 1024 * 1024)
  })
})
