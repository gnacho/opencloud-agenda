<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog">
      <h2>{{ t('Add Subscription') }}</h2>

      <label>
        {{ t('Name') }}
        <input v-model="form.name" type="text" :placeholder="t('e.g. Public Holidays')" />
      </label>

      <label>
        {{ t('iCal URL (.ics)') }}
        <input v-model="form.url" type="url" placeholder="https://example.com/calendar.ics" />
      </label>

      <label>
        {{ t('Color') }}
        <input v-model="form.color" type="color" />
      </label>

      <p v-if="error" class="error-msg">{{ error }}</p>

      <div class="dialog-actions">
        <button @click="$emit('close')">{{ t('Cancel') }}</button>
        <button class="primary" :disabled="!canSave" @click="submit">{{ t('Add') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, ref } from 'vue'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'add', url: string, name: string, color: string): void
  (e: 'close'): void
}>()

const form = reactive({ url: '', name: '', color: '#e67e22' })
const error = ref('')

const canSave = computed(() => form.url.trim().startsWith('http') && form.name.trim().length > 0)

function submit() {
  error.value = ''
  try {
    new URL(form.url.trim())
  } catch {
    error.value = 'Please enter a valid URL.'
    return
  }
  emit('add', form.url.trim(), form.name.trim(), form.color)
  emit('close')
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: var(--oc-color-background-default, #fff);
  border-radius: 8px;
  padding: 24px;
  min-width: 340px;
  max-width: 480px;
  width: 90%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
}

@media (prefers-color-scheme: dark) {
  .dialog {
    background: #1e1e1e;
    color: #e8e8e8;
  }
}

h2 {
  margin: 0;
  font-size: 1.1rem;
  color: inherit;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
  color: inherit;
}

input[type='text'],
input[type='url'] {
  padding: 6px 8px;
  border: 1px solid var(--oc-color-border, #ddd);
  border-radius: 4px;
  background: var(--oc-color-background-default, #fff);
  color: inherit;
  font-size: 0.9rem;
}

@media (prefers-color-scheme: dark) {
  input[type='text'],
  input[type='url'] {
    background: #2a2a2a;
    color: #e8e8e8;
    border-color: #555;
  }
}

input[type='color'] {
  width: 48px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.error-msg {
  color: var(--oc-color-status-danger, #c0392b);
  font-size: 0.85rem;
  margin: 0;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

button {
  padding: 6px 16px;
  border-radius: 4px;
  border: 1px solid var(--oc-color-border, #ddd);
  background: var(--oc-color-background-default, #fff);
  color: inherit;
  cursor: pointer;
  font-size: 0.9rem;
}

@media (prefers-color-scheme: dark) {
  button:not(.primary) {
    background: #2a2a2a;
    color: #e8e8e8;
    border-color: #555;
  }
}

button.primary {
  background: var(--oc-color-primary, #0082c9);
  color: #fff;
  border-color: transparent;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
