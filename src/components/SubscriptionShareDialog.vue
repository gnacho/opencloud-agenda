<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog">
      <h2>{{ subscription.name }}</h2>
      <p class="hint">{{ t('Scan this code to add the calendar on another device.') }}</p>

      <!-- Deliberately black on white in both themes: a QR tinted to match dark
           mode loses contrast and many phone cameras stop recognising it. -->
      <div class="qr-tile">
        <div ref="qrEl" class="qr" />
      </div>

      <label class="url-label">
        {{ t('iCal URL (.ics)') }}
        <input ref="urlInput" :value="subscription.url" readonly @focus="selectAll" />
      </label>

      <p v-if="copyState === 'failed'" class="hint warn">
        {{ t('Copying is unavailable here — select the address and copy it manually.') }}
      </p>

      <div class="dialog-actions">
        <button @click="$emit('close')">{{ t('Close') }}</button>
        <button class="primary" @click="copy">
          {{ copyState === 'copied' ? t('Copied') : t('Copy URL') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import QrCreator from 'qr-creator'
import { useI18n } from '@/composables/useI18n'
import { copyText } from '@/utils/clipboard'
import type { IcsSubscription } from '@/composables/useSubscriptions'

const { t } = useI18n()

const props = defineProps<{ subscription: IcsSubscription }>()
defineEmits<{ (e: 'close'): void }>()

const qrEl = ref<HTMLElement | null>(null)
const urlInput = ref<HTMLInputElement | null>(null)
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')

onMounted(() => {
  if (!qrEl.value) return
  QrCreator.render(
    {
      text: props.subscription.url,
      // 'M' tolerates ~15 % damage — enough for a phone camera at an angle
      // without inflating the code for these fairly long feed URLs.
      ecLevel: 'M',
      // qr-creator defaults `quiet` to 0, but the spec requires a 4-module
      // margin; without it scanners get unreliable. Not left to the white tile
      // around the canvas, which is only worth about two modules.
      quiet: 4,
      // A ~110-character feed URL needs a 41-module code; with the quiet zone
      // that is 49 across, so 240 px keeps every module about 5 px wide.
      size: 240,
      fill: '#000000',
      background: '#ffffff',
    },
    qrEl.value,
  )
})

function selectAll() {
  urlInput.value?.select()
}

async function copy() {
  copyState.value = (await copyText(props.subscription.url)) ? 'copied' : 'failed'
  if (copyState.value === 'failed') selectAll()
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
  min-width: 300px;
  max-width: 380px;
  width: 90%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
  color: inherit;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
  color: inherit;
  overflow-wrap: anywhere;
}

.hint {
  margin: 0;
  font-size: 0.82rem;
  opacity: 0.75;
}

.hint.warn {
  opacity: 1;
  color: var(--oc-color-status-danger, #c0392b);
}

.qr-tile {
  align-self: center;
  background: #fff;
  padding: 10px;
  border-radius: 6px;
  line-height: 0;
}

.url-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
}

input {
  padding: 6px 8px;
  border: 1px solid var(--oc-color-border, #ddd);
  border-radius: 4px;
  background: var(--oc-color-background-default, #fff);
  color: inherit;
  font-size: 0.8rem;
  font-family: monospace;
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

button:hover {
  background: #e0e0e0;
}

button.primary {
  background: var(--oc-color-primary, #0082c9);
  color: #fff;
  border-color: transparent;
}

button.primary:hover {
  opacity: 0.9;
  background: var(--oc-color-primary, #0082c9);
}

/* Last, so it outranks the light-mode rules above — a media query adds no
   specificity, and the same ordering slip made buttons unreadable in 2.4.1. */
@media (prefers-color-scheme: dark) {
  .dialog {
    background: #1e1e1e;
    color: #e8e8e8;
  }
  input {
    background: #2a2a2a;
    color: #e8e8e8;
    border-color: #555;
  }
  button:not(.primary) {
    background: #2a2a2a;
    color: #e8e8e8;
    border-color: #555;
  }
  button:not(.primary):hover {
    background: #333;
  }
}
</style>
