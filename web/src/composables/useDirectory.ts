import type { ListResponse } from '@shared/api'
import type { MaybeRefOrGetter } from 'vue'
import { ref, toValue, watch } from 'vue'
import { fetchDirectory } from '@/services/api'

/** 加载目录内容，路径变化时自动重新请求并取消上一次请求 */
export function useDirectory(path: MaybeRefOrGetter<string | undefined>) {
  const data = ref<ListResponse>()
  const loading = ref(false)
  const error = ref<string>()
  let controller: AbortController | undefined

  async function load(): Promise<void> {
    const current = toValue(path)
    if (current === undefined)
      return

    controller?.abort()
    const own = new AbortController()
    controller = own
    loading.value = true
    error.value = undefined

    try {
      data.value = await fetchDirectory(current, own.signal)
    }
    catch (e) {
      if (!own.signal.aborted) {
        data.value = undefined
        error.value = e instanceof Error ? e.message : String(e)
      }
    }
    finally {
      if (controller === own)
        loading.value = false
    }
  }

  watch(() => toValue(path), load, { immediate: true })

  return { data, loading, error, reload: load }
}
