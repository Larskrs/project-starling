<script setup>
import { Icon } from '@iconify/vue'
import { cn } from './utils'

/** The one spinner. Size it with a text-size class: `<Spinner class="text-2xl" />`. */
const props = defineProps({ class: { type: String, default: '' } })
</script>

<template>
  <Icon icon="mdi:loading" :class="cn('animate-spin shrink-0', props.class)" />
</template>
