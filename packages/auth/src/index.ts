import { ref, readonly } from 'vue';

/**
 * The signed-in user, exactly as login, register, /auth/me and /user/me return
 * it — they all share one projection server-side (apps/api/src/lib/user.ts).
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

const user    = ref<User    | null>(null);
const session = ref<Session | null>(null);

export function useAuth(baseUrl = '') {
  async function login(email: string, password: string): Promise<void> {
    const res  = await fetch(`${baseUrl}/api/auth/login`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Login failed');
    user.value    = data.user;
    session.value = null;
  }

  async function register(email: string, first_name: string, last_name: string, password: string): Promise<void> {
    const res  = await fetch(`${baseUrl}/api/auth/register`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ email, first_name, last_name, password }),
    });
    const data = await res.json();
    console.log(data);
    if (!res.ok) throw new Error(data.error ?? 'Registration failed');
    user.value    = data.user;
    session.value = null;
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
