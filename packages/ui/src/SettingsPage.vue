<script setup>
import { computed, inject } from 'vue'
import { cn } from './utils'

/**
 * One page of a SettingsDialog: a divided list of SettingsRows. The page rail
 * already names the page, so there's no heading here.
 *
 * Every page stays mounted (v-show) so form state and validation survive page
 * switches — a field can be invalid on a page the user isn't looking at, which
 * is why the rail can flag it.
 */
const props = defineProps({
  id:    { type: String, required: true },
  class: { type: String, default: '' },
})

const activePage = inject('settings-dialog-page', null)
const isActive   = computed(() => !activePage || activePage.value === props.id)
</script>

<template>
  <div v-show="isActive" :class="cn('divide-y divide-border', props.class)">
    <slot />
  </div>
</template>
