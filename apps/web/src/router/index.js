import { createRouter, createWebHistory } from 'vue-router'
import DefaultLayout from '../layouts/DefaultLayout.vue'
import AuthLayout    from '../layouts/AuthLayout.vue'
import EmptyLayout   from '../layouts/EmptyLayout.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/',         redirect: '/home' },
    { path: '/login',    component: () => import('../views/LoginView.vue'),     meta: { layout: AuthLayout,   title: 'Login' } },
    { path: '/register', component: () => import('../views/RegisterView.vue'),  meta: { layout: AuthLayout,   title: 'Register' } },
    { path: '/chat',     component: () => import('../views/Chat/index.vue'),    meta: { requiresAuth: true, layout: EmptyLayout,   title: 'Chat' } },
    { path: '/home',       component: () => import('../views/Home/index.vue'),             meta: { requiresAuth: true, layout: DefaultLayout, title: 'Home' } },
    { path: '/settings',   component: () => import('../views/Settings/index.vue'),         meta: { requiresAuth: true, layout: DefaultLayout, title: 'Settings' } },
    { path: '/c/:slug',    component: () => import('../views/Company/index.vue'),           meta: { requiresAuth: true, layout: DefaultLayout } },
    { path: '/c/:slug/settings', component: () => import('../views/Company/SettingsView.vue'), meta: { requiresAuth: true, requiresCompanyAdmin: true, layout: DefaultLayout } },

    {
      path:      '/c/:cslug/p/:pslug',
      component: () => import('../views/Production/index.vue'),
      meta:      { requiresAuth: true, layout: EmptyLayout },
      redirect:  to => ({ path: `/c/${to.params.cslug}/p/${to.params.pslug}/dashboard` }),
      children: [
        { path: 'dashboard',              component: () => import('../views/Production/DashboardView.vue') },
        { path: 'files',                  component: () => import('../views/Production/FilesView.vue') },
        { path: 'settings',               component: () => import('../views/Production/SettingsView.vue') },
        { path: 'members',                component: () => import('../views/Production/MembersView.vue') },
        { path: 'roles',                  component: () => import('../views/Production/RolesView.vue') },
        { path: 'timelines',              component: () => import('../views/Production/TimelinesView.vue') },
        { path: 'track-types',            component: () => import('../views/Production/TrackTypesView.vue') },
        { path: 'source-sets',            component: () => import('../views/Production/SourceSetsView.vue') },
        { path: 'source-sets/:setId',     component: () => import('../views/Production/SourceSetDetailView.vue') },
      ],
    },

    {
      path:      '/c/:cslug/p/:pslug/editor/:tlId',
      component: () => import('../views/TimelineEditor/index.vue'),
      meta:      { requiresAuth: true, layout: EmptyLayout },
    },

    { path: '/debug', component: () => import('../views/Debug/index.vue'), meta: { layout: DefaultLayout, title: 'Debug' } },

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

  if (to.meta.requiresCompanyAdmin) {
    const slug        = to.params.slug
    const companyRes  = await fetch(`/api/companies/${slug}`, { credentials: 'include' }).catch(() => null)
    const company     = companyRes?.ok ? await companyRes.json() : null
    if (!company?.canManage) return `/c/${slug}`
  }

  return true
})

router.afterEach((to) => {
  const title = to.meta.title
  if (title) document.title = `${title} — Cino`
})

export default router
