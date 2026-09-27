<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Spinner } from '@starling/ui'
import Button from '@starling/ui/Button'

/**
 * Where an invite link lands, signed in or not.
 *
 * The token in the URL is the credential, so this page is reachable without a
 * session — that is the whole point. It shows what the invite grants, then
 * either redeems it (already signed in) or sends the visitor to register/login
 * carrying the token so the account they create joins the production.
 */

const route  = useRoute()
const router = useRouter()
const { t }  = useI18n()

const token = computed(() => String(route.params.token ?? ''))

const loading  = ref(true)
const invite   = ref(null)
const reason   = ref('')
const joining  = ref(false)
const signedIn = ref(false)

/** Initials, matching the monogram the invite email draws. */
const initials = computed(() => {
  const name = invite.value?.production?.name ?? ''
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0] ?? '').join('').toUpperCase() || '?'
})

/** Stable hue per production, the same derivation the email uses. */
const hue = computed(() => {
  const name = invite.value?.production?.name ?? ''
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360
  return hash
})

const expiresInMinutes = computed(() => {
  if (!invite.value?.expiresAt) return null
  return Math.max(0, Math.round((new Date(invite.value.expiresAt) - Date.now()) / 60000))
})

const registerTo = computed(() => ({
  path:  '/register',
  query: { invite: token.value, ...(invite.value?.email ? { email: invite.value.email } : {}) },
}))
const loginTo = computed(() => ({ path: '/login', query: { invite: token.value } }))

onMounted(async () => {
  // Asked directly rather than through the auth store: this route is reachable
  // signed out, so there may be nothing loaded yet.
  const me = await fetch('/api/auth/me', { credentials: 'include' }).catch(() => null)
  signedIn.value = me?.ok ?? false

  const res = await fetch(`/api/invites/${encodeURIComponent(token.value)}`, { credentials: 'include' })
    .catch(() => null)

  loading.value = false

  if (!res?.ok) {
    const body = await res?.json().catch(() => null)
    reason.value = body?.data?.reason ?? 'notFound'
    return
  }

  invite.value = await res.json()
})

async function join() {
  joining.value = true
  const res = await fetch(`/api/invites/${encodeURIComponent(token.value)}/accept`, {
    method: 'POST', credentials: 'include',
  }).catch(() => null)
  joining.value = false

  if (!res?.ok) {
    const body = await res?.json().catch(() => null)
    reason.value = body?.data?.reason ?? 'notFound'
    invite.value = null
    return
  }

  const data = await res.json()
  await router.push(data.path)
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-6 py-12">
    <div class="w-full max-w-md">

      <div v-if="loading" class="flex justify-center py-16">
        <Spinner />
      </div>

      <!-- Nothing to accept: expired, revoked, used up, or never existed. -->
      <div v-else-if="!invite" class="rounded-xl border border-border bg-card p-8 text-center">
        <h1 class="text-xl font-semibold tracking-tight">{{ $t(`invite.rejected.${reason}.title`) }}</h1>
        <p class="mt-2 text-sm text-muted-foreground">{{ $t(`invite.rejected.${reason}.body`) }}</p>
        <Button class="mt-6 w-full" @click="router.push('/')">{{ $t('invite.goHome') }}</Button>
      </div>

      <div v-else class="rounded-xl border border-border bg-card p-8 text-center">
        <div
          class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold text-white"
          :style="{ backgroundColor: `hsl(${hue} 62% 52%)` }"
        >{{ initials }}</div>

        <h1 class="mt-5 text-xl font-semibold leading-snug tracking-tight">
          {{ invite.inviterName
            ? $t('invite.headingFrom', { inviter: invite.inviterName, company: invite.company.name, production: invite.production.name })
            : $t('invite.heading', { production: invite.production.name }) }}
        </h1>

        <p v-if="invite.roleName" class="mt-2 text-sm text-muted-foreground">
          {{ $t('invite.asRole', { role: invite.roleName }) }}
        </p>

        <!-- Signed in: one click, done. -->
        <template v-if="signedIn">
          <Button class="mt-6 w-full" :disabled="joining" @click="join">
            {{ joining ? $t('invite.joining') : invite.alreadyMember ? $t('invite.open') : $t('invite.join') }}
          </Button>
        </template>

        <!-- Signed out: the account they make carries the token through. -->
        <template v-else>
          <Button class="mt-6 w-full" @click="router.push(registerTo)">{{ $t('invite.createAccount') }}</Button>
          <button
            class="mt-3 w-full text-sm text-muted-foreground hover:text-foreground"
            @click="router.push(loginTo)"
          >{{ $t('invite.haveAccount') }}</button>
        </template>

        <p v-if="expiresInMinutes !== null && !invite.alreadyMember" class="mt-5 text-xs text-muted-foreground">
          {{ expiresInMinutes > 90
            ? $t('invite.expiresInHours', { hours: Math.round(expiresInMinutes / 60) })
            : $t('invite.expiresInMinutes', { minutes: expiresInMinutes }) }}
        </p>
      </div>

    </div>
  </div>
</template>
