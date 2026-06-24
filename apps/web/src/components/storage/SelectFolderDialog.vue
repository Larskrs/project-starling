<script setup>
import { ref, computed, watch } from 'vue'
import { Icon } from '@iconify/vue'
import Dialog     from '../ui/Dialog.vue'
import Button     from '../ui/Button.vue'
import Input      from '../ui/Input.vue'
import Label      from '../ui/Label.vue'
import Breadcrumb from '../ui/Breadcrumb.vue'
import { useApi } from '../../composables/useApi.js'

const props = defineProps({
  open:         { type: Boolean, required: true },
  productionId: { type: String,  required: true },
  title:        { type: String,  default: 'Select folder' },
})

const emit = defineEmits(['select', 'close'])

const { $fetch } = useApi()

const folders       = ref([])
const loading       = ref(false)
const crumbs        = ref([])
const currentId     = ref(null)

const creating      = ref(false)
const newName       = ref('')
const createError   = ref('')
const createLoading = ref(false)

const breadcrumbItems = computed(() => [
  { id: null, label: 'Root' },
  ...crumbs.value.map(c => ({ id: c.id, label: c.name })),
])

async function load(id) {
  loading.value = true
  const params = new URLSearchParams({ pid: props.productionId })
  if (id) params.set('folder_id', id)
  const { ok, data } = await $fetch(`/api/storage?${params}`, { silent: true })
  folders.value = ok ? data.folders : []
  loading.value = false
}

function enterFolder(folder) {
  crumbs.value    = [...crumbs.value, { id: folder.id, name: folder.name }]
  currentId.value = folder.id
  creating.value  = false
  load(folder.id)
}

function goToCrumb(idx) {
  if (idx === -1) {
    crumbs.value    = []
    currentId.value = null
  } else {
    crumbs.value    = crumbs.value.slice(0, idx + 1)
    currentId.value = crumbs.value[idx].id
  }
  creating.value = false
  load(currentId.value)
}

function reset() {
  currentId.value   = null
  crumbs.value      = []
  creating.value    = false
  newName.value     = ''
  createError.value = ''
}

watch(() => props.open, (val) => {
  if (val) { reset(); load(null) }
})

async function submitCreate() {
  createError.value   = ''
  createLoading.value = true
  const { ok, error } = await $fetch('/api/storage', {
    method: 'POST',
    json:   { production_id: props.productionId, name: newName.value.trim(), parent_id: currentId.value },
    silent: true,
  })
  createLoading.value = false
  if (!ok) { createError.value = error ?? 'Failed to create folder'; return }
  creating.value = false
  newName.value  = ''
  load(currentId.value)
}
</script>

<template>
  <Dialog :open="open" class="max-w-sm" @close="emit('close')">
    <div class="flex flex-col">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 class="text-base font-semibold">{{ title }}</h3>
        <button class="text-muted-foreground hover:text-foreground transition-colors" @click="emit('close')">
          <Icon icon="mdi:close" class="text-lg" />
        </button>
      </div>

      <!-- Breadcrumb -->
      <div class="px-4 py-2.5 border-b border-border">
        <Breadcrumb :items="breadcrumbItems">
          <template #separator>
            <Icon icon="mdi:chevron-right" class="text-muted-foreground/40 text-sm shrink-0" />
          </template>
          <template #default="{ item, index, isLast }">
            <button
              class="text-sm transition-colors hover:text-foreground truncate max-w-[120px]"
              :class="isLast ? 'text-foreground font-medium' : 'text-muted-foreground'"
              @click="goToCrumb(index - 1)"
            >{{ item.label }}</button>
          </template>
        </Breadcrumb>
      </div>

      <!-- Folder list -->
      <div class="flex flex-col gap-0.5 px-2 py-2 min-h-[150px] max-h-[260px] overflow-y-auto">
        <div v-if="loading" class="flex items-center justify-center py-10">
          <Icon icon="mdi:loading" class="animate-spin text-2xl text-muted-foreground/50" />
        </div>

        <p v-else-if="folders.length === 0 && !creating" class="py-8 text-center text-sm text-muted-foreground">
          No subfolders here
        </p>

        <template v-else>
          <button
            v-for="folder in folders"
            :key="folder.id"
            class="flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-muted transition-colors"
            @click="enterFolder(folder)"
          >
            <Icon icon="mdi:folder" class="text-primary text-lg shrink-0" />
            <span class="flex-1 truncate text-foreground text-sm">{{ folder.name }}</span>
            <Icon icon="mdi:chevron-right" class="text-muted-foreground/40 text-base shrink-0" />
          </button>
        </template>

        <!-- Inline create form -->
      </div>
      <form
        v-if="creating"
        class="flex flex-col gap-2 px-3 py-2.5 border-t border-border bg-card mt-1"
        @submit.prevent="submitCreate"
      >
        <Label for="sfd-name" class="text-sm">Folder name</Label>
        <div class="flex gap-1">
          <Input id="sfd-name" v-model="newName" placeholder="My folder" autofocus class="h-9 text-sm" />
          <p v-if="createError" class="text-sm text-destructive">{{ createError }}</p>
          <div class="flex gap-2 justify-end">
            <Button type="button" size="sm" variant="ghost" @click="creating = false; newName = ''"><Icon icon="mdi:close" /></Button>
            <Button type="submit" size="sm" :disabled="!newName.trim() || createLoading">
              {{ createLoading ? 'Creating…' : 'Create' }}
            </Button>
          </div>
        </div>
      </form>

      <!-- Footer -->
      <div class="flex items-center justify-between px-4 py-3 border-t border-border">
        <Button
          size="sm"
          variant="ghost"
          @click="creating = !creating; newName = ''; createError = ''"
        >
          <Icon icon="mdi:folder-plus-outline" class="mr-1.5 text-base" />
          New folder
        </Button>
        <div class="flex gap-2">
          <Button size="sm" variant="outline" @click="emit('close')">Cancel</Button>
          <Button size="sm" @click="emit('select', currentId)">Move here</Button>
        </div>
      </div>

    </div>
  </Dialog>
</template>
