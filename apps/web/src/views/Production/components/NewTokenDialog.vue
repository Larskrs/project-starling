<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button } from '@starling/ui'

/**
 * The one moment a token's secret exists outside the device it is going onto.
 *
 * Only the hash is stored, so this cannot be shown again by anyone, including
 * support. The dialog says so in as many words rather than burying it: an
 * operator who closes this without copying has to revoke and reissue, and they
 * should learn that here and not an hour later at the desk.
 */
const props = defineProps({
  open:   { type: Boolean, required: true },
  secret: { type: String,  default: '' },
  label:  { type: String,  default: '' },
})

defineEmits(['close'])

const { t } = useI18n()
const copied = ref(false)

// Reset between tokens, so a second issue never shows the first one's state.
watch(() => props.open, (open) => { if (!open) copied.value = false })

async function copy() {
  try {
    await navigator.clipboard.writeText(props.secret)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2500)
  } catch {
    // Clipboard access can be refused (insecure origin, denied permission).
    // The secret is selectable on screen either way, so there is nothing to
    // recover from — only a button that does not light up.
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="!$event && $emit('close')">
    <DialogContent class="max-w-lg p-6 flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{{ t('integrations.secretTitle', { label }) }}</DialogTitle>
      </DialogHeader>

      <div class="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-3">
        <Icon icon="mdi:alert-outline" class="size-4.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <p class="text-sm leading-relaxed text-foreground">{{ t('integrations.secretWarning') }}</p>
      </div>

      <div class="rounded-lg border border-border bg-muted/40 p-3">
        <code class="block font-mono text-xs leading-relaxed break-all select-all text-foreground">{{ secret }}</code>
      </div>

      <Button type="button" variant="outline" class="gap-1.5" @click="copy">
        <Icon :icon="copied ? 'mdi:check' : 'mdi:content-copy'" class="size-4" />
        {{ copied ? t('integrations.copied') : t('integrations.copy') }}
      </Button>

      <p class="text-xs text-muted-foreground leading-relaxed">{{ t('integrations.secretNext') }}</p>

      <DialogFooter class="pt-1">
        <Button type="button" @click="$emit('close')">{{ t('integrations.secretDone') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
