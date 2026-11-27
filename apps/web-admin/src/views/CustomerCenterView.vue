<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">客户档案中心</h1>
        <p class="page-subtitle">新老客统一 360° 查询 · 业务员可随时修改客户文字/数字信息，全部自动审计留痕</p>
      </div>
      <div class="page-actions">
        <el-button @click="router.push('/crm')">新客开发看板</el-button>
        <el-button @click="router.push('/crm-existing')">老客维护看板</el-button>
      </div>
    </div>

    <!-- 分段筛选 + 搜索 -->
    <div class="surface-card filter-bar">
      <div class="segmented">
        <button
          v-for="s in stageOptions"
          :key="s.value"
          type="button"
          :class="{ on: filters.stage === s.value }"
          @click="filters.stage = s.value; loadList()"
        >
          {{ s.label }}
        </button>
      </div>
      <div class="filter-right">
        <el-select
          v-if="auth.isHQ"
          v-model="filters.orgId"
          clearable
          placeholder="全部服务商"
          style="width: 190px"
          @change="loadList"
        >
          <el-option v-for="d in meta.dealers" :key="d.id" :label="d.name" :value="d.id" />
        </el-select>
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="搜门店 / 联系人 / 电话 / 微信 / 备注"
          style="width: 240px"
          @keyup.enter="loadList"
          @clear="loadList"
        />
        <el-button type="primary" @click="loadList">查询</el-button>
      </div>
    </div>

    <!-- 客户总表 -->
    <div class="surface-card flush">
      <div class="card-bar">
        <span class="card-bar-title">共检索到 {{ customers.length }} 家客户</span>
        <span class="card-bar-hint">点击任意客户查看完整文字/数字/得分档案，支持随时在线编辑</span>
      </div>
      <el-table
        :data="customers"
        size="small"
        style="width: 100%"
        empty-text="当前条件下没有客户档案"
        @row-click="(row: any) => openDetail(row.id)"
      >
        <el-table-column label="客户名称 / 区域" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="cell-strong">{{ row.name }}</div>
            <div class="cell-sub">{{ row.city }} · {{ row.orgName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="阶段" width="96">
          <template #default="{ row }">
            <span class="stage-pill" :class="stageClass(row.lifecycleStage)">
              {{ stageLabel(row.lifecycleStage) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="联系人 / 电话" min-width="136" show-overflow-tooltip>
          <template #default="{ row }">
            <div>{{ row.contactName || '未填' }} <span v-if="row.contactRole" class="cell-sub">{{ row.contactRole }}</span></div>
            <div class="mono cell-sub">{{ row.contactPhone || row.wechatId || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="评分 / 消费" min-width="134">
          <template #default="{ row }">
            <template v-if="row.isExisting">
              <div class="score-row">
                <strong class="num">健康 {{ row.healthScore }} 分</strong>
                <span class="cell-sub">· {{ row.healthGrade }}</span>
              </div>
              <div class="mono cell-sub">累计 ¥{{ Number(row.totalOrderAmount).toFixed(2) }}（{{ row.totalOrderCount }} 单）</div>
            </template>
            <template v-else>
              <div class="score-row">
                <strong class="num">五维 {{ row.prospectScore }} 分</strong>
                <span v-if="row.storeGrade" class="cell-sub">· {{ row.storeGrade }}</span>
              </div>
              <div class="cell-sub">新客开发期 · 尚未消费</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="业务员 / 跟进" min-width="112">
          <template #default="{ row }">
            <div>{{ row.salesRepName }}</div>
            <div class="mono cell-sub">{{ row.latestVisitDate || '暂无拜访' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="162" align="right">
          <template #default="{ row }">
            <div class="table-actions" @click.stop>
              <el-button size="small" type="primary" link @click="openDetail(row.id)">查看 / 修改</el-button>
              <el-button
                v-if="!row.isExisting"
                size="small"
                type="success"
                link
                @click="markAsExisting(row)"
              >
                标为老客
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div class="table-pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="total"
          :page-size="pageSize"
          :current-page="page"
          @current-change="(p: number) => loadList(p)"
        />
      </div>
    </div>

    <!-- 360° 客户全景档案抽屉（支持随时编辑 + 老客历史评分折叠归档） -->
    <el-drawer v-model="drawerOpen" size="min(680px, 96vw)" :with-header="false">
      <div v-if="detailLoading" class="drawer-empty">正在加载客户 360° 档案…</div>
      <div v-else-if="detail" class="drawer-inner">
        <div class="drawer-head">
          <div>
            <div class="dh-top">
              <h2 class="dh-title">{{ detail.clinic.name }}</h2>
              <span class="stage-pill" :class="stageClass(detail.clinic.lifecycleStage)">
                {{ stageLabel(detail.clinic.lifecycleStage) }}
              </span>
            </div>
            <div class="cell-sub">
              {{ detail.orgName }} · 负责业务员：{{ detail.clinic.salesRepName || '未指定' }}
            </div>
          </div>
          <div class="dh-actions">
            <el-button size="small" type="primary" @click="openEditDialog">编辑档案</el-button>
            <el-button v-if="!detail.isExisting" size="small" type="success" plain @click="markAsExisting(detail.clinic)">
              标为老客
            </el-button>
            <button type="button" class="drawer-close" @click="drawerOpen = false">×</button>
          </div>
        </div>

        <!-- 核心计算分摘要卡 -->
        <div v-if="detail.isExisting" class="score-banner existing">
          <div>
            <div class="sb-kicker">合作老客 · 实时健康度</div>
            <div class="sb-big num">
              {{ detail.healthEval?.healthScore ?? '—' }}<span>/100 分 · {{ detail.healthEval?.healthGrade }}</span>
            </div>
            <div class="sb-sub">{{ detail.healthEval?.advice }}</div>
          </div>
          <div class="sb-right">
            <div class="sb-kicker">累计消费</div>
            <div class="sb-money num">¥{{ Number(detail.orderSummary.totalOrderAmount).toFixed(2) }}</div>
            <div class="sb-sub">
              共 {{ detail.orderSummary.totalOrderCount }} 单
              <template v-if="detail.orderSummary.daysSinceLastOrder !== null">
                · 距上次 {{ detail.orderSummary.daysSinceLastOrder }} 天
              </template>
            </div>
          </div>
        </div>
        <div v-else class="score-banner prospect">
          <div>
            <div class="sb-kicker">新客开发期 · 五维评分</div>
            <div class="sb-big num">
              {{ detail.prospectEval.totalScore }}<span>/100 分 · {{ detail.prospectEval.storeGrade || '待补全' }}</span>
            </div>
            <div class="sb-sub">{{ detail.prospectEval.actionAdvice || detail.prospectEval.validationText }}</div>
          </div>
        </div>

        <!-- 全量收录信息（文字/数字/联系资料） -->
        <section class="d-section">
          <div class="ds-head">
            <h3>客户基础资料与收录信息</h3>
            <el-button size="small" link type="primary" @click="openEditDialog">修改资料</el-button>
          </div>
          <div class="kv-grid">
            <div class="kv"><span>城市 / 区域</span><strong>{{ detail.clinic.city || '未填' }}</strong></div>
            <div class="kv"><span>详细地址</span><strong>{{ detail.clinic.address || '未填' }}</strong></div>
            <div class="kv"><span>联系人</span><strong>{{ detail.clinic.contactName || '未填' }} {{ detail.clinic.contactRole }}</strong></div>
            <div class="kv"><span>联系电话</span><strong class="mono">{{ detail.clinic.contactPhone || '未填' }}</strong></div>
            <div class="kv"><span>微信号</span><strong class="mono">{{ detail.clinic.wechatId || '未填' }}</strong></div>
            <div class="kv"><span>线索来源</span><strong>{{ detail.clinic.leadSource || '未填' }}</strong></div>
            <div class="kv full"><span>客情备注</span><strong>{{ detail.clinic.remark || '暂无备注' }}</strong></div>
          </div>
        </section>

        <!-- 新客：直接展示当前可编辑五维属性 -->
        <section v-if="!detail.isExisting" class="d-section">
          <div class="ds-head">
            <h3>新客五维评分明细（点「编辑档案」可随时修改重算）</h3>
          </div>
          <div class="kv-grid">
            <div class="kv"><span>① 门店类型</span><strong>{{ detail.clinic.storeType || '待填' }}（{{ detail.prospectEval.storeTypeScore }}分）</strong></div>
            <div class="kv"><span>② 引流价格</span><strong>{{ detail.clinic.trafficPrice || '待填' }}（{{ detail.prospectEval.trafficPriceScore }}分）</strong></div>
            <div class="kv"><span>③ 门店面积</span><strong>{{ detail.clinic.storeArea || '待填' }}（{{ detail.prospectEval.storeAreaScore }}分）</strong></div>
            <div class="kv"><span>④ 美容师人数</span><strong>{{ detail.clinic.beauticianCount || '待填' }}（{{ detail.prospectEval.beauticianScore }}分）</strong></div>
            <div class="kv full"><span>⑤ 门店规模</span><strong>{{ detail.clinic.storeScale || '待填' }}（{{ detail.prospectEval.storeScaleScore }}分）</strong></div>
          </div>
        </section>

        <!-- 老客：近期订单 + 老客维护记录 -->
        <section v-if="detail.isExisting" class="d-section">
          <div class="ds-head">
            <h3>近期老客回访记录（{{ detail.existingVisits.length }} 条）</h3>
          </div>
          <div v-if="!detail.existingVisits.length" class="empty-sm">暂无老客维护回访，可前往「老客维护看板」或 App 录入</div>
          <div v-for="v in detail.existingVisits" :key="v.id" class="visit-item">
            <div class="vi-top">
              <span class="mono">{{ v.visitDate }}</span>
              <span class="vi-badge">{{ v.visitType || '回访' }}</span>
              <span v-if="v.stockRemainBoxes !== null && v.stockRemainBoxes !== undefined" class="vi-badge">余 {{ v.stockRemainBoxes }} 盒</span>
              <span v-if="v.repurchaseIntent" class="vi-badge accent">{{ v.repurchaseIntent }}</span>
              <span class="cell-sub" style="margin-left: auto">{{ v.salesRepName }}</span>
            </div>
            <div class="vi-body">{{ v.visitSummary || '—' }}</div>
            <div v-if="v.customerNeed" class="vi-need">下步需求：{{ v.customerNeed }}</div>
          </div>
        </section>

        <section v-if="detail.isExisting && detail.recentOrders.length" class="d-section">
          <div class="ds-head">
            <h3>近期供货订单（{{ detail.recentOrders.length }} 单）</h3>
          </div>
          <div v-for="o in detail.recentOrders" :key="o.id" class="order-mini">
            <span class="mono">{{ o.docNo }}</span>
            <span class="cell-sub">{{ String(o.bizDate).slice(0, 10) }}</span>
            <strong class="mono" style="margin-left: auto">¥{{ Number(o.totalAmount).toFixed(2) }}</strong>
          </div>
        </section>

        <!-- 老客去冗余设计：开发期历史五维评分默认折叠归档 -->
        <section v-if="detail.isExisting && (detail.initialScoreSnapshot || detail.prospectVisits.length)" class="d-section">
          <el-collapse>
            <el-collapse-item name="history">
              <template #title>
                <span class="collapse-title">
                  新客开发期初始归档快照（已转化锁定 · 默认收起不冗杂）
                  <strong v-if="detail.initialScoreSnapshot" style="margin-left: 8px">
                    {{ detail.initialScoreSnapshot.totalScore }} 分 · {{ detail.initialScoreSnapshot.storeGrade }}
                  </strong>
                </span>
              </template>
              <div v-if="detail.initialScoreSnapshot" class="kv-grid" style="margin-bottom: 10px">
                <div class="kv"><span>① 门店类型</span><strong>{{ detail.initialScoreSnapshot.dimensions?.storeType?.value || '—' }}（{{ detail.initialScoreSnapshot.dimensions?.storeType?.score ?? 0 }}分）</strong></div>
                <div class="kv"><span>② 引流价格</span><strong>{{ detail.initialScoreSnapshot.dimensions?.trafficPrice?.value || '—' }}（{{ detail.initialScoreSnapshot.dimensions?.trafficPrice?.score ?? 0 }}分）</strong></div>
                <div class="kv"><span>③ 门店面积</span><strong>{{ detail.initialScoreSnapshot.dimensions?.storeArea?.value || '—' }}（{{ detail.initialScoreSnapshot.dimensions?.storeArea?.score ?? 0 }}分）</strong></div>
                <div class="kv"><span>④ 美容师人数</span><strong>{{ detail.initialScoreSnapshot.dimensions?.beauticianCount?.value || '—' }}（{{ detail.initialScoreSnapshot.dimensions?.beauticianCount?.score ?? 0 }}分）</strong></div>
                <div class="kv full"><span>⑤ 门店规模</span><strong>{{ detail.initialScoreSnapshot.dimensions?.storeScale?.value || '—' }}（{{ detail.initialScoreSnapshot.dimensions?.storeScale?.score ?? 0 }}分）</strong></div>
              </div>
              <div v-if="detail.prospectVisits.length">
                <div class="cell-sub" style="margin-bottom: 6px">开发期历史拜访（{{ detail.prospectVisits.length }} 条）</div>
                <div v-for="pv in detail.prospectVisits" :key="pv.id" class="visit-item">
                  <div class="vi-top">
                    <span class="mono">{{ pv.visitDate }}</span>
                    <span class="cell-sub">{{ pv.salesRepName }}</span>
                  </div>
                  <div class="vi-body">{{ pv.visitSummary || '—' }}</div>
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </section>

        <!-- 新客拜访跟进记录 -->
        <section v-if="!detail.isExisting" class="d-section">
          <div class="ds-head">
            <h3>新客拜访跟进记录（{{ detail.followUps.length }} 条）</h3>
          </div>
          <div v-if="!detail.followUps.length" class="empty-sm">暂无拜访跟进记录</div>
          <div v-for="v in detail.followUps" :key="v.id" class="visit-item">
            <div class="vi-top">
              <span class="mono">{{ v.visitDate }}</span>
              <span v-if="v.dealStatus" class="vi-badge">{{ v.dealStatus }}</span>
              <span v-if="v.cityMeetingStatus" class="vi-badge">{{ v.cityMeetingStatus }}</span>
              <span class="cell-sub" style="margin-left: auto">{{ v.salesRepName }}</span>
            </div>
            <div class="vi-body">{{ v.visitSummary || '—' }}</div>
            <div v-if="v.customerNeed" class="vi-need">客户需求：{{ v.customerNeed }}</div>
          </div>
        </section>

        <!-- 修改审计留痕 -->
        <section v-if="detail.editHistory?.length" class="d-section">
          <div class="ds-head">
            <h3>档案变更留痕（最近 {{ detail.editHistory.length }} 条）</h3>
          </div>
          <div v-for="h in detail.editHistory.slice(0, 6)" :key="h.id" class="audit-row">
            <span class="mono cell-sub">{{ String(h.createdAt).slice(0, 16).replace('T', ' ') }}</span>
            <span class="audit-txt">{{ h.operatorName }}：{{ h.summary }}</span>
          </div>
        </section>
      </div>
    </el-drawer>

    <!-- 随时编辑客户档案弹窗（业务员可用） -->
    <el-dialog v-model="editDialog" title="编辑客户档案（保存自动写入审计日志）" width="min(640px, 94vw)" align-center>
      <el-form :model="editForm" label-width="92px">
        <div class="grid-2">
          <el-form-item label="机构名称" required>
            <el-input v-model="editForm.name" />
          </el-form-item>
          <el-form-item label="城市 / 区域" required>
            <el-input v-model="editForm.city" />
          </el-form-item>
        </div>
        <el-form-item label="详细地址">
          <el-input v-model="editForm.address" placeholder="门店详细地址" />
        </el-form-item>
        <div class="grid-2">
          <el-form-item label="联系人">
            <el-input v-model="editForm.contactName" />
          </el-form-item>
          <el-form-item label="联系人职位">
            <el-select v-model="editForm.contactRole" clearable allow-create filterable style="width: 100%">
              <el-option v-for="r in meta.contactRoles" :key="r" :label="r" :value="r" />
            </el-select>
          </el-form-item>
        </div>
        <div class="grid-2">
          <el-form-item label="联系电话">
            <el-input v-model="editForm.contactPhone" />
          </el-form-item>
          <el-form-item label="微信号">
            <el-input v-model="editForm.wechatId" />
          </el-form-item>
        </div>
        <div class="grid-2">
          <el-form-item label="负责业务员">
            <el-input v-model="editForm.salesRepName" />
          </el-form-item>
          <el-form-item label="线索来源">
            <el-select v-model="editForm.leadSource" clearable allow-create filterable style="width: 100%">
              <el-option v-for="s in meta.leadSources" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
        </div>

        <!-- 仅未转老客的新客展示五维可编辑打分项，老客界面保持清爽 -->
        <template v-if="detail && !detail.isExisting">
          <div class="edit-divider">新客五维评分（修改后 100 分总分实时重算）</div>
          <div class="grid-2">
            <el-form-item v-for="dim in meta.scoringDimensions" :key="dim.key" :label="dim.shortLabel">
              <el-select v-model="(editForm as any)[dim.key]" clearable style="width: 100%">
                <el-option
                  v-for="opt in dim.options"
                  :key="opt.value"
                  :label="`${opt.value}（${opt.score}分）`"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </div>
        </template>

        <el-form-item label="客情备注">
          <el-input v-model="editForm.remark" type="textarea" :rows="3" placeholder="可记录门店特色、主营项目、决策偏好等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingEdit" @click="saveCustomerEdit">保存修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { CONTACT_ROLE_OPTIONS, LEAD_SOURCE_OPTIONS, STORE_SCORING_DIMENSIONS } from '@lumina/shared-types';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const stageOptions = [
  { label: '全部客户', value: 'ALL' },
  { label: '新客开发', value: 'PROSPECT' },
  { label: '老客维护', value: 'EXISTING' },
  { label: '沉睡预警', value: 'DORMANT' },
];

const meta = ref<any>({
  dealers: [],
  contactRoles: CONTACT_ROLE_OPTIONS,
  leadSources: LEAD_SOURCE_OPTIONS,
  scoringDimensions: STORE_SCORING_DIMENSIONS,
});

const filters = ref({ stage: 'ALL', orgId: '', keyword: '' });
const customers = ref<any[]>([]);

const drawerOpen = ref(false);
const detailLoading = ref(false);
const detail = ref<any>(null);

const editDialog = ref(false);
const savingEdit = ref(false);
const editForm = ref({
  name: '',
  city: '',
  address: '',
  contactName: '',
  contactRole: '',
  contactPhone: '',
  wechatId: '',
  salesRepName: '',
  leadSource: '',
  storeType: '',
  trafficPrice: '',
  storeArea: '',
  beauticianCount: '',
  storeScale: '',
  remark: '',
});

async function loadMeta() {
  meta.value = (await api.get('/crm/meta')) as any;
}

const page = ref(1);
const pageSize = 20;
const total = ref(0);

async function loadList(p = 1) {
  page.value = p;
  const res = (await api.get('/crm/customers', {
    params: {
      stage: filters.value.stage !== 'ALL' ? filters.value.stage : undefined,
      orgId: filters.value.orgId || undefined,
      keyword: filters.value.keyword.trim() || undefined,
      page: p,
      pageSize,
    },
  })) as any;
  customers.value = Array.isArray(res) ? res : res.items || [];
  total.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function openDetail(id: string) {
  drawerOpen.value = true;
  detailLoading.value = true;
  try {
    detail.value = await api.get(`/crm/customers/${id}`);
  } finally {
    detailLoading.value = false;
  }
}

function openEditDialog() {
  if (!detail.value?.clinic) return;
  const c = detail.value.clinic;
  editForm.value = {
    name: c.name || '',
    city: c.city || '',
    address: c.address || '',
    contactName: c.contactName || '',
    contactRole: c.contactRole || '',
    contactPhone: c.contactPhone || '',
    wechatId: c.wechatId || '',
    salesRepName: c.salesRepName || '',
    leadSource: c.leadSource || '',
    storeType: c.storeType || '',
    trafficPrice: c.trafficPrice || '',
    storeArea: c.storeArea || '',
    beauticianCount: c.beauticianCount || '',
    storeScale: c.storeScale || '',
    remark: c.remark || '',
  };
  editDialog.value = true;
}

async function saveCustomerEdit() {
  if (!detail.value?.clinic?.id) return;
  savingEdit.value = true;
  try {
    detail.value = await api.patch(`/crm/customers/${detail.value.clinic.id}`, editForm.value);
    ElMessage.success('客户档案已更新并记录审计留痕');
    editDialog.value = false;
    await loadList();
  } finally {
    savingEdit.value = false;
  }
}

async function markAsExisting(row: any) {
  const id = row.id;
  if (!id) return;
  const ok = await ElMessageBox.confirm(
    `确认将「${row.name}」标为合作老客吗？系统将冻结其开发期五维评分快照并转入「老客维护看板」。`,
    '标为老客',
    { confirmButtonText: '确认标为老客', cancelButtonText: '取消', type: 'info' },
  ).catch(() => false);
  if (!ok) return;
  const updated = await api.post(`/crm/customers/${id}/mark-existing`, { remark: '在客户档案中心手动标为老客' });
  ElMessage.success(`「${row.name}」已转为老客`);
  if (drawerOpen.value && detail.value?.clinic?.id === id) {
    detail.value = updated;
  }
  await loadList();
}

function stageLabel(s: string) {
  if (s === 'EXISTING_ACTIVE') return '活跃老客';
  if (s === 'EXISTING_DORMANT') return '沉睡预警';
  return '新客开发';
}

function stageClass(s: string) {
  if (s === 'EXISTING_ACTIVE') return 'existing';
  if (s === 'EXISTING_DORMANT') return 'dormant';
  return 'prospect';
}

watch(
  () => route.query.id,
  (id) => {
    if (typeof id === 'string' && id) openDetail(id);
  },
);

onMounted(async () => {
  await Promise.all([loadMeta(), loadList()]);
  if (typeof route.query.id === 'string' && route.query.id) {
    openDetail(route.query.id);
  }
});
</script>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.filter-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.segmented {
  display: inline-flex;
  background: #f3f4f6;
  padding: 3px;
  border-radius: 8px;
  gap: 2px;
}
.segmented button {
  border: 0;
  background: transparent;
  padding: 6px 14px;
  font-size: 13px;
  color: #4b5563;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.segmented button.on {
  background: #ffffff;
  color: #111827;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.card-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-hairline);
}
.card-bar-title { font-size: 13.5px; font-weight: 600; color: var(--ink-primary); }
.card-bar-hint { font-size: 12px; color: var(--ink-muted); }
.cell-strong { font-weight: 600; color: var(--ink-primary); }
.cell-sub { font-size: 12px; color: var(--ink-muted); margin-top: 2px; }

.stage-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
}
.stage-pill.prospect { background: #f3f4f6; color: #374151; }
.stage-pill.existing { background: #ecfdf5; color: #047857; }
.stage-pill.dormant { background: #fef2f2; color: #b91c1c; }

.table-actions { display: inline-flex; gap: 6px; }
.drawer-empty { padding: 48px 20px; text-align: center; color: var(--ink-muted); }
.drawer-inner { padding: 20px 22px 32px; display: flex; flex-direction: column; gap: 18px; }
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-hairline);
}
.dh-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dh-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--ink-primary); }
.dh-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.drawer-close {
  width: 30px;
  height: 30px;
  border: 0;
  background: #f3f4f6;
  border-radius: 999px;
  font-size: 18px;
  cursor: pointer;
  color: #4b5563;
}

.score-banner {
  border-radius: 10px;
  padding: 16px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.score-banner.existing { background: #111827; color: #ffffff; }
.score-banner.prospect { background: #f8fafc; border: 1px solid var(--border-hairline); color: #111827; }
.sb-kicker { font-size: 11.5px; opacity: 0.72; }
.sb-big { font-size: 24px; font-weight: 700; margin-top: 4px; }
.sb-big span { font-size: 13px; font-weight: 500; opacity: 0.85; margin-left: 4px; }
.sb-money { font-size: 20px; font-weight: 700; margin-top: 4px; }
.sb-sub { font-size: 12px; opacity: 0.78; margin-top: 4px; }
.sb-right { text-align: right; }

.d-section { display: flex; flex-direction: column; gap: 10px; }
.ds-head { display: flex; justify-content: space-between; align-items: center; }
.ds-head h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--ink-primary); }
.kv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
  background: #f9fafb;
  border: 1px solid var(--border-hairline);
  border-radius: 8px;
  padding: 12px 14px;
}
.kv { display: flex; flex-direction: column; gap: 3px; }
.kv.full { grid-column: 1 / -1; }
.kv span { font-size: 11.5px; color: var(--ink-muted); }
.kv strong { font-size: 13px; color: var(--ink-primary); font-weight: 500; }

.visit-item {
  border: 1px solid var(--border-hairline);
  border-radius: 8px;
  padding: 10px 12px;
  background: #ffffff;
}
.vi-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.vi-badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #374151;
  font-size: 11px;
  font-weight: 600;
}
.vi-badge.accent { background: #111827; color: #ffffff; }
.vi-body { margin-top: 6px; font-size: 13px; color: var(--ink-primary); line-height: 1.5; }
.vi-need { margin-top: 4px; font-size: 12px; color: var(--ink-secondary); }
.order-mini {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border-hairline);
  border-radius: 6px;
  font-size: 13px;
}
.collapse-title { font-size: 13px; color: #4b5563; }
.empty-sm { font-size: 12.5px; color: var(--ink-muted); padding: 8px 0; }
.audit-row {
  display: flex;
  gap: 10px;
  font-size: 12px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--border-hairline);
}
.audit-txt { color: var(--ink-secondary); }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.edit-divider {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-secondary);
  margin: 6px 0 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-hairline);
}
</style>
