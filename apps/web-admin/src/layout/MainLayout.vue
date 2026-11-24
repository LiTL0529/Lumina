<template>
  <div class="admin-shell">
    <aside class="rail" :class="{ open: railOpen }">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="brand-copy">
          <div class="brand-word">LUMINA</div>
          <div class="brand-sub">供销溯源 · 渠道执行</div>
        </div>
      </div>

      <nav class="rail-nav">
        <div v-for="group in navGroups" :key="group.label" class="nav-group">
          <div class="nav-label">{{ group.label }}</div>
          <router-link
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="nav-item"
            :class="{ active: isActive(item.path) }"
          >
            <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
            <span class="nav-text">{{ item.label }}</span>
          </router-link>
        </div>
      </nav>

      <div class="rail-footer">
        <a :href="mobileEntryUrl" target="_blank" rel="noopener" class="mobile-entry">
          <el-icon><Iphone /></el-icon>
          <span>手机端 · 销售工作台 / 验真</span>
          <el-icon class="entry-arrow"><TopRight /></el-icon>
        </a>
        <div class="org-card">
          <div class="org-role">{{ roleLabel }}</div>
          <div class="org-name" :title="auth.user?.orgName">{{ auth.user?.orgName }}</div>
        </div>
      </div>
    </aside>

    <div v-if="railOpen" class="rail-scrim" @click="railOpen = false" />

    <div class="main-area">
      <header class="topbar">
        <div class="topbar-left">
          <button class="rail-toggle" type="button" aria-label="打开导航" @click="railOpen = !railOpen">
            <el-icon><Expand /></el-icon>
          </button>
          <div class="crumb">
            <span class="crumb-parent">{{ currentGroup }}</span>
            <span class="crumb-slash">/</span>
            <span class="crumb-now">{{ currentTitle }}</span>
          </div>
        </div>

        <form class="global-scan" @submit.prevent="jumpToTrace">
          <el-icon class="gs-icon"><Aim /></el-icon>
          <input
            ref="scanRef"
            v-model="globalCode"
            class="gs-input mono"
            placeholder="扫码或输入防伪码，追踪这一盒的去向"
            inputmode="text"
            autocomplete="off"
          />
          <kbd class="gs-kbd">{{ isMac ? '⌘' : 'Ctrl' }} K</kbd>
        </form>

        <div class="topbar-right">
          <span class="env-chip" :class="auth.isHQ ? 'hq' : 'dealer'">
            {{ auth.isHQ ? '品牌总控' : '服务商独立仓' }}
          </span>
          <span class="user-name">{{ auth.user?.realName }}</span>
          <button class="text-btn" type="button" @click="handleLogout">切换账号</button>
        </div>
      </header>

      <div v-if="liveOrderBanner" class="live-banner" @click="router.push('/sales')">
        <span class="live-dot" />
        <span class="live-text">仓库收到新订单：{{ liveOrderBanner }}</span>
        <span class="live-go">去扫码出库</span>
      </div>

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
  Download,
  Sell,
  Box,
  OfficeBuilding,
  DataAnalysis,
  Setting,
  Iphone,
  Aim,
  Expand,
  TopRight,
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { playScanBeep, speakWarehouseVoice } from '../composables/useBarcodeScanner';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const liveOrderBanner = ref('');
const globalCode = ref('');
const scanRef = ref<HTMLInputElement | null>(null);
const railOpen = ref(false);
let socket: Socket | null = null;

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const mobileEntryUrl = computed(() => {
  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:5174/m/workbench`;
  }
  return `${window.location.origin}/m/workbench`;
});

const navGroups = [
  {
    label: '作业',
    items: [
      { path: '/', label: '总控台', icon: Odometer },
      { path: '/purchase', label: '扫码入库', icon: Download },
      { path: '/sales', label: '出库与打单', icon: Sell },
    ],
  },
  {
    label: '追溯',
    items: [
      { path: '/trace', label: '一物一码', icon: FullScreen },
      { path: '/inventory', label: '库存与核验', icon: Box },
    ],
  },
  {
    label: '渠道',
    items: [
      { path: '/channels', label: '服务商与机构', icon: OfficeBuilding },
      { path: '/reports', label: '报表与返点', icon: DataAnalysis },
    ],
  },
  {
    label: '系统',
    items: [{ path: '/settings', label: '商品与规则', icon: Setting }],
  },
];

const routeTitles: Record<string, { title: string; group: string }> = {
  '/': { title: '总控台', group: '作业' },
  '/purchase': { title: '扫码入库', group: '作业' },
  '/sales': { title: '出库与打单', group: '作业' },
  '/trace': { title: '一物一码', group: '追溯' },
  '/inventory': { title: '库存与核验', group: '追溯' },
  '/channels': { title: '服务商与机构', group: '渠道' },
  '/reports': { title: '报表与返点', group: '渠道' },
  '/settings': { title: '商品与规则', group: '系统' },
};

const currentTitle = computed(() => routeTitles[route.path]?.title || '工作台');
const currentGroup = computed(() => routeTitles[route.path]?.group || '作业');

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

function isActive(path: string) {
  return route.path === path;
}

function jumpToTrace() {
  const code = globalCode.value.trim();
  if (!code) {
    router.push('/trace');
    return;
  }
  globalCode.value = '';
  router.push({ path: '/trace', query: { code } });
}

function focusScan(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    scanRef.value?.focus();
  }
}

onMounted(() => {
  window.addEventListener('keydown', focusScan);

  socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    if (auth.user) {
      socket?.emit('join_org', { orgId: auth.user.orgId, orgType: auth.user.orgType });
    }
  });
  socket.on('warehouse:new_order', (data: { docNo: string; customerName: string; totalAmount: number }) => {
    liveOrderBanner.value = `${data.docNo} · ${data.customerName} · ¥${data.totalAmount}`;
    playScanBeep('notify');
    speakWarehouseVoice(`您有新的待出库订单，客户${data.customerName}`);
    ElNotification({
      title: '新订单待扫码出库',
      message: `单号 ${data.docNo}（${data.customerName}），金额 ¥${data.totalAmount}，请及时扫码核验并打印联单`,
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
  window.removeEventListener('keydown', focusScan);
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
  background: var(--paper);
}

/* ---------------- 侧栏 ---------------- */
.rail {
  width: 226px;
  flex-shrink: 0;
  background: var(--surface-2);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  padding: 18px 12px 12px;
  z-index: 40;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 8px 16px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 14px;
}

.brand-mark {
  width: 30px;
  height: 30px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  align-items: stretch;
  padding: 5px 4px;
  background: var(--brand-ink);
  border-radius: 5px;
}
.brand-mark span {
  background: #d9e8e2;
  border-radius: 1px;
}
.brand-mark span:nth-child(2) {
  transform: scaleY(0.66);
  align-self: center;
}
.brand-mark span:nth-child(3) {
  transform: scaleY(0.82);
  align-self: center;
}

.brand-word {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--ink);
  line-height: 1.2;
}
.brand-sub {
  font-size: 10.5px;
  color: var(--ink-3);
  margin-top: 3px;
  letter-spacing: 0.02em;
}

.rail-nav {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 8px;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nav-label {
  font-size: 10.5px;
  color: var(--ink-3);
  padding: 0 10px 5px;
  letter-spacing: 0.08em;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 5px;
  color: var(--ink-2);
  text-decoration: none;
  font-size: 13.5px;
  transition: background 0.14s ease, color 0.14s ease;
}

.nav-item:hover {
  background: #f1efe7;
  color: var(--ink);
}

.nav-item.active {
  background: var(--brand-tint);
  color: var(--brand-ink);
  font-weight: 600;
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 7px;
  bottom: 7px;
  width: 2px;
  background: var(--brand);
  border-radius: 0 2px 2px 0;
}

.nav-icon {
  font-size: 15px;
  color: var(--ink-3);
}
.nav-item.active .nav-icon {
  color: var(--brand);
}

.nav-badge {
  margin-left: auto;
  font-family: var(--font-num);
  font-size: 11px;
  background: var(--seal);
  color: #fff;
  border-radius: 99px;
  padding: 0 6px;
  line-height: 16px;
}

.rail-footer {
  border-top: 1px solid var(--line);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mobile-entry {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border-radius: 5px;
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--ink-2);
  text-decoration: none;
  font-size: 11.5px;
  transition: border-color 0.14s ease, color 0.14s ease;
}
.mobile-entry:hover {
  border-color: var(--brand-line);
  color: var(--brand-ink);
}
.entry-arrow {
  margin-left: auto;
  font-size: 12px;
  color: var(--ink-3);
}

.org-card {
  padding: 8px 10px;
  border-radius: 5px;
  background: var(--surface-3);
}
.org-role {
  font-size: 10.5px;
  color: var(--ink-3);
}
.org-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------------- 主区 ---------------- */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  height: 56px;
  flex-shrink: 0;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 18px;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.rail-toggle {
  display: none;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 5px;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--ink-2);
}

.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  white-space: nowrap;
}
.crumb-parent {
  color: var(--ink-3);
}
.crumb-slash {
  color: var(--line-strong);
}
.crumb-now {
  color: var(--ink);
  font-weight: 600;
}

.global-scan {
  flex: 1;
  max-width: 520px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-2);
  transition: border-color 0.15s ease, background 0.15s ease;
}
.global-scan:focus-within {
  border-color: var(--brand-line);
  background: #fff;
}
.gs-icon {
  color: var(--ink-3);
  font-size: 15px;
}
.gs-input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--ink);
  letter-spacing: 0.02em;
  min-width: 0;
}
.gs-input::placeholder {
  color: var(--ink-3);
  font-family: var(--font-ui);
  letter-spacing: 0;
}
.gs-kbd {
  font-family: var(--font-ui);
  font-size: 10.5px;
  color: var(--ink-3);
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 4px;
  padding: 1px 5px;
  white-space: nowrap;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.env-chip {
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink-2);
  white-space: nowrap;
}
.env-chip.hq {
  border-color: var(--brand-line);
  background: var(--brand-tint);
  color: var(--brand-ink);
}
.env-chip.dealer {
  border-color: #d9cbaa;
  background: var(--ochre-tint);
  color: var(--ochre);
}

.user-name {
  font-size: 12.5px;
  color: var(--ink);
  font-weight: 500;
  white-space: nowrap;
}

.text-btn {
  border: 0;
  background: transparent;
  color: var(--ink-3);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 2px;
  font-family: inherit;
}
.text-btn:hover {
  color: var(--brand);
}

.live-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 24px;
  background: var(--ochre-tint);
  border-bottom: 1px solid #e8d7b4;
  font-size: 12.5px;
  color: #6d4a0d;
  cursor: pointer;
}
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #b8801f;
  box-shadow: 0 0 0 3px rgba(184, 128, 31, 0.18);
  animation: live-pulse 1.6s ease-in-out infinite;
}
@keyframes live-pulse {
  50% {
    box-shadow: 0 0 0 6px rgba(184, 128, 31, 0.06);
  }
}
.live-text {
  font-weight: 500;
}
.live-go {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  color: #8a5e12;
}

.content-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px 40px;
}

.content-scroll > :deep(*) {
  max-width: 1400px;
}

.rail-scrim {
  display: none;
}

@media (max-width: 1080px) {
  .rail {
    position: fixed;
    inset: 0 auto 0 0;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    box-shadow: 0 0 40px rgba(23, 33, 31, 0.18);
  }
  .rail.open {
    transform: none;
  }
  .rail-scrim {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(16, 28, 26, 0.35);
    z-index: 30;
  }
  .rail-toggle {
    display: inline-flex;
  }
  .gs-kbd {
    display: none;
  }
  .global-scan {
    max-width: none;
  }
}

@media (max-width: 760px) {
  .topbar {
    padding: 0 14px;
    gap: 10px;
  }
  .crumb,
  .env-chip,
  .user-name {
    display: none;
  }
  .content-scroll {
    padding: 16px 14px 32px;
  }
}
</style>
