<script setup>
import { inject } from 'vue'
import ContextMenuItemBase from './ContextMenuItemBase.vue'

const props = defineProps({
  icon:        { type: String, default: null },
  shortcut:    { type: String, default: null },
  disabled:    { type: Boolean, default: false },
  destructive: { type: Boolean, default: false },
})

const emit     = defineEmits(['click'])
const ctxClose = inject('ctxClose', null)

function handleClick() {
  if (props.disabled) return
  emit('click')
  ctxClose?.()
}
</script>

<template>
  <ContextMenuItemBase
    :icon="icon"
    :disabled="disabled"
    :destructive="destructive"
    @click="handleClick"
  >
    <template v-if="$slots.icon" #icon>
      <slot name="icon" />
    </template>

    <slot />

    <template #trailing>
      <span v-if="shortcut" class="ml-auto text-xs text-muted-foreground tracking-wide font-mono">
        {{ shortcut }}
      </span>
    </template>
  </ContextMenuItemBase>
</template>
