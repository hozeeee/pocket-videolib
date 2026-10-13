import type { Ref } from 'vue'
import { ref, watch } from 'vue'

/** 持久化到 localStorage 的响应式值 */
export function useLocalStorage<T>(key: string, initial: T): Ref<T> {
  const storageKey = `pocket-videolib:${key}`
  let value = initial
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw !== null)
      value = JSON.parse(raw) as T
  }
  catch {}

  const state = ref(value) as Ref<T>
  watch(state, (v) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(v))
    }
    catch {}
  }, { deep: true })
  return state
}
