<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">扫码入库建档</h1>
        <p class="page-subtitle">扫码建档入库、系统防伪码入库与采购单管理</p>
      </div>
      <div class="page-actions">
        <el-button v-if="auth.isHQ" @click="poDialog = true">新增采购单</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="plain-tabs">
      <el-tab-pane label="扫码作业台" name="scan">
        <div class="desk">
          <!-- 作业条件 -->
          <div class="desk-toolbar">
            <div class="segmented" role="tablist">
              <button
                v-if="auth.isHQ"
                type="button"
                :class="{ on: scanMode === 'REGISTER_INBOUND' }"
                @click="switchScanMode('REGISTER_INBOUND')"
              >
                扫码建档入库
              </button>
              <button
                v-if="auth.isHQ"
                type="button"
                :class="{ on: scanMode === 'HQ_INBOUND' }"
                @click="switchScanMode('HQ_INBOUND')"
              >
                系统防伪码 · 入库
              </button>
              <button
                type="button"
                :class="{ on: scanMode === 'DEALER_INBOUND' }"
                @click="switchScanMode('DEALER_INBOUND')"
              >
                代理商 · 扫码收货
              </button>
            </div>

            <div class="toolbar-fields">
              <el-select v-model="scanWarehouseId" class="toolbar-select" placeholder="入库仓库">
                <el-option
                  v-for="w in warehouses"
                  :key="w.id"
                  :label="`${w.name} · ${w.org.name}`"
                  :value="w.id"
                />
              </el-select>
              <el-select
                v-if="scanMode === 'HQ_INBOUND' || scanMode === 'REGISTER_INBOUND'"
                v-model="selectedPoId"
                clearable
                class="toolbar-select"
                placeholder="关联采购单（可选）"
              >
                <el-option
                  v-for="po in pendingPos"
                  :key="po.id"
                  :label="`${po.docNo} · ${po.supplier.name}`"
                  :value="po.id"
                />
              </el-select>
            </div>
          </div>

          <!-- 扫码建档入库专用商品与批次配置 -->
          <div v-if="scanMode === 'REGISTER_INBOUND'" class="register-bar">
            <div class="rb-field">
              <span class="rb-label">建档商品</span>
              <el-select v-model="registerProductId" class="rb-select" placeholder="选择对应商品">
                <el-option
                  v-for="p in products"
                  :key="p.id"
                  :label="`${p.name}（${p.skuCode} · ${p.spec || '标准'}）`"
                  :value="p.id"
                />
              </el-select>
            </div>
            <div class="rb-field">
              <span class="rb-label">生产批次</span>
              <el-input
                v-model="registerBatchNo"
                class="rb-input"
                clearable
                placeholder="留空按当日自动生成"
              />
            </div>
            <div class="rb-field">
              <span class="rb-label">码级别</span>
              <el-select v-model="registerCodeLevel" class="rb-select-sm">
                <el-option label="单品盒码" value="UNIT" />
                <el-option label="外箱码" value="CARTON" />
              </el-select>
            </div>
          </div>

          <!-- 扫描台 -->
          <div class="stage">
            <div class="stage-head">
              <span class="stage-title">{{ scanMode === 'REGISTER_INBOUND' ? '入库建档扫码口' : '扫码口' }}</span>
              <div class="stage-head-right">
                <span class="stage-sub">USB 扫码枪免点击盲扫 · 或手工输入防伪码回车录入</span>
              </div>
            </div>
            <input
              ref="scanRef"
              v-model="scanInput"
              class="stage-input mono"
              :placeholder="
                scanMode === 'REGISTER_INBOUND'
                  ? '扫描产品包装条码 / 二维码（新码直接建档入库）'
                  : '扫描外箱码 / 单品盒码'
              "
              autocomplete="off"
              spellcheck="false"
              @keyup.enter="handleManualScan"
            />
            <div class="stage-foot">
              <span class="kbd-hint"><kbd>Enter</kbd> 校验加入</span>
              <span class="kbd-hint"><kbd>F2</kbd> 清空本次</span>
              <span class="kbd-hint"><kbd>F4</kbd> {{ scanMode === 'REGISTER_INBOUND' ? '确认建档入库' : '确认入库' }}</span>
              <span class="stage-mode">
                {{
                  scanMode === 'REGISTER_INBOUND'
                    ? '扫描任意新产品码，自动建档并入库留痕'
                    : scanMode === 'HQ_INBOUND'
                      ? '整箱按箱规自动展开'
                      : '仅可收本代理商待收货码'
                }}
              </span>
            </div>
          </div>

          <!-- 最近一次扫描 -->
          <div class="last-scan" :class="lastScan?.ok === false ? 'fail' : lastScan ? 'ok' : 'idle'">
            <template v-if="lastScan">
              <div class="ls-mark">{{ lastScan.ok ? '✓' : '✕' }}</div>
              <div class="ls-body">
                <div class="ls-title">{{ lastScan.ok ? lastScan.productName : lastScan.message }}</div>
                <div class="ls-meta">
                  <template v-if="lastScan.ok">
                    <span v-if="lastScan.token" class="mono">{{ lastScan.token }}</span>
                    <span v-if="lastScan.batchNo">批次 {{ lastScan.batchNo }}</span>
                    <span v-if="lastScan.codeLevel">{{ lastScan.codeLevel === 'CARTON' ? '外箱' : '单盒' }}</span>
                    <span class="ls-qty">+{{ lastScan.unitCount }} 盒</span>
                  </template>
                  <template v-else>该码未加入本次入库，请核对仓库与码状态</template>
                </div>
              </div>
              <el-button
                v-if="lastRegisteredBatch && lastScan.plain"
                size="small"
                type="primary"
                plain
                @click="qrPrintDialog = true"
              >
                打印本批二维码（A4）
              </el-button>
              <div class="ls-time mono">{{ lastScan.time }}</div>
            </template>
            <template v-else>
              <div class="ls-mark idle">·</div>
              <div class="ls-body">
                <div class="ls-title idle">等待第一次扫描</div>
                <div class="ls-meta">扫到的货会在这里显示商品、批次与盒数，库管看这一块就够了。</div>
              </div>
            </template>
          </div>

          <!-- 已扫明细 -->
          <div class="desk-list">
            <div class="list-head">
              <span>本次入库明细</span>
              <span class="list-count">{{ scannedItems.length }} 次扫码 · {{ totalScanUnits }} 盒</span>
            </div>

            <el-table :data="scannedItems" size="small" empty-text="还没有扫描记录">
              <el-table-column prop="token" label="防伪码" width="190">
                <template #default="{ row }"><span class="code-chip">{{ row.token }}</span></template>
              </el-table-column>
              <el-table-column label="级别" width="80">
                <template #default="{ row }">
                  <span class="level-tag" :class="row.codeLevel === 'CARTON' ? 'carton' : 'unit'">
                    {{ row.codeLevel === 'CARTON' ? '外箱' : '单盒' }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="productName" label="商品" min-width="180" />
              <el-table-column prop="batchNo" label="批次" width="150">
                <template #default="{ row }"><span class="mono muted">{{ row.batchNo }}</span></template>
              </el-table-column>
              <el-table-column label="盒数" width="80" align="right">
                <template #default="{ row }"><strong class="mono">{{ row.unitCount }}</strong></template>
              </el-table-column>
              <el-table-column label="" width="64" align="right">
                <template #default="{ $index }">
                  <el-button link type="danger" size="small" @click="scannedItems.splice($index, 1)">移除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="desk-foot">
            <div class="foot-total">
              <span class="ft-label">合计</span>
              <span class="ft-value num">{{ totalScanUnits }}</span>
              <span class="ft-unit">盒</span>
              <span class="ft-sep">/</span>
              <span class="ft-note">{{ scannedItems.length }} 次扫码</span>
            </div>
            <div class="foot-actions">
              <el-button :disabled="!scannedItems.length" @click="scannedItems = []">清空列表</el-button>
              <el-button
                type="primary"
                :disabled="!scannedItems.length"
                :loading="submittingScan"
                @click="submitInbound"
              >
                {{ scanMode === 'REGISTER_INBOUND' ? '确认建档并入库' : '确认入库' }}
              </el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="采购单据" name="list">
        <div class="surface-card flush">
          <el-table :data="purchaseOrders" size="small" empty-text="暂无采购单">
            <el-table-column prop="docNo" label="采购单号" width="138">
              <template #default="{ row }"><span class="mono">{{ row.docNo }}</span></template>
            </el-table-column>
            <el-table-column label="业务日期" width="96">
              <template #default="{ row }"><span class="muted">{{ row.bizDate?.slice(0, 10) }}</span></template>
            </el-table-column>
            <el-table-column label="供应商" min-width="136" show-overflow-tooltip>
              <template #default="{ row }">{{ row.supplier?.name }}</template>
            </el-table-column>
            <el-table-column label="入库仓库" width="124" show-overflow-tooltip>
              <template #default="{ row }">{{ row.warehouse?.name }}</template>
            </el-table-column>
            <el-table-column label="商品明细" min-width="176" show-overflow-tooltip>
              <template #default="{ row }">
                <div v-for="it in row.items" :key="it.id" class="po-line">
                  {{ it.product.name }} × {{ it.qty }}
                  <span class="muted">（已入 {{ it.inboundQty }}）</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="金额" width="98" align="right">
              <template #default="{ row }"><span class="mono">¥{{ Number(row.totalAmount).toFixed(2) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="82">
              <template #default="{ row }">
                <span class="state-dot" :class="row.status === 'COMPLETED' ? 'done' : 'open'">
                  {{ row.status === 'COMPLETED' ? '已入库' : '待入库' }}
                </span>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="poTotal"
              :page-size="poPageSize"
              :current-page="poPage"
              @current-change="(p: number) => loadPurchaseOrders(p)"
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="poDialog" title="新增采购单" width="min(680px, 94vw)" align-center>
      <el-form :model="poForm" :label-width="isMobile ? 'auto' : '95px'" :label-position="isMobile ? 'top' : 'right'">
        <div class="po-grid-2">
          <el-form-item label="供应商" required>
            <el-select v-model="poForm.supplierId" style="width: 100%">
              <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="入库仓库" required>
            <el-select v-model="poForm.warehouseId" style="width: 100%">
              <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="采购明细" required>
          <div style="width: 100%; display: flex; flex-direction: column; gap: 8px">
            <div v-for="(it, idx) in poForm.items" :key="idx" class="po-item-row">
              <el-select v-model="it.productId" placeholder="商品" @change="onSelectPoProduct(it)">
                <el-option v-for="p in products" :key="p.id" :label="`${p.name} (${p.skuCode})`" :value="p.id" />
              </el-select>
              <el-input-number v-model="it.qty" :min="1" placeholder="数量" style="width: 100%" controls-position="right" />
              <el-input-number v-model="it.unitPrice" :min="0" :precision="2" placeholder="进价" style="width: 100%" controls-position="right" />
              <el-button link type="danger" @click="poForm.items.splice(idx, 1)">删</el-button>
            </div>
            <el-button
              size="small"
              plain
              style="width: 120px"
              @click="poForm.items.push({ productId: '', qty: 12, unitPrice: 150 })"
            >
              + 添加商品
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="单据备注">
          <el-input v-model="poForm.remark" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="poDialog = false">取消</el-button>
        <el-button type="primary" @click="createPo">保存采购单</el-button>
      </template>
    </el-dialog>

    <QrLabelPrintModal
      v-model="qrPrintDialog"
      :batch-no="lastRegisteredBatch?.batchNo"
      :product-name="lastRegisteredBatch?.productName"
      :sku-code="lastRegisteredBatch?.skuCode"
      :codes="lastRegisteredBatch?.codes || []"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { useViewport } from '../utils/format';
import { playScanBeep, speakWarehouseVoice, useBarcodeScanner } from '../composables/useBarcodeScanner';
import QrLabelPrintModal from '../components/QrLabelPrintModal.vue';

const auth = useAuthStore();
const { width } = useViewport();
const isMobile = computed(() => width.value <= 720);
const activeTab = ref('scan');
const scanMode = ref<'REGISTER_INBOUND' | 'HQ_INBOUND' | 'DEALER_INBOUND'>(
  auth.isHQ ? 'REGISTER_INBOUND' : 'DEALER_INBOUND',
);
const scanWarehouseId = ref('');
const selectedPoId = ref('');
const registerProductId = ref('');
const registerBatchNo = ref('');
const registerCodeLevel = ref<'UNIT' | 'CARTON'>('UNIT');
const scanInput = ref('');
const scanRef = ref<HTMLInputElement | null>(null);
const scannedItems = ref<any[]>([]);
const submittingScan = ref(false);
const lastScan = ref<any>(null);
const qrPrintDialog = ref(false);
const lastRegisteredBatch = ref<any>(null);

const purchaseOrders = ref<any[]>([]);
const warehouses = ref<any[]>([]);
const suppliers = ref<any[]>([]);
const products = ref<any[]>([]);

const poDialog = ref(false);
const poForm = ref({
  supplierId: '',
  warehouseId: '',
  remark: '',
  items: [{ productId: '', qty: 12, unitPrice: 165 }],
});

const pendingPos = computed(() => purchaseOrders.value.filter((p) => p.status !== 'COMPLETED'));
const totalScanUnits = computed(() => scannedItems.value.reduce((s, i) => s + i.unitCount, 0));

const activePo = computed(() => purchaseOrders.value.find((p) => p.id === selectedPoId.value));

function stamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

const poPage = ref(1);
const poPageSize = 20;
const poTotal = ref(0);

async function loadPurchaseOrders(page = poPage.value) {
  poPage.value = page;
  const res = (await api.get('/purchase-orders', { params: { page, pageSize: poPageSize } })) as any;
  purchaseOrders.value = Array.isArray(res) ? res : res.items || [];
  poTotal.value = Array.isArray(res) ? res.length : Number(res.total || 0);
}

async function loadData() {
  const [, whs, sups, prods] = await Promise.all([
    loadPurchaseOrders(poPage.value),
    api.get('/warehouses'),
    api.get('/suppliers'),
    api.get('/products'),
  ]);
  warehouses.value = whs as unknown as any[];
  suppliers.value = sups as unknown as any[];
  products.value = prods as unknown as any[];

  if (warehouses.value.length && !scanWarehouseId.value) {
    scanWarehouseId.value = warehouses.value[0].id;
    poForm.value.warehouseId = warehouses.value[0].id;
  }
  if (products.value.length && !registerProductId.value) {
    registerProductId.value = products.value[0].id;
  }
  if (suppliers.value.length && !poForm.value.supplierId) {
    poForm.value.supplierId = suppliers.value[0].id;
  }
}

function switchScanMode(mode: 'REGISTER_INBOUND' | 'HQ_INBOUND' | 'DEALER_INBOUND') {
  if (scanMode.value === mode) return;
  scanMode.value = mode;
  scannedItems.value = [];
  lastScan.value = null;
  setTimeout(() => scanRef.value?.focus(), 40);
}

onMounted(() => {
  loadData();
  window.addEventListener('keydown', hotkeys);
  setTimeout(() => scanRef.value?.focus(), 120);
});

onUnmounted(() => window.removeEventListener('keydown', hotkeys));

function hotkeys(e: KeyboardEvent) {
  if (activeTab.value !== 'scan') return;
  if (e.key === 'F2') {
    e.preventDefault();
    scannedItems.value = [];
    scanRef.value?.focus();
  }
  if (e.key === 'F4') {
    e.preventDefault();
    if (scannedItems.value.length) submitInbound();
  }
}

const inFlightTokens = new Set<string>();

function normalizeScanClient(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/\/v\/([0-9A-Za-z]{16})(?:[/?#]|$)/i);
  if (m) return m[1].toUpperCase();
  return s.replace(/\s+/g, '').toUpperCase();
}

function findDuplicateReason(
  list: any[],
  token: string,
  parentToken?: string | null,
  childTokens?: string[],
): string | null {
  if (list.some((i) => i.token === token)) {
    return `产品码 ${token} 已在待入库列表中，已自动去重`;
  }
  if (parentToken && list.some((i) => i.token === parentToken)) {
    return `产品码 ${token} 所属外箱 ${parentToken} 已在待入库列表中，无需重复扫描`;
  }
  if (list.some((i) => Array.isArray(i.childTokens) && i.childTokens.includes(token))) {
    return `产品码 ${token} 所属外箱已在待入库列表中，无需重复扫描`;
  }
  if (Array.isArray(childTokens) && childTokens.length) {
    const hit = childTokens.find((ct) => list.some((i) => i.token === ct));
    if (hit) {
      return `外箱 ${token} 内的单品码 ${hit} 已在列表中，请勿箱盒混扫重复`;
    }
  }
  return null;
}

async function processCode(raw: string) {
  const norm = normalizeScanClient(raw);
  if (!norm || !scanWarehouseId.value) return;
  if (scanMode.value === 'REGISTER_INBOUND' && !registerProductId.value) {
    ElMessage.warning('请先选择建档对应的商品');
    return;
  }
  const preDup = findDuplicateReason(scannedItems.value, norm);
  if (preDup) {
    playScanBeep('error');
    lastScan.value = { ok: false, message: preDup, time: stamp() };
    ElMessage.warning(preDup);
    return;
  }
  if (inFlightTokens.has(norm)) return;
  inFlightTokens.add(norm);
  try {
    const res = (await api.post('/stock/scan-validate', {
      rawInput: raw.trim(),
      mode: scanMode.value,
      warehouseId: scanWarehouseId.value,
      ...(scanMode.value === 'REGISTER_INBOUND'
        ? {
            productId: registerProductId.value,
            codeLevel: registerCodeLevel.value,
            batchNo: registerBatchNo.value || undefined,
          }
        : {}),
    })) as any;

    if (!res.ok) {
      playScanBeep('error');
      speakWarehouseVoice(res.message);
      lastScan.value = { ok: false, message: res.message, time: stamp() };
      ElMessage.error(res.message);
      return;
    }
    const postDup = findDuplicateReason(scannedItems.value, res.token, res.parentToken, res.childTokens);
    if (postDup) {
      playScanBeep('error');
      lastScan.value = { ok: false, message: postDup, time: stamp() };
      ElMessage.warning(postDup);
      return;
    }
    scannedItems.value.unshift(res);
    playScanBeep('success');
    lastScan.value = { ...res, ok: true, time: stamp() };
    scanRef.value?.focus();
  } finally {
    inFlightTokens.delete(norm);
  }
}

async function handleManualScan() {
  await processCode(scanInput.value);
  scanInput.value = '';
}

useBarcodeScanner((code) => {
  if (activeTab.value === 'scan') processCode(code);
});

async function submitInbound() {
  submittingScan.value = true;
  try {
    let res: any;
    if (scanMode.value === 'REGISTER_INBOUND') {
      res = await api.post('/stock/inbound-register', {
        warehouseId: scanWarehouseId.value,
        productId: registerProductId.value,
        batchNo: registerBatchNo.value || undefined,
        codeLevel: registerCodeLevel.value,
        purchaseOrderId: selectedPoId.value || undefined,
        codeInputs: scannedItems.value.map((i) => i.token),
      });
      playScanBeep('notify');
      lastRegisteredBatch.value = {
        batchNo: res.batchNo,
        productName: res.productName || products.value.find((p) => p.id === registerProductId.value)?.name || '',
        skuCode: res.skuCode || '',
        codes: (res.registeredCodes || []).map((t: string) => ({
          codeToken: t,
          codeLevel: res.codeLevel || registerCodeLevel.value,
        })),
      };
      ElMessage.success(
        `扫码建档入库完成：${res.inboundUnitsCount} 件，批次 ${res.batchNo}，单号 ${res.stockDoc.docNo}`,
      );
    } else {
      lastRegisteredBatch.value = null;
      res = await api.post('/stock/inbound', {
        mode: scanMode.value,
        warehouseId: scanWarehouseId.value,
        purchaseOrderId: selectedPoId.value || undefined,
        codeInputs: scannedItems.value.map((i) => i.token),
      });
      playScanBeep('notify');
      ElMessage.success(`扫码入库完成：${res.inboundUnitsCount} 盒，单号 ${res.stockDoc.docNo}`);
    }
    lastScan.value = {
      ok: true,
      productName:
        scanMode.value === 'REGISTER_INBOUND'
          ? `建档入库完成 · ${res.inboundUnitsCount} 件（批次 ${res.batchNo}）`
          : `入库完成 · ${res.inboundUnitsCount} 盒`,
      batchNo: res.stockDoc.docNo,
      token: '',
      codeLevel: '',
      unitCount: res.inboundUnitsCount,
      time: stamp(),
      plain: true,
    };
    scannedItems.value = [];
    selectedPoId.value = '';
    await loadData();
    scanRef.value?.focus();
  } finally {
    submittingScan.value = false;
  }
}

function onSelectPoProduct(item: { productId: string; unitPrice: number }) {
  const p = products.value.find((x) => x.id === item.productId);
  if (p) item.unitPrice = Number(p.costPrice || p.defaultSupplyPrice);
}

async function createPo() {
  const validItems = poForm.value.items.filter((i) => i.productId && i.qty > 0);
  if (!validItems.length) return ElMessage.warning('请至少选择一款商品');
  await api.post('/purchase-orders', { ...poForm.value, items: validItems });
  ElMessage.success('采购单创建成功');
  poDialog.value = false;
  await loadData();
}
</script>

<style scoped>
.desk {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.desk-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
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
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12.5px;
  color: var(--ink-2);
  cursor: pointer;
  font-family: inherit;
  transition: background 0.14s ease, color 0.14s ease;
}
.segmented button.on {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(23, 33, 31, 0.06);
}

.toolbar-fields {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.toolbar-select {
  width: 220px;
}
.register-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  padding: 11px 18px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
}
.rb-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rb-label {
  font-size: 12px;
  color: var(--ink-2);
  white-space: nowrap;
}
.rb-select {
  width: 240px;
}
.rb-input {
  width: 185px;
}
.rb-select-sm {
  width: 112px;
}
.po-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.po-item-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr auto;
  gap: 8px;
  align-items: center;
}

/* 扫描台 */
.stage {
  background: #111827;
  padding: 22px 24px 18px;
  position: relative;
}
.stage::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: none;
  pointer-events: none;
}
.stage-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  position: relative;
  z-index: 1;
}
.stage-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #d1d5db;
}
.stage-sub {
  font-size: 11.5px;
  color: #94a3b8;
}

