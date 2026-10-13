<script setup lang="ts">
import type { IconName } from './AppIcon.vue'
import AppIcon from './AppIcon.vue'

withDefaults(defineProps<{
  type?: 'loading' | 'empty' | 'error'
  title: string
  description?: string
  icon?: IconName
}>(), {
  type: 'empty',
})
</script>

<template>
  <div class="status" :class="`status--${type}`">
    <span v-if="type === 'loading'" class="spinner" />
    <AppIcon v-else :name="icon ?? (type === 'error' ? 'alert' : 'folder')" :size="40" />
    <p class="title">
      {{ title }}
    </p>
    <p v-if="description" class="muted">
      {{ description }}
    </p>
    <slot />
  </div>
</template>

<style scoped>
.status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 64px 16px;
  text-align: center;
  color: var(--text-muted);
}

.status p {
  margin: 0;
}

.title {
  color: var(--text);
  font-size: 15px;
}

.status--error {
  color: var(--danger);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
