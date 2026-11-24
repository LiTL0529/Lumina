<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">服务商与机构</h1>
        <p class="page-subtitle">
          同一个机构被两个服务商同时报备时，以服务端时间戳为准，先报先得；90 天保护期内别人抢不走，270 天没有复购则自动回公海。
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="runExpirySweep">执行到期巡检</el-button>
        <el-button v-if="auth.isHQ" @click="dealerDialog = true">新增服务商</el-button>
        <el-button type="primary" @click="reportDialog = true">机构报备</el-button>
      </div>
    </div>

    <!-- 服务商 -->
    <section class="surface-card">
      <div class="section-header">
        <div>
          <h2 class="section-title">服务商主体</h2>
          <span class="section-note">授权区域是窜货判定的基准；停供后无法下单、总仓也不向其供货</span>
        </div>
        <span class="section-note">{{ dealers.length }} 家服务商</span>
      </div>

      <div class="dealer-grid">
        <article v-for="d in dealers" :key="d.id" class="dealer-card" :class="{ frozen: d.supplyFrozen }">
          <div class="dc-top">
            <div>
              <div class="dc-name">{{ d.name }}</div>
              <div class="dc-code mono">{{ d.code }}</div>
            </div>
            <span class="dc-status" :class="d.supplyFrozen ? 'frozen' : 'ok'">
              {{ d.supplyFrozen ? '已停供' : '正常供货' }}
            </span>
          </div>

          <div class="dc-regions">
            <span v-for="r in d.regionCodes || []" :key="r" class="region-chip">{{ r }}</span>
            <span v-if="!(d.regionCodes || []).length" class="cell-sub">未设授权区域</span>
          </div>

          <div class="dc-stats">
            <div class="dc-stat">
              <span class="dc-stat-value num">{{ d.warehouses?.length || 0 }}</span>
              <span class="dc-stat-label">独立仓</span>
            </div>
            <div class="dc-stat">
              <span class="dc-stat-value num">{{ d._count?.ownedClinics || 0 }}</span>
              <span class="dc-stat-label">绑定机构</span>
            </div>
            <div class="dc-stat">
              <span class="dc-stat-value num">{{ d.contactName || '—' }}</span>
              <span class="dc-stat-label">负责人</span>
            </div>
          </div>

          <div class="dc-foot">
            <span v-if="d.supplyFrozen" class="dc-reason">{{ d.freezeReason || '停供中' }}</span>
            <span v-else class="dc-foot-note">授权区域内供货</span>
            <el-button
              v-if="auth.isHQ"
              class="dc-action"
              size="small"
              plain
              :type="d.supplyFrozen ? 'success' : 'info'"
              @click="toggleFreeze(d)"
            >
              {{ d.supplyFrozen ? '恢复供货' : '暂停供货' }}
            </el-button>
          </div>
        </article>
      </div>
    </section>

    <!-- 机构 -->
    <section class="surface-card">
      <div class="section-header">
        <div>
          <h2 class="section-title">终端机构归属</h2>
          <span class="section-note">倒计时条越满越接近到期；到期未复购即回公海</span>
        </div>
        <el-button link type="primary" @click="reportDialog = true">报备新机构</el-button>
      </div>

      <el-table :data="clinics" size="small" empty-text="还没有机构，先报备一家试试">
        <el-table-column label="机构" min-width="210">
          <template #default="{ row }">
            <div class="cell-strong">{{ row.name }}</div>
            <div class="cell-sub">{{ row.province || '' }}{{ row.city }} · {{ row.contactName || '—' }} {{ row.contactPhone || '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="归属服务商" width="170">
          <template #default="{ row }">
            <span :class="row.ownerOrg ? '' : 'muted'">{{ row.ownerOrg?.name || '公海待报备' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <span class="bind-pill" :class="bindClass(row.bindStatus)">{{ bindLabel(row.bindStatus) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="规则倒计时" width="210">
          <template #default="{ row }">
            <template v-if="row.protectDaysLeft !== null && row.protectDaysLeft !== undefined">
              <div class="cd-label">
                保护剩余 <strong :class="{ urgent: row.protectDaysLeft <= 15 }">{{ row.protectDaysLeft }}</strong> 天
              </div>
              <div class="cd-bar"><span :style="{ width: `${Math.min(100, (row.protectDaysLeft / 90) * 100)}%` }" /></div>
            </template>
            <template v-else-if="row.unbindDaysLeft !== null && row.unbindDaysLeft !== undefined">
              <div class="cd-label">
                解绑剩余 <strong :class="{ urgent: row.unbindDaysLeft <= 30 }">{{ row.unbindDaysLeft }}</strong> 天
              </div>
              <div class="cd-bar soft">
                <span :style="{ width: `${Math.min(100, (row.unbindDaysLeft / 270) * 100)}%` }" />
              </div>
            </template>
            <span v-else class="cell-sub">可抢单报备</span>
          </template>
        </el-table-column>
        <el-table-column label="报备时间" width="150">
          <template #default="{ row }">
            <span class="mono cell-sub">{{ row.reportedAt ? row.reportedAt.replace('T', ' ').slice(0, 16) : '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="欠款" width="100" align="right">
          <template #default="{ row }">
            <span class="mono" :class="Number(row.arrearsAmount) > 0 ? 'bad' : 'muted'">
              ¥{{ Number(row.arrearsAmount).toFixed(0) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="" width="120" align="right" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.bindStatus === 'PUBLIC_POOL'" size="small" type="primary" plain @click="claimFromPool(row)">
              抢单报备
            </el-button>
            <el-button v-else size="small" link @click="openLogs(row)">归属日志</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 报备 -->
    <el-dialog v-model="reportDialog" title="终端机构报备" width="540px">
      <p class="dialog-note">提交即锁定服务端时间戳。同城重复报备以先提交者为准。</p>
      <el-form :model="reportForm" label-width="100px">
        <el-form-item label="机构全称" required>
          <el-input v-model="reportForm.name" placeholder="如：南昌华美皮肤管理中心" />
        </el-form-item>
        <el-form-item label="统一信用代码">
          <el-input v-model="reportForm.creditCode" placeholder="选填，填了按执照号优先去重" />
        </el-form-item>
        <div class="form-2">
          <el-form-item label="省份">
            <el-input v-model="reportForm.province" />
          </el-form-item>
          <el-form-item label="城市" required>
            <el-input v-model="reportForm.city" />
          </el-form-item>
        </div>
        <div class="form-2">
          <el-form-item label="负责人">
            <el-input v-model="reportForm.contactName" />
          </el-form-item>
          <el-form-item label="电话">
            <el-input v-model="reportForm.contactPhone" />
          </el-form-item>
        </div>
        <el-form-item v-if="auth.isHQ" label="归属服务商">
          <el-select v-model="reportForm.targetOrgId" style="width: 100%" clearable placeholder="默认总部，可指定服务商">
            <el-option v-for="d in dealers" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="详细地址">
          <el-input v-model="reportForm.address" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reportDialog = false">取消</el-button>
        <el-button type="primary" :loading="reporting" @click="submitReport">提交并锁定时间戳</el-button>
      </template>
    </el-dialog>

    <!-- 新增服务商 -->
    <el-dialog v-model="dealerDialog" title="新增服务商" width="500px">
      <el-form :model="dealerForm" label-width="100px">
        <el-form-item label="名称" required><el-input v-model="dealerForm.name" /></el-form-item>
        <el-form-item label="编码" required><el-input v-model="dealerForm.code" placeholder="如 DL-WH01" /></el-form-item>
        <el-form-item label="授权城市" required>
          <el-input v-model="dealerForm.regionsText" placeholder="逗号分隔，如：武汉市,宜昌市" />
        </el-form-item>
        <el-form-item label="联系人"><el-input v-model="dealerForm.contactName" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="dealerForm.contactPhone" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dealerDialog = false">取消</el-button>
        <el-button type="primary" @click="createDealer">保存（自动建独立仓）</el-button>
      </template>
    </el-dialog>

    <!-- 归属日志 -->
    <el-drawer v-model="logsDialog" :size="440" :with-header="false">
      <div class="drawer-inner">
        <div class="drawer-head">
          <div>
            <div class="drawer-kicker">归属与保护记录</div>
            <div class="drawer-title">{{ logsTitle }}</div>
          </div>
          <button class="drawer-close" type="button" @click="logsDialog = false">×</button>
        </div>
        <div v-if="!clinicLogs.length" class="empty-line">暂无记录</div>
        <ul class="timeline">
          <li v-for="(l, i) in clinicLogs" :key="l.id" class="tl-item">
            <div class="tl-rail">
              <span class="tl-dot" :class="i === 0 ? 'latest' : ''" />
              <span class="tl-line" v-if="i < clinicLogs.length - 1" />
            </div>
            <div class="tl-body">
              <div class="tl-label">{{ l.action }}</div>
              <div class="tl-time mono">{{ l.serverTimestamp?.replace('T', ' ').slice(0, 19) }}</div>
              <div class="tl-meta">{{ l.remark }}</div>
            </div>
          </li>
        </ul>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const clinics = ref<any[]>([]);
const orgs = ref<any[]>([]);

const reportDialog = ref(false);
const reporting = ref(false);
const reportForm = ref({
  name: '',
  creditCode: '',
  province: '江西省',
  city: '南昌市',
  address: '',
  contactName: '',
  contactPhone: '',
  targetOrgId: '',
});

const dealerDialog = ref(false);
const dealerForm = ref({ name: '', code: '', regionsText: '', contactName: '', contactPhone: '' });

const logsDialog = ref(false);
const logsTitle = ref('');
const clinicLogs = ref<any[]>([]);

const dealers = computed(() => orgs.value.filter((o) => o.type === 'DEALER'));

async function loadAll() {
  const [c, o] = await Promise.all([api.get('/clinics'), api.get('/orgs')]);
  clinics.value = c as unknown as any[];
  orgs.value = o as unknown as any[];
}

onMounted(loadAll);

async function submitReport() {
  reporting.value = true;
  try {
    const res = (await api.post('/clinics/report', reportForm.value)) as any;
    ElMessage.success(res.message);
    reportDialog.value = false;
    reportForm.value.name = '';
    reportForm.value.creditCode = '';
    await loadAll();
  } finally {
    reporting.value = false;
  }
}

async function claimFromPool(row: any) {
  const res = (await api.post('/clinics/report', {
    name: row.name,
    city: row.city,
    cityCode: row.cityCode,
    contactPhone: row.contactPhone,
  })) as any;
  ElMessage.success(res.message);
  await loadAll();
}

async function runExpirySweep() {
  const res = (await api.post('/clinics/run-expiry-check')) as any;
  ElMessage.success(`巡检完成：释放 ${res.released90Count} 家、解绑 ${res.released270Count} 家`);
  await loadAll();
}

async function openLogs(row: any) {
  logsTitle.value = row.name;
  clinicLogs.value = (await api.get(`/clinics/${row.id}/logs`)) as unknown as any[];
  logsDialog.value = true;
}

async function toggleFreeze(org: any) {
  const nextFreeze = !org.supplyFrozen;
  let reason = '';
  if (nextFreeze) {
    const result = await ElMessageBox.prompt('暂停后该服务商无法下单，总仓也不会向其供货。', '暂停供货', {
      confirmButtonText: '确认暂停',
      cancelButtonText: '取消',
      inputValue: '月度流向核验异常未合理解释',
    }).catch(() => null);
    if (!result) return;
    reason = result.value;
  }
  await api.patch(`/orgs/${org.id}/freeze`, { supplyFrozen: nextFreeze, freezeReason: reason });
  ElMessage.success(nextFreeze ? '已暂停供货' : '已恢复供货');
  await loadAll();
}

async function createDealer() {
  const regionCodes = dealerForm.value.regionsText
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  await api.post('/orgs', {
    name: dealerForm.value.name,
    code: dealerForm.value.code,
    regionCodes,
    contactName: dealerForm.value.contactName,
    contactPhone: dealerForm.value.contactPhone,
  });
  ElMessage.success('服务商已创建，独立仓已同步开通');
  dealerDialog.value = false;
  await loadAll();
}

function bindLabel(s: string) {
  if (s === 'BOUND_ACTIVE') return '正式绑定';
  if (s === 'PROTECTED_90D') return '90 天保护';
  return '公海';
}
function bindClass(s: string) {
  if (s === 'BOUND_ACTIVE') return 'ok';
  if (s === 'PROTECTED_90D') return 'protect';
  return 'pool';
}
</script>

<style scoped>
.dealer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 12px;
}
.dealer-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.dealer-card.frozen {
  background: var(--surface-2);
}
.dc-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.dc-name {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.4;
}
.dc-code {
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 2px;
}
.dc-status {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid transparent;
  flex-shrink: 0;
}
.dc-status.ok {
  background: var(--jade-tint);
  border-color: #cfe0d3;
  color: var(--jade);
}
.dc-status.frozen {
  background: var(--seal-tint);
  border-color: var(--seal-line);
  color: var(--seal);
}
.dc-regions {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  min-height: 20px;
}
.region-chip {
  font-size: 10.5px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  border-radius: 3px;
  padding: 1px 6px;
  color: var(--ink-2);
}
.dc-stats {
  display: flex;
  gap: 22px;
  border-top: 1px solid var(--line);
  padding-top: 10px;
}
.dc-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dc-stat-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.dc-stat-label {
  font-size: 10.5px;
  color: var(--ink-3);
}
.dc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding-top: 2px;
}
.dc-foot-note {
  font-size: 10.5px;
  color: var(--ink-3);
}
.dc-action {
  flex-shrink: 0;
}
.dc-reason {
  font-size: 10.5px;
  color: var(--seal);
  line-height: 1.4;
}

/* 机构表 */
.cell-strong {
  font-size: 13px;
  font-weight: 600;
}
.cell-sub {
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 1px;
}
.bind-pill {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.bind-pill.ok {
  background: var(--jade-tint);
  border-color: #cfe0d3;
  color: var(--jade);
}
.bind-pill.protect {
  background: var(--brand-tint);
  border-color: var(--brand-line);
  color: var(--brand-ink);
}
.bind-pill.pool {
  background: var(--surface-3);
  border-color: var(--line);
  color: var(--ink-3);
}
.cd-label {
  font-size: 11px;
  color: var(--ink-2);
  line-height: 1.7;
}
.cd-label strong {
  font-family: var(--font-num);
  font-size: 13px;
  color: var(--ink);
  margin: 0 1px;
}
.cd-label strong.urgent {
  color: var(--seal);
}
.cd-bar {
  height: 3px;
  background: #efeee6;
  border-radius: 3px;
  margin-top: 8px;
  overflow: hidden;
  max-width: 150px;
}
.cd-bar span {
  display: block;
  height: 100%;
  background: var(--brand-line);
}
.cd-bar.soft span {
  background: #cfc9b8;
}
.bad {
  color: var(--seal);
}
.muted {
  color: var(--ink-3);
}

.form-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.dialog-note {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--ink-2);
  line-height: 1.6;
}

/* 抽屉 */
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 16px;
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
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tl-item {
  display: flex;
  gap: 12px;
}
.tl-rail {
  width: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  padding-top: 4px;
}
.tl-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--line-strong);
  background: var(--surface);
}
.tl-dot.latest {
  border-color: var(--brand);
  background: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-tint);
}
.tl-line {
  flex: 1;
  width: 1px;
  background: var(--line);
  margin-top: 4px;
  min-height: 30px;
}
.tl-body {
  flex: 1;
  padding-bottom: 16px;
}
.tl-label {
  font-size: 12.5px;
  font-weight: 600;
}
.tl-time {
  font-size: 10.5px;
  color: var(--ink-3);
  margin-top: 2px;
}
.tl-meta {
  font-size: 11.5px;
  color: var(--ink-2);
  margin-top: 3px;
  line-height: 1.55;
}

@media (max-width: 720px) {
  .form-2 {
    grid-template-columns: 1fr;
  }
}
</style>