.stage-input {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 56px;
  border: 1px solid #334155;
  background: rgba(15, 23, 42, 0.72);
  border-radius: 10px;
  padding: 0 18px;
  font-size: 17px;
  letter-spacing: 0.08em;
  color: #f8fafc;
  outline: none;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}
.stage-input::placeholder {
  color: #64748b;
  font-size: 15px;
  letter-spacing: 0.02em;
}
.stage-input:focus {
  border-color: #9ca3af;
  background: rgba(15, 23, 42, 0.94);
  box-shadow: none;
}

.stage-foot {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
  font-size: 11px;
  color: #94a3b8;
  flex-wrap: wrap;
}
.kbd-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px;
  padding: 1px 5px;
  color: #cbd5e1;
}
.stage-mode {
  margin-left: auto;
  color: #94a3b8;
}

/* 最近扫描 */
.last-scan {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
  min-height: 72px;
  transition: background 0.2s ease;
}
.last-scan.ok {
  background: var(--jade-tint);
}
.last-scan.fail {
  background: var(--seal-tint);
}
.last-scan.idle {
  background: var(--surface-2);
}
.ls-mark {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}
.last-scan.ok .ls-mark {
  background: var(--jade);
  color: #fff;
}
.last-scan.fail .ls-mark {
  background: var(--seal);
  color: #fff;
}
.last-scan.idle .ls-mark {
  background: var(--surface-3);
  color: var(--ink-3);
}
.ls-body {
  flex: 1;
  min-width: 0;
}
.ls-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: -0.01em;
}
.ls-title.idle {
  color: var(--ink-2);
  font-weight: 500;
  font-size: 13px;
}
.ls-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11.5px;
  color: var(--ink-2);
  margin-top: 4px;
  flex-wrap: wrap;
}
.ls-qty {
  font-family: var(--font-num);
  font-size: 15px;
  font-weight: 600;
  color: var(--jade);
}
.ls-time {
  font-size: 11px;
  color: var(--ink-3);
  flex-shrink: 0;
}

