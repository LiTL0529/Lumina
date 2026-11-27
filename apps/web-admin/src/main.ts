import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import './styles/index.css';
import App from './App.vue';
import { router } from './router';

// Suppress benign Element Plus table ResizeObserver browser loop notifications
const origRO = window.ResizeObserver;
if (typeof origRO === 'function') {
  window.ResizeObserver = class ResizeObserver extends origRO {
    constructor(cb: ResizeObserverCallback) {
      super((entries, obs) => {
        window.requestAnimationFrame(() => cb(entries, obs));
      });
    }
  };
}
window.addEventListener('error', (e) => {
  if (e.message && e.message.includes('ResizeObserver loop')) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.mount('#app');
