<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import Dialog        from '@starling/ui/Dialog'
import DialogContent from '@starling/ui/DialogContent'
import DialogTitle   from '@starling/ui/DialogTitle'
import DialogFooter  from '@starling/ui/DialogFooter'
import Button        from '@starling/ui/Button'
import Input         from '@starling/ui/Input'
import Label         from '@starling/ui/Label'

const props = defineProps({
  open:          { type: Boolean, required: true },
  title:         { type: String,  required: true },
  description:   { type: String,  default: '' },
  confirmValue:  { type: String,  required: true },
  confirmLabel:  { type: String,  required: true },
  loading:       { type: Boolean, default: false },
  extraDisabled: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'cancel'])

const { t } = useI18n()

const typed = ref('')
watch(() => props.open, (v) => { if (!v) typed.value = '' })
const matches = computed(() => typed.value === props.confirmValue)
</script>

<template>
  <Dialog :open="open" @update:open="!$event && emit('cancel')">
    <DialogContent class="max-w-md p-6 flex flex-col gap-5">

      <div class="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/8 p-3.5">
        <Icon icon="mdi:alert-circle-outline" class="text-destructive text-lg shrink-0 mt-px" />
        <div class="min-w-0">
          <DialogTitle class="text-destructive text-sm font-semibold">{{ title }}</DialogTitle>
          <p v-if="description" class="text-sm text-muted-foreground mt-1 leading-relaxed">{{ description }}</p>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label>
          <i18n-t keypath="danger.typeToConfirm" tag="span">
            <template #value>
              <code class="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground">{{ confirmValue }}</code>
            </template>
          </i18n-t>
        </Label>
        <Input v-model="typed" :placeholder="confirmValue" autocomplete="off" />
      </div>

      <slot :matches="matches" />

      <DialogFooter class="pt-1">
        <Button variant="outline" :disabled="loading" @click="emit('cancel')">{{ t('danger.cancel') }}</Button>
        <Button
          variant="destructive"
          :disabled="!matches || loading || extraDisabled"
          @click="emit('confirm')"
        >
          <Icon v-if="loading" icon="mdi:loading" class="animate-spin mr-1.5 text-base" />
          {{ loading ? t('danger.pleaseWait') : confirmLabel }}
        </Button>
      </DialogFooter>

    </DialogContent>
  </Dialog>
</template>
