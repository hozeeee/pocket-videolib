<script setup lang="ts">
export interface QualityOption {
  id: string
  label: string
  /** 附加说明，如「已缓存」 */
  note?: string
}

defineProps<{
  options: QualityOption[]
  disabled?: boolean
}>()

const quality = defineModel<string>({ required: true })
</script>

<template>
  <label class="quality btn" title="清晰度">
    <span class="muted">清晰度</span>
    <select v-model="quality" :disabled="disabled">
      <option v-for="option in options" :key="option.id" :value="option.id">
        {{ option.label }}{{ option.note ? ` · ${option.note}` : '' }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.quality {
  gap: 8px;
  padding-right: 8px;
  cursor: default;
}

select {
  max-width: 160px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  outline: none;
}

select option {
  background: var(--bg-elevated);
}
</style>
