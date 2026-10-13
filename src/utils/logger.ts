import process from 'node:process'

const useColor = process.stdout.isTTY && !process.env.NO_COLOR

function paint(code: number, text: string): string {
  return useColor ? `\x1B[${code}m${text}\x1B[0m` : text
}

export const color = {
  dim: (s: string) => paint(2, s),
  bold: (s: string) => paint(1, s),
  red: (s: string) => paint(31, s),
  green: (s: string) => paint(32, s),
  yellow: (s: string) => paint(33, s),
  cyan: (s: string) => paint(36, s),
}

function timestamp(): string {
  return color.dim(new Date().toLocaleTimeString())
}

export const logger = {
  verbose: false,

  info(message: string): void {
    console.log(`${timestamp()} ${message}`)
  },
  warn(message: string): void {
    console.warn(`${timestamp()} ${color.yellow('WARN')} ${message}`)
  },
  error(message: string, error?: unknown): void {
    console.error(`${timestamp()} ${color.red('ERROR')} ${message}`)
    if (error && this.verbose)
      console.error(error)
  },
  /** 访问日志，仅在 --verbose 时输出 */
  access(method: string, url: string, status: number, ms: number): void {
    if (!this.verbose)
      return
    const statusText = status >= 500 ? color.red(String(status)) : status >= 400 ? color.yellow(String(status)) : color.green(String(status))
    console.log(`${timestamp()} ${method} ${url} ${statusText} ${color.dim(`${ms}ms`)}`)
  },
}
