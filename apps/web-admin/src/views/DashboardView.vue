<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">总控台</h1>
        <p class="page-subtitle">
          待处理：{{ data?.kpis.pendingOutboundCount ?? 0 }} 单待扫码出库 · {{ unresolvedAlerts.length }} 条未结案预警
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="exportLedger">导出台账</el-button>
        <el-button type="primary" @click="router.push('/purchase')">扫码入库建档</el-button>
      </div>
    </div>

    <template v-if="data">
      <!-- 无框数字带 -->
      <div class="kpi-grid">
        <div class="kpi-cell" :class="{ warn: data.kpis.pendingOutboundCount > 0 }">
          <div class="kpi-label"><span class="signal-dot" :class="{ warn: data.kpis.pendingOutboundCount > 0 }" />待扫码出库</div>
          <div class="kpi-value">{{ data.kpis.pendingOutboundCount }}<span class="unit">单</span></div>
          <div class="kpi-meta">待逐码绑定客户</div>
        </div>
        <div class="kpi-cell" :class="{ danger: unresolvedAlerts.length > 0 }">
          <div class="kpi-label"><span class="signal-dot" :class="{ danger: unresolvedAlerts.length > 0 }" />待处置预警</div>
          <div class="kpi-value">{{ unresolvedAlerts.length }}<span class="unit">条</span></div>
          <div class="kpi-meta">跨区窜货 / 破价 / 账实差异</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">当前在库</div>
          <div class="kpi-value">{{ inStockQty }}<span class="unit">盒</span></div>
          <div class="kpi-meta">{{ warehouseCount }} 个仓库 · 支持单品级溯源</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">累计供货额</div>
          <div class="kpi-value">¥{{ data.kpis.totalSalesAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</div>
          <div class="kpi-meta">毛利率 {{ data.kpis.grossMarginPercent }}%</div>
        </div>
      </div>

      <!-- 唯一视觉中心：待处理工作台 -->
      <section class="workbench">
        <div class="wb-tabs" role="tablist">
          <button
            v-for="t in tabs"
            :key="t.key"
            type="button"
            class="wb-tab"
            :class="{ on: tab === t.key }"
            @click="switchTab(t.key)"
          >
            {{ t.label }}
            <span class="wb-count" :class="t.tone">{{ t.count }}</span>
          </button>
        </div>

        <div class="bulk-bar">
          <div class="bulk-left">
            <el-select v-if="tab === 'orders'" v-model="orderStatus" clearable size="small" placeholder="全部状态" style="width: 130px">
              <el-option label="待扫码" value="PENDING_OUTBOUND" />
              <el-option label="部分出库" value="PARTIAL_OUTBOUND" />
              <el-option label="红线待特批" value="PENDING_APPROVAL" />
            </el-select>
            <el-select v-else-if="tab === 'alerts'" v-model="alertSeverity" clearable size="small" placeholder="全部级别" style="width: 130px">
              <el-option label="CRITICAL" value="CRITICAL" />
              <el-option label="HIGH" value="HIGH" />
              <el-option label="MEDIUM" value="MEDIUM" />
              <el-option label="LOW" value="LOW" />
            </el-select>
            <el-select v-else v-model="clinicWindow" size="small" style="width: 130px">
              <el-option label="30 天内" :value="30" />
              <el-option label="15 天内" :value="15" />
              <el-option label="7 天内" :value="7" />
            </el-select>
            <el-input
              v-model="keyword"
              size="small"
              clearable
              :placeholder="tab === 'orders' ? '搜索单号 / 客户' : tab === 'alerts' ? '搜索标题 / 组织 / 防伪码' : '搜索机构 / 归属'"
              style="width: 220px"
            />
          </div>
          <div class="bulk-right">
            <span class="bulk-count">已选 <strong>{{ selection.length }}</strong> 项</span>
            <el-button v-if="tab === 'orders'" size="small" :disabled="!selection.length" @click="printPicking">批量打印拣货单</el-button>
            <el-button size="small" @click="exportCsv">导出 CSV</el-button>
          </div>
        </div>

        <!-- 待扫码出库 -->
        <el-table
          v-if="tab === 'orders'"
          :data="filteredOrders"
          size="small"
          style="width: 100%"
          row-key="id"
          empty-text="暂无待出库订单，销售在手机端下单后会实时出现在这里"
          @selection-change="onSelect"
        >
          <el-table-column type="selection" width="44" />
          <el-table-column label="单号" width="160">
            <template #default="{ row }"><span class="mono doc">{{ row.docNo }}</span></template>
          </el-table-column>
          <el-table-column label="客户 / 场景" min-width="220">
            <template #default="{ row }">
              <div class="cell-strong">{{ row.buyerOrg?.name || row.clinic?.name || '—' }}</div>
              <div class="cell-sub">{{ row.orderScene === 'HQ_TO_DEALER' ? '总仓 → 服务商' : '服务商 → 机构' }} · {{ row.warehouse?.name || '默认仓' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="数量" width="90" align="right">
            <template #default="{ row }"><span class="num">{{ qtyOf(row) }} 盒</span></template>
          </el-table-column>
          <el-table-column label="金额" width="120" align="right">
            <template #default="{ row }"><span class="num">¥{{ Number(row.totalAmount).toFixed(2) }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="112">
            <template #default="{ row }">
              <span class="status-tag" :class="row.status === 'PENDING_APPROVAL' ? 'danger' : 'warn'">
                {{ orderStatusLabel(row.status) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="96" align="right">
            <template #default="{ row }">
              <el-button size="small" link @click="openOrder(row)">{{ row.status === 'PENDING_APPROVAL' ? '去审批' : '去扫码' }}</el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 合规与窜货预警 -->
        <el-table
          v-else-if="tab === 'alerts'"
          :data="filteredAlerts"
          size="small"
          style="width: 100%"
          row-key="id"
          empty-text="渠道流向健康，暂无未结案预警"
          @selection-change="onSelect"
        >
          <el-table-column type="selection" width="44" />
          <el-table-column label="级别" width="96">
            <template #default="{ row }">
              <span class="status-tag" :class="['CRITICAL', 'HIGH'].includes(row.severity) ? 'danger' : 'warn'">{{ row.severity }}</span>
            </template>
          </el-table-column>
          <el-table-column label="预警" min-width="260">
            <template #default="{ row }">
              <div class="cell-strong">{{ row.title }}</div>
              <div class="cell-sub">{{ alertTypeLabel(row.alertType) }} · {{ row.org?.name || '总部 / 未知' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="防伪码 / 单号" width="180">
            <template #default="{ row }">
              <span v-if="row.traceCodeToken" class="mono cell-sub">{{ row.traceCodeToken }}</span>
              <span v-else-if="row.docNo" class="mono cell-sub">{{ row.docNo }}</span>
              <span v-else class="cell-sub">—</span>
            </template>
          </el-table-column>
          <el-table-column label="发生时间" width="140">
            <template #default="{ row }"><span class="mono cell-sub">{{ fmt(row.createdAt) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="96" align="right">
            <template #default>
              <el-button size="small" link @click="router.push({ path: '/trace', query: { tab: 'alerts' } })">去处置</el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 保护期临期 -->
        <el-table
          v-else
          :data="filteredClinics"
          size="small"
          style="width: 100%"
          row-key="id"
          empty-text="当前窗口内没有临期机构"
          @selection-change="onSelect"
        >
          <el-table-column type="selection" width="44" />
          <el-table-column label="机构" min-width="220">
            <template #default="{ row }">
              <div class="cell-strong">{{ row.name }}</div>
              <div class="cell-sub">{{ row.city || '—' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="归属服务商" min-width="180">
            <template #default="{ row }">{{ row.ownerOrg?.name || '总部直营' }}</template>
          </el-table-column>
          <el-table-column label="到期类型" width="150">
            <template #default="{ row }"><span class="cell-sub">{{ row.warnType }}</span></template>
          </el-table-column>
          <el-table-column label="剩余" width="96" align="right">
            <template #default="{ row }">
              <span class="num days" :class="{ urgent: row.daysLeft <= 15 }">{{ row.daysLeft }} 天</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="96" align="right">
            <template #default>
              <el-button size="small" link @click="router.push('/channels')">去跟进</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <!-- 底部轻量化流向条 -->
      <section class="flow-strip">
        <div class="flow-head">
          <span class="flow-title">一物一码流向概览</span>
          <button type="button" class="flow-link" @click="router.push('/trace')">进入流向中心 →</button>
        </div>
        <div class="flow-row">
          <template v-for="(s, i) in flowStages" :key="s.label">
            <button type="button" class="flow-node" @click="router.push(s.to)">
              <span class="flow-label">{{ s.label }}</span>
              <span class="flow-value num">{{ s.value }}</span>
            </button>
            <span v-if="i < flowStages.length - 1" class="flow-line" aria-hidden="true" />
          </template>
        </div>
      </section>
    </template>

    <div v-else class="loading-block"><span class="dot" /><span class="dot" /><span class="dot" /></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../utils/api';

const router = useRouter();
const data = ref<any>(null);
const alerts = ref<any[]>([]);
const inStockQty = ref<number | string>('—');
const warehouseCount = ref(0);

const tab = ref<'orders' | 'alerts' | 'clinics'>('orders');
const keyword = ref('');
const orderStatus = ref('');
const alertSeverity = ref('');
const clinicWindow = ref(30);
const selection = ref<any[]>([]);

const unresolvedAlerts = computed(() => alerts.value.filter((a) => a.status !== 'RESOLVED'));
const expiring = computed(() => (data.value?.expiringClinics || []) as any[]);

const tabs = computed(() => [
  { key: 'orders' as const, label: '待扫码出库', count: data.value?.pendingOrders?.length || 0, tone: 'warn' },
  { key: 'alerts' as const, label: '合规与窜货预警', count: unresolvedAlerts.value.length, tone: 'danger' },
  { key: 'clinics' as const, label: '保护期临期', count: expiring.value.length, tone: 'warn' },
]);

function includesKw(...fields: Array<string | undefined | null>) {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return true;
  return fields.some((f) => (f || '').toLowerCase().includes(kw));
}

const filteredOrders = computed(() =>
  ((data.value?.pendingOrders || []) as any[]).filter(
    (o) =>
      (!orderStatus.value || o.status === orderStatus.value) &&
      includesKw(o.docNo, o.buyerOrg?.name, o.clinic?.name),
  ),
);
const filteredAlerts = computed(() =>
  unresolvedAlerts.value.filter(
    (a) => (!alertSeverity.value || a.severity === alertSeverity.value) && includesKw(a.title, a.org?.name, a.traceCodeToken, a.docNo),
  ),
);
const filteredClinics = computed(() =>
  expiring.value.filter((c) => c.daysLeft <= clinicWindow.value && includesKw(c.name, c.ownerOrg?.name, c.city)),
);

const flowStages = computed(() => {
  const k = data.value?.kpis;
  if (!k) return [];
  return [
    { label: '出厂赋码', value: k.totalUnitsGenerated, to: '/trace' },
    { label: '总仓在库', value: inStockQty.value, to: '/inventory' },
    { label: '已出库', value: k.totalSalesQty, to: '/sales' },
    { label: '终端机构', value: k.activeClinicsCount, to: '/channels' },
    { label: '顾客验真', value: k.totalVerifiedConsumers, to: '/trace' },
  ];
});

watch(tab, () => {
  keyword.value = '';
  selection.value = [];
});

function switchTab(k: 'orders' | 'alerts' | 'clinics') {
  tab.value = k;
}
function onSelect(rows: any[]) {
  selection.value = rows;
}
function qtyOf(o: any) {
  return (o.items || []).reduce((s: number, i: any) => s + Number(i.qty || 0), 0);
}
function orderStatusLabel(s: string) {
  return ({ PENDING_APPROVAL: '红线待特批', PENDING_OUTBOUND: '待扫码', PARTIAL_OUTBOUND: '部分出库' } as Record<string, string>)[s] || s;
}
function alertTypeLabel(t: string) {
  return (
    ({
      CROSS_REGION: '跨区窜货',
      UNAUTHORIZED_SCAN: '非授权扫码',
      HIGH_FREQ_VERIFY: '高频验真',
      PRICE_BELOW_REDLINE: '低于供货红线',
      RETAIL_PRICE_REPORT: '零售破价举报',
      RECONCILIATION_VARIANCE: '账实差异',
    } as Record<string, string>)[t] || t
  );
}
function fmt(t: string) {
  return new Date(t).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).replace(/\//g, '-').slice(0, 16);
}
function openOrder(order: any) {
  router.push({ path: '/sales', query: { outbound: order.id } });
}

function downloadCsv(name: string, header: string[], rows: Array<Array<unknown>>) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([`\ufeff${header.join(',')}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCsv() {
  if (tab.value === 'orders') {
    const rows = (selection.value.length ? selection.value : filteredOrders.value).map((o) => [
      o.docNo,
      o.buyerOrg?.name || o.clinic?.name || '',
      o.orderScene === 'HQ_TO_DEALER' ? '总仓→服务商' : '服务商→机构',
      qtyOf(o),
      Number(o.totalAmount).toFixed(2),
      orderStatusLabel(o.status),
    ]);
    downloadCsv('lumina-pending-orders', ['单号', '客户', '场景', '数量', '金额', '状态'], rows);
  } else if (tab.value === 'alerts') {
    const rows = (selection.value.length ? selection.value : filteredAlerts.value).map((a) => [
      a.severity,
      alertTypeLabel(a.alertType),
      a.title,
      a.org?.name || '',
      a.traceCodeToken || a.docNo || '',
      fmt(a.createdAt),
    ]);
    downloadCsv('lumina-alerts', ['级别', '类型', '标题', '组织', '防伪码/单号', '时间'], rows);
  } else {
    const rows = (selection.value.length ? selection.value : filteredClinics.value).map((c) => [
      c.name,
      c.ownerOrg?.name || '总部直营',
      c.warnType,
      c.daysLeft,
    ]);
    downloadCsv('lumina-expiring-clinics', ['机构', '归属', '到期类型', '剩余天数'], rows);
  }
}

function exportLedger() {
  const rows = ((data.value?.pendingOrders || []) as any[]).map((o) => [
    o.docNo,
    o.buyerOrg?.name || o.clinic?.name || '',
    qtyOf(o),
    Number(o.totalAmount).toFixed(2),
    orderStatusLabel(o.status),
  ]);
  downloadCsv('lumina-dashboard-ledger', ['单号', '客户', '数量', '金额', '状态'], rows);
}

function printPicking() {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  const blocks = selection.value
    .map(
      (o) => `<section><h2>${esc(o.docNo)}</h2><p>${esc(o.buyerOrg?.name || o.clinic?.name || '—')} · ${esc(o.warehouse?.name || '默认仓')}</p>
      <table><thead><tr><th>商品</th><th>数量</th><th>已出库</th></tr></thead><tbody>${(o.items || [])
        .map((i: any) => `<tr><td>${esc(i.product?.name)}</td><td>${esc(i.qty)}</td><td>${esc(i.outboundQty ?? 0)}</td></tr>`)
        .join('')}</tbody></table></section>`,
    )
    .join('');
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>拣货单</title><style>
    body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#111827;padding:24px}
    h1{font-size:18px;margin:0 0 16px}section{border-top:1px solid #d1d5db;padding:12px 0;break-inside:avoid}
    h2{font-size:14px;margin:0;font-family:ui-monospace,Menlo,monospace}p{margin:4px 0 8px;font-size:12px;color:#4b5563}
    table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #eceef2;padding:6px 4px;text-align:left}
    th{color:#6b7280;font-weight:500}</style></head><body><h1>Lumina 出库拣货单 · ${selection.value.length} 单</h1>${blocks}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

async function loadData() {
  const [dashRes, stockRes, alertRes] = await Promise.allSettled([
    api.get('/reports/dashboard'),
    api.get('/stock/balances'),
    api.get('/trace/alerts'),
  ]);
  if (stockRes.status === 'fulfilled') {
    const list = stockRes.value as unknown as any[];
    inStockQty.value = list.reduce((s, r) => s + Number(r.qty || 0), 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    warehouseCount.value = new Set(list.map((r) => r.warehouseId)).size;
  } else {
    inStockQty.value = '0';
    warehouseCount.value = 0;
  }
  if (dashRes.status === 'fulfilled') {
    data.value = dashRes.value;
  }
  if (alertRes.status === 'fulfilled') {
    alerts.value = alertRes.value as unknown as any[];
  } else {
    alerts.value = (data.value?.recentAlerts || []) as any[];
  }
}

onMounted(() => {
  loadData();
  window.addEventListener('lumina:scan-activity', loadData);
});
onUnmounted(() => {
  window.removeEventListener('lumina:scan-activity', loadData);
});
</script>

<style scoped>
.workbench {
  border: 1px solid var(--border-hairline);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 40px;
}
.wb-tabs {
  display: flex;
  gap: 28px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border-hairline);
}
.wb-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.wb-tab:hover {
  color: var(--ink-primary);
}
.wb-tab.on {
  color: var(--ink-primary);
  font-weight: 600;
  border-bottom-color: #111827;
}
.wb-count {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 10px;
  font-size: 11.5px;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  background: var(--bg-subtle);
  color: var(--ink-secondary);
}
.wb-tab.on .wb-count.warn {
  background: var(--status-warn-bg);
  color: var(--status-warn);
}
.wb-tab.on .wb-count.danger {
  background: var(--status-danger-bg);
  color: var(--status-danger);
}
.workbench :deep(.el-table th.el-table__cell) {
  background: #ffffff;
}
.doc {
  font-size: 12.5px;
  font-weight: 600;
}
.cell-strong {
  font-weight: 500;
  color: var(--ink-primary);
}
.cell-sub {
  font-size: 12px;
  color: var(--ink-muted);
}
.days {
  font-weight: 600;
  color: var(--status-warn);
}
.days.urgent {
  color: var(--status-danger);
}

.flow-strip {
  padding-top: 4px;
}
.flow-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.flow-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-primary);
}
.flow-link {
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-secondary);
  cursor: pointer;
}
.flow-link:hover {
  color: var(--ink-primary);
}
.flow-row {
  display: flex;
  align-items: center;
  padding: 16px 0;
  border-top: 1px solid var(--border-hairline);
  border-bottom: 1px solid var(--border-hairline);
}
.flow-node {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  border: 0;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  white-space: nowrap;
}
.flow-node:hover {
  background: var(--bg-hover);
}
.flow-label {
  font-size: 12.5px;
  color: var(--ink-muted);
}
.flow-value {
  font-size: 17px;
  font-weight: 600;
  color: var(--ink-primary);
}
.flow-line {
  flex: 1;
  height: 1px;
  min-width: 16px;
  margin: 0 12px;
  background: var(--border-hairline);
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
  background: var(--border-strong);
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

@media (max-width: 900px) {
  .flow-row {
    flex-wrap: wrap;
    gap: 8px 0;
  }
  .flow-line {
    display: none;
  }
  .wb-tabs {
    gap: 16px;
    overflow-x: auto;
  }
}
</style>
