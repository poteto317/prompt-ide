// GUI から起動したアプリの PATH(launchd の最小の PATH)に足す、CLI の既定の探索先。cliService(従来の方式)と
// エージェントの起動(agentCommand)が共有する。Windows では使わない

/** 既定の探索先。home が無ければ home 配下は含めない(cliService の buildEnv の従来の並び) */
export function getCliSearchPaths(home: string | undefined): string[] {
  const paths = ['/usr/local/bin', '/opt/homebrew/bin', '/snap/bin']
  if (home) paths.push(`${home}/.local/bin`, `${home}/.cargo/bin`)
  return paths
}

/** basePath の後ろに extra を ':' で足す。basePath が空・未定義なら extra だけ(先頭に ':' を付けない) */
export function appendSearchPaths(basePath: string | undefined, extra: readonly string[]): string {
  const extraStr = extra.join(':')
  return basePath ? `${basePath}:${extraStr}` : extraStr
}
