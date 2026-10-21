import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }))

import {
  ApiKeyDecryptError,
  KeystoreUnavailableError,
  toApiKeyLoadFailureReason
} from '../apiKeyErrors'
import { SettingsFileError } from '../settingsFileStore'

let consoleErrorSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
})

describe('toApiKeyLoadFailureReason', () => {
  it('KeystoreUnavailableError は keystore-unavailable になる', () => {
    expect(toApiKeyLoadFailureReason(new KeystoreUnavailableError())).toBe('keystore-unavailable')
  })

  it('ApiKeyDecryptError は decrypt-failed になる', () => {
    expect(toApiKeyLoadFailureReason(new ApiKeyDecryptError())).toBe('decrypt-failed')
  })

  it('SettingsFileError は settings-file-error になる', () => {
    expect(toApiKeyLoadFailureReason(new SettingsFileError())).toBe('settings-file-error')
  })

  it('分類できる失敗は記録しない(SettingsFileError は元の例外を settingsFileStore が記録済み)', () => {
    toApiKeyLoadFailureReason(new KeystoreUnavailableError())
    toApiKeyLoadFailureReason(new ApiKeyDecryptError())
    toApiKeyLoadFailureReason(new SettingsFileError())
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('分類できない Error は unknown になり、元の例外を console.error に記録する', () => {
    const err = new Error("EPERM: operation not permitted, rename '/mock/userData/settings.json'")
    expect(toApiKeyLoadFailureReason(err)).toBe('unknown')
    expect(consoleErrorSpy).toHaveBeenCalledOnce()
    expect(consoleErrorSpy?.mock.calls[0]).toContain(err)
  })

  it('Error でない値も unknown になり、記録する', () => {
    expect(toApiKeyLoadFailureReason('string error')).toBe('unknown')
    expect(consoleErrorSpy).toHaveBeenCalledOnce()
  })

  it('文言だけが似た Error は instanceof で見分けるため分類しない', () => {
    expect(toApiKeyLoadFailureReason(new Error('システムのキーストアが利用できません'))).toBe(
      'unknown'
    )
  })
})
