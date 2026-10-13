import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 使用 hash 路由：服务端无需区分前端路由，离线时 Service Worker 也只需缓存根页面。
 * 媒体路径通过 query 传递，避免特殊字符与 `/` 的编码问题。
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'browse',
      component: () => import('./views/BrowseView.vue'),
    },
    {
      path: '/view',
      name: 'view',
      component: () => import('./views/MediaView.vue'),
    },
    {
      path: '/cache',
      name: 'cache',
      component: () => import('./views/CacheView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})
