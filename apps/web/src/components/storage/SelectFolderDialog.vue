<script setup>
import { ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import Dialog from '../ui/Dialog.vue'
import Button from '../ui/Button.vue'
import Input  from '../ui/Input.vue'
import Label  from '../ui/Label.vue'

const props = defineProps({
  open:      { type: Boolean, required: true },
  companyId: { type: String,  required: true },
  title:     { type: String,  default: 'Select folder' },
})

const emit = defineEmits(['select', 'close'])

const folders       = ref([])
const loading       = ref(false)
const crumbs        = ref([])
const currentId     = ref(null)

const creating      = ref(false)
const newName       = ref('')
const createError   = ref('')
const createLoading = ref(false)

async function load(id) {
  loading.value = true
  try {
    const params = new URLSearchParams({ cid: props.companyId })
    if (id) params.set('folder_id', id)
    const res  = await fetch(`/api/storage?${params}`, { credentials: 'include' })
    if (!res.ok) throw new Error()
    const data = await res.json()
    folders.value = data.folders
  } catch {
    folders.value = []
  } finally {
    loading.value = false
  }
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
  try {
    const res = await fetch('/api/storage', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({
        company_id: props.companyId,
        name:       newName.value.trim(),
        parent_id:  currentId.value,
      }),
    })
    const data = await res.json()
    if (!res.ok) { createError.value = data.error ?? 'Failed to create folder'; return }
    creating.value = false
    newName.value  = ''
    load(currentId.value)
  } catch {
    createError.value = 'Network error'
  } finally {
    createLoading.value = false
  }
}
</script>

<template>
  <Dialog :open="open" class="max-w-md" @close="emit('close')">
    <div class="flex flex-col">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
        <h3 class="text-base font-semibold">{{ title }}</h3>
        <button class="text-muted-foreground hover:text-foreground transition-colors" @click="emit('close')">
          <Icon icon="mdi:close" class="text-xl" />
        </button>
      </div>

      <!-- Breadcrumb -->
      <div class="flex items-center flex-wrap gap-0.5 px-5 py-2.5 text-sm border-b border-border min-h-[2.75rem]">
        <button
          class="transition-colors hover:text-foreground"
          :class="crumbs.length === 0 ? 'text-foreground font-medium' : 'text-muted-foreground'"
          @click="goToCrumb(-1)"
        >Root</button>
        <template v-for="(crumb, i) in crumbs" :key="crumb.id">
          <Icon icon="mdi:chevron-right" class="text-base text-muted-foreground/40 shrink-0" />
          <button
            class="truncate max-w-[140px] transition-colors hover:text-foreground"
            :class="i === crumbs.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground'"
            @click="goToCrumb(i)"
          >{{ crumb.name }}</button>
        </template>
      </div>

      <!-- Folder list -->
      <div class="flex flex-col gap-0.5 px-2 py-2 min-h-[180px] max-h-[320px] overflow-y-auto">
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
            class="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left hover:bg-muted transition-colors"
            @click="enterFolder(folder)"
          >
            <Icon icon="mdi:folder" class="text-blue-400 text-lg shrink-0" />
            <span class="flex-1 truncate text-foreground">{{ folder.name }}</span>
            <Icon icon="mdi:chevron-right" class="text-muted-foreground/40 text-base shrink-0" />
          </button>
        </template>

        <!-- Inline create form -->
        <form
          v-if="creating"
          class="flex flex-col gap-2 px-3 py-2.5 rounded-md border border-border bg-card mt-1"
          @submit.prevent="submitCreate"
        >
          <Label for="sfd-name" class="text-xs">New folder name</Label>
          <Input id="sfd-name" v-model="newName" placeholder="My folder" autofocus class="h-8 text-sm" />
          <p v-if="createError" class="text-xs text-destructive">{{ createError }}</p>
          <div class="flex gap-2 justify-end">
            <Button type="button" size="xs" variant="ghost" @click="creating = false; newName = ''">Cancel</Button>
            <Button type="submit" size="xs" :disabled="!newName.trim() || createLoading">
              {{ createLoading ? 'Creating…' : 'Create' }}
            </Button>
          </div>
        </form>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between px-5 py-4 border-t border-border">
        <Button
          size="sm"
          variant="ghost"
          @click="creating = !creating; newName = ''; createError = ''"
        >
          <Icon icon="mdi:folder-plus-outline" class="mr-1.5 text-base" />
          New folder here
        </Button>
        <div class="flex gap-2">
          <Button size="sm" variant="outline" @click="emit('close')">Cancel</Button>
          <Button size="sm" @click="emit('select', currentId)">Move here</Button>
        </div>
      </div>

    </div>
  </Dialog>
</template>
