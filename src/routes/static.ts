import type { Request, Response } from '../utils/http'
import { getWebAsset } from '../assets'
import { sendText } from '../utils/http'

const DEV_HINT_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>pocket-videolib</title></head>
<body style="font-family:sans-serif;padding:2rem">
<h1>Web UI not built</h1>
<p>Run <code>npm run build:web</code>, or use <code>npm run dev</code> and open the Vite dev server.</p>
</body></html>`

/** 单页应用入口：所有非 API / 媒体请求都返回 index.html */
export function handleIndex(req: Request, res: Response): void {
  const html = getWebAsset('index.html')
  sendText(req, res, html ? 200 : 503, html ?? DEV_HINT_HTML, 'text/html; charset=utf-8', {
    'Cache-Control': 'no-cache',
  })
}

export function handleServiceWorker(req: Request, res: Response): void {
  const js = getWebAsset('sw.js')
  if (!js) {
    sendText(req, res, 404, 'Service worker not built')
    return
  }
  sendText(req, res, 200, js, 'text/javascript; charset=utf-8', {
    'Cache-Control': 'no-cache',
    'Service-Worker-Allowed': '/',
  })
}
