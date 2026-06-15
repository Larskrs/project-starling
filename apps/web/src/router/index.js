import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',         redirect: '/chat' },
    { path: '/login',    component: () => import('../views/LoginView.vue') },
    { path: '/register', component: () => import('../views/RegisterView.vue') },
    { path: '/chat',     component: () => import('../views/ChatView.vue'), meta: { requiresAuth: true } },
  ],
})

// Auth guard — single /api/auth/me check per navigation
router.beforeEach(async (to) => {
  const needsAuth  = to.meta.requiresAuth
  const isAuthPage = to.path === '/login' || to.path === '/register'

  if (!needsAuth && !isAuthPage) return true

  const res = await fetch('/api/auth/me', { credentials: 'include' }).catch(() => null)
  const ok  = res?.ok ?? false

  if (needsAuth  && !ok) return '/login'
  if (isAuthPage &&  ok) return '/chat'
  return true
})

export default router
