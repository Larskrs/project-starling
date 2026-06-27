<script setup>
import { ref, watch } from 'vue'
import Dialog        from '@starling/ui/Dialog'
import DialogContent from '@starling/ui/DialogContent'
import DialogHeader  from '@starling/ui/DialogHeader'
import DialogTitle   from '@starling/ui/DialogTitle'
import Input  from '@starling/ui/Input'
import { useApi } from '../../composables/useApi.js'

const props = defineProps({
  open: { type: Boolean, required: true },
})

const emit = defineEmits(['close', 'select'])

const { $fetch } = useApi()

const query   = ref('')
const results = ref([])
const loading = ref(false)
const error   = ref('')

let debounceTimer = null

async function fetchGifs(path, params = {}) {
  loading.value = true
  error.value   = ''
  const qs = new URLSearchParams(params)
  const { ok, data } = await $fetch(`/api/chat/gifs/${path}?${qs}`, { silent: true })
  loading.value = false
  if (!ok) { error.value = 'Failed to load GIFs'; return }
  results.value = data?.data ?? []
}

function loadTrending() {
  fetchGifs('trending')
}

watch(query, (q) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    q.trim() ? fetchGifs('search', { q }) : loadTrending()
  }, 400)
})

watch(() => props.open, (open) => {
  if (open) { query.value = ''; loadTrending() }
})

function select(gif) {
  const url = gif.images?.original?.url ?? gif.images?.downsized_large?.url
  if (!url) return
  emit('select', url)
  emit('close')
}
</script>

<template>
  <Dialog :open="open" @update:open="!$event && emit('close')">
    <DialogContent class="max-w-xl flex flex-col gap-3 p-4" style="height: 480px">

      <DialogHeader class="shrink-0">
        <DialogTitle>{{ query ? `"${query}"` : 'Trending GIFs' }}</DialogTitle>
      </DialogHeader>

      <Input v-model="query" placeholder="Search Giphy…" autofocus class="shrink-0" />

      <!-- Results -->
      <div class="flex-1 overflow-y-auto min-h-0">
        <p v-if="error"        class="pt-8 text-center text-sm text-destructive">{{ error }}</p>
        <p v-else-if="loading" class="pt-8 text-center text-sm text-muted-foreground">Loading…</p>
        <p v-else-if="!results.length" class="pt-8 text-center text-sm text-muted-foreground">No results</p>

        <div v-else class="grid grid-cols-3 gap-2">
          <button
            v-for="gif in results"
            :key="gif.id"
            class="overflow-hidden rounded aspect-square bg-muted hover:ring-2 ring-primary transition-all focus:outline-none focus:ring-2"
            @click="select(gif)"
          >
            <img
              :src="gif.images?.fixed_height_small?.url"
              :alt="gif.title"
              class="h-full w-full object-cover"
              loading="lazy"
            />
          </button>
        </div>
      </div>

      <p class="shrink-0 text-right text-xs text-muted-foreground">Powered by GIPHY</p>
    </DialogContent>
  </Dialog>
</template>
