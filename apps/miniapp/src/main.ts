import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import './styles/mobile.css';
import App from './App.vue';
import VerifyView from './views/VerifyView.vue';
import MobileWorkbenchView from './views/MobileWorkbenchView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/v' },
    { path: '/v', component: VerifyView },
    { path: '/v/:token', component: VerifyView },
    { path: '/m/workbench', component: MobileWorkbenchView },
  ],
});

createApp(App).use(router).mount('#app');
