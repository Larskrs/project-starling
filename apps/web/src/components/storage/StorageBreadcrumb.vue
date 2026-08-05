<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Breadcrumb } from '@starling/ui'

/**
 * The path to the current folder. `navigate` carries an index into `crumbs`,
 * or -1 for the root.
 */
const props = defineProps({
  crumbs: { type: Array,  required: true },   // [{ id, name }]
  size:   { type: String, default: 'lg' },    // lg on a page, sm in a dialog
})

defineEmits(['navigate'])

const { t } = useI18n()

const items = computed(() => [
  { id: null, label: t('storage.root') },
  ...props.crumbs.map(c => ({ id: c.id, label: c.name })),
])
</script>

<template>
  <Breadcrumb :items="items" :class="size === 'lg' ? 'gap-0' : ''">
    <template #default="{ item, index, isLast }">
      <button
        v-if="size === 'lg'"
        class="first:-ml-3 -ml-1 text-lg px-3 py-1 rounded-lg transition-colors truncate max-w-36"
        :class="isLast
          ? 'text-foreground font-medium pointer-events-none'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/75'"
        @click="$emit('navigate', index - 1)"
      >{{ item.label }}</button>
      <button
        v-else
        class="text-sm transition-colors hover:text-foreground truncate max-w-[120px]"
        :class="isLast ? 'text-foreground font-medium' : 'text-muted-foreground'"
        @click="$emit('navigate', index - 1)"
      >{{ item.label }}</button>
    </template>
    <template #separator>
      <Icon
        icon="mdi:chevron-right"
        class="shrink-0 text-muted-foreground/40"
        :class="size === 'lg' ? 'text-xl -ml-1' : 'text-sm'"
      />
    </template>
  </Breadcrumb>
</template>
