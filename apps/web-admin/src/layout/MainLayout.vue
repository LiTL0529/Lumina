<template>
  <div class="admin-shell">
    <aside class="rail" :class="{ open: railOpen }">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 8V6a2 2 0 0 1 2-2h2" />
            <path d="M16 4h2a2 2 0 0 1 2 2v2" />
            <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
            <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
            <path d="M9 9h6v6H9z" />
          </svg>
        </div>
        <div class="brand-copy">
          <div class="brand-word">LUMINA</div>
          <div class="brand-sub">供销溯源与渠道执行</div>
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
        <button type="button" class="rail-link" @click="openApkModal">
          <el-icon><Download /></el-icon>
          <span>安卓扫码 App</span>
        </button>
        <div class="org-card">
          <div class="org-role">{{ roleLabel }}</div>
          <div class="org-name" :title="auth.user?.orgName">{{ auth.user?.orgName }}</div>
        </div>
      </div>
    </aside>

    <div v-if="railOpen" class="rail-scrim" @click="railOpen = false" />

    <div class="main-area" :class="{ 'with-drawer': aiOpen }">
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

        <div class="topbar-center">
          <el-dropdown v-if="auth.isHQ" trigger="click" @command="onScopeChange">
            <button type="button" class="scope-btn" :class="{ drilled: !!scope.scopeOrgId }">
              <span class="scope-key">视角</span>
              <span class="scope-val">{{ scope.label }}</span>
              <el-icon class="scope-caret"><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu class="scope-menu">
                <el-dropdown-item command="" :class="{ 'is-current': !scope.scopeOrgId }">品牌总部全局</el-dropdown-item>
                <el-dropdown-item
                  v-for="d in scope.dealers"
                  :key="d.id"
                  :command="d.id"
                  :class="{ 'is-current': scope.scopeOrgId === d.id }"
                  :divided="d === scope.dealers[0]"
                >
                  {{ d.name }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span v-else class="scope-fixed">{{ auth.user?.orgName }}</span>

          <form class="global-scan" @submit.prevent="jumpToTrace">
            <el-icon class="gs-icon"><Search /></el-icon>
            <input
              ref="scanRef"
              v-model="globalCode"
              class="gs-input"
              placeholder="防伪码直查"
              inputmode="text"
              autocomplete="off"
            />
            <kbd class="gs-kbd">{{ modKey }}K</kbd>
          </form>
        </div>

        <div class="topbar-right">
          <button type="button" class="ai-btn" :class="{ on: aiOpen }" @click="aiOpen = !aiOpen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
              <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
            </svg>
            <span>AI 助手</span>
            <kbd>{{ modKey }}J</kbd>
          </button>
          <span class="user-name">{{ auth.user?.realName }}</span>
          <button class="text-btn" type="button" @click="handleLogout">退出</button>
        </div>
      </header>

      <div v-if="scope.scopeOrgId && auth.isHQ" class="scope-banner">
        当前以 <strong>{{ scope.label }}</strong> 视角查看（只读下钻）
        <button type="button" @click="onScopeChange('')">返回总部全局</button>
      </div>

      <div v-if="liveOrderBanner" class="live-banner" @click="router.push('/sales')">
        <span class="signal-dot warn" />
        <span class="live-text">仓库收到新订单：{{ liveOrderBanner }}</span>
        <span class="live-go">去扫码出库</span>
      </div>

      <main class="content-scroll">
        <div class="content-inner">
          <router-view :key="`${route.path}::${scope.version}`" />
        </div>
      </main>
    </div>

    <AiCopilotDrawer v-model="aiOpen" />

    <el-dialog v-model="apkDialog" title="Lumina 安卓扫码 App" width="min(400px, 92vw)" align-center>
      <div class="apk-modal-body">
        <img v-if="apkQrUrl" :src="apkQrUrl" alt="扫码下载安卓 APK" class="apk-qr" />
        <div class="apk-tip">安卓手机扫码下载安装，支持原生高清连扫入库、收货、出库、查流向与外勤拜访，手机端直接提交并与 PC 实时同步。</div>
        <a :href="apkDownloadUrl" download="lumina-scanner.apk" class="el-button el-button--primary apk-dl-btn">
          下载 lumina-scanner.apk
        </a>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { io, Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import { ElNotification } from 'element-plus';
import {
  Odometer,
  FullScreen,
  Download,
  Sell,
  Box,
  OfficeBuilding,
  Tickets,
  Refresh,
  User,
  DataAnalysis,
  Setting,
  Search,
  Expand,
  ArrowDown,
  Document,
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { useScopeStore } from '../stores/scope';
import { APP_BASE, SOCKET_PATH } from '../utils/api';
import { playScanBeep, speakWarehouseVoice } from '../composables/useBarcodeScanner';
import AiCopilotDrawer from '../components/AiCopilotDrawer.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const scope = useScopeStore();
const liveOrderBanner = ref('');
const globalCode = ref('');
const scanRef = ref<HTMLInputElement | null>(null);
const railOpen = ref(false);
const aiOpen = ref(false);
const apkDialog = ref(false);
const apkQrUrl = ref('');
const apkDownloadUrl = computed(() => `${window.location.origin}${APP_BASE}/downloads/lumina-scanner.apk`);

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const modKey = isMac ? '⌘' : 'Ctrl ';

async function openApkModal() {
  railOpen.value = false;
  apkDialog.value = true;
  if (!apkQrUrl.value) {
    apkQrUrl.value = await QRCode.toDataURL(apkDownloadUrl.value, {
      width: 200,
      margin: 1,
      color: { dark: '#111827', light: '#ffffff' },
    });
  }
}
let socket: Socket | null = null;

watch(
  () => route.fullPath,
  () => {
    railOpen.value = false;
  },
);

const navGroups = [
  {
    label: '作业',
    items: [
      { path: '/', label: '总控台', icon: Odometer },
      { path: '/purchase', label: '扫码入库建档', icon: Download },
      { path: '/sales', label: '出库与打单', icon: Sell },
    ],
  },
  {
    label: '追溯',
    items: [
      { path: '/trace', label: '流向追溯查询', icon: FullScreen },
      { path: '/inventory', label: '库存与核验', icon: Box },
    ],
  },
  {
    label: '渠道',
    items: [
      { path: '/crm', label: '新客开发看板', icon: Tickets },
      { path: '/crm-existing', label: '老客维护看板', icon: Refresh },
      { path: '/customers', label: '客户档案中心', icon: User },
      { path: '/channels', label: '代理商与机构', icon: OfficeBuilding },
      { path: '/reports', label: '报表与返点', icon: DataAnalysis },
    ],
  },
  {
    label: '系统',
    items: [
      { path: '/settings', label: '商品与规则', icon: Setting },
      { path: '/audit-logs', label: '操作审计日志', icon: Document },
    ],
  },
];

const routeTitles: Record<string, { title: string; group: string }> = {
  '/': { title: '总控台', group: '作业' },
  '/purchase': { title: '扫码入库建档', group: '作业' },
  '/sales': { title: '出库与打单', group: '作业' },
  '/trace': { title: '流向追溯查询', group: '追溯' },
  '/inventory': { title: '库存与核验', group: '追溯' },
  '/crm': { title: '新客开发看板', group: '渠道' },
  '/crm-existing': { title: '老客维护看板', group: '渠道' },
  '/customers': { title: '客户档案中心', group: '渠道' },
  '/channels': { title: '代理商与机构', group: '渠道' },
  '/reports': { title: '报表与返点', group: '渠道' },
  '/settings': { title: '商品与规则', group: '系统' },
  '/audit-logs': { title: '操作审计日志', group: '系统' },
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

function onScopeChange(id: string) {
  scope.setScope(id);
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

function onKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'k') {
    e.preventDefault();
    scanRef.value?.focus();
  } else if (k === 'j') {
    e.preventDefault();
    aiOpen.value = !aiOpen.value;
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  if (auth.isHQ) scope.loadDealers();
  else if (scope.scopeOrgId) scope.setScope('');

  socket = io(window.location.origin, { path: SOCKET_PATH, transports: ['websocket', 'polling'] });
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
      message: `单号 ${data.docNo}（${data.customerName}），金额 ¥${data.totalAmount}`,
      type: 'success',
      duration: 6000,
    });
  });
  socket.on('compliance:new_alert', (data: { title: string }) => {
    playScanBeep('error');
    ElNotification({ title: '流向与合规预警', message: data.title, type: 'warning', duration: 7000 });
  });
  socket.on(
    'trace:scan_activity',
    (data: { actionLabel: string; docNo: string; operatorName: string; unitCount: number; targetName?: string }) => {
      playScanBeep('notify');
      const targetStr = data.targetName ? ` → ${data.targetName}` : '';
      ElNotification({
        title: `实时扫码 · ${data.actionLabel}`,
        message: `${data.operatorName} 完成 ${data.unitCount} 件${targetStr}（单号 ${data.docNo}）`,
        type: 'info',
        duration: 5000,
      });
      window.dispatchEvent(new CustomEvent('lumina:scan-activity', { detail: data }));
    },
  );
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  socket?.disconnect();
});

