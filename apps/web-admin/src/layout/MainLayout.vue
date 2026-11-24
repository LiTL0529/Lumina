<template>
  <div class="admin-shell">
    <aside class="sidebar">
      <div class="brand-header">
        <div class="brand-mark">L</div>
        <div>
          <div class="brand-name">LUMINA</div>
          <div class="brand-sub">供销溯源 · 轻量化 ERP</div>
        </div>
      </div>

      <nav class="nav-list">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <a
          :href="mobileVerifyDemoUrl"
          target="_blank"
          rel="noopener"
          class="mobile-entry-link"
        >
          <el-icon><Iphone /></el-icon>
          <span>打开手机销售 / C端验真</span>
        </a>
        <div class="org-pill">
          <div class="org-pill-role">{{ roleLabel }}</div>
          <div class="org-pill-name">{{ auth.user?.orgName }}</div>
        </div>
      </div>
    </aside>

    <div class="main-area">
      <header class="topbar">
        <div class="topbar-left">
          <span class="env-badge">{{ auth.isHQ ? '品牌总控视角' : '服务商独立仓视角' }}</span>
          <span v-if="liveOrderBanner" class="live-alert-pill" @click="router.push('/sales')">
            新订单提醒：{{ liveOrderBanner }}
          </span>
        </div>
        <div class="topbar-right">
          <span class="user-label">{{ auth.user?.realName }}</span>
          <el-button size="small" plain @click="handleLogout">切换账号</el-button>
        </div>
      </header>

      <main class="content-scroll">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { io, Socket } from 'socket.io-client';
import { ElNotification } from 'element-plus';
import {
  Odometer,
  FullScreen,
  ShoppingCart,
  Sell,
  Box,
  OfficeBuilding,
  DataAnalysis,
  Setting,
  Iphone,
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { playScanBeep, speakWarehouseVoice } from '../composables/useBarcodeScanner';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const liveOrderBanner = ref('');
let socket: Socket | null = null;

const mobileVerifyDemoUrl = computed(() => {
  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:5174/m/workbench`;
  }
  return `${window.location.origin}/m/workbench`;
});

const navItems = [
  { path: '/', label: '总控工作台', icon: Odometer },
  { path: '/trace', label: '一物一码溯源', icon: FullScreen },
  { path: '/purchase', label: '采购与扫码入库', icon: ShoppingCart },
  { path: '/sales', label: '销售出库与套打', icon: Sell },
  { path: '/inventory', label: '库存与月度核验', icon: Box },
  { path: '/channels', label: '服务商与机构报备', icon: OfficeBuilding },
  { path: '/reports', label: '经营报表与返点', icon: DataAnalysis },
  { path: '/settings', label: '商品与规则设置', icon: Setting },
];

const roleLabel = computed(() => {
  const map: Record<string, string> = {
    HQ_ADMIN: '品牌总部管理员',
    HQ_WAREHOUSE: '总仓库管',
    HQ_COMPLIANCE: '流向管控负责人',
    DEALER_ADMIN: '服务商负责人',
    DEALER_WAREHOUSE: '服务商库管',
    SALES_REP: '外勤销售',
  };
  return map[auth.user?.roleCode || ''] || auth.user?.roleCode;
});

onMounted(() => {
  socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    if (auth.user) {
      socket?.emit('join_org', { orgId: auth.user.orgId, orgType: auth.user.orgType });
    }
  });
  socket.on('warehouse:new_order', (data: { docNo: string; customerName: string; totalAmount: number }) => {
    liveOrderBanner.value = `${data.docNo} · ${data.customerName} (¥${data.totalAmount})`;
    playScanBeep('notify');
    speakWarehouseVoice(`您有新的待出库订单，客户${data.customerName}`);
    ElNotification({
      title: '新订单待扫码出库',
      message: `单号 ${data.docNo}（${data.customerName}），金额 ¥${data.totalAmount}，请及时扫码核验并针式打单`,
      type: 'success',
      duration: 6000,
    });
  });
  socket.on('compliance:new_alert', (data: { title: string }) => {
    playScanBeep('error');
    ElNotification({
      title: '流向与合规预警',
      message: data.title,
      type: 'warning',
      duration: 7000,
    });
  });
});

onUnmounted(() => {
  socket?.disconnect();
});

function handleLogout() {
  auth.logout();
  router.push('/login');
}
</script>

<style scoped>
.admin-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.sidebar {
  width: 232px;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  color: #e6f0ee;
  display: flex;
  flex-direction: column;
  padding: 18px 12px 14px;
}
.brand-header {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 4px 10px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 12px;
}
.brand-mark {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: linear-gradient(135deg, #0f6e66, #1d9a8f);
  color: #fff;
  font-weight: 800;
  font-size: 18px;
  display: grid;
  place-items: center;
  letter-spacing: 1px;
}
.brand-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #fff;
}
.brand-sub {
  font-size: 11px;
  color: #8fb1ac;
  margin-top: 2px;
}
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  overflow-y: auto;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  color: #b7ccc9;
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 500;
  transition: background 0.15s ease, color 0.15s ease;
}
.nav-item:hover {
  background: var(--sidebar-hover);
  color: #fff;
}
.nav-item.active {
  background: var(--sidebar-active);
  color: #fff;
  font-weight: 600;
}
.sidebar-footer {
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mobile-entry-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  border-radius: 7px;
  background: rgba(184, 134, 59, 0.16);
  border: 1px solid rgba(184, 134, 59, 0.35);
  color: #f3d7a3;
  text-decoration: none;
  font-size: 12px;
  font-weight: 500;
}
.mobile-entry-link:hover {
  background: rgba(184, 134, 59, 0.28);
}
.org-pill {
  padding: 9px 11px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
}
.org-pill-role {
  font-size: 11px;
  color: #7cc5be;
}
.org-pill-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.topbar {
  height: 54px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.env-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--brand-primary-soft);
  color: var(--brand-primary);
}
.live-alert-pill {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 99px;
  background: var(--brand-gold-soft);
  border: 1px solid #e7cfa3;
  color: #8b5e16;
  cursor: pointer;
  font-weight: 500;
}
.user-label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}
.content-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 22px 26px 32px;
}
</style>
