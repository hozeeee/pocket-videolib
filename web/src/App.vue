<script setup lang="ts">
import AppHeader from '@/components/layout/AppHeader.vue'
</script>

<template>
  <AppHeader />
  <main class="app-main">
    <RouterView v-slot="{ Component, route }">
      <component :is="Component" :key="route.name" />
    </RouterView>
  </main>
</template>

<style scoped>
.app-main {
  width: 100%;
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 16px var(--page-padding) 48px;
}
</style>
