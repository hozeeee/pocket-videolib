/** 相对路径工具，路径统一以 `/` 分隔且不以 `/` 开头 */

export function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean)
}

export function parentPath(path: string): string {
  return splitPath(path).slice(0, -1).join('/')
}

export function baseName(path: string): string {
  return splitPath(path).at(-1) ?? ''
}

/** 去掉扩展名：`movie.part1.mp4` → `movie.part1` */
export function stripExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}
