import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { APP_USER_MODEL_ID } from '../appIdentity'

describe('APP_USER_MODEL_ID', () => {
  it('electron-builder.yml の appId と同じ(Windows のトースト通知はショートカットの AppUserModelID と一致しないと出ない)', () => {
    const builder = readFileSync(resolve(__dirname, '../../../electron-builder.yml'), 'utf-8')
    const appId = /^appId:\s*(\S+)\s*$/m.exec(builder)?.[1]
    expect(appId).toBe(APP_USER_MODEL_ID)
  })
})