function handleLogout() {
  scope.reset();
  auth.logout();
  router.push('/login');
}
</script>

<style scoped>
.admin-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-canvas);
}

/* ---------------- 侧栏 ---------------- */
.rail {
  width: 224px;
  flex-shrink: 0;
  background: var(--bg-rail);
  border-right: 1px solid var(--border-hairline);
  display: flex;
  flex-direction: column;
  padding: 20px 12px 14px;
  z-index: 40;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px 22px;
}
.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #111827;
  color: #ffffff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.brand-mark svg {
  width: 16px;
  height: 16px;
}
.brand-word {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--ink-primary);
  line-height: 1.2;
}
.brand-sub {
  font-size: 11px;
  color: var(--ink-muted);
  margin-top: 2px;
}

.rail-nav {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 10px;
}
.nav-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.nav-label {
  font-size: 11px;
  color: var(--ink-muted);
  padding: 0 12px 6px;
  letter-spacing: 0.04em;
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  border-radius: 6px;
  color: var(--ink-secondary);
  text-decoration: none;
  font-size: 13.5px;
  transition: background 0.12s ease, color 0.12s ease;
}
.nav-item:hover {
  background: var(--bg-active);
  color: var(--ink-primary);
}
.nav-item.active {
  background: var(--bg-active);
  color: var(--ink-primary);
  font-weight: 600;
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 7px;
  bottom: 7px;
  width: 2px;
  border-radius: 2px;
  background: #111827;
}
.nav-icon {
  font-size: 15px;
  color: var(--ink-muted);
}
.nav-item.active .nav-icon,
.nav-item:hover .nav-icon {
  color: var(--ink-primary);
}

