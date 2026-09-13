<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Skeleton } from '@starling/ui'
import { useApi } from '../../composables/useApi'
import { usePageTitle } from '../../composables/usePageTitle'
import { neighbours, breadcrumb, filterGroups } from './lib/docsNav'
import DocsSearch from './components/DocsSearch.vue'

const route  = useRoute()
const router = useRouter()
const { $fetch } = useApi()

const groups    = ref([])
const page      = ref(null)
const headings  = ref([])
const html      = ref('')
const loading   = ref(true)
const error     = ref(null)
const navFilter = ref('')
const activeId  = ref('')
const searchOpen = ref(false)
const mobileNavOpen = ref(false)

const slug = computed(() => {
  const parts = route.params.path
  return (Array.isArray(parts) ? parts.join('/') : (parts ?? '')).replace(/^\/+|\/+$/g, '')
})

usePageTitle(computed(() => page.value?.title ? `${page.value.title} — Docs` : 'Documentation'))

const visibleGroups = computed(() => filterGroups(groups.value, navFilter.value))
const crumbs        = computed(() => slug.value ? breadcrumb(groups.value, slug.value) : [])
const around        = computed(() => slug.value ? neighbours(groups.value, slug.value) : { prev: null, next: null })

async function load() {
  loading.value = true
  error.value   = null
  mobileNavOpen.value = false

  if (!slug.value) {
    const { ok, data } = await $fetch('/api/docs', { silent: true })
    loading.value = false
    if (!ok) { error.value = 'load'; return }
    groups.value = data.groups ?? []
    page.value = null
    html.value = ''
    headings.value = []
    return
  }

  const { ok, data, status } = await $fetch(
    `/api/docs/page?slug=${encodeURIComponent(slug.value)}`, { silent: true },
  )
  loading.value = false

  if (!ok) {
    // 401 means the page exists but is internal. Worth distinguishing, because
    // "sign in" and "no such page" call for completely different actions.
    error.value = status === 401 ? 'auth' : 'missing'
    // The sidebar still earns its place: a signed-out reader can navigate to
    // the pages they can open.
    const index = await $fetch('/api/docs', { silent: true })
    if (index.ok) groups.value = index.data.groups ?? []
    return
  }

  groups.value = data.groups ?? []
  page.value   = data.page
  // Already HTML: the server parsed the markdown once, when the file last
  // changed. Nothing here parses anything.
  html.value     = data.html
  headings.value = data.headings ?? []

  await nextTick()
  observeHeadings()
  // A deep link arrives before the content exists, so the scroll has to wait for
  // the render rather than happening on navigation.
  if (route.hash) scrollToHash(route.hash)
  else window.scrollTo({ top: 0 })
}

/**
 * Keyed on the PATH, not the full path.
 *
 * `route.fullPath` includes the hash, so watching it made every click in the
 * contents rail refetch and re-render the page you were already reading — the
 * content blanked to a skeleton and the whole column jumped. An anchor click is
 * navigation within a page, so it must not touch the page.
 */
watch(slug, load, { immediate: true })

function scrollToHash(hash) {
  const el = document.querySelector(hash)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Anchors are handled on their own, so they scroll without reloading anything.
watch(() => route.hash, (hash) => {
  if (hash && !loading.value) scrollToHash(hash)
})

// ── In-page contents ──────────────────────────────────────────────────────────

let observer = null

function observeHeadings() {
  observer?.disconnect()
  if (!headings.value.length) return

  // rootMargin pins the trigger near the top of the viewport, so the highlight
  // changes as a heading reaches the top rather than when it first peeks in at
  // the bottom.
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) activeId.value = entry.target.id
    }
  }, { rootMargin: '-88px 0px -70% 0px' })

  for (const h of headings.value) {
    const el = document.getElementById(h.id)
    if (el) observer.observe(el)
  }
}

// ── Keyboard ──────────────────────────────────────────────────────────────────

function onGlobalKey(e) {
  // The universal docs gesture. Ignored while typing, so it never steals a
  // keystroke from the filter box or a form.
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '')
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchOpen.value = true
    return
  }
  if (e.key === '/' && !typing && !searchOpen.value) {
    e.preventDefault()
    searchOpen.value = true
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKey))
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('keydown', onGlobalKey)
})

