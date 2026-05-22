export const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  sh: 'shell',
  bash: 'shell',
}

export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANGUAGE[ext] ?? 'plaintext'
}
