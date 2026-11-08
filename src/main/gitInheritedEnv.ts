import type { SimpleGitOptions } from 'simple-git'

// simple-git は env() で渡した環境を検査し、拒否する変数(GIT_ASKPASS・GIT_CONFIG_GLOBAL など)や GIT_CONFIG_KEY_n の設定があると
// 投げる。親の環境をそのまま引き継いで env() を使う git(方式の判定の git・git status の git・getDiff の git)は、この検査を外す。
// 分類は引数の検査と共通なので、-c・--config の危険なキー(core.pager・diff.external など)や --upload-pack などの引数の検査も一緒に外れる。
// そのため使う側は命令を固定し、-c・オプションには固定の値だけを渡し、利用者の値は `--` の後の pathspec にだけ入れる(getDiff の git の core.quotePath=false など)。型で全部の分類を並べさせる(版を上げて分類が増えたら型が落ちる)
export const INHERITED_ENV_ALLOWANCES: Required<
  Omit<NonNullable<SimpleGitOptions['unsafe']>, 'allowUnsafeCustomBinary'>
> = {
  allowUnsafeAlias: true,
  allowUnsafeAskPass: true,
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
  allowUnsafeHooksPath: true,
  allowUnsafeDiffExternal: true,
  allowUnsafeDiffTextConv: true,
  allowUnsafeFilter: true,
  allowUnsafeFsMonitor: true,
  allowUnsafeGpgProgram: true,
  allowUnsafeTemplateDir: true
}