.rail-footer {
  border-top: 1px solid var(--border-hairline);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rail-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-secondary);
  font-size: 12.5px;
  font-family: inherit;
  text-decoration: none;
  cursor: pointer;
  text-align: left;
}
.rail-link:hover {
  background: var(--bg-active);
  color: var(--ink-primary);
}
.org-card {
  margin-top: 10px;
  padding: 0 12px;
}
.org-role {
  font-size: 11px;
  color: var(--ink-muted);
}
.org-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-primary);
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
  transition: margin-right 0.2s ease;
}
@media (min-width: 1440px) {
  .main-area.with-drawer {
    margin-right: 420px;
  }
}

.topbar {
  height: 56px;
  flex-shrink: 0;
  background: #ffffff;
  border-bottom: 1px solid var(--border-hairline);
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.rail-toggle {
  display: none;
  border: 1px solid var(--border-strong);
  background: #ffffff;
  border-radius: 6px;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--ink-secondary);
}
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  white-space: nowrap;
}
.crumb-parent {
  color: var(--ink-muted);
}
.crumb-slash {
  color: var(--border-strong);
}
.crumb-now {
  color: var(--ink-primary);
  font-weight: 600;
}

.topbar-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-width: 0;
}
.scope-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: #ffffff;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-primary);
  cursor: pointer;
  white-space: nowrap;
  max-width: 260px;
}
.scope-btn:hover {
  border-color: #9ca3af;
}
.scope-btn.drilled {
  border-color: #111827;
}
.scope-key {
  color: var(--ink-muted);
}
.scope-val {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scope-caret {
  font-size: 12px;
  color: var(--ink-muted);
}
.scope-fixed {
  font-size: 12.5px;
  color: var(--ink-secondary);
  padding: 0 4px;
  white-space: nowrap;
}
:deep(.scope-menu .is-current) {
  font-weight: 600;
  color: #111827;
}

.global-scan {
  flex: 0 1 300px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--bg-subtle);
  transition: border-color 0.15s ease, background 0.15s ease;
}
.global-scan:focus-within {
  border-color: #111827;
  background: #ffffff;
}
.gs-icon {
  color: var(--ink-muted);
  font-size: 14px;
}
.gs-input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--ink-primary);
  min-width: 0;
  font-family: inherit;
}
.gs-input::placeholder {
  color: var(--ink-muted);
}
.gs-kbd,
.ai-btn kbd {
  font-family: var(--font-ui);
  font-size: 10.5px;
  color: var(--ink-muted);
  border: 1px solid var(--border-hairline);
  background: #ffffff;
  border-radius: 4px;
  padding: 0 5px;
  line-height: 16px;
  white-space: nowrap;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.ai-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: #ffffff;
  color: var(--ink-primary);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ai-btn svg {
  width: 15px;
  height: 15px;
}
.ai-btn:hover {
  border-color: #9ca3af;
}
.ai-btn.on {
  border-color: #111827;
  background: var(--bg-subtle);
}
.user-name {
  font-size: 12.5px;
  color: var(--ink-primary);
  font-weight: 500;
  white-space: nowrap;
}
.text-btn {
  border: 0;
  background: transparent;
  color: var(--ink-muted);
  font-size: 12.5px;
  cursor: pointer;
  padding: 4px 2px;
  font-family: inherit;
  white-space: nowrap;
}
.text-btn:hover {
  color: var(--ink-primary);
}

.scope-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border-hairline);
  font-size: 12.5px;
  color: var(--ink-secondary);
}
.scope-banner strong {
  color: var(--ink-primary);
}
.scope-banner button {
  margin-left: auto;
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.live-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 24px;
  background: var(--status-warn-bg);
  border-bottom: 1px solid var(--status-warn-line);
  font-size: 12.5px;
  color: #92400e;
  cursor: pointer;
}
.live-text {
  font-weight: 500;
}
.live-go {
  margin-left: auto;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.content-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 36px var(--page-gutter) 56px;
}
.content-inner {
  max-width: var(--page-max);
  margin: 0 auto;
}