/**
 * Keeps in-app doc links inside the router, and runs the copy buttons.
 *
 * The rendered HTML is a string, so its links are plain anchors that would
 * reload the whole app. One delegated listener is cheaper and more robust than
 * hydrating each element.
 */
function onContentClick(e) {
  const copy = e.target.closest('[data-copy]')
  if (copy) {
    const code = copy.closest('.codeblock')?.querySelector('code')
    if (code) {
      navigator.clipboard.writeText(code.innerText).then(() => {
        copy.textContent = 'Copied'
        setTimeout(() => { copy.textContent = 'Copy' }, 2000)
      }).catch(() => { /* insecure origin or denied — the text is selectable anyway */ })
    }
    return
  }

  const link = e.target.closest('a[data-doclink]')
  if (!link) return
  const href = link.getAttribute('href')
  if (!href || !href.startsWith('/')) return
  e.preventDefault()
  router.push(href)
}
</script>

<template>
  <div class="dk">
    <!-- ── Top bar ───────────────────────────────────────────────────────── -->
    <header class="dk__bar">
      <div class="dk__barInner">
        <button
          type="button"
          class="dk__burger"
          aria-label="Toggle navigation"
          @click="mobileNavOpen = !mobileNavOpen"
        >
          <Icon :icon="mobileNavOpen ? 'mdi:close' : 'mdi:menu'" class="size-5" />
        </button>

        <RouterLink to="/docs" class="dk__brand">
          <Icon icon="mdi:book-open-variant-outline" class="size-4" />
          <span>Cino</span>
          <span class="dk__brandSub">Docs</span>
        </RouterLink>

        <!-- Styled as an input but is a button: the palette owns the typing, so
             a real field here would need its state kept in two places. -->
        <button type="button" class="dk__search" @click="searchOpen = true">
          <Icon icon="mdi:magnify" class="size-4" />
          <span>Search documentation…</span>
          <kbd>⌘K</kbd>
        </button>

        <RouterLink to="/home" class="dk__appLink">
          Open app
          <Icon icon="mdi:arrow-top-right" class="size-3.5" />
        </RouterLink>
      </div>
    </header>

    <!-- ── Three columns, centred as one block ───────────────────────────── -->
    <div class="dk__shell">
      <aside class="dk__nav" :class="{ 'is-open': mobileNavOpen }">
        <input
          v-model="navFilter"
          type="search"
          placeholder="Filter pages"
          aria-label="Filter pages"
          class="dk__filter"
        />
        <nav>
          <div v-for="group in visibleGroups" :key="group.category" class="dk__group">
            <div class="dk__groupLabel">{{ group.category }}</div>
            <RouterLink
              v-for="p in group.pages"
              :key="p.slug"
              :to="`/docs/${p.slug}`"
              class="dk__navLink"
              :class="{ 'is-active': p.slug === slug }"
            >{{ p.title }}</RouterLink>
          </div>
          <p v-if="!visibleGroups.length" class="dk__navEmpty">No pages match.</p>
        </nav>
      </aside>

      <main class="dk__main">
        <!-- Rendered for the whole lifetime of a page route, loading included.
             Appearing only once the fetch returned pushed the article down on
             every navigation, which read as the page jumping. -->
        <nav v-if="slug" class="dk__crumbs">
          <template v-for="(crumb, i) in crumbs" :key="i">
            <RouterLink v-if="crumb.to" :to="crumb.to">{{ crumb.label }}</RouterLink>
            <span v-else>{{ crumb.label }}</span>
            <span v-if="i < crumbs.length - 1" class="dk__crumbSep">/</span>
          </template>
        </nav>

        <div v-if="loading" class="dk__prose">
          <Skeleton class="h-9 w-2/3 rounded mb-5" />
          <Skeleton class="h-4 w-full rounded mb-2" />
          <Skeleton class="h-4 w-5/6 rounded mb-6" />
          <Skeleton class="h-40 w-full rounded-xl" />
        </div>

        <div v-else-if="error === 'auth'" class="dk__prose">
          <h1>This page is internal</h1>
          <p>Sign in to read it, or browse the public documentation in the sidebar.</p>
          <p><RouterLink to="/login">Sign in →</RouterLink></p>
        </div>

        <div v-else-if="error" class="dk__prose">
          <h1>No such page</h1>
          <p>Nothing is published at this address.</p>
          <p><RouterLink to="/docs">All documentation →</RouterLink></p>
        </div>

        <!-- The index is generated rather than written, so adding a markdown
             file publishes a page with no second place to update. -->
        <div v-else-if="!slug" class="dk__prose">
          <h1>Documentation</h1>
          <p class="lede">Guides for building against the Cino API, and reference for the people who work on it.</p>
          <template v-for="group in groups" :key="group.category">
            <h2>{{ group.category }}</h2>
            <ul class="dk__cards">
              <li v-for="p in group.pages" :key="p.slug">
                <RouterLink :to="`/docs/${p.slug}`">
                  <span class="dk__cardTitle">{{ p.title }}</span>
                  <span class="dk__cardSlug">/docs/{{ p.slug }}</span>
                </RouterLink>
              </li>
            </ul>
          </template>
        </div>

        <template v-else>
          <article class="dk__prose" @click="onContentClick" v-html="html" />

          <nav v-if="around.prev || around.next" class="dk__pager">
            <RouterLink v-if="around.prev" :to="`/docs/${around.prev.slug}`" class="dk__pagerLink">
              <span class="dk__pagerDir">← Previous</span>
              <span class="dk__pagerTitle">{{ around.prev.title }}</span>
            </RouterLink>
            <span v-else />
            <RouterLink v-if="around.next" :to="`/docs/${around.next.slug}`" class="dk__pagerLink is-next">
              <span class="dk__pagerDir">Next →</span>
              <span class="dk__pagerTitle">{{ around.next.title }}</span>
            </RouterLink>
          </nav>
        </template>
      </main>

      <aside class="dk__toc">
        <div v-if="headings.length" class="dk__tocInner">
          <div class="dk__tocLabel">On this page</div>
          <a
            v-for="h in headings"
            :key="h.id"
            :href="`#${h.id}`"
            :class="{ 'is-active': h.id === activeId }"
            v-html="h.text"
          />
        </div>
      </aside>
    </div>

    <DocsSearch :open="searchOpen" @close="searchOpen = false" />
  </div>