/* 明细 */
.desk-list {
  padding: 4px 20px 8px;
}
.list-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 12px 0 8px;
  font-size: 12.5px;
  color: var(--ink-2);
  font-weight: 500;
}
.list-count {
  font-size: 11.5px;
  color: var(--ink-3);
  font-weight: 400;
}

.level-tag {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--line);
  color: var(--ink-2);
  background: var(--surface-2);
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

.desk-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
  background: var(--surface-2);
  flex-wrap: wrap;
}
.foot-total {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ft-label {
  font-size: 12px;
  color: var(--ink-2);
}
.ft-value {
  font-size: 26px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1;
}
.ft-unit {
  font-size: 12px;
  color: var(--ink-3);
}
.ft-sep {
  color: var(--line-strong);
  margin: 0 2px;
}
.ft-note {
  font-size: 11.5px;
  color: var(--ink-3);
}
.foot-actions {
  display: flex;
  gap: 8px;
}

.po-line {
  font-size: 12px;
  line-height: 1.6;
}

.state-dot {
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.state-dot::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.state-dot.done {
  color: var(--jade);
}
.state-dot.open {
  color: var(--ochre);
}

.plain-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}

@media (max-width: 720px) {
  .desk-toolbar {
    padding: 12px 14px;
    gap: 10px;
  }
  .toolbar-fields,
  .toolbar-select,
  .rb-field,
  .rb-select,
  .rb-input,
  .rb-select-sm {
    width: 100%;
  }
  .register-bar {
    padding: 10px 14px;
  }
  .rb-field {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  .stage {
    padding: 16px 14px 14px;
  }
  .stage-input {
    font-size: 15px;
    height: 48px;
  }
  .desk-list {
    padding: 4px 14px 8px;
  }
  .desk-foot {
    flex-direction: column;
    align-items: stretch;
    padding: 12px 14px;
  }
  .foot-actions {
    justify-content: flex-end;
  }
  .po-grid-2 {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .po-item-row {
    grid-template-columns: 1fr 1fr;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
}
</style>
