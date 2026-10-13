import type { IncomingMessage, ServerResponse } from 'node:http'

export type Request = IncomingMessage
export type Response = ServerResponse

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

/** 所有响应都附带的安全相关头 */
export function setCommonHeaders(res: Response): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
}

export function sendJson(req: Request, res: Response, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

export function sendText(req: Request, res: Response, status: number, body: string, contentType = 'text/plain; charset=utf-8', headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

export function sendError(req: Request, res: Response, status: number, message: string): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  sendJson(req, res, status, { error: message })
}
