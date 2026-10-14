import { execFile } from 'node:child_process'
import { access, readFile, realpath } from 'node:fs/promises'
import process from 'node:process'
import { promisify } from 'node:util'

export interface LinkSpeed {
  name: string
  /** 网卡协商速率（发送方向），单位 Mbps */
  mbps: number
  /** docker0、Hyper-V vEthernet 等虚拟网卡 */
  virtual: boolean
}

const execFileAsync = promisify(execFile)

/** 外部命令可能不存在或卡住，超时后放弃，不影响启动 */
async function run(file: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(file, args, { timeout: 3000, windowsHide: true })
  return stdout
}

/** 解析 `iw dev <name> link` 输出中的 `tx bitrate: 866.7 MBit/s` */
export function parseIwBitrate(output: string): number | undefined {
  const match = /tx bitrate:\s*([\d.]+)\s*MBit\/s/i.exec(output)
  return match ? Number(match[1]) : undefined
}

/** 解析 macOS `ifconfig <name>` 输出中的 `media: autoselect (1000baseT <full-duplex>)` */
export function parseIfconfigMedia(output: string): number | undefined {
  const match = /media:.*\((\d+(?:\.\d+)?)(G?)base/i.exec(output)
  if (!match)
    return undefined
  return Number(match[1]) * (match[2] ? 1000 : 1)
}

/** 解析 PowerShell 输出的 `名称\t速率(bps)\t是否虚拟` 行 */
export function parseWindowsAdapters(output: string): LinkSpeed[] {
  const result: LinkSpeed[] = []
  for (const line of output.split(/\r?\n/)) {
    const [name, bps, virtual] = line.split('\t')
    const mbps = Number(bps) / 1e6
    if (name && mbps > 0)
      result.push({ name, mbps, virtual: virtual?.trim() === 'True' })
  }
  return result
}

async function detectLinux(name: string): Promise<LinkSpeed | undefined> {
  const dir = `/sys/class/net/${name}`
  const virtual = (await realpath(dir)).includes('/devices/virtual/')
  const speed = Number(await readFile(`${dir}/speed`, 'utf8').catch(() => ''))
  if (speed > 0)
    return { name, mbps: speed, virtual }

  // 无线网卡不提供 speed，尝试从 iw 读取当前发送速率
  const wireless = await access(`${dir}/wireless`).then(() => true, () => false)
  if (!wireless)
    return undefined
  const mbps = parseIwBitrate(await run('iw', ['dev', name, 'link']).catch(() => ''))
  return mbps ? { name, mbps, virtual } : undefined
}

async function detectDarwin(name: string): Promise<LinkSpeed | undefined> {
  // 无线网卡的 media 行不含速率，只能识别有线网卡
  const mbps = parseIfconfigMedia(await run('ifconfig', [name]))
  return mbps ? { name, mbps, virtual: !/^en\d+$/.test(name) } : undefined
}

const WINDOWS_SCRIPT = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; '
  + 'Get-NetAdapter | ForEach-Object { "$($_.Name)`t$($_.TransmitLinkSpeed)`t$($_.Virtual)" }'

async function detectWindows(names: string[]): Promise<LinkSpeed[]> {
  const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT])
  return parseWindowsAdapters(output).filter(item => names.includes(item.name))
}

/**
 * 检测网卡的协商速率（即本机到路由器 / 交换机的链路上限），不代表运营商出口带宽。
 * 检测失败的网卡会被忽略；存在物理网卡时不返回虚拟网卡。
 */
export async function detectLinkSpeeds(names: string[], platform: NodeJS.Platform = process.platform): Promise<LinkSpeed[]> {
  let speeds: LinkSpeed[] = []
  try {
    if (platform === 'win32') {
      speeds = await detectWindows(names)
    }
    else if (platform === 'linux' || platform === 'darwin') {
      const detect = platform === 'linux' ? detectLinux : detectDarwin
      const results = await Promise.all(names.map(name => detect(name).catch(() => undefined)))
      speeds = results.filter((item): item is LinkSpeed => item !== undefined)
    }
  }
  catch {
    return []
  }
  const physical = speeds.filter(item => !item.virtual)
  return physical.length > 0 ? physical : speeds
}
