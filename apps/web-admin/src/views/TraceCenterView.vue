<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">一物一码溯源与防窜货中心</h1>
        <p class="page-subtitle">工厂批次赋码（箱盒双层关联）、全生命周期单码流向追踪及跨区窜货预警处置</p>
      </div>
      <el-button v-if="auth.isHQ" type="primary" @click="batchDialog = true">
        + 生成工厂防伪码批次
      </el-button>
    </div>

    <el-tabs v-model="activeTab" class="surface-card">
      <el-tab-pane label="生码批次与二维码" name="batches">
        <el-table :data="batches" size="small">
          <el-table-column prop="batchNo" label="批次号" width="160">
            <template #default="{ row }"><span class="mono">{{ row.batchNo }}</span></template>
          </el-table-column>
          <el-table-column label="商品">
            <template #default="{ row }">
              <strong>{{ row.product.name }}</strong>
              <span style="color: var(--text-muted); margin-left: 6px" class="mono">{{ row.product.skuCode }}</span>
            </template>
          </el-table-column>
          <el-table-column label="箱 / 盒配置" width="150">
            <template #default="{ row }" class="mono">
              {{ row.cartonCount }} 箱 / {{ row.unitCount }} 盒（{{ row.cartonQty }}盒/箱）
            </template>
          </el-table-column>
          <el-table-column label="有效期至" width="110">
            <template #default="{ row }"><span class="mono">{{ row.expDate?.slice(0, 10) }}</span></template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" show-overflow-tooltip />
          <el-table-column label="操作" width="210" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" plain @click="openBatchCodes(row.id)">查看码与二维码</el-button>
              <el-button size="small" @click="downloadCsv(row.id, row.batchNo)">导出CSV</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="单码全链路追踪" name="timeline">
        <div class="scan-input-bar">
          <el-input
            v-model="lookupCode"
            placeholder="请扫描或输入 16 位防伪码 Token 或完整二维码链接，回车查询"
            clearable
            style="max-width: 520px"
            @keyup.enter="searchTimeline"
          />
          <el-button type="primary" :loading="searching" @click="searchTimeline">查询流向</el-button>
        </div>

        <div v-if="timelineData" class="timeline-result">
          <div class="trace-summary-grid">
            <div class="info-box">
              <div class="info-label">防伪码 Token & 级别</div>
              <div class="info-val mono">
                {{ timelineData.code.codeToken }}
                <el-tag size="small" style="margin-left: 6px">
                  {{ timelineData.code.codeLevel === 'CARTON' ? '外箱码' : '单品盒码' }}
                </el-tag>
                <el-tag size="small" :type="timelineData.signatureValid ? 'success' : 'danger'" style="margin-left: 4px">
                  {{ timelineData.signatureValid ? 'HMAC 验签通过' : '签名异常' }}
                </el-tag>
              </div>
            </div>
            <div class="info-box">
              <div class="info-label">商品与批次</div>
              <div class="info-val">{{ timelineData.code.product.name }}（{{ timelineData.code.batch.batchNo }}）</div>
            </div>
            <div class="info-box">
              <div class="info-label">当前状态 / 查验次数</div>
              <div class="info-val">
                <el-tag size="small">{{ timelineData.code.status }}</el-tag>
                <span class="mono" style="margin-left: 8px">C端查验 {{ timelineData.code.verifyCount }} 次</span>
              </div>
            </div>
            <div class="info-box">
              <div class="info-label">当前归属流向</div>
              <div class="info-val">
                服务商：{{ timelineData.assignedDealer?.name || '总部在库' }}
                <span v-if="timelineData.targetClinic"> → 机构：{{ timelineData.targetClinic.name }}</span>
              </div>
            </div>
          </div>

          <h4 style="margin: 18px 0 12px; font-size: 14px">全生命周期流转时间轴</h4>
          <el-timeline>
            <el-timeline-item
              v-for="ev in timelineData.code.events"
              :key="ev.id"
              :timestamp="ev.occurredAt?.replace('T', ' ').slice(0, 19)"
              type="primary"
            >
              <strong>{{ eventLabel(ev.eventType) }}</strong>
              <span v-if="ev.docNo" class="code-chip" style="margin-left: 8px">{{ ev.docNo }}</span>
              <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 3px">{{ ev.remark }}</div>
            </el-timeline-item>
          </el-timeline>
        </div>
      </el-tab-pane>

      <el-tab-pane label="窜货与合规风控预警" name="alerts">
        <el-table :data="alerts" size="small">
          <el-table-column label="级别" width="84">
            <template #default="{ row }">
              <el-tag size="small" :type="row.severity === 'CRITICAL' || row.severity === 'HIGH' ? 'danger' : 'warning'">
                {{ row.severity }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="alertType" label="预警类型" width="150" />
          <el-table-column prop="title" label="预警标题" min-width="220" />
          <el-table-column prop="detail" label="证据详情" min-width="280" show-overflow-tooltip />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'RESOLVED' ? 'success' : 'danger'">
                {{ row.status === 'RESOLVED' ? '已处置' : '待处置' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="auth.isHQ && row.status !== 'RESOLVED'"
                size="small"
                type="primary"
                plain
                @click="openResolve(row)"
              >
                处置结案
              </el-button>
              <span v-else style="font-size: 12px; color: var(--text-muted)">{{ row.resolution || '-' }}</span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- Create Batch Modal -->
    <el-dialog v-model="batchDialog" title="工厂批次生码（一物一码 + 箱盒关联）" width="520px">
      <el-form :model="batchForm" label-width="110px">
        <el-form-item label="选择商品" required>
          <el-select v-model="batchForm.productId" style="width: 100%" placeholder="请选择商品">
            <el-option
              v-for="p in products"
              :key="p.id"
              :label="`${p.name} (${p.skuCode}) - ${p.cartonQty}${p.unitName}/箱`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="单品盒数" required>
          <el-input-number v-model="batchForm.unitCount" :min="1" :max="10000" style="width: 100%" />
        </el-form-item>
        <el-form-item label="启用箱盒关联">
          <el-switch v-model="batchForm.enableCarton" active-text="整箱预绑定箱码" />
        </el-form-item>
        <el-form-item v-if="batchForm.enableCarton" label="每箱盒数">
          <el-input-number v-model="batchForm.cartonQty" :min="2" :max="200" style="width: 100%" />
        </el-form-item>
        <el-form-item label="批次备注">
          <el-input v-model="batchForm.remark" placeholder="如：广州厂11月第二批赋码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitBatch">立即生成防伪码</el-button>
      </template>
    </el-dialog>

    <!-- Batch Codes & Live QR Dialog -->
    <el-dialog v-model="codesDialog" :title="`批次码明细：${batchCodesData?.batch?.batchNo || ''}`" width="900px">
      <div v-if="batchCodesData" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center">
        <span style="font-size: 13px; color: var(--text-secondary)">
          点击任意二维码或“模拟C端扫码验真”即可体验消费者防伪查询页（含首次/多次提示与异地窜货检测）
        </span>
        <el-button size="small" type="primary" @click="downloadCsv(batchCodesData.batch.id, batchCodesData.batch.batchNo)">
          导出工厂印刷 CSV
        </el-button>
      </div>
      <el-table :data="batchCodesData?.codes || []" size="small" max-height="460">
        <el-table-column label="码级别" width="95">
          <template #default="{ row }">
            <el-tag size="small" :type="row.codeLevel === 'CARTON' ? 'warning' : 'success'">
              {{ row.codeLevel === 'CARTON' ? '外箱码' : '单品盒码' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="codeToken" label="防伪码 Token" width="180">
          <template #default="{ row }">
            <span class="code-chip" style="cursor: pointer" @click="copyToken(row.codeToken)">{{ row.codeToken }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="parentToken" label="所属外箱码" width="160">
          <template #default="{ row }"><span class="mono">{{ row.parentToken || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="status" label="当前状态" width="150" />
        <el-table-column label="操作" width="230">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="jumpTimeline(row.codeToken)">查流向</el-button>
            <el-button size="small" link type="success" @click="openQrPreview(row)">二维码</el-button>
            <el-button size="small" link type="warning" @click="openConsumerVerify(row.codeToken)">C端验真</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- Single QR Preview -->
    <el-dialog v-model="qrDialog" title="产品溯源二维码（手机微信/浏览器可扫）" width="380px">
      <div style="text-align: center; padding: 10px 0">
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="Trace QR" style="width: 210px; height: 210px; border: 1px solid var(--border-subtle); border-radius: 8px" />
        <div class="mono" style="margin-top: 10px; font-weight: 700; font-size: 15px">{{ qrTarget?.codeToken }}</div>
        <div style="font-size: 12px; color: var(--text-muted); word-break: break-all; margin-top: 6px">{{ qrTarget?.verifyUrl }}</div>
        <div style="margin-top: 14px">
          <el-button type="primary" @click="openConsumerVerify(qrTarget?.codeToken)">直接模拟终端扫码验真</el-button>
        </div>
      </div>
    </el-dialog>

    <!-- Alert Resolution Modal -->
    <el-dialog v-model="resolveDialog" title="风控预警处置结案" width="460px">
      <el-form label-width="90px">
        <el-form-item label="预警事件">
          <div style="font-weight: 600">{{ activeAlert?.title }}</div>
        </el-form-item>
        <el-form-item label="处置结论" required>
          <el-input v-model="resolutionText" type="textarea" :rows="3" placeholder="请输入核查结果与处罚/返点扣减说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resolveDialog = false">取消</el-button>
        <el-button type="primary" @click="submitResolve">确认结案</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import QRCode from 'qrcode';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const activeTab = ref('batches');
const batches = ref<any[]>([]);
const products = ref<any[]>([]);
const alerts = ref<any[]>([]);

const batchDialog = ref(false);
const creating = ref(false);
const batchForm = ref({ productId: '', unitCount: 12, enableCarton: true, cartonQty: 6, remark: '' });

const codesDialog = ref(false);
const batchCodesData = ref<any>(null);

const qrDialog = ref(false);
const qrTarget = ref<any>(null);
const qrDataUrl = ref('');

const lookupCode = ref('');
const searching = ref(false);
const timelineData = ref<any>(null);

const resolveDialog = ref(false);
const activeAlert = ref<any>(null);
const resolutionText = ref('');

async function loadAll() {
  const [b, p, a] = await Promise.all([
    api.get('/trace/batches'),
    api.get('/products'),
    api.get('/trace/alerts'),
  ]);
  batches.value = b as unknown as any[];
  products.value = p as unknown as any[];
  alerts.value = a as unknown as any[];
  if (products.value.length && !batchForm.value.productId) {
    batchForm.value.productId = products.value[0].id;
  }
}

onMounted(loadAll);

async function submitBatch() {
  creating.value = true;
  try {
    const res = (await api.post('/trace/batches', batchForm.value)) as any;
    ElMessage.success(`成功生成 ${res.unitCount} 个单品防伪码（${res.cartonCount} 个外箱码）`);
    batchDialog.value = false;
    await loadAll();
    if (res.batch?.id) openBatchCodes(res.batch.id);
  } finally {
    creating.value = false;
  }
}

async function openBatchCodes(batchId: string) {
  batchCodesData.value = await api.get(`/trace/batches/${batchId}/codes`);
  codesDialog.value = true;
}

async function downloadCsv(batchId: string, batchNo: string) {
  const token = localStorage.getItem('lumina_token');
  const resp = await fetch(`/api/v1/trace/batches/${batchId}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${batchNo}_trace_codes.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function openQrPreview(row: any) {
  qrTarget.value = row;
  const hostUrl = `http://${window.location.hostname}:5174/v/${row.codeToken}`;
  qrTarget.value = { ...row, verifyUrl: hostUrl };
  qrDataUrl.value = await QRCode.toDataURL(hostUrl, { width: 220, margin: 1 });
  qrDialog.value = true;
}

function openConsumerVerify(token: string) {
  window.open(`http://${window.location.hostname}:5174/v/${token}`, '_blank');
}

function copyToken(token: string) {
  navigator.clipboard?.writeText(token);
  ElMessage.success(`已复制防伪码：${token}`);
}

async function jumpTimeline(token: string) {
  codesDialog.value = false;
  activeTab.value = 'timeline';
  lookupCode.value = token;
  await searchTimeline();
}

async function searchTimeline() {
  if (!lookupCode.value.trim()) return;
  searching.value = true;
  try {
    timelineData.value = await api.get(
      `/trace/codes/${encodeURIComponent(lookupCode.value.trim())}/timeline`,
    );
  } finally {
    searching.value = false;
  }
}

function openResolve(row: any) {
  activeAlert.value = row;
  resolutionText.value = '';
  resolveDialog.value = true;
}

async function submitResolve() {
  if (!resolutionText.value.trim()) return ElMessage.warning('请填写处置结论');
  await api.patch(`/trace/alerts/${activeAlert.value.id}/resolve`, {
    status: 'RESOLVED',
    resolution: resolutionText.value,
  });
  ElMessage.success('预警已结案');
  resolveDialog.value = false;
  await loadAll();
}

function eventLabel(t: string) {
  const m: Record<string, string> = {
    BATCH_GENERATED: '工厂赋码生成',
    CARTON_BOUND: '外箱绑定关联',
    HQ_INBOUND: '品牌总仓扫码入库',
    HQ_OUTBOUND: '总仓扫码出库至服务商',
    DEALER_INBOUND: '服务商独立仓确认收货',
    DEALER_OUTBOUND: '服务商扫码出库至终端机构',
    CARTON_UNPACKED: '外箱拆零自动解绑',
    RETURN_TO_DEALER: '机构退货回服务商仓',
    RETURN_TO_HQ: '退货回品牌总仓',
    CONSUMER_VERIFIED: '终端顾客首次扫码验真',
  };
  return m[t] || t;
}
</script>

<style scoped>
.trace-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.info-box {
  background: var(--bg-canvas);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 12px 14px;
}
.info-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.info-val {
  font-size: 13.5px;
  font-weight: 600;
}
</style>
