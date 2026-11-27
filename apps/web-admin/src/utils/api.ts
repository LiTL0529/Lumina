import axios from 'axios';
import { ElMessage } from 'element-plus';

export const APP_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
export const API_BASE = `${APP_BASE}/api/v1`;
export const SOCKET_PATH = `${APP_BASE}/socket.io/`;

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('lumina_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // HQ organization perspective (server honours it only for HQ users on GET requests)
  const method = (config.method || 'get').toLowerCase();
  const scope = localStorage.getItem('lumina_scope_org');
  if (method === 'get' && scope && config.headers['X-Scope-Org-Id'] === undefined) {
    config.headers['X-Scope-Org-Id'] = scope;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const status = err.response?.status;
    const data = err.response?.data;
    const msg =
      (typeof data?.message === 'string' ? data.message : Array.isArray(data?.message) ? data.message.join('；') : null) ||
      err.message ||
      '请求失败';

    if (status === 401) {
      localStorage.removeItem('lumina_token');
      localStorage.removeItem('lumina_user');
      const loginPath = `${APP_BASE}/login`;
      if (window.location.pathname !== loginPath) {
        window.location.href = loginPath;
      }
    } else if (data?.code !== 'REDLINE_VIOLATION') {
      ElMessage.error(msg);
    }
    return Promise.reject(err);
  },
);
