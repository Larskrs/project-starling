<script setup>
import { ref, computed, onMounted } from 'vue'
import { Icon } from '@iconify/vue'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'radix-vue'
import {
  useColorMode,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub,
} from '@starling/ui'
import { useStorage } from './storage.js'
import { useStorageApi, thumbnailUrl } from './useStorageApi.js'
import { fileIcon, FOLDER_HUES } from './fileKinds.js'

/**
 * A folder in the grid, tinted by its hue and peeking at the first few files
 * inside it. Rename, delete and recolour are named here and carried out by the
 * storage root.
 */
const props = defineProps({ folder: { type: Object, required: true } })

const { productionId, browser, actions } = useStorage()
const { isDark } = useColorMode()
const api = useStorageApi()

const menuOpen  = ref(false)
const isHovered = ref(false)

// ── File peek previews ────────────────────────────────────────────────────
const peekFiles = ref([])

onMounted(async () => {
  if (!props.folder.fileCount) return
  const { ok, files } = await api.list(productionId.value, props.folder.id)
  if (ok) peekFiles.value = files.slice(0, 3)
})

const PEEK_STYLES_DEFAULT = [
  { transform: 'rotate(-11deg) translate(-7px, 3px) scale(0.86)', zIndex: 1 },
  { transform: 'rotate(-3deg)  translate(-1px, 1px) scale(0.93)', zIndex: 2 },
  { transform: 'rotate(8deg)   translate(5px, -1px) scale(1)',    zIndex: 3 },
]

const PEEK_STYLES_HOVER = [
  { transform: 'rotate(-15deg) translate(-13px, 4px) scale(0.84)', zIndex: 1 },
  { transform: 'rotate(-4deg)  translate(-1px,  2px) scale(0.92)', zIndex: 2 },
  { transform: 'rotate(13deg)  translate(11px, -2px) scale(1)',    zIndex: 3 },
]

const peekStyles = computed(() => isHovered.value ? PEEK_STYLES_HOVER : PEEK_STYLES_DEFAULT)

// ── Hue theming ───────────────────────────────────────────────────────────
const hueVars = computed(() => {
  const { hue } = props.folder
  if (hue == null) return null
  return isDark.value
    ? { '--bg': `oklch(0.58 0.25 ${hue} / 0.3)`, '--hover': `oklch(0.64 0.25 ${hue} / 0.5)`, '--icon': `oklch(0.72 0.20 ${hue})` }
    : { '--bg': `oklch(0.88 0.07 ${hue} / 0.6)`, '--hover': `oklch(0.85 0.09 ${hue} / 0.8)`, '--icon': `oklch(0.52 0.18 ${hue})` }
})

const swatchStyle = (hue) => hue == null
  ? { background: 'transparent', borderStyle: 'dashed', borderColor: 'currentColor', opacity: '0.45' }
  : { background: `oklch(0.72 0.20 ${hue})`, borderColor: 'transparent' }
</script>

<template>
  <DropdownMenuRoot v-model:open="menuOpen">
    <div
      class="folder-card isolate relative flex items-center rounded-lg transition-colors"
      :class="{ 'folder-card--hued': folder.hue != null }"
      :style="hueVars"
      @mouseenter="isHovered = true"
      @mouseleave="isHovered = false"
      @contextmenu.prevent="menuOpen = true"
    >
      <Transition name="peek">
        <div v-if="peekFiles.length" class="peek-cards absolute pointer-events-none" style="top: 0; right: 40px;">
          <div class="relative" style="width: 52px; height: 36px;">
            <div
              v-for="(file, i) in peekFiles"
              :key="file.id"
              class="absolute inset-0 rounded overflow-hidden shadow-lg bg-muted peek-card"
              style="border: 1px solid oklch(1 0 0 / 0.1);"
              :style="peekStyles[i]"
            >
              <img v-if="thumbnailUrl(file)" :src="thumbnailUrl(file)" class="w-full h-full object-cover" />
              <div v-else class="w-full h-full flex items-center justify-center">
                <Icon :icon="fileIcon(file)" class="text-lg text-foreground/50" />
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <button
        class="flex-1 flex items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-l-lg min-w-0"
        @click="browser.openFolder(folder)"
      >
        <Icon
          icon="mdi:folder"
          class="text-xl shrink-0"
          :class="folder.hue == null ? 'text-primary' : ''"
          :style="folder.hue != null ? { color: 'var(--icon)' } : null"
        />
        <span class="text-base font-medium text-foreground truncate">{{ folder.name }}</span>
      </button>

      <DropdownMenuTrigger as-child>
        <button
          class="group shrink-0 mx-1.5 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="{ 'bg-foreground/10 text-foreground': menuOpen }"
          :aria-label="$t('storage.folder.options')"
          @click.stop
        >
          <Icon icon="mdi:dots-horizontal" class="size-5" />
        </button>
      </DropdownMenuTrigger>
    </div>

    <DropdownMenuContent align="end">
      <DropdownMenuLabel>{{ $t('storage.folder.menu') }}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuSub :label="$t('storage.folder.color')" icon="mdi:palette-outline">
        <DropdownMenuLabel>{{ $t('storage.folder.hue') }}</DropdownMenuLabel>
        <DropdownMenuItem
          v-for="preset in FOLDER_HUES"
          :key="preset.key"
          :shortcut="folder.hue === preset.hue ? '✓' : ''"
          @click="actions.setHue(folder, preset.hue)"
        >
          <template #icon>
            <span class="size-3.5 rounded-full shrink-0 border-2 inline-block" :style="swatchStyle(preset.hue)" />
          </template>
          <span :class="{ 'font-medium': folder.hue === preset.hue }">{{ $t(`storage.hues.${preset.key}`) }}</span>
        </DropdownMenuItem>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon="mdi:folder-open-outline" @click="browser.openFolder(folder)">
        {{ $t('storage.folder.open') }}
      </DropdownMenuItem>
      <DropdownMenuItem icon="mdi:pencil-outline" @click="actions.rename(folder)">
        {{ $t('storage.folder.rename') }}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon="mdi:delete-outline" destructive @click="actions.remove(folder)">
        {{ $t('storage.folder.delete') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>

<style scoped>
.folder-card       { background-color: oklch(var(--muted) / 0.88); }
.folder-card:hover { background-color: oklch(var(--secondary) / 1.5); }

.folder-card--hued       { background-color: var(--bg); }
.folder-card--hued:hover { background-color: var(--hover); }

.peek-cards              { z-index: -1; transform: translateY(-62%); transition: transform 0.25s ease; }
.folder-card:hover .peek-cards { transform: translateY(-75%); }

.peek-card { transition: transform 0.25s ease; }

.peek-enter-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.peek-enter-from   { opacity: 0; transform: translateY(-45%) scale(0.85); }
.peek-enter-to     { opacity: 1; transform: translateY(-62%); }
</style>
