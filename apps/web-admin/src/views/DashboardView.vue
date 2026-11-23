<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">供销溯源与渠道管控总览</h1>
        <p class="page-subtitle">实时监测一物一码流向、3.5 折供货红线、90/270 天机构保护及仓库出库进度</p>
      </div>
      <div style="display: flex; gap: 10px">
        <el-button @click="loadData">刷新数据</el-button>
        <el-button type="primary" @click="router.push('/sales')">快捷开单 / 扫码出库</el-button>
      </div>
    </div>

    <div class="kpi-grid" v-if="data">
      <div class="kpi-card">
        <div class="kpi-label"><span>累计赋码单品数</span><el-tag size="small" type="success">防伪在控</el-tag></div>
        <div class="kpi-value mono">{{ data.kpis.totalUnitsGenerated }}</div>
        <div class="kpi-meta">终端顾客扫码验真 {{ data.kpis.totalVerifiedConsumers }} 次</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>有效销售额（毛利率）</span></div>
        <div class="kpi-value mono">¥{{ data.kpis.totalSalesAmount.toLocaleString() }}</div>
        <div class="kpi-meta">毛利 ¥{{ data.kpis.grossProfit.toLocaleString() }}（{{ data.kpis.grossMarginPercent }}%）· 售出 {{ data.kpis.totalSalesQty }} 盒</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>待扫码出库订单</span><el-tag size="small" type="warning">需处理</el-tag></div>
        <div class="kpi-value mono">{{ data.kpis.pendingOutboundCount }}</div>
        <div class="kpi-meta">活跃归属终端机构 {{ data.kpis.activeClinicsCount }} 家</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>未处置风控预警</span><el-tag size="small" :type="data.kpis.openAlertsCount > 0 ? 'danger' : 'success'">流向监控</el-tag></div>
        <div class="kpi-value mono" :style="{ color: data.kpis.openAlertsCount > 0 ? 'var(--danger)' : 'var(--success)' }">
          {{ data.kpis.openAlertsCount }}
        </div>
        <div class="kpi-meta">跨区窜货 / 破价红线 / 账实差异自动汇聚</div>
      </div>
    </div>

    <div class="dashboard-two-col" v-if="data">
      <div class="surface-card">
        <div class="section-header">
          <h3 class="section-title">待出库 / 待审批订单队列</h3>
          <el-button link type="primary" @click="router.push('/sales')">前往处理 →</el-button>
        </div>
        <el-table :data="data.pendingOrders" size="small" empty-text="当前无待出库订单">
          <el-table-column prop="docNo" label="单号" width="145">
            <template #default="{ row }"><span class="mono">{{ row.docNo }}</span></template>
          </el-table-column>
          <el-table-column label="客户/服务商">
            <template #default="{ row }">{{ row.buyerOrg?.name || row.clinic?.name || '-' }}</template>
          </el-table-column>
          <el-table-column label="金额" width="95" align="right">
            <template #default="{ row }"><span class="mono">¥{{ Number(row.totalAmount).toFixed(2) }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="105">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'PENDING_APPROVAL' ? 'danger' : 'warning'">
                {{ row.status === 'PENDING_APPROVAL' ? '红线待特批' : '待扫码出库' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="surface-card">
        <div class="section-header">
          <h3 class="section-title">90 天保护 / 270 天解绑即将到期提醒</h3>
          <el-button link type="primary" @click="router.push('/channels')">机构管理 →</el-button>
        </div>
        <el-table :data="data.expiringClinics" size="small" empty-text="暂无 30 天内到期机构">
          <el-table-column prop="name" label="终端机构" />
          <el-table-column label="归属服务商" width="145">
            <template #default="{ row }">{{ row.ownerOrg?.name || '-' }}</template>
          </el-table-column>
          <el-table-column prop="warnType" label="规则类型" width="120" />
          <el-table-column label="剩余天数" width="90" align="right">
            <template #default="{ row }">
              <el-tag size="small" :type="row.daysLeft <= 15 ? 'danger' : 'warning'">
                {{ row.daysLeft }} 天
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <div class="surface-card" style="margin-top: 16px" v-if="data">
      <div class="section-header">
        <h3 class="section-title">最新窜货与合规风控预警</h3>
        <el-button link type="primary" @click="router.push('/trace')">进入预警中心 →</el-button>
      </div>
      <el-table :data="data.recentAlerts" size="small" empty-text="当前渠道流向健康，无异常预警">
        <el-table-column label="级别" width="82">
          <template #default="{ row }">
            <el-tag size="small" :type="row.severity === 'CRITICAL' || row.severity === 'HIGH' ? 'danger' : 'warning'">
              {{ row.severity }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="预警事件" min-width="240" />
        <el-table-column label="涉事主体" width="170">
          <template #default="{ row }">{{ row.org?.name || '总部/未知' }}</template>
        </el-table-column>
        <el-table-column prop="traceCodeToken" label="关联码/单号" width="160">
          <template #default="{ row }">
            <span class="mono">{{ row.traceCodeToken || row.docNo || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'RESOLVED' ? 'success' : 'danger'">
              {{ row.status === 'RESOLVED' ? '已结案' : '待处置' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../utils/api';

const router = useRouter();
const data = ref<any>(null);

async function loadData() {
  data.value = await api.get('/reports/dashboard');
}

onMounted(loadData);
</script>

<style scoped>
.dashboard-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 1100px) {
  .dashboard-two-col {
    grid-template-columns: 1fr;
  }
}
</style>
