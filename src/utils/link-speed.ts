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
async function run(file: string, args: string[], timeout = 3000): Promise<string> {
  const { stdout } = await execFileAsync(file, args, { timeout, windowsHide: true })
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

interface SystemProfilerWifi {
  _name?: unknown
  spairport_current_network_information?: {
    spairport_network_rate?: unknown
  }
}

/** 解析 macOS `system_profiler SPAirPortDataType -json` 的当前 Wi-Fi 发送速率 */
export function parseSystemProfilerWifi(output: string): LinkSpeed[] {
  try {
    const root = JSON.parse(output) as { SPAirPortDataType?: Array<{ spairport_airport_interfaces?: SystemProfilerWifi[] }> }
    const interfaces = root.SPAirPortDataType?.flatMap(item => item.spairport_airport_interfaces ?? []) ?? []
    return interfaces.flatMap((item) => {
      const name = typeof item._name === 'string' ? item._name : undefined
      const rawRate = item.spairport_current_network_information?.spairport_network_rate
      const mbps = typeof rawRate === 'number'
        ? rawRate
        : Number(String(rawRate ?? '').replace(/[^\d.]/g, ''))
      return name && mbps > 0 ? [{ name, mbps, virtual: false }] : []
    })
  }
  catch {
    return []
  }
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

async function detectDarwin(names: string[]): Promise<LinkSpeed[]> {
  // ifconfig 可直接读取有线协商速率，但 Wi-Fi 的 media 行通常不含速率
  const wiredResults = await Promise.all(names.map(async (name) => {
    const mbps = parseIfconfigMedia(await run('ifconfig', [name]).catch(() => ''))
    return mbps ? { name, mbps, virtual: !/^en\d+$/.test(name) } : undefined
  }))
  const wired = wiredResults.filter((item): item is LinkSpeed => item !== undefined)
  const detectedNames = new Set(wired.map(item => item.name))

  // macOS 10.15+ 支持 JSON 输出；相比已废弃的 airport 命令，对新系统更稳定
  const profile = await run('system_profiler', ['SPAirPortDataType', '-json'], 5000).catch(() => '')
  const wifi = parseSystemProfilerWifi(profile)
    .filter(item => names.includes(item.name) && !detectedNames.has(item.name))
  return [...wired, ...wifi]
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
    else if (platform === 'darwin') {
      speeds = await detectDarwin(names)
    }
    else if (platform === 'linux') {
      const results = await Promise.all(names.map(name => detectLinux(name).catch(() => undefined)))
      speeds = results.filter((item): item is LinkSpeed => item !== undefined)
    }
  }
  catch {
    return []
  }
  const physical = speeds.filter(item => !item.virtual)
  return physical.length > 0 ? physical : speeds
}
