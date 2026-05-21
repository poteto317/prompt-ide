import { describe, it, expect } from 'vitest'
import { sidebarTitles, sidebarPlaceholders } from '../sidebarTitles'
import { Panel } from '../../types'

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

describe('sidebarPlaceholders', () => {
  it('Panel 型の全値にプレースホルダーが定義されている', () => {
    ALL_PANELS.forEach((panel) => {
      expect(sidebarPlaceholders[panel]).toBeTruthy()
    })
  })

  it('各プレースホルダーが空文字でない', () => {
    ALL_PANELS.forEach((panel) => {
      expect(sidebarPlaceholders[panel].trim().length).toBeGreaterThan(0)
    })
  })
})
