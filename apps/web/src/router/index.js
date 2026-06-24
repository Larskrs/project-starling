import { createRouter, createWebHistory } from 'vue-router'
import DefaultLayout from '../layouts/DefaultLayout.vue'
import AuthLayout    from '../layouts/AuthLayout.vue'
import EmptyLayout   from '../layouts/EmptyLayout.vue'

const router = createRouter({
  history: createWebHistory('/'),
  routes: [
    { path: '/',         redirect: '/home' },
    { path: '/login',    component: () => import('../views/LoginView.vue'),     meta: { layout: AuthLayout } },
    { path: '/register', component: () => import('../views/RegisterView.vue'),  meta: { layout: AuthLayout } },
    { path: '/chat',     component: () => import('../views/Chat/index.vue'),    meta: { requiresAuth: true, layout: EmptyLayout } },
    { path: '/home',     component: () => import('../views/Home/index.vue'),    meta: { requiresAuth: true, layout: DefaultLayout } },
    { path: '/c',        component: () => import('../views/Companies/index.vue'), meta: { requiresAuth: true, layout: DefaultLayout } },
    { path: '/c/:slug',  component: () => import('../views/Company/index.vue'), meta: { requiresAuth: true, layout: DefaultLayout } },

    {
      path:      '/c/:cslug/p/:pslug',
      component: () => import('../views/Production/index.vue'),
      meta:      { requiresAuth: true, layout: EmptyLayout },
      redirect:  to => ({ path: `/c/${to.params.cslug}/p/${to.params.pslug}/files` }),
      children: [
        { path: 'files',    component: () => import('../views/Production/FilesView.vue') },
        { path: 'settings', component: () => import('../views/Production/SettingsView.vue') },
        { path: 'members',  component: () => import('../views/Production/MembersView.vue') },
        { path: 'roles',    component: () => import('../views/Production/RolesView.vue') },
      ],
    },

    { path: '/:pathMatch(.*)*', component: () => import('../views/NotFoundView.vue'), meta: { layout: EmptyLayout } },
  ],
})

router.beforeEach(async (to) => {
  const needsAuth  = to.meta.requiresAuth
  const isAuthPage = to.path === '/login' || to.path === '/register'

  if (!needsAuth && !isAuthPage) return true

  const res = await fetch('/api/auth/me', { credentials: 'include' }).catch(() => null)
  const ok  = res?.ok ?? false

  if (needsAuth  && !ok) return '/login'
  if (isAuthPage &&  ok) return '/home'
  return true
})

export default router
