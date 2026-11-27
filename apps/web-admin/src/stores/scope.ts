import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../utils/api';

export interface ScopeOrg {
  id: string;
  name: string;
  city?: string | null;
}

const STORAGE_KEY = 'lumina_scope_org';

/**
 * HQ organization perspective switcher. Empty scopeOrgId = 品牌总部全局.
 * The value is sent as `X-Scope-Org-Id` on every GET request (see utils/api.ts);
 * the server only honours it for HQ users and only for read requests.
 */
export const useScopeStore = defineStore('scope', () => {
  const scopeOrgId = ref<string>(localStorage.getItem(STORAGE_KEY) || '');
  const dealers = ref<ScopeOrg[]>([]);
  const version = ref(0);
  const loaded = ref(false);

  const current = computed(() => dealers.value.find((d) => d.id === scopeOrgId.value) || null);
  const label = computed(() => current.value?.name || '品牌总部全局');

  async function loadDealers() {
    try {
      const list = (await api.get('/orgs', { headers: { 'X-Scope-Org-Id': '' } })) as unknown as Array<any>;
      dealers.value = (list || [])
        .filter((o) => o.type === 'DEALER' && o.status !== 'DISABLED')
        .map((o) => ({ id: o.id, name: o.name, city: o.city }));
      if (scopeOrgId.value && !dealers.value.some((d) => d.id === scopeOrgId.value)) {
        setScope('');
      }
    } catch {
      dealers.value = [];
    } finally {
      loaded.value = true;
    }
  }

  function setScope(id: string) {
    scopeOrgId.value = id || '';
    if (scopeOrgId.value) localStorage.setItem(STORAGE_KEY, scopeOrgId.value);
    else localStorage.removeItem(STORAGE_KEY);
    version.value += 1;
  }

  function reset() {
    scopeOrgId.value = '';
    dealers.value = [];
    loaded.value = false;
    localStorage.removeItem(STORAGE_KEY);
  }

  return { scopeOrgId, dealers, version, loaded, current, label, loadDealers, setScope, reset };
});
