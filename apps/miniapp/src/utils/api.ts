import axios from 'axios';

export const mApi = axios.create({
  baseURL: '/api/v1',
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
