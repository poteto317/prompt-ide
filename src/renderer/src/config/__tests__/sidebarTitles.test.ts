import { describe, it, expect } from 'vitest'
import { sidebarTitles } from '../sidebarTitles'
import type { Panel } from '../../types'

const ALL_PANELS: Panel[] = ['explorer', 'source-control', 'prompts']

describe('sidebarTitles', () => {
  it('Panel 型の全値にタイトルが定義されている', () => {
    ALL_PANELS.forEach((panel) => {
      expect(sidebarTitles[panel]).toBeTruthy()
    })
  })

  it('各タイトルが空文字でない', () => {
    ALL_PANELS.forEach((panel) => {
      expect(sidebarTitles[panel].trim().length).toBeGreaterThan(0)
    })
  })
})
