<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { useApi } from '../../../composables/useApi'
import { highlightParts } from '../lib/docsNav'

/**
 * Command-palette search over the documentation.
 *
 * Results come from the server rather than a client-side index: searching in
 * the browser would mean shipping every page to it, private ones included.
 */
const props = defineProps({
  open: { type: Boolean, required: true },
})
const emit = defineEmits(['close'])

const router = useRouter()
const { $fetch } = useApi()

const query   = ref('')
const hits    = ref([])
const active  = ref(0)
const loading = ref(false)
const inputEl = ref(null)
const listEl  = ref(null)

// Each keystroke would otherwise be a request. 160ms is below the point where
// typing feels laggy and well above the rate anyone actually types.
const DEBOUNCE_MS = 160
let timer = null
// Responses can arrive out of order; only the newest query may paint.
let seq = 0

async function run(q) {
  if (q.trim().length < 2) { hits.value = []; loading.value = false; return }
  const mine = ++seq
  loading.value = true
  const { ok, data } = await $fetch(`/api/docs/search?q=${encodeURIComponent(q)}`, { silent: true })
  if (mine !== seq) return
  loading.value = false
  hits.value = ok ? (data.hits ?? []) : []
  active.value = 0
}

watch(query, (q) => {
  clearTimeout(timer)
  timer = setTimeout(() => run(q), DEBOUNCE_MS)
})

watch(() => props.open, async (open) => {
  if (!open) return
  // Reopening with the previous results still on screen is disorienting.
  query.value = ''
  hits.value = []
  active.value = 0
  await nextTick()
  inputEl.value?.focus()
})

function go(hit) {
  if (!hit) return
  emit('close')
  router.push(`/docs/${hit.slug}${hit.headingId ? `#${hit.headingId}` : ''}`)
}

function move(delta) {
  if (!hits.value.length) return
  // Wraps, so holding an arrow key never dead-ends at either edge.
  active.value = (active.value + delta + hits.value.length) % hits.value.length
  nextTick(() => {
    listEl.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  })
}

function onKeydown(e) {
  if (e.key === 'ArrowDown')      { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter')     { e.preventDefault(); go(hits.value[active.value]) }
  else if (e.key === 'Escape')    { e.preventDefault(); emit('close') }
}

// Esc has to work from anywhere in the dialog, not only the input.
function onWindowKey(e) {
  if (props.open && e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onWindowKey))
onBeforeUnmount(() => { window.removeEventListener('keydown', onWindowKey); clearTimeout(timer) })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ds" @click.self="$emit('close')">
      <div class="ds__panel" role="dialog" aria-modal="true" aria-label="Search documentation">
        <div class="ds__inputRow">
          <Icon icon="mdi:magnify" class="ds__inputIcon" />
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            placeholder="Search documentation…"
            class="ds__input"
            autocomplete="off"
            spellcheck="false"
            @keydown="onKeydown"
          />
          <kbd class="ds__esc">Esc</kbd>
        </div>

        <div v-if="query.trim().length >= 2" ref="listEl" class="ds__results">
          <p v-if="loading && !hits.length" class="ds__empty">Searching…</p>
          <p v-else-if="!hits.length" class="ds__empty">
            No matches for <strong>{{ query }}</strong>
          </p>

          <button
            v-for="(hit, i) in hits"
            :key="`${hit.slug}-${hit.headingId ?? i}`"
            type="button"
            class="ds__hit"
            :data-active="i === active"
            @mouseenter="active = i"
            @click="go(hit)"
          >
            <div class="ds__hitHead">
              <span class="ds__hitTitle">{{ hit.title }}</span>
              <span v-if="hit.heading" class="ds__hitSep">›</span>
              <span v-if="hit.heading" class="ds__hitHeading">{{ hit.heading }}</span>
              <span class="ds__hitCat">{{ hit.category }}</span>
            </div>
            <p class="ds__hitSnippet">
              <!-- Parts, not interpolated HTML: snippets are document text, so
                   there is nothing to escape and nothing to get wrong. -->
              <template v-for="(part, p) in highlightParts(hit.snippet, query)" :key="p">
                <mark v-if="part.match">{{ part.text }}</mark>
                <template v-else>{{ part.text }}</template>
              </template>
            </p>
          </button>
        </div>

        <div v-else class="ds__hint">
          <p>Search across every page you can read.</p>
        </div>

        <div class="ds__footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ds {
  position: fixed; inset: 0; z-index: 60;
  background: oklch(0% 0 0 / 0.45);
  backdrop-filter: blur(2px);
  display: flex; justify-content: center;
  padding: 12vh 16px 16px;
}

.ds__panel {
  width: 100%; max-width: 640px;
  max-height: 70vh; display: flex; flex-direction: column;
  background: oklch(var(--background));
  border: 1px solid oklch(var(--border)); border-radius: 14px;
  box-shadow: 0 24px 60px oklch(0% 0 0 / 0.35);
  overflow: hidden;
}

.ds__inputRow {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; border-bottom: 1px solid oklch(var(--border));
}
.ds__inputIcon { width: 18px; height: 18px; color: oklch(var(--muted-foreground)); flex: none; }
.ds__input {
  flex: 1; border: 0; background: transparent; outline: none;
  font-size: 15px; color: oklch(var(--foreground));
}
.ds__input::placeholder { color: oklch(var(--muted-foreground)); }
.ds__esc {
  font-size: 11px; padding: 2px 6px; border-radius: 5px;
  border: 1px solid oklch(var(--border)); color: oklch(var(--muted-foreground));
}

.ds__results { overflow-y: auto; padding: 6px; }
.ds__empty, .ds__hint { padding: 28px 16px; text-align: center; color: oklch(var(--muted-foreground)); font-size: 14px; }

.ds__hit {
  display: block; width: 100%; text-align: left;
  padding: 10px 12px; border-radius: 9px; border: 0;
  background: transparent; cursor: pointer;
}
.ds__hit[data-active='true'] { background: oklch(var(--accent)); }

.ds__hitHead { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.ds__hitTitle { font-size: 14px; font-weight: 560; color: oklch(var(--foreground)); flex: none; }
.ds__hitSep { font-size: 13px; color: oklch(var(--muted-foreground)); flex: none; }
/* The heading is the only part allowed to shrink: it is the longest and the
   least load-bearing, and without this a long one pushes the category chip out
   of the row entirely. */
.ds__hitHeading {
  font-size: 13px; color: oklch(var(--muted-foreground));
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ds__hitCat {
  margin-left: auto; padding-left: 8px;
  font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase;
  color: oklch(var(--muted-foreground)); flex: none;
}
.ds__hitSnippet {
  margin: 3px 0 0; font-size: 12.5px; line-height: 1.55;
  color: oklch(var(--muted-foreground));
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ds__hitSnippet mark { background: transparent; color: oklch(var(--foreground)); font-weight: 600; }

.ds__footer {
  display: flex; gap: 16px; padding: 9px 16px;
  border-top: 1px solid oklch(var(--border)); background: oklch(var(--muted));
  font-size: 11.5px; color: oklch(var(--muted-foreground));
}
.ds__footer kbd {
  font-size: 10.5px; padding: 1px 5px; margin-right: 3px; border-radius: 4px;
  border: 1px solid oklch(var(--border)); background: oklch(var(--background));
}

@media (max-width: 640px) {
  .ds { padding-top: 6vh; }
}
</style>
