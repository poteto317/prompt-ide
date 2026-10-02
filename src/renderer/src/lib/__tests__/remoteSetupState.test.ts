import { describe, it, expect } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import { GIT_REMOTE_TIMEOUT_SECONDS } from '@shared/remoteTimeout'
import {
  SETTING_UPSTREAM_NOTICE,
  buildRemoteSetupBannerText,
  getRemoteSetupState
} from '../remoteSetupState'

const configured: GitStatusResult = {
  isRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [],
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false
}

// 設計書の「状態ごとの表示」の表の各行。バナー(RemoteSetupBanner)とテストが同じ判定を使う
describe('getRemoteSetupState', () => {
  it.each([
    ['gitStatus が null', null, null],
    [
      'リポジトリでない',
      {
        ...configured,
        isRepo: false,
        branch: null,
        hasOrigin: false,
        hasRemote: false,
        upstream: null
      },
      null
    ],
    [
      'リモートが 1 つも無い',
      { ...configured, hasOrigin: false, hasRemote: false, upstream: null },
      'no-origin'
    ],
    [
      'リモートが無く detached でも no-origin(追加はブランチに関係しない)',
      {
        ...configured,
        hasOrigin: false,
        hasRemote: false,
        upstream: null,
        detached: true,
        branch: 'HEAD'
      },
      'no-origin'
    ],
    // git clone -o github など。既存の push / pull は通信できるため何も出さない(レビュー 8 周目)
    [
      'origin 以外の名前のリモートだけ・upstream あり',
      { ...configured, hasOrigin: false, hasRemote: true, upstream: 'github/main' },
      null
    ],
    // 初回 push は origin 固定で、押しても「リモート origin が未設定のため…」で拒否されるため出さない
    [
      'origin 以外の名前のリモートだけ・upstream なし(新しいブランチ)',
      { ...configured, hasOrigin: false, hasRemote: true, upstream: null },
      null
    ],
    [
      'origin あり・detached(リベース中など)',
      { ...configured, upstream: null, detached: true, branch: 'HEAD' },
      null
    ],
    ['origin あり・ブランチの上・upstream なし', { ...configured, upstream: null }, 'no-upstream'],
    // コミットが無い(init の直後)ことは status では区別せず、同じバナーを出す(押すと main が拒否する)
    [
      'コミットが無くても同じ',
      { ...configured, upstream: null, ahead: 0, files: [] },
      'no-upstream'
    ],
    ['upstream 設定済み(gone を含む)', configured, null],
    ['ローカルのブランチが upstream', { ...configured, upstream: 'main' }, null],
    [
      'マージ中でも条件どおり',
      { ...configured, mergeInProgress: true, upstream: null },
      'no-upstream'
    ],
    ['branch が null', { ...configured, branch: null, upstream: null }, null]
  ] as Array<[string, GitStatusResult | null, string | null]>)(
    '%s → %s',
    (_label, status, expected) => {
      expect(getRemoteSetupState(status)).toBe(expected)
    }
  )

  // リポジトリの中の全組み合わせ(リモートの有無 3 通り × ブランチの位置 3 通り × upstream の有無 2 通り)。
  // origin があればリモートもあるため、hasOrigin: true・hasRemote: false の組は git の上では起きない(作らない)
  const remotes = {
    なし: { hasOrigin: false, hasRemote: false },
    'origin 以外だけ': { hasOrigin: false, hasRemote: true },
    'origin あり': { hasOrigin: true, hasRemote: true }
  } as const
  const positions = {
    ブランチの上: { detached: false, branch: 'main' },
    detached: { detached: true, branch: 'HEAD' },
    'branch が null': { detached: false, branch: null }
  } as const
  // リモートが無いと upstream はローカルのブランチ(main)だけがあり得る
  const upstreams = { なし: null, あり: 'x/main' } as const
  it.each([
    ['なし', 'ブランチの上', 'なし', 'no-origin'],
    ['なし', 'ブランチの上', 'あり', 'no-origin'],
    ['なし', 'detached', 'なし', 'no-origin'],
    ['なし', 'detached', 'あり', 'no-origin'],
    ['なし', 'branch が null', 'なし', 'no-origin'],
    ['なし', 'branch が null', 'あり', 'no-origin'],
    ['origin 以外だけ', 'ブランチの上', 'なし', null],
    ['origin 以外だけ', 'ブランチの上', 'あり', null],
    ['origin 以外だけ', 'detached', 'なし', null],
    ['origin 以外だけ', 'detached', 'あり', null],
    ['origin 以外だけ', 'branch が null', 'なし', null],
    ['origin 以外だけ', 'branch が null', 'あり', null],
    ['origin あり', 'ブランチの上', 'なし', 'no-upstream'],
    ['origin あり', 'ブランチの上', 'あり', null],
    ['origin あり', 'detached', 'なし', null],
    ['origin あり', 'detached', 'あり', null],
    ['origin あり', 'branch が null', 'なし', null],
    ['origin あり', 'branch が null', 'あり', null]
  ] as Array<
    [keyof typeof remotes, keyof typeof positions, keyof typeof upstreams, string | null]
  >)('リモート %s・%s・upstream %s → %s', (remote, position, upstream, expected) => {
    const status: GitStatusResult = {
      ...configured,
      ...remotes[remote],
      ...positions[position],
      upstream:
        upstreams[upstream] === null ? null : remote === 'なし' ? 'main' : upstreams[upstream]
    }
    expect(getRemoteSetupState(status)).toBe(expected)
  })
})

describe('buildRemoteSetupBannerText', () => {
  it('種類ごとの文言(upstream はブランチ名を括弧で添える)', () => {
    expect(buildRemoteSetupBannerText('no-origin', 'main')).toBe('リモートが未設定です')
    expect(buildRemoteSetupBannerText('no-upstream', 'feat/x')).toBe(
      'upstream が未設定です（feat/x）'
    )
  })

  it('branch が null のとき no-upstream では括弧内が空文字になる', () => {
    // L31: `upstream が未設定です（${branch ?? ''}）` の branch ?? '' ブランチ
    expect(buildRemoteSetupBannerText('no-upstream', null)).toBe('upstream が未設定です（）')
  })
})

// 秒数は main の打ち切り(GIT_REMOTE_TIMEOUT_MS)から組み立てる(パターン 88)
describe('SETTING_UPSTREAM_NOTICE', () => {
  it('打ち切りまでの秒数を共有の定数から組み立てる', () => {
    expect(SETTING_UPSTREAM_NOTICE).toBe(
      `初回 push 中です。応答が ${GIT_REMOTE_TIMEOUT_SECONDS} 秒途絶えると打ち切ります`
    )
    expect(SETTING_UPSTREAM_NOTICE).toBe('初回 push 中です。応答が 30 秒途絶えると打ち切ります')
  })
})
