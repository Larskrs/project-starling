import { ref, readonly } from 'vue';

export interface User {
  id:              number;
  email:           string;
  name:            string;
  isAdministrator: boolean;
}

export interface Session {
  id:        string;
  userId:    number;
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

  async function register(email: string, name: string, password: string): Promise<void> {
    const res  = await fetch(`${baseUrl}/api/auth/register`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ email, name, password }),
    });
    const data = await res.json();
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