</template>

<style scoped>
.dk { min-height: 100vh; background: oklch(var(--background)); color: oklch(var(--foreground)); }

/* ── Top bar ───────────────────────────────────────────────────────────── */
.dk__bar {
  position: sticky; top: 0; z-index: 40;
  border-bottom: 1px solid oklch(var(--border));
  background: color-mix(in oklab, oklch(var(--background)) 85%, transparent);
  backdrop-filter: blur(8px);
}
.dk__barInner {
  max-width: 1440px; margin: 0 auto;
  height: 56px; padding: 0 24px;
  display: flex; align-items: center; gap: 16px;
}

.dk__burger {
  display: none; border: 0; background: transparent;
  color: oklch(var(--muted-foreground)); cursor: pointer; padding: 4px;
}

.dk__brand {
  display: flex; align-items: center; gap: 7px;
  font-size: 14px; font-weight: 620; color: oklch(var(--foreground)); text-decoration: none;
  flex: none;
}
.dk__brandSub {
  font-weight: 450; color: oklch(var(--muted-foreground));
  padding-left: 7px; border-left: 1px solid oklch(var(--border));
}

/* Sits in the middle of the bar, capped so it does not sprawl on a wide screen. */
.dk__search {
  margin-left: auto; margin-right: auto;
  display: flex; align-items: center; gap: 8px;
  width: 100%; max-width: 380px; height: 34px; padding: 0 10px;
  border: 1px solid oklch(var(--border)); border-radius: 9px;
  background: oklch(var(--muted)); color: oklch(var(--muted-foreground));
  font-size: 13px; cursor: pointer; text-align: left;
}
.dk__search:hover { border-color: oklch(var(--muted-foreground)); }
.dk__search span { flex: 1; }
.dk__search kbd {
  font-size: 10.5px; padding: 2px 5px; border-radius: 5px;
  border: 1px solid oklch(var(--border)); background: oklch(var(--background));
}

.dk__appLink {
  display: flex; align-items: center; gap: 4px; flex: none;
  font-size: 13px; color: oklch(var(--muted-foreground)); text-decoration: none;
}
.dk__appLink:hover { color: oklch(var(--foreground)); }

/* ── Shell: the whole three-column block is centred ────────────────────── */
.dk__shell {
  max-width: 1440px; margin: 0 auto;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 232px;
  gap: 40px;
  padding: 0 24px;
  align-items: start;
}

