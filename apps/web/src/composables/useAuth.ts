import { useRouter } from 'vue-router'
import { useAuth as _useAuth } from '@starling/auth'

export function useAuth() {
  const router = useRouter()
  const auth   = _useAuth()

  async function login(email: string, password: string): Promise<void> {
    await auth.login(email, password)
    await router.push('/home')
  }

  async function register(
    email: string, first_name: string, last_name: string, password: string,
  ): Promise<void> {
    await auth.register(email, first_name, last_name, password)
    await router.push('/home')
  }

  async function logout(): Promise<void> {
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
