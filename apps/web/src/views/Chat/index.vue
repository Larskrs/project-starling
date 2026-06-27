<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useAuth }        from '../../composables/useAuth.js'
import { useSocket }      from '../../composables/useSocket.js'
import Button             from '@starling/ui/Button'
import Input              from '@starling/ui/Input'
import GifPickerDialog     from './GifPickerDialog.vue'

const { user, logout, fetchUser } = useAuth()
const { messages, onlineUsers, connected, connect, disconnect, sendMessage } = useSocket()

const text            = ref('')
const sending         = ref(false)
const listEl          = ref(null)
const gifDialogOpen   = ref(false)
const pendingGif      = ref(null) // { type: 'gif', url }

onMounted(async () => {
  connect()
})

onUnmounted(() => disconnect())

watch(messages, async () => {
  await nextTick()
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
}, { deep: true })

function onGifSelect(url) {
  pendingGif.value = { type: 'gif', url }
}

async function handleSend() {
  const trimmed = text.value.trim()
  if ((!trimmed && !pendingGif.value) || sending.value) return
  sending.value = true
  try {
    const attachments = pendingGif.value ? [pendingGif.value] : []
    await sendMessage(trimmed || ' ', attachments)
    text.value       = ''
    pendingGif.value = null
  } catch (e) {
    console.error(e)
  } finally {
    sending.value = false
  }
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function fmt(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="h-dvh max-h-dvh flex flex-col bg-background">

    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <header class="flex items-center justify-between px-6 py-3 border-b border-border bg-card shrink-0">
      <div class="flex items-center gap-2.5">
        <span class="font-semibold tracking-tight text-foreground">Starling Chat</span>
        <span
          :class="connected ? 'bg-green-500' : 'bg-muted-foreground'"
          class="w-2 h-2 rounded-full transition-colors"
        />
      </div>
      <div class="flex items-center gap-4">
        <span class="text-muted-foreground">{{ user?.first_name }}</span>
        <Button variant="outline" size="sm" @click="logout">Sign out</Button>
      </div>
    </header>

    <!-- ── Body ────────────────────────────────────────────────────────────── -->
    <div class="flex flex-1 min-h-0">

      <!-- Messages column -->
      <main class="flex flex-col flex-1 min-w-0">

        <!-- Message list -->
        <div ref="listEl" class="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <p v-if="messages.length === 0" class="text-center text-sm text-muted-foreground pt-10">
            No messages yet. Say something!
          </p>

          <div
            v-for="msg in messages"
            :key="msg.id"
            class="flex gap-3 items-start"
          >
            <!-- Avatar -->
            <div class="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold shrink-0 select-none">
              {{ initials(msg.user.name) }}
            </div>

            <!-- Bubble -->
            <div>
              <div class="flex items-baseline gap-2 mb-0.5">
                <span class="text-sm font-semibold text-foreground">{{ msg.user.name }}</span>
                <span class="text-xs text-muted-foreground">{{ fmt(msg.sentAt) }}</span>
              </div>
              <p v-if="msg.text.trim()" class="text-sm text-foreground leading-relaxed break-words">{{ msg.text }}</p>
              <div v-if="msg.attachments?.length" class="mt-2 flex flex-col gap-2">
                <img
                  v-for="att in msg.attachments"
                  :key="att.url"
                  :src="att.url"
                  class="max-w-xs max-h-64 rounded-md object-contain"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Pending GIF preview -->
        <div v-if="pendingGif" class="px-6 pt-3 flex items-start gap-2">
          <img :src="pendingGif.url" class="max-h-32 rounded-md object-contain" />
          <button
            class="text-muted-foreground hover:text-foreground text-xs mt-1"
            @click="pendingGif = null"
          >Remove</button>
        </div>

        <!-- Input bar -->
        <div class="border-t border-border px-6 py-4 flex gap-2 shrink-0 bg-card">
          <Button
            variant="ghost"
            size="icon"
            :disabled="!connected"
            title="Add GIF"
            @click="gifDialogOpen = true"
          >GIF</Button>
          <Input
            v-model="text"
            placeholder="Type a message…"
            class="flex-1"
            :disabled="!connected"
            @keydown.enter.prevent="handleSend"
          />
          <Button
            @click="handleSend"
            :disabled="(!text.trim() && !pendingGif) || sending || !connected"
          >Send</Button>
        </div>
      </main>

      <!-- Online users sidebar -->
      <aside class="hidden sm:flex flex-col w-52 shrink-0 border-l border-border bg-card px-4 py-5">
        <p class="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">
          Online &mdash; {{ onlineUsers.length }}
        </p>
        <ul class="space-y-2 overflow-y-auto">
          <li
            v-for="u in onlineUsers"
            :key="u.id"
            class="flex items-center gap-2 text-sm"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
            <span class="truncate" :class="u.id === user?.id ? 'font-medium text-foreground' : 'text-foreground'">
              {{ u.name }}
            </span>
            <span v-if="u.id === user?.id" class="text-xs text-muted-foreground shrink-0">you</span>
          </li>
        </ul>
      </aside>

    </div>
  </div>

  <GifPickerDialog
    :open="gifDialogOpen"
    @close="gifDialogOpen = false"
    @select="onGifSelect"
  />
</template>