.dk__nav {
  position: sticky; top: 56px;
  max-height: calc(100vh - 56px); overflow-y: auto;
  padding: 28px 0 48px;
}
.dk__filter {
  width: 100%; height: 32px; margin-bottom: 4px;
  border: 1px solid oklch(var(--border)); border-radius: 8px;
  background: oklch(var(--background)); color: oklch(var(--foreground));
  padding: 0 10px; font-size: 13px;
}
.dk__filter:focus { outline: 2px solid oklch(var(--ring)); outline-offset: -1px; }

.dk__group { margin-top: 18px; }
.dk__groupLabel {
  font-size: 12px; font-weight: 620; color: oklch(var(--foreground));
  padding: 6px 10px;
}
.dk__navLink {
  display: block; padding: 5px 10px; font-size: 13.5px;
  color: oklch(var(--muted-foreground)); text-decoration: none;
  border-left: 2px solid oklch(var(--border)); margin-left: 10px;
}
.dk__navLink:hover { color: oklch(var(--foreground)); border-left-color: oklch(var(--muted-foreground)); }
.dk__navLink.is-active {
  color: oklch(var(--foreground)); font-weight: 550;
  border-left-color: oklch(var(--primary));
}
.dk__navEmpty { font-size: 13px; color: oklch(var(--muted-foreground)); padding: 12px 10px; }

/* The reading column. The measure is the point of a docs page — long lines are
   what makes reference material tiring — so it is capped and centred in the
   space between the two rails. */
.dk__main { padding: 40px 0 96px; min-width: 0; }
.dk__prose { max-width: 46rem; margin: 0 auto; }

/* ── Breadcrumbs ───────────────────────────────────────────────────────── */
.dk__crumbs {
  max-width: 46rem; margin: 0 auto 14px;
  /* Reserved whether or not there is anything in it yet, so the article below
     never moves between the loading and loaded states. */
  min-height: 19px;
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  font-size: 12.5px; color: oklch(var(--muted-foreground));
}
.dk__crumbs a { color: oklch(var(--muted-foreground)); text-decoration: none; }
.dk__crumbs a:hover { color: oklch(var(--foreground)); }
.dk__crumbSep { opacity: 0.5; }

/* ── Pager ─────────────────────────────────────────────────────────────── */
.dk__pager {
  max-width: 46rem; margin: 56px auto 0;
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}
.dk__pagerLink {
  display: flex; flex-direction: column; gap: 3px;
  border: 1px solid oklch(var(--border)); border-radius: 11px; padding: 14px 16px;
  text-decoration: none;
}
.dk__pagerLink:hover { border-color: oklch(var(--muted-foreground)); }
.dk__pagerLink.is-next { text-align: right; }
.dk__pagerDir { font-size: 12px; color: oklch(var(--muted-foreground)); }
.dk__pagerTitle { font-size: 14px; font-weight: 550; color: oklch(var(--foreground)); }

/* ── On this page ──────────────────────────────────────────────────────── */
.dk__toc {
  position: sticky; top: 56px;
  max-height: calc(100vh - 56px); overflow-y: auto;
  padding: 40px 0 48px;
}
.dk__tocLabel {
  font-size: 12px; font-weight: 620; color: oklch(var(--foreground)); margin-bottom: 8px;
}
.dk__toc a {
  display: block; padding: 4px 0 4px 10px; font-size: 12.5px; line-height: 1.5;
  color: oklch(var(--muted-foreground)); text-decoration: none;
  border-left: 2px solid oklch(var(--border));
}
.dk__toc a:hover { color: oklch(var(--foreground)); }
.dk__toc a.is-active { color: oklch(var(--primary)); border-left-color: oklch(var(--primary)); }

/* ── Index cards ───────────────────────────────────────────────────────── */
.dk__cards { list-style: none; padding: 0; display: grid; gap: 8px; }
.dk__cards a {
  display: flex; flex-direction: column; gap: 2px;
  border: 1px solid oklch(var(--border)); border-radius: 11px; padding: 14px 16px;
  text-decoration: none;
}
.dk__cards a:hover { border-color: oklch(var(--muted-foreground)); }
.dk__cardTitle { font-weight: 560; color: oklch(var(--foreground)); }
.dk__cardSlug { font-size: 12px; color: oklch(var(--muted-foreground)); font-family: ui-monospace, monospace; }

