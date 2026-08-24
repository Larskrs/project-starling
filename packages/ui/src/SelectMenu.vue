<script setup lang="ts" generic="T extends SelectOption">
import { computed } from 'vue'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'radix-vue'
import { Icon } from '@iconify/vue'
import { cn } from './utils'
import DropdownMenuContent   from './DropdownMenuContent.vue'
import DropdownMenuItem      from './DropdownMenuItem.vue'
import DropdownMenuSeparator from './DropdownMenuSeparator.vue'

/**
 * The minimum an option must carry. Consumers pass richer objects (an icon, a
 * hue, …) and the generic keeps those fields visible in the slot props — which
 * is the whole reason this is generic rather than typed to a fixed shape.
 */
export interface SelectOption {
  value: string | number | null
  label: string
}

const props = withDefaults(defineProps<{
  modelValue?: T['value'] | null
  options?: T[]
  /** Adds a "none" first item; null omits it entirely. */
  nullLabel?: string | null
  placeholder?: string
  align?: 'start' | 'center' | 'end'
  class?: string
}>(), {
  // No modelValue default — an absent value is `undefined`, and every
  // comparison here is null-loose, so it reads the same as null.
  options: () => [] as never[],
  nullLabel: null,
  placeholder: 'Select…',
  align: 'start',
  class: '',
})

const emit = defineEmits<{ 'update:modelValue': [value: T['value'] | null] }>()

defineSlots<{
  selected?: (props: { option: T | null }) => unknown
  icon?: (props: { option: T }) => unknown
  option?: (props: { option: T }) => unknown
}>()

const current = computed(() => props.options.find(o => o.value === props.modelValue) ?? null)
const label   = computed(() => current.value?.label ?? (props.nullLabel !== null ? props.nullLabel : null))
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        :class="cn(
          'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm',
          'hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          props.class
        )"
      >
        <slot name="selected" :option="current" />
        <span class="flex-1 text-left truncate" :class="label ? 'text-foreground' : 'text-muted-foreground'">
          {{ label ?? placeholder }}
        </span>
        <Icon icon="mdi:unfold-more-horizontal" class="size-3.5 text-muted-foreground shrink-0" />
      </button>
    </DropdownMenuTrigger>

    <DropdownMenuContent :align="align" class="min-w-[var(--radix-dropdown-menu-trigger-width)]">
      <template v-if="nullLabel !== null">
        <DropdownMenuItem :shortcut="modelValue == null ? '✓' : undefined" @click="emit('update:modelValue', null)">
          {{ nullLabel }}
        </DropdownMenuItem>
        <DropdownMenuSeparator v-if="options.length" />
      </template>
      <DropdownMenuItem
        v-for="opt in options"
        :key="String(opt.value)"
        :shortcut="modelValue === opt.value ? '✓' : undefined"
        @click="emit('update:modelValue', opt.value)"
      >
        <template #icon><slot name="icon" :option="opt" /></template>
        <slot name="option" :option="opt">{{ opt.label }}</slot>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>
