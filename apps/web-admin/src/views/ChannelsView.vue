<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">服务商与终端机构报备保护</h1>
        <p class="page-subtitle">服务端 UTC 时间戳抢单先报先得、90 天保护期锁定、270 天无复购自动解绑回公海、服务商授权区域与停供管控</p>
      </div>
      <div style="display: flex; gap: 10px">
        <el-button @click="runExpirySweep">立即执行到期巡检</el-button>
        <el-button v-if="auth.isHQ" @click="dealerDialog = true">+ 新增服务商</el-button>
        <el-button type="primary" @click="reportDialog = true">+ 机构报备（锁定90天）</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="surface-card">
      <el-tab-pane label="终端机构归属与保护倒计时" name="clinics">
        <el-table :data="clinics" size="small">
          <el-table-column prop="name" label="终端机构名称" min-width="180">
            <template #default="{ row }">
              <strong>{{ row.name }}</strong>
              <div style="font-size: 11px; color: var(--text-muted)">{{ row.province || '' }} {{ row.city }} · {{ row.contactName || '-' }} {{ row.contactPhone || '' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="归属服务商" width="170">
            <template #default="{ row }">{{ row.ownerOrg?.name || '公海待报备' }}</template>
          </el-table-column>
          <el-table-column label="保护 / 绑定状态" width="130">
            <template #default="{ row }">
              <el-tag size="small" :type="bindTagType(row.bindStatus)">{{ bindLabel(row.bindStatus) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="报备时间戳 (UTC)" width="160">
            <template #default="{ row }">
              <span class="mono" style="font-size: 12px">{{ row.reportedAt ? row.reportedAt.replace('T', ' ').slice(0, 19) : '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="规则倒计时" width="150">
            <template #default="{ row }">
              <el-tag v-if="row.protectDaysLeft !== null" size="small" :type="row.protectDaysLeft <= 15 ? 'danger' : 'warning'">
                90天保护剩 {{ row.protectDaysLeft }} 天
              </el-tag>
              <el-tag v-else-if="row.unbindDaysLeft !== null" size="small" :type="row.unbindDaysLeft <= 30 ? 'danger' : 'success'">
                270天解绑剩 {{ row.unbindDaysLeft }} 天
              </el-tag>
              <span v-else style="color: var(--text-muted)">可抢单报备</span>
            </template>
          </el-table-column>
          <el-table-column label="累计欠款" width="105" align="right">
            <template #default="{ row }">
              <span class="mono" :style="{ color: Number(row.arrearsAmount) > 0 ? 'var(--danger)' : 'var(--text-muted)' }">
                ¥{{ Number(row.arrearsAmount).toFixed(2) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="row.bindStatus === 'PUBLIC_POOL'"
                size="small"
                type="primary"
                plain
                @click="claimFromPool(row)"
              >
                立即抢单
              </el-button>
              <el-button v-else size="small" link @click="openLogs(row)">归属日志</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="服务商主体与停供管控" name="dealers">
        <el-table :data="orgs" size="small">
          <el-table-column prop="code" label="编码" width="110">
            <template #default="{ row }"><span class="mono">{{ row.code }}</span></template>
          </el-table-column>
          <el-table-column prop="name" label="服务商名称" min-width="180" />
          <el-table-column label="类型" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.type === 'HQ' ? 'primary' : 'info'">{{ row.type === 'HQ' ? '总部' : '服务商' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="授权区域（防窜货基准）" min-width="220">
            <template #default="{ row }">
              <el-tag v-for="r in (row.regionCodes || [])" :key="r" size="small" style="margin: 2px">{{ r }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="独立仓 / 绑定机构" width="150">
            <template #default="{ row }">
              {{ row.warehouses?.length || 0 }} 仓 · {{ row._count?.ownedClinics || 0 }} 家机构
            </template>
          </el-table-column>
          <el-table-column label="供货状态" width="100">
            <template #default="{ row }">
              <el-tag size="small" :type="row.supplyFrozen ? 'danger' : 'success'">
                {{ row.supplyFrozen ? '已停供冻结' : '正常供货' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="auth.isHQ && row.type === 'DEALER'"
                size="small"
                :type="row.supplyFrozen ? 'success' : 'danger'"
                plain
                @click="toggleFreeze(row)"
              >
                {{ row.supplyFrozen ? '恢复供货' : '暂停供货' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- Report Clinic Modal -->
    <el-dialog v-model="reportDialog" title="终端机构报备（服务端时间戳防扯皮）" width="520px">
      <el-form :model="reportForm" label-width="105px">
        <el-form-item label="机构全称" required>
          <el-input v-model="reportForm.name" placeholder="如：南昌华美皮肤管理中心" />
        </el-form-item>
        <el-form-item label="统一信用代码">
          <el-input v-model="reportForm.creditCode" placeholder="选填，填写后优先按营业执照唯一去重" />
        </el-form-item>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
          <el-form-item label="省份">
            <el-input v-model="reportForm.province" placeholder="如：江西省" />
          </el-form-item>
          <el-form-item label="所在城市" required>
            <el-input v-model="reportForm.city" placeholder="如：南昌市" />
          </el-form-item>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
          <el-form-item label="负责人">
            <el-input v-model="reportForm.contactName" />
          </el-form-item>
          <el-form-item label="联系电话">
            <el-input v-model="reportForm.contactPhone" />
          </el-form-item>
        </div>
        <el-form-item v-if="auth.isHQ" label="归属服务商">
          <el-select v-model="reportForm.targetOrgId" style="width: 100%" placeholder="默认总部，可指定服务商">
            <el-option v-for="d in orgs.filter((o) => o.type === 'DEALER')" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="详细地址">
          <el-input v-model="reportForm.address" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reportDialog = false">取消</el-button>
        <el-button type="primary" :loading="reporting" @click="submitReport">确认报备并锁时间戳</el-button>
      </template>
    </el-dialog>

    <!-- Add Dealer Modal -->
    <el-dialog v-model="dealerDialog" title="新增区域服务商（自动建独立仓）" width="500px">
      <el-form :model="dealerForm" label-width="100px">
        <el-form-item label="服务商名称" required><el-input v-model="dealerForm.name" /></el-form-item>
        <el-form-item label="服务商编码" required><el-input v-model="dealerForm.code" placeholder="如 DL-WH01" /></el-form-item>
        <el-form-item label="授权城市" required><el-input v-model="dealerForm.regionsText" placeholder="多个城市用逗号分隔，如：武汉市,宜昌市" /></el-form-item>
        <el-form-item label="联系人"><el-input v-model="dealerForm.contactName" /></el-form-item>
        <el-form-item label="联系电话"><el-input v-model="dealerForm.contactPhone" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dealerDialog = false">取消</el-button>
        <el-button type="primary" @click="createDealer">保存服务商</el-button>
      </template>
    </el-dialog>

    <!-- Protection Logs Modal -->
    <el-dialog v-model="logsDialog" :title="`归属与保护时间戳日志 · ${logsTitle}`" width="560px">
      <el-timeline>
        <el-timeline-item
          v-for="l in clinicLogs"
          :key="l.id"
          :timestamp="l.serverTimestamp?.replace('T', ' ').slice(0, 19) + ' UTC'"
          type="primary"
        >
          <strong>{{ l.action }}</strong>
          <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 2px">{{ l.remark }}</div>
        </el-timeline-item>
      </el-timeline>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const activeTab = ref('clinics');
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
  ElMessage.success(
    `到期巡检完成：90天超期释放 ${res.released90Count} 家，270天无复购解绑 ${res.released270Count} 家`,
  );
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
    const prompt = await ElMessageBox.prompt('请输入暂停供货原因（将阻断该服务商下单及总仓向其供货）', '暂停供货确认', {
      confirmButtonText: '确认冻结',
      cancelButtonText: '取消',
      inputValue: '月度流向核验异常未合理解释',
    }).catch(() => null);
    if (!prompt) return;
    reason = prompt.value;
  }
  await api.patch(`/orgs/${org.id}/freeze`, { supplyFrozen: nextFreeze, freezeReason: reason });
  ElMessage.success(nextFreeze ? '已暂停该服务商供货权限' : '已恢复该服务商正常供货');
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
  ElMessage.success('服务商与独立仓创建成功');
  dealerDialog.value = false;
  await loadAll();
}

function bindLabel(s: string) {
  if (s === 'BOUND_ACTIVE') return '正式绑定(270天)';
  if (s === 'PROTECTED_90D') return '报备保护(90天)';
  return '公海池';
}
function bindTagType(s: string): any {
  if (s === 'BOUND_ACTIVE') return 'success';
  if (s === 'PROTECTED_90D') return 'warning';
  return 'info';
}
</script>
