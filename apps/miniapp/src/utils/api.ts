import axios from 'axios';

export function getAppBase(): string {
  const isCapacitor =
    typeof window !== 'undefined' &&
    Boolean((window as any).Capacitor?.isNativePlatform?.());
  if (isCapacitor) {
    return '/lumina';
  }
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return base === '.' ? '' : base;
}

export function getServerOrigin(): string {
  const envOrigin = (import.meta.env.VITE_API_ORIGIN || '').trim();
  if (envOrigin) return envOrigin.replace(/\/$/, '');
  const isCapacitor =
    typeof window !== 'undefined' &&
    Boolean((window as any).Capacitor?.isNativePlatform?.());
  if (isCapacitor) {
    return 'https://jianxing-asean-ai.com';
  }
  return '';
}

export function getSocketOrigin(): string {
  const remote = getServerOrigin();
  if (remote) return remote;
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export function getSocketPath(): string {
  return `${getAppBase()}/socket.io/`;
}

export const mApi = axios.create({
  baseURL: `${getServerOrigin()}${getAppBase()}/api/v1`,
  timeout: 15000,
});

mApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('lumina_mobile_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

mApi.interceptors.response.use(
  (res) => res.data,
  (err) => Promise.reject(err),
);
