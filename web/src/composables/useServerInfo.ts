import type { ServerInfo } from '@shared/api'
import { ref } from 'vue'
import { fetchServerInfo } from '@/services/api'

const info = ref<ServerInfo>()
let loading: Promise<void> | undefined

/** 服务端信息，全局只请求一次 */
export function useServerInfo() {
  loading ??= fetchServerInfo()
    .then((data) => {
      info.value = data
      document.title = `${data.rootName} · Pocket VideoLib`
    })
    .catch(() => {
      loading = undefined
    })
  return { info }
}
