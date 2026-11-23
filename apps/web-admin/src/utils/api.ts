import axios from 'axios';
import { ElMessage } from 'element-plus';

export const api = axios.create({
  baseURL: '/api/v1',
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('lumina_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    } else if (data?.code !== 'REDLINE_VIOLATION') {
      ElMessage.error(msg);
    }
    return Promise.reject(err);
  },
);
