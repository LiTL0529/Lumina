<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">报表与返点</h1>
        <p class="page-subtitle">渠道销售统计与季度返点核算</p>
      </div>
      <div class="page-actions">
        <el-input v-model="periodMonth" style="width: 128px" placeholder="YYYY-MM" />
        <el-button v-if="auth.isHQ" type="primary" :loading="calculating" @click="recalculateRebates">
          核算本月返点
        </el-button>
      </div>
    </div>

    <div class="kpi-grid" v-if="salesReport">
      <div class="kpi-cell">
        <div class="kpi-label">销售数量</div>
        <div class="kpi-value">{{ salesReport.summary.totalQty }}<span class="unit">盒</span></div>
      </div>
      <div class="kpi-cell">
        <div class="kpi-label">销售额</div>
        <div class="kpi-value">¥{{ fmtMoney(salesReport.summary.totalSales) }}</div>
      </div>
      <div class="kpi-cell">
        <div class="kpi-label">毛利</div>
        <div class="kpi-value">¥{{ fmtMoney(salesReport.summary.totalProfit) }}</div>
      </div>
      <div class="kpi-cell">
        <div class="kpi-label">毛利率</div>
        <div class="kpi-value">{{ salesReport.summary.marginRate }}<span class="unit">%</span></div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="plain-tabs">
      <el-tab-pane label="KPI 返点核算" name="rebates">
        <div class="surface-card flush">
          <el-table :data="rebates" size="small" style="width: 100%" empty-text="点右上角「核算本月返点」生成可审计返点单">
            <el-table-column label="账期" width="84">
              <template #default="{ row }"><span class="mono">{{ row.periodMonth }}</span></template>
            </el-table-column>
            <el-table-column label="服务商" min-width="135" show-overflow-tooltip>
              <template #default="{ row }"><span class="cell-strong">{{ row.org?.name }}</span></template>
            </el-table-column>
            <el-table-column label="回款" width="110" align="right">
              <template #default="{ row }"><span class="mono">¥{{ fmtMoney(row.paymentAmount) }}</span></template>
            </el-table-column>
            <el-table-column label="活跃机构" width="82" align="right">
              <template #default="{ row }"><span class="mono">{{ row.newActiveClinics }}</span></template>
            </el-table-column>
            <el-table-column label="SKU 覆盖" width="108" align="right">
              <template #default="{ row }">
                <span class="mono">{{ row.activeCoreSkuCount }}/{{ row.totalCoreSkuCount }}</span>
                <span class="cell-sub"> {{ (Number(row.skuCoverageRate) * 100).toFixed(0) }}%</span>
              </template>
            </el-table-column>
            <el-table-column label="返点率" width="104" align="right">
              <template #default="{ row }">
                <span class="mono">{{ (Number(row.baseRebateRate) * 100).toFixed(0) }}%+{{ (Number(row.bonusRebateRate) * 100).toFixed(0) }}%</span>
              </template>
            </el-table-column>
            <el-table-column label="扣减" width="84" align="right">
              <template #default="{ row }">
                <span class="mono" :class="Number(row.penaltyDeduction) > 0 ? 'bad' : 'muted'">
                  {{ Number(row.penaltyDeduction) > 0 ? `-¥${fmtMoney(row.penaltyDeduction)}` : '—' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="应发返点" width="114" align="right">
              <template #default="{ row }">
                <span class="rebate-amount num">¥{{ fmtMoney(row.finalRebateAmount) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="" width="64" align="right">
              <template #default="{ row }">
                <el-button size="small" link type="primary" @click="viewSnapshot(row)">依据</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="rebateTotal"
              :page-size="rebatePageSize"
              :current-page="rebatePage"
              @current-change="(p: number) => loadRebates(p)"
            />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="销售明细" name="sales">
        <div class="surface-card">
          <div class="seg-row">
            <div class="segmented">
              <button
                v-for="g in groups"
                :key="g.value"
                type="button"
                :class="{ on: salesGroup === g.value }"
                @click="switchGroup(g.value)"
              >
                {{ g.label }}
              </button>
            </div>
            <span class="seg-note">按当前登录主体的数据范围统计</span>
          </div>

          <el-table v-if="salesGroup === 'detail'" :data="salesReport?.rows || []" size="small" empty-text="暂无销售数据">
            <el-table-column prop="bizDate" label="日期" width="96">
              <template #default="{ row }"><span class="mono cell-sub">{{ row.bizDate }}</span></template>
            </el-table-column>
            <el-table-column prop="docNo" label="单号" width="138">
              <template #default="{ row }"><span class="mono">{{ row.docNo }}</span></template>
            </el-table-column>
            <el-table-column prop="customerName" label="客户" min-width="130" show-overflow-tooltip />
            <el-table-column prop="productName" label="商品" min-width="136" show-overflow-tooltip />
            <el-table-column prop="qty" label="数量" width="58" align="right" />
            <el-table-column label="折扣" width="60" align="right">
              <template #default="{ row }"><span class="mono muted">{{ row.discountPercent }}%</span></template>
            </el-table-column>
            <el-table-column label="销售额" width="98" align="right">
              <template #default="{ row }"><span class="mono">¥{{ fmtMoney(row.lineAmount) }}</span></template>
            </el-table-column>
            <el-table-column label="毛利" width="96" align="right">
              <template #default="{ row }">
                <span class="mono" :class="row.grossProfit >= 0 ? 'ok' : 'bad'">¥{{ fmtMoney(row.grossProfit) }}</span>
              </template>
            </el-table-column>
          </el-table>

          <el-table v-else-if="salesGroup === 'product'" :data="salesReport?.rows || []" size="small">
            <el-table-column prop="skuCode" label="货号" width="94">
              <template #default="{ row }"><span class="mono cell-sub">{{ row.skuCode }}</span></template>
            </el-table-column>
            <el-table-column prop="productName" label="商品" min-width="148" show-overflow-tooltip />
            <el-table-column prop="brandName" label="品牌" width="104" show-overflow-tooltip />
            <el-table-column prop="qty" label="销量" width="66" align="right" />
            <el-table-column label="销售额" width="104" align="right">
              <template #default="{ row }"><span class="mono">¥{{ fmtMoney(row.lineAmount) }}</span></template>
            </el-table-column>
            <el-table-column label="毛利" width="104" align="right">
              <template #default="{ row }"><span class="mono">¥{{ fmtMoney(row.grossProfit) }}</span></template>
            </el-table-column>
          </el-table>

          <el-table v-else :data="salesReport?.rows || []" size="small">
            <el-table-column prop="customerName" label="客户 / 服务商" min-width="156" show-overflow-tooltip />
            <el-table-column prop="orderCount" label="订单行" width="82" align="right" />
            <el-table-column prop="qty" label="拿货盒数" width="88" align="right" />
            <el-table-column label="销售额" width="110" align="right">
              <template #default="{ row }"><span class="mono">¥{{ fmtMoney(row.lineAmount) }}</span></template>
            </el-table-column>
            <el-table-column label="毛利" width="110" align="right">
              <template #default="{ row }"><span class="mono">¥{{ fmtMoney(row.grossProfit) }}</span></template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="salesTotal"
              :page-size="salesPageSize"
              :current-page="salesPage"
              @current-change="(p: number) => loadSalesReport(p)"
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-drawer v-model="snapshotDialog" :size="isMobile ? '100%' : '480px'" :with-header="false">
      <div class="drawer-inner">
        <div class="drawer-head">
          <div>
            <div class="drawer-kicker">返点审计依据</div>
            <div class="drawer-title">{{ snapshotTitle }}</div>
          </div>
          <button class="drawer-close" type="button" @click="snapshotDialog = false">×</button>
        </div>

        <div v-if="snapshotRows.length" class="snap-list">
          <div v-for="kv in snapshotRows" :key="kv.key" class="snap-row">
            <span class="snap-key">{{ kv.key }}</span>
            <span class="snap-val" :class="{ mono: kv.mono }">{{ kv.value }}</span>
          </div>
        </div>
        <div v-else class="empty-line">该返点单没有留存的审计快照。</div>

        <button class="raw-toggle" type="button" @click="showRaw = !showRaw">
          {{ showRaw ? '收起原始 JSON' : '查看原始 JSON' }}
        </button>
        <pre v-if="showRaw" class="raw-json mono">{{ JSON.stringify(activeSnapshot, null, 2) }}</pre>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { useViewport } from '../utils/format';

const auth = useAuthStore();
const { width } = useViewport();
const isMobile = computed(() => width.value <= 720);
const activeTab = ref('rebates');
const periodMonth = ref(new Date().toISOString().slice(0, 7));
const salesGroup = ref('detail');
const salesReport = ref<any>(null);
const rebates = ref<any[]>([]);
const calculating = ref(false);

const snapshotDialog = ref(false);
const activeSnapshot = ref<any>(null);
const snapshotTitle = ref('');
const showRaw = ref(false);

const groups = [
  { label: '销售明细', value: 'detail' },
  { label: '按商品', value: 'product' },
  { label: '按客户', value: 'customer' },
];

const snapshotRows = computed(() => {
  const snap = activeSnapshot.value;
  if (!snap || typeof snap !== 'object') return [];
  return Object.entries(snap).map(([key, value]) => ({
    key,
    value:
      typeof value === 'number'
        ? value.toLocaleString('zh-CN')
        : typeof value === 'string'
          ? value
          : JSON.stringify(value),
    mono: typeof value === 'number',
  }));
});

const salesPage = ref(1);
const salesPageSize = 20;
const salesTotal = ref(0);
const rebatePage = ref(1);
const rebatePageSize = 20;
const rebateTotal = ref(0);

function fmtMoney(v: unknown) {
  return Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadSalesReport(p = 1) {
  salesPage.value = p;
  const res = (await api.get('/reports/sales', {
    params: { groupBy: salesGroup.value, page: p, pageSize: salesPageSize },
  })) as any;
  salesReport.value = res;
  salesTotal.value = Number(res?.total ?? res?.rows?.length ?? 0);
}

async function loadRebates(p = 1) {
  rebatePage.value = p;
  const res = (await api.get('/rebates', { params: { page: p, pageSize: rebatePageSize } })) as any;
  rebates.value = Array.isArray(res) ? res : res.items || [];
  rebateTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function switchGroup(g: string) {
  salesGroup.value = g;
  await loadSalesReport(1);
}

async function recalculateRebates() {
  calculating.value = true;
  try {
    await api.post('/rebates/calculate', { periodMonth: periodMonth.value });
    ElMessage.success(`${periodMonth.value} 返点已核算`);
    await loadRebates();
  } finally {
    calculating.value = false;
  }
}

function viewSnapshot(row: any) {
  activeSnapshot.value = row.auditSnapshot;
  snapshotTitle.value = `${row.org?.name} · ${row.periodMonth}`;
  showRaw.value = false;
  snapshotDialog.value = true;
}

onMounted(async () => {
  await Promise.all([loadSalesReport(), loadRebates()]);
});
</script>

<style scoped>
.plain-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}
.cell-strong {
  font-size: 13px;
  font-weight: 600;
}
.cell-sub {
  font-size: 11px;
  color: var(--ink-3);
}
.rebate-amount {
  font-size: 15px;
  font-weight: 600;
  color: var(--brand-ink);
}
.ok {
  color: var(--jade);
}
.bad {
  color: var(--seal);
}
.muted {
  color: var(--ink-3);
}

.seg-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.segmented {
  display: inline-flex;
  padding: 2px;
  background: var(--surface-3);
  border-radius: 6px;
  gap: 2px;
}
.segmented button {
  border: 0;
  background: transparent;
  padding: 6px 11px;
  border-radius: 4px;
  font-size: 12.5px;
  color: var(--ink-2);
  cursor: pointer;
  font-family: inherit;
}
.segmented button.on {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(23, 33, 31, 0.06);
}
.seg-note {
  font-size: 11.5px;
  color: var(--ink-3);
}

/* 抽屉 */
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 6px;
}
.drawer-kicker {
  font-size: 10.5px;
  letter-spacing: 0.12em;
  color: var(--ink-3);
}
.drawer-title {
  font-size: 15px;
  font-weight: 600;
  margin-top: 4px;
}
.drawer-close {
  border: 0;
  background: transparent;
  font-size: 20px;
  color: var(--ink-3);
  cursor: pointer;
  line-height: 1;
}
.snap-list {
  padding: 6px 0;
}
.snap-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
}
.snap-key {
  color: var(--ink-2);
  word-break: break-all;
}
.snap-val {
  color: var(--ink);
  text-align: right;
  font-weight: 500;
  word-break: break-all;
}
.raw-toggle {
  margin-top: 14px;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 5px;
  padding: 6px 12px;
  font-size: 11.5px;
  color: var(--ink-2);
  cursor: pointer;
  font-family: inherit;
}
.raw-json {
  margin-top: 10px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 12px;
  font-size: 11px;
  line-height: 1.6;
  overflow: auto;
  max-height: 320px;
}
</style>