/* ── Responsive ────────────────────────────────────────────────────────── */
@media (max-width: 1200px) {
  /* The contents rail goes first: it is a convenience, while the page list is
     the only way to get anywhere. */
  .dk__shell { grid-template-columns: 240px minmax(0, 1fr); }
  .dk__toc { display: none; }
}

@media (max-width: 860px) {
  .dk__shell { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .dk__burger { display: block; }
  .dk__brandSub { display: none; }
  .dk__search span { display: none; }
  .dk__search { max-width: none; margin-left: auto; margin-right: 0; width: auto; }
  .dk__appLink { display: none; }

  .dk__nav {
    display: none; position: static; max-height: none;
    padding: 16px 0; border-bottom: 1px solid oklch(var(--border));
  }
  .dk__nav.is-open { display: block; }
  .dk__main { padding: 24px 0 64px; }
  .dk__pager { grid-template-columns: 1fr; }
}
</style>

<!-- Unscoped: the prose is set with v-html, so scoped attributes never reach it. -->
<style>
.dk__prose { color: oklch(var(--foreground)); font-size: 15.5px; line-height: 1.75; }

/* Tables, diagrams and code may break the measure; prose may not. */
.dk__prose > .wide { max-width: min(58rem, 100%); }

.dk__prose h1 { font-size: 34px; font-weight: 680; letter-spacing: -0.025em; margin: 0 0 14px; line-height: 1.2; }
.dk__prose h2 {
  font-size: 22px; font-weight: 640; letter-spacing: -0.015em;
  margin: 48px 0 14px; padding-top: 20px; border-top: 1px solid oklch(var(--border));
  scroll-margin-top: 80px;
}
.dk__prose h3 { font-size: 17px; font-weight: 620; margin: 30px 0 8px; scroll-margin-top: 80px; }
.dk__prose h1 + p, .dk__prose .lede { color: oklch(var(--muted-foreground)); font-size: 17px; line-height: 1.65; }

.dk__prose p, .dk__prose ul, .dk__prose ol { margin: 0 0 18px; }
.dk__prose li { margin: 6px 0; }
.dk__prose a { color: oklch(var(--primary)); text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
.dk__prose a:hover { text-decoration-thickness: 2px; }
.dk__prose strong { font-weight: 640; color: oklch(var(--foreground)); }
.dk__prose hr { border: 0; border-top: 1px solid oklch(var(--border)); margin: 36px 0; }

.dk__prose blockquote {
  margin: 0 0 18px; padding: 14px 18px;
  border: 1px solid oklch(var(--border)); border-left: 3px solid oklch(var(--primary));
  border-radius: 0 10px 10px 0; background: oklch(var(--muted));
}
.dk__prose blockquote p:last-child { margin-bottom: 0; }

/* Anchors sit in the gutter and appear on hover, so they never shift a heading. */
.dk__prose .hanchor {
  float: left; margin-left: -0.85em; padding-right: 0.25em;
  color: oklch(var(--muted-foreground)); text-decoration: none; opacity: 0;
}
.dk__prose h2:hover .hanchor, .dk__prose h3:hover .hanchor { opacity: 0.5; }

.dk__prose :not(pre) > code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875em; padding: 0.15em 0.4em; border-radius: 5px;
  background: oklch(var(--muted)); border: 1px solid oklch(var(--border));
}

.dk__prose .codeblock {
  margin: 0 0 22px; border: 1px solid oklch(var(--border)); border-radius: 12px;
  overflow: hidden; background: oklch(var(--muted));
}
.dk__prose .codeblock__bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 10px 7px 14px; border-bottom: 1px solid oklch(var(--border));
}
.dk__prose .codeblock__lang {
  font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
  color: oklch(var(--muted-foreground));
}
.dk__prose .codeblock__copy {
  font-size: 11.5px; padding: 3px 9px; border-radius: 6px;
  border: 1px solid oklch(var(--border)); background: oklch(var(--background));
  color: oklch(var(--muted-foreground)); cursor: pointer;
}
.dk__prose .codeblock__copy:hover { color: oklch(var(--foreground)); }
.dk__prose .codeblock pre { margin: 0; padding: 15px 16px; overflow-x: auto; }
.dk__prose .codeblock code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px; line-height: 1.7;
}

