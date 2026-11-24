<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">{{ greeting }}，{{ auth.user?.realName?.replace(/（.*?）/g, '') }}</h1>
        <p class="page-subtitle">
          {{ todayLabel }} · 今天有 {{ data?.kpis.pendingOutboundCount ?? 0 }} 张出库单待扫，{{
            data?.kpis.openAlertsCount ?? 0
          }} 条流向预警待处置。
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="loadData">刷新</el-button>
        <el-button type="primary" @click="router.push('/purchase')">扫码入库</el-button>
      </div>
    </div>

    <template v-if="data">
      <!-- 指标 -->
      <div class="kpi-grid">
        <div class="kpi-cell" :class="{ accent: data.kpis.pendingOutboundCount > 0 }">
          <div class="kpi-label">待扫码出库</div>
          <div class="kpi-value">{{ data.kpis.pendingOutboundCount }}<span class="unit">单</span></div>
          <div class="kpi-meta">出库时逐码绑定到客户名下</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">当前在库</div>
          <div class="kpi-value">{{ inStockQty }}<span class="unit">盒</span></div>
          <div class="kpi-meta">{{ warehouseCount }} 个仓库 · 可穿透到每一盒</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">累计供货额</div>
          <div class="kpi-value">¥{{ data.kpis.totalSalesAmount.toLocaleString() }}</div>
          <div class="kpi-meta">
            毛利 ¥{{ data.kpis.grossProfit.toLocaleString() }} · 毛利率 {{ data.kpis.grossMarginPercent }}%
          </div>
        </div>
        <div class="kpi-cell" :class="{ accent: data.kpis.openAlertsCount > 0 }">
          <div class="kpi-label">待处置预警</div>
          <div class="kpi-value">{{ data.kpis.openAlertsCount }}<span class="unit">条</span></div>
          <div class="kpi-meta">跨区窜货 / 破价 / 账实差异</div>
        </div>
      </div>

      <!-- 码链 -->
      <section class="chain-card">
        <div class="chain-head">
          <h2 class="section-title">一物一码流向</h2>
          <span class="section-note">从工厂到顾客，五道关口全部留痕</span>
        </div>
        <CodeChain :stages="chainStages" />
      </section>

      <div class="two-col">
        <!-- 待出库队列 -->
        <section class="surface-card">
          <div class="section-header">
            <div>
              <h2 class="section-title">待出库队列</h2>
              <span class="section-note">按状态排序，扫码完成即生成出库码归属</span>
            </div>
            <el-button link type="primary" @click="router.push('/sales')">全部单据</el-button>
          </div>

          <div v-if="!data.pendingOrders.length" class="empty-line">
            暂无待出库订单。销售在手机端下单后，会实时出现在这里。
          </div>

          <ul v-else class="queue">
            <li v-for="order in data.pendingOrders" :key="order.id" class="queue-row">
              <div class="q-main">
                <div class="q-top">
                  <span class="mono q-doc">{{ order.docNo }}</span>
                  <span class="q-scene">{{ order.orderScene === 'HQ_TO_DEALER' ? '总仓 → 服务商' : '服务商 → 机构' }}</span>
                </div>
                <div class="q-buyer">{{ order.buyerOrg?.name || order.clinic?.name || '—' }}</div>
                <div class="q-meta">
                  {{ order.items?.reduce((s: number, i: any) => s + i.qty, 0) || 0 }} 盒 ·
                  {{ order.items?.length || 0 }} 个商品 · {{ order.warehouse?.name || '默认仓' }}
                </div>
              </div>
              <div class="q-side">
                <span class="q-amount num">¥{{ Number(order.totalAmount).toFixed(2) }}</span>
                <span
                  class="q-status"
                  :class="order.status === 'PENDING_APPROVAL' ? 'warn' : 'ready'"
                >
                  {{ order.status === 'PENDING_APPROVAL' ? '红线待特批' : '待扫码' }}
                </span>
              </div>
              <el-button
                class="q-action"
                :type="order.status === 'PENDING_APPROVAL' ? 'warning' : 'primary'"
                plain
                size="small"
                @click="openOrder(order)"
              >
                {{ order.status === 'PENDING_APPROVAL' ? '去审批' : '去扫码' }}
              </el-button>
            </li>
          </ul>
        </section>

        <!-- 规则倒计时 -->
        <section class="surface-card">
          <div class="section-header">
            <div>
              <h2 class="section-title">渠道规则倒计时</h2>
              <span class="section-note">90 天保护 · 270 天无复购解绑</span>
            </div>
            <el-button link type="primary" @click="router.push('/channels')">机构台账</el-button>
          </div>

          <div v-if="!data.expiringClinics.length" class="empty-line">30 天内没有到期机构。</div>

          <ul v-else class="countdown">
            <li v-for="c in data.expiringClinics" :key="c.id" class="cd-row">
              <div class="cd-body">
                <div class="cd-name">{{ c.name }}</div>
                <div class="cd-meta">{{ c.ownerOrg?.name || '总部直营' }} · {{ c.warnType }}</div>
              </div>
              <div class="cd-days" :class="{ urgent: c.daysLeft <= 15 }">
                {{ c.daysLeft }}<span>天</span>
              </div>
              <div class="cd-bar">
                <span
                  :style="{ width: `${Math.max(4, 100 - (c.daysLeft / 90) * 100)}%` }"
                  :class="{ urgent: c.daysLeft <= 15 }"
                />
              </div>
            </li>
          </ul>
        </section>
      </div>

      <!-- 风控 -->
      <section class="surface-card">
        <div class="section-header">
          <div>
            <h2 class="section-title">流向与合规预警</h2>
            <span class="section-note">证据链自动汇总，处置结论永久留痕</span>
          </div>
          <el-button link type="primary" @click="router.push('/trace')">进入预警中心</el-button>
        </div>

        <div v-if="!data.recentAlerts.length" class="empty-line">渠道流向健康，暂无异常。</div>

        <ul v-else class="alerts">
          <li v-for="a in data.recentAlerts" :key="a.id" class="alert-row">
            <span class="alert-level" :class="severityClass(a.severity)">{{ a.severity }}</span>
            <div class="alert-body">
              <div class="alert-title">{{ a.title }}</div>
              <div class="alert-meta">
                {{ a.org?.name || '总部/未知' }} · {{ a.alertType }}
                <span v-if="a.traceCodeToken" class="mono alert-code">{{ a.traceCodeToken }}</span>
              </div>
            </div>
            <span class="alert-state" :class="a.status === 'RESOLVED' ? 'done' : 'open'">
              {{ a.status === 'RESOLVED' ? '已结案' : '待处置' }}
            </span>
          </li>
        </ul>
      </section>
    </template>

    <div v-else class="loading-block">
      <span class="dot" /><span class="dot" /><span class="dot" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import CodeChain from '../components/CodeChain.vue';

