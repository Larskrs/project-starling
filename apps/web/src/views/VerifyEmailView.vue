<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Spinner } from '@starling/ui'
import Button from '@starling/ui/Button'

/**
 * Where a "confirm your address" link lands.
 *
 * Reachable without a session on purpose: mail gets opened on a phone while the
 * account is signed in on a laptop, and a link that only works in one of those
 * places fails half the time. The token in the URL is the proof.
 *
 * It POSTs on mount rather than offering a button — the person already clicked
 * the button, in their email client.
 */

const route  = useRoute()
const router = useRouter()

const loading = ref(true)
const email   = ref('')
const reason  = ref('')

onMounted(async () => {
  const token = String(route.params.token ?? '')
  const res = await fetch(`/api/verify-email/${encodeURIComponent(token)}`, {
    method: 'POST', credentials: 'include',
  }).catch(() => null)

  loading.value = false

  if (!res?.ok) {
    const body = await res?.json().catch(() => null)
    reason.value = body?.data?.reason ?? 'notFound'
    return
  }

  email.value = (await res.json()).email
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-6 py-12">
    <div class="w-full max-w-md">

      <div v-if="loading" class="flex justify-center py-16">
        <Spinner />
      </div>

      <div v-else class="rounded-xl border border-border bg-card p-8 text-center">
        <template v-if="email">
          <Icon icon="mdi:check-circle-outline" class="mx-auto size-12 text-primary" aria-hidden="true" />
          <h1 class="mt-4 text-xl font-semibold tracking-tight">{{ $t('verifyEmail.done.title') }}</h1>
          <p class="mt-2 text-sm text-muted-foreground">{{ $t('verifyEmail.done.body', { email }) }}</p>
        </template>

        <template v-else>
          <Icon icon="mdi:alert-circle-outline" class="mx-auto size-12 text-muted-foreground" aria-hidden="true" />
          <h1 class="mt-4 text-xl font-semibold tracking-tight">{{ $t(`verifyEmail.rejected.${reason}.title`) }}</h1>
          <p class="mt-2 text-sm text-muted-foreground">{{ $t(`verifyEmail.rejected.${reason}.body`) }}</p>
        </template>

        <Button class="mt-6 w-full" @click="router.push('/settings')">{{ $t('verifyEmail.goToSettings') }}</Button>
      </div>

    </div>
  </div>
</template>
