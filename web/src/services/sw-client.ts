import { ref } from 'vue'

/** Service Worker 是否已接管当前页面（接管后才能边缓存边播放） */
export const swActive = ref(false)

/** Service Worker 需要安全上下文：HTTPS 或 localhost */
export const swSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext

export async function registerServiceWorker(): Promise<void> {
  if (!swSupported || !import.meta.env.PROD)
    return

  const update = (): void => {
    swActive.value = Boolean(navigator.serviceWorker.controller)
  }
  navigator.serviceWorker.addEventListener('controllerchange', update)
  update()

  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    update()
  }
  catch (error) {
    console.warn('Service worker registration failed:', error)
  }
}