const router = useRouter();
const auth = useAuthStore();
const data = ref<any>(null);
const inStockQty = ref<number | string>('—');
const warehouseCount = ref(0);

const todayLabel = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date());

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});

const chainStages = computed(() => {
  const k = data.value?.kpis;
  if (!k) return [];
  return [
    { key: 'factory', label: '出厂赋码', value: k.totalUnitsGenerated, note: '独立身份', state: 'done' as const },
    { key: 'hq', label: '总仓在库', value: inStockQty.value, note: `${warehouseCount.value} 个仓`, state: 'active' as const },
    { key: 'dealer', label: '服务商流向', value: k.totalSalesQty, note: '盒已出库', state: 'done' as const },
    { key: 'clinic', label: '终端机构', value: k.activeClinicsCount, note: '在保护/绑定中', state: 'done' as const },
    { key: 'consumer', label: '顾客验真', value: k.totalVerifiedConsumers, note: '次扫码', state: 'idle' as const },
  ];
});

async function loadData() {
  data.value = await api.get('/reports/dashboard');
  api
    .get('/stock/balances')
    .then((rows: any) => {
      const list = rows as unknown as any[];
      inStockQty.value = list.reduce((s, r) => s + Number(r.qty || 0), 0).toLocaleString();
      warehouseCount.value = new Set(list.map((r) => r.warehouseId)).size;
    })
    .catch(() => {
      inStockQty.value = '—';
    });
}

