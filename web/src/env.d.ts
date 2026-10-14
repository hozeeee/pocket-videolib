/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<object, object, unknown>
  export default component
}

/** hls.js 的精简构建（不含字幕、多音轨、DRM），类型与完整版相同 */
declare module 'hls.js/light' {
  import Hls from 'hls.js'

  export * from 'hls.js'
  export default Hls
}
