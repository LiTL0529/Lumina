<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">一物一码</h1>
        <p class="page-subtitle">
          工厂生码时箱盒预绑定，出库时扫箱码自动整箱展开、拆零扫盒码自动解绑外箱。任何一个码，都能倒着查到它经过的每一手。
        </p>
      </div>
      <div class="page-actions">
        <el-button v-if="auth.isHQ" type="primary" @click="batchDialog = true">生成防伪码批次</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="plain-tabs">
      <!-- 批次 -->
      <el-tab-pane label="生码批次" name="batches">
        <div class="surface-card flush">
          <el-table :data="batches" size="small" empty-text="还没有生码批次">
            <el-table-column label="批次号" width="160">
              <template #default="{ row }"><span class="mono cell-doc">{{ row.batchNo }}</span></template>
            </el-table-column>
            <el-table-column label="商品" min-width="200">
              <template #default="{ row }">
                <div class="cell-strong">{{ row.product.name }}</div>
                <div class="cell-sub mono">{{ row.product.skuCode }}</div>
              </template>
            </el-table-column>
            <el-table-column label="箱 / 盒" width="140">
              <template #default="{ row }">
                <span class="mono">{{ row.cartonCount }}</span> 箱
                <span class="cell-sub">/</span>
                <span class="mono">{{ row.unitCount }}</span> 盒
                <div class="cell-sub">{{ row.cartonQty }} 盒/箱</div>
              </template>
            </el-table-column>
            <el-table-column label="有效期" width="110">
              <template #default="{ row }"><span class="mono cell-sub">{{ row.expDate?.slice(0, 10) }}</span></template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
            <el-table-column label="操作" width="200" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" plain @click="openBatchCodes(row.id)">查看码</el-button>
                <el-button size="small" link @click="downloadCsv(row.id, row.batchNo)">导出 CSV</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- 单码追踪 -->
      <el-tab-pane label="单码追踪" name="timeline">
        <div class="trace-search">
          <div class="ts-field">
            <el-icon class="ts-icon"><Aim /></el-icon>
            <input
              v-model="lookupCode"
              class="ts-input mono"
              placeholder="扫描或粘贴 16 位防伪码 / 二维码链接"
              @keyup.enter="searchTimeline"
            />
            <button class="ts-btn" type="button" :disabled="searching" @click="searchTimeline">
              {{ searching ? '查询中…' : '查流向' }}
            </button>
          </div>
          <span class="ts-hint">在顶部全局搜索框扫码，也会直接跳到这里</span>
        </div>

        <template v-if="timelineData">
          <div class="code-hero">
            <div class="ch-left">
              <div class="ch-kicker">
                {{ timelineData.code.codeLevel === 'CARTON' ? '外箱码' : '单品盒码' }}
                <span class="ch-dot">·</span>
                <span :class="timelineData.signatureValid ? 'ch-ok' : 'ch-bad'">
                  {{ timelineData.signatureValid ? '签名校验通过' : '签名异常' }}
                </span>
              </div>
              <div class="ch-token mono">{{ timelineData.code.codeToken }}</div>
              <div class="ch-product">
                {{ timelineData.code.product.name }}
                <span class="mono ch-sku">{{ timelineData.code.product.skuCode }}</span>
              </div>
            </div>
            <div class="ch-right">
              <div class="ch-stat">
                <span class="ch-stat-label">当前状态</span>
                <span class="ch-stat-value">{{ statusLabel(timelineData.code.status) }}</span>
              </div>
              <div class="ch-stat">
                <span class="ch-stat-label">已验证</span>
                <span class="ch-stat-value num">{{ timelineData.code.verifyCount }} 次</span>
              </div>
              <div class="ch-stat">
                <span class="ch-stat-label">批次</span>
                <span class="ch-stat-value mono">{{ timelineData.code.batch.batchNo }}</span>
              </div>
            </div>
          </div>

          <section class="surface-card chain-wrap">
            <div class="section-header">
              <h2 class="section-title">这一盒走过的路</h2>
              <span class="section-note">
                归属：{{ timelineData.assignedDealer?.name || '总部在库' }}
                <template v-if="timelineData.targetClinic"> → {{ timelineData.targetClinic.name }}</template>
              </span>
            </div>
            <CodeChain :stages="journeyStages" />
          </section>

          <section class="surface-card">
            <div class="section-header">
              <h2 class="section-title">流向时间轴</h2>
              <span class="section-note">每次流转都带单号与操作人，不可篡改</span>
            </div>
            <ul class="timeline">
              <li v-for="(ev, i) in reversedEvents" :key="ev.id" class="tl-item">
                <div class="tl-rail">
                  <span class="tl-dot" :class="i === 0 ? 'latest' : ''" />
                  <span class="tl-line" v-if="i < reversedEvents.length - 1" />
                </div>
                <div class="tl-body">
                  <div class="tl-top">
                    <span class="tl-label">{{ eventLabel(ev.eventType) }}</span>
                    <span class="tl-time mono">{{ fmtTime(ev.occurredAt) }}</span>
                  </div>
                  <div class="tl-meta">
                    <span v-if="ev.docNo" class="code-chip">{{ ev.docNo }}</span>
                    <span v-if="ev.remark">{{ ev.remark }}</span>
                  </div>
                </div>
              </li>
            </ul>
          </section>
        </template>

        <div v-else class="trace-empty">
          <div class="te-title">扫一个码试试</div>
          <div class="te-desc">
            在顶部全局搜索框扫任意防伪码，或在上方输入框粘贴 16 位码，就能看到它从出厂到顾客的完整路径。
          </div>
        </div>
      </el-tab-pane>

      <!-- 预警 -->
      <el-tab-pane label="窜货与合规预警" name="alerts">
        <div class="surface-card flush">
          <el-table :data="alerts" size="small" empty-text="当前渠道流向健康">
            <el-table-column label="级别" width="76">
              <template #default="{ row }">
                <span class="sev" :class="sevClass(row.severity)">{{ row.severity }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="alertType" label="类型" width="150" />
            <el-table-column prop="title" label="事件" min-width="200" />
            <el-table-column prop="detail" label="证据" min-width="240" show-overflow-tooltip />
            <el-table-column label="状态" width="95">
              <template #default="{ row }">
                <span class="rec-pill" :class="row.status === 'RESOLVED' ? 'ok' : 'bad'">
                  {{ row.status === 'RESOLVED' ? '已结案' : '待处置' }}
                </span>
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
                  结案
                </el-button>
                <span v-else class="cell-sub">{{ row.resolution || '—' }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 生码 -->
    <el-dialog v-model="batchDialog" title="生成防伪码批次" width="540px">
      <el-form :model="batchForm" label-width="110px">
        <el-form-item label="商品" required>
          <el-select v-model="batchForm.productId" style="width: 100%" placeholder="选择商品">
            <el-option
              v-for="p in products"
              :key="p.id"
              :label="`${p.name}（${p.skuCode}）${p.cartonQty}${p.unitName}/箱`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="单品盒数" required>
          <el-input-number v-model="batchForm.unitCount" :min="1" :max="10000" style="width: 100%" controls-position="right" />
        </el-form-item>
        <el-form-item label="箱盒关联">
          <el-switch v-model="batchForm.enableCarton" active-text="整箱预绑定箱码" />
        </el-form-item>
        <el-form-item v-if="batchForm.enableCarton" label="每箱盒数">
          <el-input-number v-model="batchForm.cartonQty" :min="2" :max="200" style="width: 100%" controls-position="right" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="batchForm.remark" placeholder="如：广州厂 11 月第二批" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitBatch">生成</el-button>
      </template>
    </el-dialog>

    <!-- 批次码明细 -->
    <el-dialog v-model="codesDialog" :title="`批次码 · ${batchCodesData?.batch?.batchNo || ''}`" width="920px">
      <div class="codes-toolbar">
        <span class="dialog-note">点二维码可预览手机扫码页，点 C 端验真可模拟顾客查验。</span>
        <el-button
          size="small"
          @click="downloadCsv(batchCodesData.batch.id, batchCodesData.batch.batchNo)"
        >
          导出工厂印刷 CSV
        </el-button>
      </div>
      <el-table :data="batchCodesData?.codes || []" size="small" max-height="460">
        <el-table-column label="级别" width="80">
          <template #default="{ row }">
            <span class="level-tag" :class="row.codeLevel === 'CARTON' ? 'carton' : 'unit'">
              {{ row.codeLevel === 'CARTON' ? '外箱' : '单盒' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="codeToken" label="防伪码" width="185">
          <template #default="{ row }">
            <span class="code-chip clickable" @click="copyToken(row.codeToken)">{{ row.codeToken }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="parentToken" label="所属外箱" width="170">
          <template #default="{ row }"><span class="mono cell-sub">{{ row.parentToken || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="150">
          <template #default="{ row }"><span class="cell-sub">{{ statusLabel(row.status) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="jumpTimeline(row.codeToken)">查流向</el-button>
            <el-button size="small" link @click="openQrPreview(row)">二维码</el-button>
            <el-button size="small" link @click="openConsumerVerify(row.codeToken)">C 端验真</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 二维码 -->
    <el-dialog v-model="qrDialog" title="产品溯源二维码" width="360px">
      <div class="qr-wrap">
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="溯源二维码" class="qr-img" />
        <div class="mono qr-token">{{ qrTarget?.codeToken }}</div>
        <div class="qr-url">{{ qrTarget?.verifyUrl }}</div>
        <el-button type="primary" style="margin-top: 14px" @click="openConsumerVerify(qrTarget?.codeToken)">
          模拟顾客扫码
        </el-button>
      </div>
    </el-dialog>

    <!-- 结案 -->
    <el-dialog v-model="resolveDialog" title="预警结案" width="460px">
      <div class="resolve-head">{{ activeAlert?.title }}</div>
      <el-input
        v-model="resolutionText"
        type="textarea"
        :rows="3"
        placeholder="填写核查结果与处罚 / 返点扣减说明"
      />
      <template #footer>
        <el-button @click="resolveDialog = false">取消</el-button>
        <el-button type="primary" @click="submitResolve">确认结案</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import QRCode from 'qrcode';
import { ElMessage } from 'element-plus';
import { Aim } from '@element-plus/icons-vue';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import CodeChain from '../components/CodeChain.vue';

const auth = useAuthStore();
const route = useRoute();
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

const reversedEvents = computed(() => [...(timelineData.value?.code?.events || [])].reverse());

const journeyStages = computed(() => {
  const events: any[] = timelineData.value?.code?.events || [];
  const has = (t: string) => events.some((e) => e.eventType === t);
  const stage = (done: boolean, active: boolean) => (active ? 'active' : done ? 'done' : 'idle');
  const consumerActive = has('CONSUMER_VERIFIED');
  return [
    { key: 'gen', label: '出厂赋码', note: '工厂生成', state: stage(has('BATCH_GENERATED') || true, false) },
    { key: 'hq', label: '总仓入库', note: has('HQ_INBOUND') ? '已入库' : '未入库', state: stage(has('HQ_INBOUND'), false) },
    {
      key: 'dealer',
      label: '发往服务商',
      note: timelineData.value?.assignedDealer?.name || '尚未出库',
      state: stage(has('HQ_OUTBOUND') || has('DEALER_INBOUND'), false),
    },
    {
      key: 'clinic',
      label: '终端机构',
      note: timelineData.value?.targetClinic?.name || '尚未到店',
      state: stage(has('DEALER_OUTBOUND'), false),
    },
    {
      key: 'consumer',
      label: '顾客验真',
      note: has('CONSUMER_VERIFIED') ? `已验 ${timelineData.value.code.verifyCount} 次` : '待扫码',
      state: consumerActive ? 'active' : 'idle',
    },
  ] as any;
});

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

onMounted(async () => {
  await loadAll();
  const q = route.query.code as string | undefined;
  if (q) {
    activeTab.value = 'timeline';
    lookupCode.value = q;
    await searchTimeline();
  }
});

async function submitBatch() {
  creating.value = true;
  try {
    const res = (await api.post('/trace/batches', batchForm.value)) as any;
    ElMessage.success(`已生成 ${res.unitCount} 个单品码、${res.cartonCount} 个外箱码`);
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

function getVerifyBase() {
  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:5174/v`;
  }
  return `${window.location.origin}/v`;
}

async function openQrPreview(row: any) {
  const hostUrl = `${getVerifyBase()}/${row.codeToken}`;
  qrTarget.value = { ...row, verifyUrl: hostUrl };
  qrDataUrl.value = await QRCode.toDataURL(hostUrl, { width: 220, margin: 1, color: { dark: '#17211f', light: '#ffffff' } });
  qrDialog.value = true;
}

function openConsumerVerify(token: string) {
  window.open(`${getVerifyBase()}/${token}`, '_blank');
}

function copyToken(token: string) {
  navigator.clipboard?.writeText(token);
  ElMessage.success(`已复制：${token}`);
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
    HQ_OUTBOUND: '总仓出库至服务商',
    DEALER_INBOUND: '服务商收货入独立仓',
    DEALER_OUTBOUND: '服务商出库至终端机构',
    CARTON_UNPACKED: '外箱拆零自动解绑',
    RETURN_TO_DEALER: '机构退货回服务商仓',
    RETURN_TO_HQ: '退货回品牌总仓',
    CONSUMER_VERIFIED: '顾客扫码验真',
  };
  return m[t] || t;
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    GENERATED: '已生成待入库',
    IN_HQ_STOCK: '总仓在库',
    IN_TRANSIT_TO_DEALER: '发往服务商在途',
    IN_DEALER_STOCK: '服务商在库',
    SOLD_TO_CLINIC: '已售至机构',
    CONSUMED: '已核销',
    UNPACKED: '外箱已拆零',
    VOIDED: '已作废',
  };
  return m[s] || s;
}

function sevClass(s: string) {
  return s === 'CRITICAL' || s === 'HIGH' ? 'high' : 'medium';
}

function fmtTime(t: string) {
  return t?.replace('T', ' ').slice(0, 16);
}
</script>

<style scoped>
.plain-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}
.cell-doc {
  color: var(--brand-ink);
  font-size: 12.5px;
  font-weight: 600;
}
.cell-strong {
  font-size: 13px;
  font-weight: 600;
}
.cell-sub {
  font-size: 11px;
  color: var(--ink-3);
}

/* 搜索 */
.trace-search {
  margin-bottom: 16px;
}
.ts-field {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 8px;
  padding: 6px 6px 6px 14px;
}
.ts-icon {
  color: var(--ink-3);
}
.ts-input {
  flex: 1;
  border: 0;
  outline: none;
  font-size: 14px;
  letter-spacing: 0.05em;
  background: transparent;
  min-width: 0;
}
.ts-input::placeholder {
  font-family: var(--font-ui);
  letter-spacing: 0;
  color: var(--ink-3);
}
.ts-btn {
  border: 0;
  background: var(--brand);
  color: #fff;
  border-radius: 5px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
}
.ts-btn:hover {
  background: var(--brand-ink);
}
.ts-hint {
  display: block;
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 7px;
  padding-left: 4px;
}

/* 码摘要 */
.code-hero {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  background: var(--dark);
  color: var(--dark-ink);
  border-radius: var(--radius-md);
  padding: 20px 24px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.ch-kicker {
  font-size: 10.5px;
  color: #7e9993;
  letter-spacing: 0.06em;
}
.ch-dot {
  margin: 0 4px;
}
.ch-ok {
  color: #8fc9b4;
}
.ch-bad {
  color: #e2a49b;
}
.ch-token {
  font-size: 24px;
  letter-spacing: 0.12em;
  margin-top: 8px;
  color: #f0f6f4;
  font-weight: 600;
}
.ch-product {
  font-size: 13px;
  color: #b7cbc6;
  margin-top: 8px;
}
.ch-sku {
  margin-left: 8px;
  color: #7e9993;
  font-size: 11.5px;
}
.ch-right {
  display: flex;
  gap: 26px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.ch-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ch-stat-label {
  font-size: 10.5px;
  color: #6d8781;
}
.ch-stat-value {
  font-size: 14px;
  color: #e8efec;
  font-weight: 500;
}
.chain-wrap {
  margin-bottom: 14px;
}

/* 时间轴 */
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tl-item {
  display: flex;
  gap: 14px;
}
.tl-rail {
  width: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  padding-top: 5px;
}
.tl-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--line-strong);
  background: var(--surface);
  flex-shrink: 0;
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
  margin: 4px 0 0;
  min-height: 34px;
}
.tl-body {
  flex: 1;
  padding-bottom: 16px;
  min-width: 0;
}
.tl-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.tl-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
}
.tl-time {
  font-size: 11px;
  color: var(--ink-3);
  flex-shrink: 0;
}
.tl-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
  color: var(--ink-2);
  margin-top: 3px;
  flex-wrap: wrap;
}

/* 空态 */
.trace-empty {
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-md);
  padding: 56px 24px;
  text-align: center;
  background: var(--surface-2);
}
.te-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}
.te-desc {
  font-size: 12.5px;
  color: var(--ink-2);
  margin-top: 8px;
  line-height: 1.7;
  max-width: 44ch;
  margin-left: auto;
  margin-right: auto;
}

/* 弹窗 */
.codes-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.dialog-note {
  margin: 0;
  font-size: 12px;
  color: var(--ink-2);
}
.qr-wrap {
  text-align: center;
}
.qr-img {
  width: 210px;
  height: 210px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.qr-token {
  margin-top: 10px;
  font-size: 15px;
  font-weight: 600;
}
.qr-url {
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 5px;
  word-break: break-all;
}
.resolve-head {
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 12px;
  line-height: 1.5;
}

.level-tag {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink-2);
}
.level-tag.carton {
  border-color: #dcc9a3;
  background: var(--ochre-tint);
  color: var(--ochre);
}
.level-tag.unit {
  border-color: var(--brand-line);
  background: var(--brand-tint);
  color: var(--brand-ink);
}
.sev {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid transparent;
}
.sev.high {
  background: var(--seal-tint);
  color: var(--seal);
  border-color: var(--seal-line);
}
.sev.medium {
  background: var(--ochre-tint);
  color: var(--ochre);
  border-color: #e6d5ae;
}
.rec-pill {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 3px;
  border: 1px solid transparent;
}
.rec-pill.ok {
  background: var(--jade-tint);
  border-color: #cfe0d3;
  color: var(--jade);
}
.rec-pill.bad {
  background: var(--seal-tint);
  border-color: var(--seal-line);
  color: var(--seal);
}
</style>
