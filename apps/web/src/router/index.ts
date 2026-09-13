import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import DefaultLayout from '../layouts/DefaultLayout.vue'
import AuthLayout    from '../layouts/AuthLayout.vue'
import EmptyLayout   from '../layouts/EmptyLayout.vue'
import { useTimelineOpening } from '../composables/useTimelineOpening'

const { startOpening, finishOpening } = useTimelineOpening()

const EDITOR_ROUTE = 'timeline-editor'
const isEditorRoute = (route: RouteLocationNormalized): boolean =>
  route.matched.some(r => r.name === EDITOR_ROUTE)

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    // The root IS the pitch: a signed-out visitor lands on the welcome page at
    // "/" rather than being bounced to a second URL. `guestOnly` sends anyone
    // with a session straight on to their home page.
    { path: '/',         component: () => import('../views/Welcome/index.vue'), meta: { guestOnly: true, layout: EmptyLayout, title: 'Welcome' } },
    { path: '/login',    component: () => import('../views/LoginView.vue'),     meta: { layout: AuthLayout,   title: 'Login' } },
    { path: '/register', component: () => import('../views/RegisterView.vue'),  meta: { layout: AuthLayout,   title: 'Register' } },
    { path: '/chat',     component: () => import('../views/Chat/index.vue'),    meta: { requiresAuth: true, layout: EmptyLayout,   title: 'Chat' } },
    // Kept for links minted while the pitch lived at its own URL.
    { path: '/welcome',  redirect: '/' },
    // Public by default: the integration guide is written for third parties
    // who have no account yet, and the API refuses the internal pages to a
    // signed-out reader on its own. No requiresAuth here on purpose.
    { path: '/docs/:path(.*)*', component: () => import('../views/Docs/index.vue'), meta: { layout: EmptyLayout, title: 'Documentation' } },
    // Signed-out visitors landing on the home page get the product pitch rather
    // than a login form — every other protected route still routes to /login.
    { path: '/home',       component: () => import('../views/Home/index.vue'),             meta: { requiresAuth: true, guestRedirect: '/', layout: DefaultLayout, title: 'Home' } },
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
        { path: 'integrations',           component: () => import('../views/Production/IntegrationsView.vue') },
        { path: 'timelines',              component: () => import('../views/Production/TimelinesView.vue') },
        { path: 'track-types',            component: () => import('../views/Production/TrackTypesView.vue') },
        { path: 'source-sets',            component: () => import('../views/Production/SourceSetsView.vue') },
        { path: 'source-sets/:setId',     component: () => import('../views/Production/SourceSetDetailView.vue') },
      ],
    },

    {
      path:      '/c/:cslug/p/:pslug/editor/:tlId',
      name:      'timeline-editor',
      component: () => import('../views/TimelineEditor/index.vue'),
      meta:      { requiresAuth: true, layout: EmptyLayout },
    },

    { path: '/debug', component: () => import('../views/Debug/index.vue'), meta: { layout: DefaultLayout, title: 'Debug' } },

    { path: '/:pathMatch(.*)*', component: () => import('../views/NotFoundView.vue'), meta: { layout: EmptyLayout } },
  ],
})

router.beforeEach(async (to) => {
  // Before the auth fetch, not after: everything from here to the editor
  // having its data is wait the user should see covered.
  // Repeated params arrive as an array; the editor route only ever has one.
  const tlId = Array.isArray(to.params.tlId) ? to.params.tlId[0] : to.params.tlId
  if (isEditorRoute(to) && tlId) startOpening({ id: tlId })

  const needsAuth  = to.meta.requiresAuth
  // Pages only a signed-out visitor should see — a session sends them home.
  const guestOnly  = to.meta.guestOnly || to.path === '/login' || to.path === '/register'

  if (!needsAuth && !guestOnly) return true

  const res = await fetch('/api/auth/me', { credentials: 'include' }).catch(() => null)
  const ok  = res?.ok ?? false

  if (needsAuth && !ok) return to.meta.guestRedirect ?? '/login'
  if (guestOnly &&  ok) return '/home'

  if (to.meta.requiresCompanyAdmin) {
    const slug        = to.params.slug
    const companyRes  = await fetch(`/api/companies/${slug}`, { credentials: 'include' }).catch(() => null)
    const company     = companyRes?.ok ? await companyRes.json() : null
    if (!company?.canManage) return `/c/${slug}`
  }

  return true
})

router.afterEach((to) => {
  // A guard redirect or a back button mid-load leaves the screen with nothing
  // to wait for; the editor itself clears it on the happy path.
  if (!isEditorRoute(to)) finishOpening()

  const title = to.meta.title
  if (title) document.title = `${title} — Cino`
})

// A failed navigation (chunk fetch error, aborted guard) must not strand the
// loading screen over a page the user can still use.
router.onError(finishOpening)

export default router
