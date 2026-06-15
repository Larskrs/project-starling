import { useRouter } from 'vue-router'
import { useAuth as _useAuth } from '@starling/auth'

export function useAuth() {
  const router = useRouter()
  const auth   = _useAuth()

  async function login(email, password) {
    await auth.login(email, password)
    await router.push('/chat')
  }
  
  async function register(email, name, password) {
    await auth.register(email, name, password)
    await router.push('/chat')
  }

  async function logout() {
    await auth.logout()
    await router.push('/login')
  }

  return {
    user:      auth.user,
    session:   auth.session,
    login,
    register,
    logout,
    fetchUser: auth.fetchUser,
  }
}
