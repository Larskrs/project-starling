<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'radix-vue'
import DropdownMenuContent   from '@starling/ui/DropdownMenuContent'
import DropdownMenuItem      from '@starling/ui/DropdownMenuItem'
import DropdownMenuSeparator from '@starling/ui/DropdownMenuSeparator'

const props = defineProps({
  modelValue: { type: String, default: null },
  roles:      { type: Array,  default: () => [] },
  align:      { type: String, default: 'end' },
})

const emit = defineEmits(['update:modelValue'])

const currentRole = computed(() => props.roles.find(r => r.id === props.modelValue) ?? null)

function badgeStyle(hue) {
  return {
    backgroundColor: `oklch(65% 0.18 ${hue} / 0.12)`,
    color:           `oklch(52% 0.2 ${hue})`,
  }
}

function select(roleId) {
  emit('update:modelValue', roleId || null)
}
</script>   

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <button
        class="flex items-center gap-1 shrink-0 rounded-full text-xs transition-all"
        :class="currentRole
          ? 'pl-2.5 pr-2 py-1 font-medium hover:opacity-75'
          : 'px-2.5 py-1 text-muted-foreground border border-border hover:bg-muted'"
        :style="currentRole ? badgeStyle(currentRole.hue) : null"
      >
        {{ currentRole?.name ?? $t('roles.noRole') }}
        <Icon icon="mdi:chevron-down" class="size-3" :class="currentRole ? 'opacity-60' : ''" />
      </button>
    </DropdownMenuTrigger>

    <DropdownMenuContent :align="align" :side-offset="4">
      <DropdownMenuItem
        :shortcut="!modelValue ? '✓' : undefined"
        @click="select(null)"
      >
        {{ $t('roles.noRole') }}
      </DropdownMenuItem>
      <DropdownMenuSeparator v-if="roles.length" />
      <DropdownMenuItem
        v-for="role in roles"
        :key="role.id"
        :shortcut="modelValue === role.id ? '✓' : undefined"
        @click="select(role.id)"
      >
        <template #icon>
          <span
            class="size-2.5 rounded-full shrink-0"
            :style="{ backgroundColor: `oklch(65% 0.18 ${role.hue})` }"
          />
        </template>
        {{ role.name }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>
