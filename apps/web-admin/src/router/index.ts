import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import MainLayout from '../layout/MainLayout.vue';
import LoginView from '../views/LoginView.vue';
import DashboardView from '../views/DashboardView.vue';
import TraceCenterView from '../views/TraceCenterView.vue';
import PurchaseView from '../views/PurchaseView.vue';
import SalesView from '../views/SalesView.vue';
import InventoryView from '../views/InventoryView.vue';
import ChannelsView from '../views/ChannelsView.vue';
import CrmVisitView from '../views/CrmVisitView.vue';
import ExistingClientsView from '../views/ExistingClientsView.vue';
import CustomerCenterView from '../views/CustomerCenterView.vue';
import ReportsView from '../views/ReportsView.vue';
import AuditLogView from '../views/AuditLogView.vue';
import SettingsView from '../views/SettingsView.vue';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true } },
    {
      path: '/',
      component: MainLayout,
      children: [
        { path: '', component: DashboardView },
        { path: 'trace', component: TraceCenterView },
        { path: 'purchase', component: PurchaseView },
        { path: 'sales', component: SalesView },
        { path: 'inventory', component: InventoryView },
        { path: 'channels', component: ChannelsView },
        { path: 'crm', component: CrmVisitView },
        { path: 'crm-existing', component: ExistingClientsView },
        { path: 'customers', component: CustomerCenterView },
        { path: 'reports', component: ReportsView },
        { path: 'settings', component: SettingsView },
        { path: 'audit-logs', component: AuditLogView },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isAuthenticated) {
    return '/login';
  }
  return true;
});
