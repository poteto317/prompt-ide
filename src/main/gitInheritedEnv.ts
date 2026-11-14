import { simpleGit } from 'simple-git'
import type { SimpleGit, SimpleGitOptions } from 'simple-git'

// simple-git は env() で渡した環境を検査し、拒否する変数(GIT_ASKPASS・GIT_CONFIG_GLOBAL など)や GIT_CONFIG_KEY_n の設定があると
// 投げる。親の環境をそのまま引き継いで env() を使う git(方式の判定の git・git status の git・getDiff の git)は、この検査を外す。
// 分類は引数の検査と共通なので、-c・--config の危険なキー(core.pager・diff.external など)や --upload-pack などの引数の検査も一緒に外れる。
// そのため使う側は命令を固定し、-c・オプションには固定の値だけを渡し、利用者の値は `--` の後の pathspec にだけ入れる(getDiff の git の core.quotePath=false など)。型で全部の分類を並べさせる(版を上げて分類が増えたら型が落ちる)
export const INHERITED_ENV_ALLOWANCES: Required<
  Omit<NonNullable<SimpleGitOptions['unsafe']>, 'allowUnsafeCustomBinary'>
> = {
  allowUnsafeAlias: true,
  allowUnsafeAskPass: true,
  allowUnsafeCommandBinaries: true,
  allowUnsafeConfigPaths: true,
  allowUnsafeConfigEnvCount: true,
  allowUnsafeCredentialHelper: true,
  allowUnsafeEditor: true,
  allowUnsafeMergeDriver: true,
  allowUnsafePager: true,
  allowUnsafeProtocolOverride: true,
  allowUnsafePack: true,
  allowUnsafeSshCommand: true,
  allowUnsafeGitProxy: true,
  allowUnsafeExec: true,
  allowUnsafeHooksPath: true,
  allowUnsafeDiffExternal: true,
  allowUnsafeDiffTextConv: true,
  allowUnsafeFilter: true,
  allowUnsafeFsMonitor: true,
  allowUnsafeGpgProgram: true,
  allowUnsafeTemplateDir: true,
  allowUnsafeInclude: true,
  allowUnsafeSubmodule: true,
  allowUnsafeUrlRewrite: true,
  allowAbbreviatedOptions: true
}

// simple-git v4 は ambient の GIT_* を既定で剥がす。テスト隔離(GIT_CONFIG_GLOBAL=/dev/null など)と
// 無害な ref 形式固定だけを残す(危険な GIT_ASKPASS・GIT_SSH_COMMAND などは載せない)
export const DEFAULT_ALLOW_ENVIRONMENT = [
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_DEFAULT_REF_FORMAT'
] as const

/** .env() に渡す環境のキーを allowEnvironment に載せる(ガード対象外のキーは simple-git 側で無視される) */
export function allowEnvironmentFrom(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((key) => env[key] !== undefined)
}

/** アプリ共通の simple-git 生成。DEFAULT_ALLOW_ENVIRONMENT を常に載せ、呼び出し側の allowEnvironment を足す */
export function createAppGit(baseDir?: string, options: Partial<SimpleGitOptions> = {}): SimpleGit {
  const { allowEnvironment = [], ...rest } = options
  return simpleGit(baseDir, {
    ...rest,
    allowEnvironment: [...DEFAULT_ALLOW_ENVIRONMENT, ...allowEnvironment]
  })
}
