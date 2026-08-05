<script setup>
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import Dialog        from './Dialog.vue'
import DialogContent from './DialogContent.vue'
import DialogHeader  from './DialogHeader.vue'
import DialogTitle   from './DialogTitle.vue'
import Input         from './Input.vue'
import { ICON_GROUPS, iconLabel, searchIcons } from './icons.js'
import { cn } from './utils.js'

/**
 * Trigger button + a picker dialog over the curated MDI catalogue.
 *
 * It opens its own Dialog rather than a popover because pickers are used from
 * inside other dialogs, and a nested Dialog is the one overlay radix will hand
 * focus to cleanly (ImageCropper does the same from TimelineDialog). Labels are
 * props — this package has no i18n of its own.
 */
const props = defineProps({
  title:             { type: String,  default: 'Pick an icon' },
  placeholder:       { type: String,  default: 'Pick an icon…' },
  searchPlaceholder: { type: String,  default: 'Search icons…' },
  emptyLabel:        { type: String,  default: 'No icons match that search.' },
  /** Offer a "no icon" choice — used where the icon is optional or inherited. */
  allowNone:         { type: Boolean, default: false },
  noneLabel:         { type: String,  default: 'None' },
  /** Group id → translated heading; falls back to the catalogue's English. */
  groupLabels:       { type: Object,  default: () => ({}) },
  /** Preview the icon in the colour it will actually appear in. */
  hue:               { type: Number,  default: null },
  disabled:          { type: Boolean, default: false },
  class:             { type: String,  default: '' },
})

const model = defineModel({ default: null })

const open  = ref(false)
const query = ref('')

watch(open, (isOpen) => { if (isOpen) query.value = '' })

const results = computed(() => searchIcons(query.value))

const groups = computed(() =>
  ICON_GROUPS
    .map(g => ({
      id:    g.id,
      label: props.groupLabels[g.id] ?? g.label,
      icons: results.value.filter(i => i.group === g.id),
    }))
    .filter(g => g.icons.length),
)

const tint = computed(() => (props.hue == null ? undefined : `oklch(65% 0.18 ${props.hue})`))

function pick(name) {
  model.value = name
  open.value  = false
}

// Enter picks the only sensible candidate rather than doing nothing.
function onSearchEnter() {
  const first = results.value[0]
  if (first) pick(first.name)
}
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :class="cn(
      'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm',
      'transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      props.class
    )"
    @click="open = true"
  >
    <Icon v-if="model" :icon="model" class="size-4 shrink-0" :style="{ color: tint }" />
    <span
      v-else
      class="size-4 shrink-0 rounded-sm border border-dashed border-muted-foreground/50"
      aria-hidden="true"
    />
    <span class="flex-1 truncate text-left" :class="model ? 'text-foreground' : 'text-muted-foreground'">
      {{ model ? iconLabel(model) : (allowNone ? noneLabel : placeholder) }}
    </span>
    <Icon icon="mdi:unfold-more-horizontal" class="size-3.5 shrink-0 text-muted-foreground" />
  </button>

  <Dialog :open="open" @update:open="open = $event">
    <DialogContent class="flex max-h-[80vh] max-w-lg flex-col overflow-hidden p-0">
      <DialogHeader class="shrink-0 gap-3 border-b border-border px-5 py-4">
        <!-- pr-8 keeps the title clear of the overlaid close button; the search
             field below it is free to use the full width. -->
        <DialogTitle class="pr-8">{{ title }}</DialogTitle>
        <Input
          v-model="query"
          type="search"
          :placeholder="searchPlaceholder"
          autofocus
          @keydown.enter.prevent="onSearchEnter"
        />
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        <button
          v-if="allowNone"
          type="button"
          class="flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors"
          :class="model == null
            ? 'border-primary bg-primary/5 text-foreground'
            : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'"
          @click="pick(null)"
        >
          <span
            class="size-4 shrink-0 rounded-sm border border-dashed border-muted-foreground/50"
            aria-hidden="true"
          />
          {{ noneLabel }}
        </button>

        <section v-for="group in groups" :key="group.id" class="flex flex-col gap-2">
          <h4 class="text-xs font-medium text-muted-foreground">{{ group.label }}</h4>
          <div class="grid grid-cols-8 gap-1">
            <button
              v-for="icon in group.icons"
              :key="icon.name"
              type="button"
              class="flex aspect-square items-center justify-center rounded-md transition-colors"
              :class="icon.name === model
                ? 'bg-primary/10 text-primary ring-1 ring-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
              :title="iconLabel(icon.name)"
              @click="pick(icon.name)"
            >
              <Icon :icon="icon.name" class="size-5" />
            </button>
          </div>
        </section>

        <p v-if="!groups.length" class="py-6 text-center text-sm text-muted-foreground">
          {{ emptyLabel }}
        </p>
      </div>
    </DialogContent>
  </Dialog>
</template>
