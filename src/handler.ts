import type { AppConfig } from './config'
import type { Request, Response } from './utils/http'
import { API_PREFIX, MEDIA_PREFIX } from '../shared/api'
import { handleInfo, handleList } from './routes/list'
import { handleMedia } from './routes/media'
import { handleIndex, handleServiceWorker } from './routes/static'
import { verifyBasicAuth } from './utils/auth'
import { HttpError, sendError, setCommonHeaders } from './utils/http'
import { logger } from './utils/logger'
import { RateLimiter } from './utils/throttle'

type RequestHandler = (req: Request, res: Response) => void

function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  }
  catch {
    throw new HttpError(400, 'Malformed URL')
  }
}

async function route(req: Request, res: Response, config: AppConfig, limiter?: RateLimiter): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname

  if (pathname === `${API_PREFIX}/info`)
    return handleInfo(req, res, config)
  if (pathname === `${API_PREFIX}/list`)
    return handleList(req, res, config, url.searchParams)
  if (pathname.startsWith(`${API_PREFIX}/`))
    throw new HttpError(404, 'Not found')

  if (pathname.startsWith(MEDIA_PREFIX))
    return handleMedia(req, res, config, decodePath(pathname.slice(MEDIA_PREFIX.length)), url.searchParams, limiter)

  if (pathname === '/sw.js')
    return handleServiceWorker(req, res)

  return handleIndex(req, res)
}

export function createHandler(config: AppConfig): RequestHandler {
  // 同一服务的所有连接共享一个限速器，限制的是总带宽
  const limiter = config.limitRate ? new RateLimiter(config.limitRate) : undefined
  return (req, res) => {
    const startedAt = Date.now()
    res.on('finish', () => logger.access(req.method ?? '-', req.url ?? '-', res.statusCode, Date.now() - startedAt))

    setCommonHeaders(res)

    if (config.auth && !verifyBasicAuth(req.headers.authorization, config.auth)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="pocket-videolib", charset="UTF-8"')
      sendError(req, res, 401, 'Unauthorized')
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD')
      sendError(req, res, 405, 'Method not allowed')
      return
    }

    route(req, res, config, limiter).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendError(req, res, error.status, error.message)
        return
      }
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        sendError(req, res, 404, 'Not found')
        return
      }
      if (code === 'EACCES' || code === 'EPERM') {
        sendError(req, res, 403, 'Permission denied')
        return
      }
      logger.error(`${req.method} ${req.url} failed`, error)
      sendError(req, res, 500, 'Internal server error')
    })
  }
}