/* ── Diagrams ──────────────────────────────────────────────────────────────
   Authored as inline SVG in the markdown, styled from here so they follow the
   theme in both modes. No diagram library is involved at any point: nothing to
   load in the browser, nothing to run at build time, and no dependency whose
   advisories a public docs page would inherit. */
.dk__prose .diagram {
  margin: 0 0 24px; padding: 18px 20px;
  border: 1px solid oklch(var(--border)); border-radius: 12px;
  background: oklch(var(--muted) / 0.5);
}
.dk__prose .diagram svg { display: block; width: 100%; height: auto; }

.dk__prose .d-box {
  fill: oklch(var(--background));
  stroke: oklch(var(--border));
  stroke-width: 1.5;
}
.dk__prose .d-box--wide { fill: oklch(var(--card)); }
.dk__prose .d-box--accent {
  fill: oklch(var(--primary) / 0.08);
  stroke: oklch(var(--primary) / 0.45);
}

/* Timeline bars: a filled pill reads as a span of time, where an outlined box
   reads as a thing. */
.dk__prose .d-bar { fill: oklch(var(--muted-foreground) / 0.22); stroke: none; }
.dk__prose .d-bar--accent { fill: oklch(var(--primary) / 0.3); }
.dk__prose .d-bar-label {
  fill: oklch(var(--foreground));
  font: 550 12.5px ui-sans-serif, system-ui, sans-serif;
}
/* The highlighted span behind a pair of bars. */
.dk__prose .d-span { fill: oklch(var(--primary) / 0.09); stroke: none; }

.dk__prose .d-line { stroke: oklch(var(--muted-foreground)); stroke-width: 1.5; fill: none; }
.dk__prose .d-line--accent { stroke: oklch(var(--primary)); }
.dk__prose .d-line--dashed { stroke-dasharray: 4 4; }
.dk__prose .d-arrow { fill: oklch(var(--muted-foreground)); }
.dk__prose .d-line--accent + text, .dk__prose .d-accent { fill: oklch(var(--primary)); }

.dk__prose .d-text {
  fill: oklch(var(--foreground));
  font: 550 14px ui-sans-serif, system-ui, sans-serif;
}
.dk__prose .d-label {
  fill: oklch(var(--muted-foreground));
  font: 620 11px ui-sans-serif, system-ui, sans-serif;
  letter-spacing: .07em; text-transform: uppercase;
}
.dk__prose .d-step {
  fill: oklch(var(--foreground));
  font: 400 13px ui-monospace, SFMono-Regular, Menlo, monospace;
}
.dk__prose .d-sub {
  fill: oklch(var(--muted-foreground));
  font: 500 11.5px ui-sans-serif, system-ui, sans-serif;
}

/* Row separators only — a full grid turns a reference table into graph paper. */
.dk__prose .tablewrap { margin: 0 0 22px; overflow-x: auto; border: 1px solid oklch(var(--border)); border-radius: 12px; }
.dk__prose table { border-collapse: collapse; width: 100%; font-size: 14px; }
.dk__prose thead th {
  position: sticky; top: 0; background: oklch(var(--muted));
  text-align: left; font-weight: 620; font-size: 12.5px;
  padding: 10px 14px; border-bottom: 1px solid oklch(var(--border)); white-space: nowrap;
}
.dk__prose tbody td { padding: 10px 14px; border-top: 1px solid oklch(var(--border)); vertical-align: top; }
.dk__prose tbody tr:first-child td { border-top: 0; }

.dk__prose .hljs-comment, .dk__prose .hljs-quote { color: oklch(var(--muted-foreground)); font-style: italic; }
.dk__prose .hljs-keyword, .dk__prose .hljs-literal, .dk__prose .hljs-built_in { color: oklch(58% 0.17 295); }
.dk__prose .hljs-string, .dk__prose .hljs-regexp { color: oklch(55% 0.14 150); }
.dk__prose .hljs-number { color: oklch(58% 0.15 45); }
.dk__prose .hljs-title, .dk__prose .hljs-title.function_ { color: oklch(55% 0.16 250); }
.dk__prose .hljs-attr, .dk__prose .hljs-property { color: oklch(55% 0.13 220); }
.dk__prose .hljs-type, .dk__prose .hljs-class { color: oklch(58% 0.13 200); }
</style>
