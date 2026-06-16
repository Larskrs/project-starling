import { createRouter, createWebHistory } from 'vue-router'
import DefaultLayout from '../layouts/DefaultLayout.vue'
import AuthLayout from '../layouts/AuthLayout.vue'

const router = createRouter({
  history: createWebHistory('/app'),
  routes: [
    { path: '/',         redirect: '/chat' },
    { path: '/login',    component: () => import('../views/LoginView.vue'),  meta: { layout: AuthLayout } },
    { path: '/register', component: () => import('../views/RegisterView.vue'), meta: { layout: AuthLayout } },
    { path: '/chat',     component: () => import('../views/ChatView.vue'),   meta: { requiresAuth: true, layout: DefaultLayout } },
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
