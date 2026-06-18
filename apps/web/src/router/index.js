import { createRouter, createWebHistory } from 'vue-router'
import DefaultLayout from '../layouts/DefaultLayout.vue'
import AuthLayout from '../layouts/AuthLayout.vue'
import EmptyLayout from '../layouts/EmptyLayout.vue'
import { apiFetch } from '../lib/api'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/',         redirect: '/chat' },
    { path: '/login',    component: () => import('../views/LoginView.vue'),  meta: { layout: AuthLayout } },
    { path: '/register', component: () => import('../views/RegisterView.vue'), meta: { layout: AuthLayout } },
    { path: '/chat',     component: () => import('../views/Chat/index.vue'),   meta: { requiresAuth: true, layout: EmptyLayout } },
    { path: '/home',      component: () => import('../views/Home/index.vue'),      meta: { requiresAuth: true, layout: DefaultLayout } },
    { path: '/c', component: () => import('../views/Companies/index.vue'), meta: { requiresAuth: true, layout: DefaultLayout } },
    { path: '/c/:slug',   component: () => import('../views/Company/index.vue'),   meta: { requiresAuth: true, layout: DefaultLayout } }
  ],
})

// Auth guard — single /api/au th/me check per navigation
router.beforeEach(async (to) => {
  const needsAuth  = to.meta.requiresAuth
  const isAuthPage = to.path === '/login' || to.path === '/register'

  if (!needsAuth && !isAuthPage) return true

  const res = await apiFetch('/api/auth/me', { credentials: 'include' }).catch(() => null)
  const ok  = res?.ok ?? false

  if (needsAuth  && !ok) return '/login'
  if (isAuthPage &&  ok) return '/home'
  return true
})

export default router
