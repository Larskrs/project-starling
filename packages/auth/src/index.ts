import { ref, readonly } from 'vue';

/**
 * The signed-in user, exactly as login, register, /auth/me and /user/me return
 * it — they all share one projection server-side (apps/api/src/lib/auth/user.ts).
 *
 * `id` is a uuid string, not a number: this was typed `number` while every
 * endpoint sent a uuid, and nothing caught it because the web app shimmed
 * @starling/auth to `any`.
 */
export interface User {
  id:              string;
  email:           string;
  name:            string;
  first_name:      string;
  last_name:       string;
  isEmailVerified: boolean;
  role:            'admin' | 'user';
  /** storageFiles id, resolved through /api/storage/{id}/serve. */
  avatarImageId:   string | null;
  bannerImageId:   string | null;
  /** ISO-8601 — a Date on the server, a string once it's been through JSON. */
  createdAt:       string;
}

export interface Session {
  id:        string;
  userId:    string;
  role:      'admin' | 'user';
  expiresAt: string;
}

export interface AuthState {
  user:    User    | null;
  session: Session | null;
}

/**
 * What the server reports about an invite token that rode along with a sign-in.
 *
 * A stale invite never fails the sign-in itself — the account and session are
 * real either way — so the caller checks this to decide where to land the user
 * and what to tell them.
 */
export interface InviteOutcome {
  accepted:    boolean;
  reason?:     'notFound' | 'expired' | 'revoked' | 'exhausted' | 'emailMismatch';
  /** Where to send them, when they did join something. */
  path?:       string;
  production?: { name: string; slug: string };
  company?:    { name: string; slug: string };
  emailBound?: boolean;
}

const user    = ref<User    | null>(null);
const session = ref<Session | null>(null);

export function useAuth(baseUrl = '') {
  /** `invite` is a one-time token from an invite link; it joins them on success. */
  async function login(email: string, password: string, invite?: string): Promise<InviteOutcome | null> {
    const res  = await fetch(`${baseUrl}/api/auth/login`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ email, password, ...(invite ? { invite } : {}) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Login failed');
    user.value    = data.user;
    session.value = null;
    return data.invite ?? null;
  }

  async function register(
    email: string, first_name: string, last_name: string, password: string, invite?: string,
  ): Promise<InviteOutcome | null> {
    const res  = await fetch(`${baseUrl}/api/auth/register`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ email, first_name, last_name, password, ...(invite ? { invite } : {}) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Registration failed');
    user.value    = data.user;
    session.value = null;
    return data.invite ?? null;
  }

  async function logout(): Promise<void> {
    await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    user.value    = null;
    session.value = null;
  }

  async function fetchUser(): Promise<AuthState> {
    const res = await fetch(`${baseUrl}/api/auth/me`, { credentials: 'include' });
    console.log(res)
    if (!res.ok) {
      user.value    = null;
      session.value = null;
      return { user: null, session: null };
    }
    const data    = await res.json();
    user.value    = data.user;
    session.value = data.session;
    return { user: data.user, session: data.session };
  }

  return {
    user:    readonly(user),
    session: readonly(session),
    login,
    register,
    logout,
    fetchUser,
  };
}
