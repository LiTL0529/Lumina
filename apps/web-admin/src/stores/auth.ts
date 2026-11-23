import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '../utils/api';

export interface UserSession {
  userId: string;
  username: string;
  realName: string;
  orgId: string;
  orgType: 'HQ' | 'DEALER';
  orgName: string;
  roleCode: string;
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(localStorage.getItem('lumina_token') || '');
  const user = ref<UserSession | null>(
    (() => {
      try {
        const raw = localStorage.getItem('lumina_user');
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    })(),
  );

  const isAuthenticated = computed(() => Boolean(token.value && user.value));
  const isHQ = computed(() => user.value?.orgType === 'HQ');

  async function login(username: string, password: string) {
    const res = (await api.post('/auth/login', { username, password })) as unknown as {
      accessToken: string;
      user: UserSession;
    };
    token.value = res.accessToken;
    user.value = res.user;
    localStorage.setItem('lumina_token', res.accessToken);
    localStorage.setItem('lumina_user', JSON.stringify(res.user));
    return res.user;
  }

  function logout() {
    token.value = '';
    user.value = null;
    localStorage.removeItem('lumina_token');
    localStorage.removeItem('lumina_user');
  }

  return { token, user, isAuthenticated, isHQ, login, logout };
});
