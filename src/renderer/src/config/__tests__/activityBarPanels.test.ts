import { describe, it, expect } from 'vitest'
import { activityBarPanels } from '../activityBarPanels'
import type { Panel } from '../../types'

const ALL_PANELS: Panel[] = ['explorer', 'source-control', 'prompts', 'settings']

describe('activityBarPanels', () => {
  it('Panel 型の全値がエントリーとして存在する', () => {
    const panelIds = activityBarPanels.map((p) => p.panel)
    ALL_PANELS.forEach((panel) => {
      expect(panelIds).toContain(panel)
    })
  })

  it('各エントリーに panel / Icon / title が揃っている', () => {
    activityBarPanels.forEach((entry) => {
      expect(entry.panel).toBeTruthy()
      expect(entry.Icon).toBeDefined()
      expect(entry.title).toBeTruthy()
    })
  })

  it('Icon が関数（React コンポーネント）である', () => {
    activityBarPanels.forEach((entry) => {
      expect(typeof entry.Icon).toBe('function')
    })
  })
})
