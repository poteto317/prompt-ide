import { request } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'

// 受け口のテスト用の HTTP の要求。node:http は Host に 127.0.0.1:<port> を付け、Origin は付けない
// (fetch は実装によって既定のヘッダーが変わるため使わない)

export interface HookResponse {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

export interface HookRequestOptions {
  method?: string
  path: string
  headers?: Record<string, string>
  body?: string | Buffer
}

export function sendHookRequest(port: number, options: HookRequestOptions): Promise<HookResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'POST',
        path: options.path,
        headers: options.headers
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          })
        )
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.end(options.body)
  })
}
