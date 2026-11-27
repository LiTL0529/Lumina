<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">老客维护看板</h1>
        <p class="page-subtitle">面向已消费合作机构 · 复购动销、健康度评分与防流失维护（不含新客五维冗余项）</p>
      </div>
      <div class="page-actions">
        <el-button @click="router.push('/crm')">切换新客开发 →</el-button>
        <el-button @click="importDialog = true">批量导入历史老客</el-button>
        <el-button type="primary" @click="openVisitModal()">+ 记录老客回访</el-button>
      </div>
    </div>

    <!-- 全局筛选栏 -->
    <div class="surface-card scope-bar">
      <div class="scope-fields">
        <el-select
          v-if="auth.isHQ"
          v-model="scope.orgId"
          clearable
          placeholder="全部代理商（服务商）"
          class="sc-select"
          @change="reloadAll"
        >
          <el-option v-for="d in meta.dealers" :key="d.id" :label="d.name" :value="d.id" />
        </el-select>
        <el-select
          v-model="scope.salesRepName"
          clearable
          filterable
          placeholder="全部业务员"
          class="sc-select-sm"
          @change="reloadAll"
        >
          <el-option v-for="rep in meta.salesReps" :key="rep" :label="rep" :value="rep" />
        </el-select>
        <el-select
          v-model="scope.planMonth"
          clearable
          placeholder="选择月份"
          class="sc-select-sm"
          @change="reloadAll"
        >
          <el-option v-for="m in meta.months" :key="m" :label="m" :value="m" />
        </el-select>
        <el-input
          v-model="scope.keyword"
          clearable
          placeholder="搜索老客门店 / 联系人 / 电话"
          class="sc-search"
          @keyup.enter="reloadAll"
          @clear="reloadAll"
        />
      </div>
      <div class="scope-actions">
        <el-button size="small" @click="reloadAll">刷新汇总</el-button>
      </div>
    </div>

    <!-- 顶部极简 4 指标带 -->
    <div v-if="dash" class="kpi-grid">
      <div class="kpi-cell">
        <div class="kpi-label">合作老客总数</div>
        <div class="kpi-value">
          {{ dash.kpis.totalExistingCount }}
          <span class="unit">家</span>
        </div>
        <div class="kpi-meta">
          活跃 {{ dash.kpis.activeCount }} 家 · 沉睡预警 {{ dash.kpis.dormantCount }} 家
        </div>
      </div>
      <div class="kpi-cell accent">
        <div class="kpi-label">本月老客维护得分</div>
        <div class="kpi-value">
          {{ dash.kpis.maintenanceScore.toFixed(2) }}
          <span class="unit">/ 20 分</span>
        </div>
        <div class="kpi-meta">
          本月已回访 {{ dash.kpis.visitedThisMonthCount }} / {{ dash.kpis.totalExistingCount }} 家（覆盖率 {{ (dash.kpis.coverageRate * 100).toFixed(1) }}%）
        </div>
      </div>
      <div class="kpi-cell">
        <div class="kpi-label">本月老客复购额</div>
        <div class="kpi-value">
          ¥{{ Number(dash.kpis.monthRepurchaseAmount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}
        </div>
        <div class="kpi-meta">本月有效供货 {{ dash.kpis.monthRepurchaseOrders }} 单</div>
      </div>
      <div class="kpi-cell" :class="{ danger: dash.kpis.dormantCount > 0 }">
        <div class="kpi-label">防流失预警门店</div>
        <div class="kpi-value">
          {{ dash.kpis.dormantCount }}
          <span class="unit">家</span>
        </div>
        <div class="kpi-meta">超 180 天未复购或健康分低于 60 分</div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="plain-tabs">
      <!-- ==================== 1. 老客维护总览 ==================== -->
      <el-tab-pane label="老客维护总览" name="clients">
        <section v-if="dash?.repLeaderboard?.length" class="surface-card">
          <div class="section-header">
            <div>
              <h2 class="section-title">业务员老客维护绩效（20 分权重）</h2>
              <span class="section-note">{{ dash.kpis.formulaNote }}</span>
            </div>
          </div>
          <el-table :data="dash.repLeaderboard" size="small" style="width: 100%">
            <el-table-column prop="orgName" label="代理商（服务商）" min-width="132" show-overflow-tooltip />
            <el-table-column prop="salesRepName" label="业务员" width="90" />
            <el-table-column label="负责老客" width="90" align="right">
              <template #default="{ row }"><span class="mono">{{ row.totalClients }} 家</span></template>
            </el-table-column>
            <el-table-column label="本月已回访" width="100" align="right">
              <template #default="{ row }"><strong class="mono">{{ row.visitedThisMonth }} 家</strong></template>
            </el-table-column>
            <el-table-column label="覆盖率" width="88" align="right">
              <template #default="{ row }"><span class="mono">{{ (row.coverageRate * 100).toFixed(0) }}%</span></template>
            </el-table-column>
            <el-table-column label="本月复购额" width="106" align="right">
              <template #default="{ row }"><span class="mono">¥{{ Number(row.monthRepurchaseAmount).toFixed(2) }}</span></template>
            </el-table-column>
            <el-table-column label="沉睡预警" width="88" align="right">
              <template #default="{ row }">
                <span class="mono" :class="{ 'bad-text': row.dormantCount > 0 }">{{ row.dormantCount }} 家</span>
              </template>
            </el-table-column>
            <el-table-column label="维护得分(20)" width="110" align="right">
              <template #default="{ row }">
                <span class="score-pill">{{ row.maintenanceScore.toFixed(2) }} 分</span>
              </template>
            </el-table-column>
          </el-table>
        </section>

        <section class="surface-card flush">
          <div class="card-bar">
            <span class="card-bar-title">已消费合作老客清单（{{ dash?.clients?.length || 0 }} 家）</span>
            <span class="card-bar-hint">健康度自动按「复购活跃 40 分 + 近 30 天回访 30 分 + 复购意向 30 分」实时计算</span>
          </div>
          <el-table
            :data="pagedClients"
            size="small"
            style="width: 100%"
            empty-text="暂无老客记录，可点击右上角「批量导入历史老客」或从新客开单自动转化"
          >
            <el-table-column label="老客门店 / 区域" min-width="148" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="cell-strong">{{ row.name }}</div>
                <div class="cell-sub">{{ row.city }} · {{ row.orgName }} · {{ row.salesRepName }}</div>
              </template>
            </el-table-column>
            <el-table-column label="联系人" min-width="112" show-overflow-tooltip>
              <template #default="{ row }">
                <div>{{ row.contactName || '未填写' }}</div>
                <div class="mono cell-sub">{{ row.contactPhone || row.wechatId || '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="健康度 / 状态" width="126">
              <template #default="{ row }">
                <div class="health-line">
                  <strong class="num">{{ row.healthScore }}</strong>
                  <span class="health-pill" :class="healthClass(row.healthGrade)">{{ row.healthGrade }}</span>
                </div>
                <div class="cell-sub">{{ row.visitedThisMonth ? '本月已回访' : '本月待回访' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="累计消费 / 复购" min-width="132">
              <template #default="{ row }">
                <div class="mono cell-strong">¥{{ Number(row.totalOrderAmount).toFixed(2) }}（{{ row.totalOrderCount }} 单）</div>
                <div class="cell-sub">
                  {{ row.daysSinceLastOrder !== null ? `距上次下单 ${row.daysSinceLastOrder} 天` : '历史导入老客' }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="最近回访 / 余量 / 意向" min-width="180">
              <template #default="{ row }">
                <div v-if="row.latestVisitDate">
                  <span class="mono">{{ row.latestVisitDate }}</span>
                  <span v-if="row.latestStockRemainBoxes !== null" class="cell-sub"> · 余 {{ row.latestStockRemainBoxes }} 盒</span>
                </div>
                <div v-else class="cell-sub">暂无回访记录</div>
                <div class="cell-sub">
                  {{ row.latestRepurchaseIntent || row.healthAdvice }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="160" align="right">
              <template #default="{ row }">
                <div class="table-actions">
                  <el-button size="small" type="primary" link @click="openVisitModal(row)">记回访</el-button>
                  <el-button size="small" link @click="router.push({ path: '/customers', query: { id: row.id } })">
                    档案/修改
                  </el-button>
                  <el-button size="small" link @click="router.push('/sales')">去开单</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="dash?.clients?.length || 0"
              :page-size="clientPageSize"
              :current-page="clientPage"
              @current-change="(p: number) => (clientPage = p)"
            />
          </div>
        </section>
      </el-tab-pane>

      <!-- ==================== 2. 老客回访记录 ==================== -->
      <el-tab-pane label="老客回访记录" name="visits">
        <div class="surface-card flush">
          <div class="card-bar">
            <span class="card-bar-title">老客维护回访记录（{{ visitTotal }} 条）</span>
            <el-button size="small" type="primary" @click="openVisitModal()">+ 记录老客回访</el-button>
          </div>
          <el-table :data="visits" size="small" style="width: 100%" empty-text="还没有老客回访记录">
            <el-table-column label="老客门店 / 区域" min-width="160">
              <template #default="{ row }">
                <div class="cell-strong">{{ row.customerName }}</div>
                <div class="cell-sub">{{ row.cityRegion }} · {{ row.salesRepName }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="visitDate" label="回访日期" width="104" />
            <el-table-column label="回访方式" width="118">
              <template #default="{ row }">
                <span class="tag-neutral">{{ row.visitType || '常规回访' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="门店余量" width="88" align="right">
              <template #default="{ row }">
                <span class="mono">{{ row.stockRemainBoxes !== null && row.stockRemainBoxes !== undefined ? `${row.stockRemainBoxes} 盒` : '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="复购意向" width="126">
              <template #default="{ row }">
                <span class="intent-pill" :class="intentClass(row.repurchaseIntent)">{{ row.repurchaseIntent || '未填' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="回访纪要 / 下步需求" min-width="165" show-overflow-tooltip>
              <template #default="{ row }">
                <div>{{ row.visitSummary || '—' }}</div>
                <div v-if="row.customerNeed" class="need-line">下步：{{ row.customerNeed }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="142" align="right">
              <template #default="{ row }">
                <div class="table-actions">
                  <el-button
                    v-if="row.clinicId"
                    size="small"
                    link
                    type="primary"
                    @click="router.push({ path: '/customers', query: { id: row.clinicId } })"
                  >
                    档案
                  </el-button>
                  <el-button size="small" link @click="openEditVisit(row)">编辑</el-button>
                  <el-button size="small" link type="danger" @click="deleteVisit(row)">删</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="visitTotal"
              :page-size="visitPageSize"
              :current-page="visitPage"
              @current-change="(p: number) => loadVisits(p)"
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 记录 / 编辑老客回访弹窗 -->
    <el-dialog
      v-model="visitDialog"
      :title="editingVisitId ? '编辑老客回访记录' : '记录老客维护回访'"
      width="min(560px, 94vw)"
      align-center
    >
      <el-form :model="visitForm" label-width="96px">
        <el-form-item label="老客门店" required>
          <el-select
            v-model="visitForm.clinicId"
            filterable
            style="width: 100%"
            placeholder="选择已消费合作老客"
            :disabled="Boolean(editingVisitId)"
            @change="onSelectClinic"
          >
            <el-option
              v-for="c in dash?.clients || []"
              :key="c.id"
              :label="`${c.name}（${c.city} · 健康度 ${c.healthScore}分）`"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <div class="grid-2">
          <el-form-item label="回访日期" required>
            <el-input v-model="visitForm.visitDate" placeholder="YYYY-MM-DD" />
          </el-form-item>
          <el-form-item label="回访方式">
            <el-select v-model="visitForm.visitType" style="width: 100%">
              <el-option v-for="o in meta.existingVisitTypes" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
        </div>
        <div class="grid-2">
          <el-form-item label="门店余量(盒)">
            <el-input-number v-model="visitForm.stockRemainBoxes" :min="0" :max="9999" style="width: 100%" />
          </el-form-item>
          <el-form-item label="本月复购意向">
            <el-select v-model="visitForm.repurchaseIntent" style="width: 100%">
              <el-option v-for="o in meta.repurchaseIntents" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="回访纪要">
          <el-input
            v-model="visitForm.visitSummary"
            type="textarea"
            :rows="3"
            placeholder="记录门店耗材动销情况、店长反馈或客情变化"
          />
        </el-form-item>
        <el-form-item label="下步动作/需求">
          <el-input v-model="visitForm.customerNeed" placeholder="如：下周安排补货 4 盒 / 约美导到店带教" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visitDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingVisit" @click="saveVisit">保存回访</el-button>
      </template>
    </el-dialog>

    <!-- 批量导入历史老客弹窗 -->
    <el-dialog v-model="importDialog" title="批量导入历史老客" width="min(640px, 94vw)" align-center>
      <p class="import-tip">
        从 Excel 直接复制多行粘贴到下方，系统将自动建档为「活跃老客」并计入老客维护看板（若原新客表已有同名门店，将自动归档其开发期评分）。<br />
        <strong>列顺序（逗号或 Tab 分隔）</strong>：门店名称、城市区域、联系人、联系电话、微信号、负责业务员、上次下单日期(YYYY-MM-DD 可空)、备注
      </p>
      <el-input
        v-model="importText"
        type="textarea"
        :rows="7"
        placeholder="示例：&#10;南昌素颜美学馆,南昌市东湖区,王店长,13800138001,wx_wang,林晨亮,2026-10-15,老合作门店&#10;九江臻美皮肤管理,九江市浔阳区,李院长,13900139002,,林晨亮,2026-09-20,季度复购"
      />
      <template #footer>
        <el-button @click="importDialog = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="runImportExisting">确认导入历史老客</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { EXISTING_VISIT_TYPE_OPTIONS, REPURCHASE_INTENT_OPTIONS } from '@lumina/shared-types';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();

const activeTab = ref('clients');
const meta = ref<any>({
  dealers: [],
  salesReps: [],
  months: [],
  currentMonth: new Date().toISOString().slice(0, 7),
  existingVisitTypes: EXISTING_VISIT_TYPE_OPTIONS,
  repurchaseIntents: REPURCHASE_INTENT_OPTIONS,
});
const scope = ref({ orgId: '', salesRepName: '', planMonth: '', keyword: '' });

const dash = ref<any>(null);
const visits = ref<any[]>([]);

const visitDialog = ref(false);
const editingVisitId = ref<string | null>(null);
const savingVisit = ref(false);
const visitForm = ref({
  clinicId: '',
  customerName: '',
  visitDate: new Date().toISOString().slice(0, 10),
  visitType: '到店回访',
  stockRemainBoxes: 0 as number | null,
  repurchaseIntent: '观望跟进',
  visitSummary: '',
  customerNeed: '',
});

const importDialog = ref(false);
const importText = ref('');
const importing = ref(false);

async function loadMeta() {
  meta.value = (await api.get('/crm/meta')) as any;
  if (!scope.value.planMonth && meta.value.currentMonth) {
    scope.value.planMonth = meta.value.currentMonth;
  }
}

const clientPage = ref(1);
const clientPageSize = 20;
const visitPage = ref(1);
const visitPageSize = 20;
const visitTotal = ref(0);

const pagedClients = computed(() => {
  const list = dash.value?.clients || [];
  const start = (clientPage.value - 1) * clientPageSize;
  return list.slice(start, start + clientPageSize);
});

async function loadVisits(p = 1) {
  visitPage.value = p;
  const params = {
    orgId: scope.value.orgId || undefined,
    salesRepName: scope.value.salesRepName || undefined,
    planMonth: scope.value.planMonth || undefined,
    keyword: scope.value.keyword.trim() || undefined,
    page: p,
    pageSize: visitPageSize,
  };
  const v = (await api.get('/crm/existing/visits', { params })) as any;
  visits.value = Array.isArray(v) ? v : v.items || [];
  visitTotal.value = Array.isArray(v) ? v.length : Number(v.total || 0);
}

async function reloadAll() {
  clientPage.value = 1;
  const params = {
    orgId: scope.value.orgId || undefined,
    salesRepName: scope.value.salesRepName || undefined,
    planMonth: scope.value.planMonth || undefined,
    keyword: scope.value.keyword.trim() || undefined,
  };
  const [d] = await Promise.all([
    api.get('/crm/existing/dashboard', { params }),
    loadVisits(1),
  ]);
  dash.value = d;
}

function openVisitModal(client?: any) {
  editingVisitId.value = null;
  visitForm.value = {
    clinicId: client?.id || dash.value?.clients?.[0]?.id || '',
    customerName: client?.name || dash.value?.clients?.[0]?.name || '',
    visitDate: new Date().toISOString().slice(0, 10),
    visitType: '到店回访',
    stockRemainBoxes: client?.latestStockRemainBoxes ?? 0,
    repurchaseIntent: client?.latestRepurchaseIntent || '观望跟进',
    visitSummary: '',
    customerNeed: '',
  };
  visitDialog.value = true;
}

function openEditVisit(row: any) {
  editingVisitId.value = row.id;
  visitForm.value = {
    clinicId: row.clinicId || '',
    customerName: row.customerName || '',
    visitDate: row.visitDate || new Date().toISOString().slice(0, 10),
    visitType: row.visitType || '到店回访',
    stockRemainBoxes: row.stockRemainBoxes ?? 0,
    repurchaseIntent: row.repurchaseIntent || '观望跟进',
    visitSummary: row.visitSummary || '',
    customerNeed: row.customerNeed || '',
  };
  visitDialog.value = true;
}

function onSelectClinic(id: string) {
  const found = (dash.value?.clients || []).find((c: any) => c.id === id);
  if (found) visitForm.value.customerName = found.name;
}

async function saveVisit() {
  if (!visitForm.value.clinicId && !visitForm.value.customerName) {
    return ElMessage.warning('请选择老客门店');
  }
  savingVisit.value = true;
  try {
    if (editingVisitId.value) {
      await api.patch(`/crm/followups/${editingVisitId.value}`, visitForm.value);
      ElMessage.success('老客回访记录已更新');
    } else {
      await api.post('/crm/existing/visits', visitForm.value);
      ElMessage.success('老客维护回访已记录，健康度已同步重算');
    }
    visitDialog.value = false;
    await reloadAll();
  } finally {
    savingVisit.value = false;
  }
}

async function deleteVisit(row: any) {
  const ok = await ElMessageBox.confirm(`确认删除「${row.customerName}」的这条回访记录吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => false);
  if (!ok) return;
  await api.delete(`/crm/followups/${row.id}`);
  ElMessage.success('已删除');
  await reloadAll();
}

async function runImportExisting() {
  const lines = importText.value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return ElMessage.warning('请先粘贴至少一行历史老客数据');
  importing.value = true;
  try {
    const rows = lines.map((line) => {
      const cols = line.split(/[\t,，]/).map((c) => c?.trim() || '');
      return {
        name: cols[0],
        city: cols[1] || '南昌市',
        contactName: cols[2] || '',
        contactPhone: cols[3] || '',
        wechatId: cols[4] || '',
        salesRepName: cols[5] || '',
        lastOrderDate: cols[6] || '',
        remark: cols[7] || '',
      };
    });
    const res = (await api.post('/crm/customers/import-existing', {
      orgId: scope.value.orgId || undefined,
      salesRepName: scope.value.salesRepName || undefined,
      rows,
    })) as any;
    ElMessage.success(`导入完成：新增 ${res.createdCount} 家，升级已有档案 ${res.upgradedCount} 家`);
    importDialog.value = false;
    importText.value = '';
    await loadMeta();
    await reloadAll();
  } finally {
    importing.value = false;
  }
}

function healthClass(g: string) {
  if (g === '健康活跃') return 'good';
  if (g === '沉睡预警') return 'bad';
  return 'mid';
}

function intentClass(i?: string) {
  if (i === '明确补货') return 'good';
  if (i === '存在流失风险') return 'bad';
  return 'mid';
}

onMounted(async () => {
  await loadMeta();
  await reloadAll();
});
</script>

<style scoped>
.scope-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.scope-fields {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.sc-select { width: 210px; }
.sc-select-sm { width: 136px; }
.sc-search { width: 220px; }

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}
.kpi-cell {
  background: #ffffff;
  border: 1px solid var(--border-hairline);
  border-radius: 10px;
  padding: 16px 18px;
}
.kpi-cell.accent {
  border-color: #111827;
}
.kpi-cell.danger {
  border-color: #fecaca;
  background: #fffafa;
}
.kpi-label {
  font-size: 12px;
  color: var(--ink-muted);
}
.kpi-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--ink-primary);
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}
.kpi-cell.danger .kpi-value {
  color: #b91c1c;
}
.kpi-value .unit {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-muted);
  margin-left: 2px;
}
.kpi-meta {
  font-size: 12px;
  color: var(--ink-secondary);
  margin-top: 6px;
}

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-primary);
}
.section-note {
  font-size: 12px;
  color: var(--ink-muted);
}
.card-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-hairline);
  flex-wrap: wrap;
}
.card-bar-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-primary);
}
.card-bar-hint {
  font-size: 12px;
  color: var(--ink-muted);
}

.cell-strong { font-weight: 600; color: var(--ink-primary); }
.cell-sub { font-size: 12px; color: var(--ink-muted); margin-top: 2px; }
.need-line { font-size: 12px; color: #374151; margin-top: 2px; }
.bad-text { color: #b91c1c; font-weight: 600; }

.health-line {
  display: flex;
  align-items: center;
  gap: 6px;
}
.health-pill,
.intent-pill,
.tag-neutral,
.score-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
}
.health-pill.good,
.intent-pill.good {
  background: #ecfdf5;
  color: #047857;
}
.health-pill.mid,
.intent-pill.mid,
.tag-neutral {
  background: #f3f4f6;
  color: #374151;
}
.health-pill.bad,
.intent-pill.bad {
  background: #fef2f2;
  color: #b91c1c;
}
.score-pill {
  background: #111827;
  color: #ffffff;
}
.table-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.import-tip {
  margin: 0 0 12px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ink-secondary);
}

@media (max-width: 1080px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .kpi-grid { grid-template-columns: 1fr; }
  .grid-2 { grid-template-columns: 1fr; }
}
</style>