function severityClass(s: string) {
  if (s === 'CRITICAL' || s === 'HIGH') return 'high';
  return 'medium';
}

function openOrder(order: any) {
  router.push({ path: '/sales', query: { outbound: order.id } });
}

onMounted(loadData);
</script>

<style scoped>
/* 码链卡 */
.chain-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 16px 22px 20px;
  margin-bottom: 16px;
}
.chain-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 12px;
  margin-bottom: 16px;
}

.two-col {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 1fr);
  gap: 16px;
  margin-bottom: 16px;
  align-items: start;
}

/* 待出库队列 */
.queue {
  list-style: none;
  margin: 0;
  padding: 0;
}
.queue-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.queue-row:last-child {
  border-bottom: 0;
  padding-bottom: 2px;
}
.q-main {
  flex: 1;
  min-width: 0;
}
.q-top {
  display: flex;
  align-items: baseline;
  gap: 9px;
}
.q-doc {
  font-size: 12.5px;
  color: var(--brand-ink);
  font-weight: 600;
}
.q-scene {
  font-size: 10.5px;
  color: var(--ink-3);
  border-left: 1px solid var(--line-strong);
  padding-left: 9px;
}
.q-buyer {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.q-meta {
  font-size: 11.5px;
  color: var(--ink-3);
  margin-top: 2px;
}
.q-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  flex-shrink: 0;
}
.q-amount {
  font-size: 14px;
  color: var(--ink);
}
.q-status {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid transparent;
}
.q-status.ready {
  color: var(--brand-ink);
  background: var(--brand-tint);
  border-color: var(--brand-line);
}
.q-status.warn {
  color: var(--seal);
  background: var(--seal-tint);
  border-color: var(--seal-line);
}
.q-action {
  flex-shrink: 0;
  min-width: 76px;
}

/* 倒计时 */
.countdown {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cd-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0 13px;
  border-bottom: 1px solid var(--line);
}
.cd-row:last-child {
  border-bottom: 0;
}
.cd-body {
  flex: 1;
  min-width: 0;
}
.cd-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cd-meta {
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cd-days {
  font-family: var(--font-num);
  font-size: 20px;
  color: var(--ink);
  line-height: 1;
  flex-shrink: 0;
}
.cd-days span {
  font-family: var(--font-ui);
  font-size: 10.5px;
  color: var(--ink-3);
  margin-left: 2px;
}
.cd-days.urgent {
  color: var(--seal);
}
.cd-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 5px;
  height: 2px;
  background: var(--surface-3);
  border-radius: 2px;
  overflow: hidden;
}
.cd-bar span {
  display: block;
  height: 100%;
  background: var(--brand-line);
  transition: width 0.4s ease;
}
.cd-bar span.urgent {
  background: var(--seal-line);
}

/* 预警 */
.alerts {
  list-style: none;
  margin: 0;
  padding: 0;
}
.alert-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--line);
}
.alert-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.alert-level {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
  width: 58px;
  text-align: center;
}
.alert-level.high {
  background: var(--seal-tint);
  color: var(--seal);
  border: 1px solid var(--seal-line);
}
.alert-level.medium {
  background: var(--ochre-tint);
  color: var(--ochre);
  border: 1px solid #e6d5ae;
}
.alert-body {
  flex: 1;
  min-width: 0;
}
.alert-title {
  font-size: 13px;
  color: var(--ink);
}
.alert-meta {
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 2px;
}
.alert-code {
  margin-left: 6px;
  color: var(--brand-ink);
}
.alert-state {
  font-size: 11px;
  flex-shrink: 0;
}
.alert-state.done {
  color: var(--jade);
}
.alert-state.open {
  color: var(--seal);
}

.loading-block {
  display: flex;
  gap: 6px;
  padding: 80px 0;
  justify-content: center;
}
.loading-block .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-line);
  animation: blink 1.2s ease-in-out infinite;
}
.loading-block .dot:nth-child(2) {
  animation-delay: 0.15s;
}
.loading-block .dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}

@media (max-width: 1100px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 720px) {
  .queue-row {
    flex-wrap: wrap;
  }
  .q-side {
    align-items: flex-start;
  }
  .q-action {
    width: 100%;
  }
}
</style>
