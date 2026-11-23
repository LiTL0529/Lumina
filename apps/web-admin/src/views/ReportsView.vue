<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">多维销售毛利报表与 KPI 返点自动核算</h1>
        <p class="page-subtitle">自动拉取回款额、新开有效机构数、核心 SKU 覆盖率与合规扣款，输出 100% 可审计的返点核算单</p>
      </div>
      <div style="display: flex; gap: 10px">
        <el-input v-model="periodMonth" style="width: 130px" placeholder="YYYY-MM" />
        <el-button v-if="auth.isHQ" type="primary" :loading="calculating" @click="recalculateRebates">
          自动核算 {{ periodMonth }} KPI 返点
        </el-button>
      </div>
    </div>

    <div class="kpi-grid" v-if="salesReport">
      <div class="kpi-card">
        <div class="kpi-label">销售商品总数</div>
        <div class="kpi-value mono">{{ salesReport.summary.totalQty }} 盒</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">累计销售额</div>
        <div class="kpi-value mono">¥{{ salesReport.summary.totalSales.toLocaleString() }}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">销售毛利</div>
        <div class="kpi-value mono" style="color: var(--success)">¥{{ salesReport.summary.totalProfit.toLocaleString() }}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">综合销售毛利率</div>
        <div class="kpi-value mono">{{ salesReport.summary.marginRate }}%</div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="surface-card">
      <el-tab-pane label="服务商 KPI 返点审计核算单" name="rebates">
        <el-table :data="rebates" size="small" empty-text="点击右上角「自动核算 KPI 返点」一键生成可审计返点单">
          <el-table-column prop="periodMonth" label="账期" width="95">
            <template #default="{ row }"><span class="mono">{{ row.periodMonth }}</span></template>
          </el-table-column>
          <el-table-column label="服务商" min-width="170">
            <template #default="{ row }"><strong>{{ row.org?.name }}</strong></template>
          </el-table-column>
          <el-table-column label="有效回款额" width="120" align="right">
            <template #default="{ row }"><span class="mono">¥{{ Number(row.paymentAmount).toLocaleString() }}</span></template>
          </el-table-column>
          <el-table-column prop="newActiveClinics" label="活跃机构数" width="95" align="center" />
          <el-table-column label="核心SKU覆盖率" width="135" align="center">
            <template #default="{ row }">
              <span class="mono">{{ row.activeCoreSkuCount }}/{{ row.totalCoreSkuCount }} ({{ (Number(row.skuCoverageRate) * 100).toFixed(0) }}%)</span>
            </template>
          </el-table-column>
          <el-table-column label="返点率(基础+奖励)" width="140" align="center">
            <template #default="{ row }">
              <span class="mono">{{ (Number(row.baseRebateRate) * 100).toFixed(0) }}% + {{ (Number(row.bonusRebateRate) * 100).toFixed(0) }}%</span>
            </template>
          </el-table-column>
          <el-table-column label="合规扣减" width="100" align="right">
            <template #default="{ row }">
              <span class="mono" :style="{ color: Number(row.penaltyDeduction) > 0 ? 'var(--danger)' : 'var(--text-muted)' }">
                -¥{{ Number(row.penaltyDeduction).toFixed(0) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="最终应发返点" width="125" align="right">
            <template #default="{ row }">
              <strong class="mono" style="color: var(--brand-primary); font-size: 14px">
                ¥{{ Number(row.finalRebateAmount).toFixed(2) }}
              </strong>
            </template>
          </el-table-column>
          <el-table-column label="审计穿透" width="100">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="viewSnapshot(row)">查依据</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="销售报表（明细 / 商品 / 客户）" name="sales">
        <div style="margin-bottom: 12px">
          <el-radio-group v-model="salesGroup" @change="loadSalesReport">
            <el-radio-button value="detail">销售明细</el-radio-button>
            <el-radio-button value="product">按商品汇总</el-radio-button>
            <el-radio-button value="customer">按客户/服务商汇总</el-radio-button>
          </el-radio-group>
        </div>

        <el-table v-if="salesGroup === 'detail'" :data="salesReport?.rows || []" size="small">
          <el-table-column prop="bizDate" label="日期" width="105" />
          <el-table-column prop="docNo" label="单号" width="145" />
          <el-table-column prop="customerName" label="客户/服务商" min-width="150" />
          <el-table-column prop="productName" label="商品名称" min-width="160" />
          <el-table-column prop="qty" label="数量" width="75" align="right" />
          <el-table-column label="折扣" width="75" align="right">
            <template #default="{ row }">{{ row.discountPercent }}%</template>
          </el-table-column>
          <el-table-column label="销售额" width="100" align="right">
            <template #default="{ row }"><span class="mono">¥{{ row.lineAmount.toFixed(2) }}</span></template>
          </el-table-column>
          <el-table-column label="毛利" width="95" align="right">
            <template #default="{ row }"><span class="mono">¥{{ row.grossProfit.toFixed(2) }}</span></template>
          </el-table-column>
        </el-table>

        <el-table v-else-if="salesGroup === 'product'" :data="salesReport?.rows || []" size="small">
          <el-table-column prop="skuCode" label="货号" width="120" />
          <el-table-column prop="productName" label="商品名称" />
          <el-table-column prop="brandName" label="品牌" width="130" />
          <el-table-column prop="qty" label="累计销量" width="100" align="right" />
          <el-table-column label="销售额" width="120" align="right">
            <template #default="{ row }"><span class="mono">¥{{ row.lineAmount.toFixed(2) }}</span></template>
          </el-table-column>
          <el-table-column label="毛利" width="120" align="right">
            <template #default="{ row }"><span class="mono">¥{{ row.grossProfit.toFixed(2) }}</span></template>
          </el-table-column>
        </el-table>

        <el-table v-else :data="salesReport?.rows || []" size="small">
          <el-table-column prop="customerName" label="客户 / 服务商" />
          <el-table-column prop="orderCount" label="订单行数" width="100" align="right" />
          <el-table-column prop="qty" label="累计拿货盒数" width="120" align="right" />
          <el-table-column label="累计销售额" width="130" align="right">
            <template #default="{ row }"><span class="mono">¥{{ row.lineAmount.toFixed(2) }}</span></template>
          </el-table-column>
          <el-table-column label="贡献毛利" width="130" align="right">
            <template #default="{ row }"><span class="mono">¥{{ row.grossProfit.toFixed(2) }}</span></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="snapshotDialog" title="KPI 返点审计依据快照" width="540px">
      <pre class="mono" style="background: var(--bg-canvas); padding: 14px; border-radius: 8px; overflow: auto; font-size: 12px">{{ JSON.stringify(activeSnapshot, null, 2) }}</pre>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const activeTab = ref('rebates');
const periodMonth = ref(new Date().toISOString().slice(0, 7));
const salesGroup = ref('detail');
const salesReport = ref<any>(null);
const rebates = ref<any[]>([]);
const calculating = ref(false);

const snapshotDialog = ref(false);
const activeSnapshot = ref<any>(null);

async function loadSalesReport() {
  salesReport.value = await api.get('/reports/sales', { params: { groupBy: salesGroup.value } });
}

async function loadRebates() {
  rebates.value = (await api.get('/rebates')) as unknown as any[];
}

async function recalculateRebates() {
  calculating.value = true;
  try {
    await api.post('/rebates/calculate', { periodMonth: periodMonth.value });
    ElMessage.success(`${periodMonth.value} 服务商 KPI 返点核算完成`);
    await loadRebates();
  } finally {
    calculating.value = false;
  }
}

function viewSnapshot(row: any) {
  activeSnapshot.value = row.auditSnapshot;
  snapshotDialog.value = true;
}

onMounted(async () => {
  await Promise.all([loadSalesReport(), loadRebates()]);
});
</script>
