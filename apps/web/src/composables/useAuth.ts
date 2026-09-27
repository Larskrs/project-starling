import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useToast } from '@starling/ui/useToast'
import { useAuth as _useAuth, type InviteOutcome } from '@starling/auth'

export function useAuth() {
  const router = useRouter()
  const auth   = _useAuth()
  const toast  = useToast()
  const { t }  = useI18n()

  /**
   * Someone arriving from an invite link lands on the production they were
   * invited to, not on /home — being dropped somewhere generic after following
   * an invitation reads as "it didn't work".
   *
   * A rejected invite still leaves them signed in, so it is reported as a toast
   * that outlives the redirect rather than an error on a form they have left.
   */
  async function landAfterAuth(outcome: InviteOutcome | null): Promise<void> {
    if (outcome && !outcome.accepted) {
      toast.error(t(`errors.invite.${outcome.reason ?? 'notFound'}`))
    }
    await router.push(outcome?.accepted && outcome.path ? outcome.path : '/home')
  }

  async function login(email: string, password: string, invite?: string): Promise<InviteOutcome | null> {
    const outcome = await auth.login(email, password, invite)
    await landAfterAuth(outcome)
    return outcome
  }

  async function register(
    email: string, first_name: string, last_name: string, password: string, invite?: string,
  ): Promise<InviteOutcome | null> {
    const outcome = await auth.register(email, first_name, last_name, password, invite)
    await landAfterAuth(outcome)
    return outcome
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
