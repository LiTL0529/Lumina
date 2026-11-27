import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { registerPlugin } from '@capacitor/core';
import './styles/mobile.css';
import App from './App.vue';
import VerifyView from './views/VerifyView.vue';
import MobileWorkbenchView from './views/MobileWorkbenchView.vue';

const isNativeApp =
  typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: isNativeApp ? '/m/workbench' : '/v' },
    { path: '/v', component: VerifyView },
    { path: '/v/:token', component: VerifyView },
    { path: '/m', redirect: '/m/workbench' },
    { path: '/m/workbench', component: MobileWorkbenchView },
  ],
});

const app = createApp(App).use(router);
router.isReady().then(() => {
  app.mount('#app');
  if (isNativeApp) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const LuminaScanner = registerPlugin<{ appReady: () => Promise<void> }>('LuminaScanner');
        LuminaScanner.appReady().catch(() => {});
      });
    });
  }
});
