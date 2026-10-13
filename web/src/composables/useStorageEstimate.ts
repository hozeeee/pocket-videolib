import { onMounted, ref } from 'vue'

/** 浏览器存储用量（StorageManager 仅在安全上下文中可用） */
export function useStorageEstimate() {
  const usage = ref<number>()
  const quota = ref<number>()
  const persisted = ref(false)

  async function refresh(): Promise<void> {
    if (!navigator.storage?.estimate)
      return
    const estimate = await navigator.storage.estimate()
    usage.value = estimate.usage
    quota.value = estimate.quota
    persisted.value = await navigator.storage.persisted?.() ?? false
  }

  onMounted(refresh)

  return { usage, quota, persisted, refresh }
}