.rail-scrim {
  display: none;
}

@media (max-width: 1280px) {
  .rail {
    width: 196px;
  }
  .content-scroll {
    padding-left: 20px;
    padding-right: 20px;
  }
}

@media (max-width: 1080px) {
  .rail {
    position: fixed;
    inset: 0 auto 0 0;
    transform: translateX(-100%);
    visibility: hidden;
    pointer-events: none;
    transition: transform 0.18s ease, visibility 0.18s ease;
    box-shadow: var(--shadow-pop);
  }
  .rail.open {
    transform: none;
    visibility: visible;
    pointer-events: auto;
  }
  .rail-scrim {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(17, 24, 39, 0.28);
    z-index: 30;
  }
  .rail-toggle {
    display: inline-flex;
  }
  .gs-kbd,
  .ai-btn kbd,
  .crumb {
    display: none;
  }
}

@media (max-width: 760px) {
  .topbar {
    padding: 0 12px;
    gap: 8px;
  }
  .user-name,
  .scope-btn .scope-key {
    display: none;
  }
  .global-scan {
    display: none;
  }
  .content-scroll {
    padding: 18px 14px 32px;
  }
}

.apk-modal-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.apk-qr {
  width: 188px;
  height: 188px;
  border: 1px solid var(--border-hairline);
  border-radius: 8px;
  padding: 6px;
  background: #ffffff;
}
.apk-tip {
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.65;
  color: var(--ink-primary);
}
.apk-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ink-muted);
}
.apk-dl-btn {
  margin-top: 16px;
  width: 100%;
  text-decoration: none;
}
</style>
