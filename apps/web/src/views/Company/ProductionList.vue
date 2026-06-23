<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import Button from '../../components/ui/Button.vue'
import SquircleAvatar from '../../components/ui/SquircleAvatar.vue'
import CreateProductionDialog from './CreateProductionDialog.vue'

const props = defineProps({
  company: { type: Object, required: true },
})

const router = useRouter()

function openProduction(production) {
  router.push(`/c/${props.company.slug}/p/${production.slug}`)
}

const productions = ref([])
const loading     = ref(true)
const error       = ref('')
const dialogOpen  = ref(false)

async function load() {
  loading.value = true
  error.value   = ''
  try {
    const res = await fetch(`/api/production?cid=${props.company.id}`, { credentials: 'include' })
    if (!res.ok) throw new Error()
    productions.value = await res.json()
  } catch {
    error.value = 'Could not load productions'
  } finally {
    loading.value = false
  }
}

function onCreated(production) {
  productions.value = [production, ...productions.value]
}

function bannerUrl(p) {
  return p.bannerImageId ? `/api/storage/${p.bannerImageId}/serve?quality=67` : null
}

function profileUrl(p) {
  return p.profileImageId ? `/api/storage/${p.profileImageId}/serve?quality=67` : null
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-foreground">Productions</h2>
      <Button size="sm" @click="dialogOpen = true">New production</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading...</p>

    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>

    <div v-else-if="productions.length === 0" class="rounded-xl border border-dashed border-border py-16 text-center">
      <p class="text-sm text-muted-foreground">No productions yet.</p>
      <Button variant="ghost" size="sm" class="mt-2" @click="dialogOpen = true">Create the first</Button>
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 relative">
      <div
        v-for="p in productions"
        :key="p.id"
        class="group h-64 relative rounded-2xl border border-border bg-background overflow-hidden cursor-pointer hover:border-border/80 hover:shadow-sm transition-all"
        @click="openProduction(p)"
      >
        <!-- Banner strip -->
        <div class="absolute z-0 inset-0 overflow-hidden bg-secondary">
          <img
            v-if="bannerUrl(p)"
            :src="bannerUrl(p)"
            :alt="p.name"
            class="absolute opacity-75 dark:opacity-100 inset-0 w-full h-full object-cover"
          />
          <!-- Gradient that bleeds the banner into the card body -->
          <div class=" absolute inset-0 bg-gradient-to-b from-transparent via-background/25 to-background/50" />
        </div>

        <!-- Card body -->
        <div class="bg-background border transition-all duration-500 z-10 p-2 rounded-xl absolute inset-x-2 bottom-2 flex items-center gap-3">
          <SquircleAvatar :src="profileUrl(p)" :size="52" class="shrink-0">
            <span class="text-base font-bold">{{ p.name.charAt(0).toUpperCase() }}</span>
          </SquircleAvatar>

          <div class="min-w-0 flex-1">
            <p class="text-base font-semibold text-foreground leading-tight truncate">{{ p.name }}</p>
          </div>

          <Icon
            icon="mdi:arrow-right"
            class="absolute group-hover:bg-foreground/5 rounded-lg size-10 p-2 group-hover:translate-x-1 duration-150 right-4 shrink-0 text-xl text-muted-foreground group-hover:text-foreground transition-all"
          />
        </div>
      </div>
    </div>
  </div>

  <CreateProductionDialog
    :open="dialogOpen"
    :company="company"
    @close="dialogOpen = false"
    @created="onCreated"
  />
</template>
