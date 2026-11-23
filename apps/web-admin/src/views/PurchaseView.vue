<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">采购单与扫码入库工作台</h1>
        <p class="page-subtitle">支持工厂赋码总仓整箱扫码入库，以及服务商收货确认扫码录入独立仓（支持 USB 扫码枪盲扫）</p>
      </div>
      <div style="display: flex; gap: 10px">
        <el-button v-if="auth.isHQ" @click="poDialog = true">+ 新增采购单</el-button>
        <el-button type="primary" @click="activeTab = 'scan'">进入扫码入库台</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="surface-card">
      <el-tab-pane label="扫码入库作业台（总仓 / 服务商收货）" name="scan">
        <div class="scan-controls">
          <el-radio-group v-model="scanMode">
            <el-radio-button v-if="auth.isHQ" value="HQ_INBOUND">总仓工厂货扫码入库</el-radio-button>
            <el-radio-button value="DEALER_INBOUND">服务商独立仓扫码收货</el-radio-button>
          </el-radio-group>

          <el-select v-model="scanWarehouseId" style="width: 240px" placeholder="选择入库仓库">
            <el-option v-for="w in warehouses" :key="w.id" :label="`${w.name} (${w.org.name})`" :value="w.id" />
          </el-select>

          <el-select
            v-if="scanMode === 'HQ_INBOUND'"
            v-model="selectedPoId"
            clearable
            style="width: 240px"
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

        <div class="scan-input-bar">
          <el-input
            v-model="scanInput"
            size="large"
            placeholder="请用 USB 扫码枪扫外箱码或单品盒码（或粘贴 Token 回车），扫 1 次外箱码自动整箱展开入库"
            @keyup.enter="handleManualScan"
          />
          <el-button type="primary" size="large" @click="handleManualScan">校验加入</el-button>
        </div>

        <el-table :data="scannedItems" size="small" empty-text="尚未扫描防伪码（可直接扫码枪盲扫，无需点击输入框）">
          <el-table-column prop="token" label="已扫防伪码" width="180">
            <template #default="{ row }"><span class="code-chip">{{ row.token }}</span></template>
          </el-table-column>
          <el-table-column label="码级别" width="95">
            <template #default="{ row }">
              <el-tag size="small" :type="row.codeLevel === 'CARTON' ? 'warning' : 'success'">
                {{ row.codeLevel === 'CARTON' ? '整箱' : '单盒' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="productName" label="商品名称" />
          <el-table-column prop="batchNo" label="批次号" width="150" />
          <el-table-column label="入库盒数" width="100" align="right">
            <template #default="{ row }"><strong class="mono">{{ row.unitCount }}</strong></template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ $index }">
              <el-button link type="danger" size="small" @click="scannedItems.splice($index, 1)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px">
          <div style="font-size: 13.5px">
            本次待入库合计：<strong class="mono" style="color: var(--brand-primary); font-size: 18px">{{ totalScanUnits }}</strong> 盒
            （{{ scannedItems.length }} 次扫码）
          </div>
          <div style="display: flex; gap: 10px">
            <el-button @click="scannedItems = []">清空列表</el-button>
            <el-button
              type="primary"
              :disabled="scannedItems.length === 0"
              :loading="submittingScan"
              @click="submitInbound"
            >
              确认扫码入库
            </el-button>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="采购单据列表" name="list">
        <el-table :data="purchaseOrders" size="small">
          <el-table-column prop="docNo" label="采购单号" width="150">
            <template #default="{ row }"><span class="mono">{{ row.docNo }}</span></template>
          </el-table-column>
          <el-table-column label="业务日期" width="110">
            <template #default="{ row }"><span class="mono">{{ row.bizDate?.slice(0, 10) }}</span></template>
          </el-table-column>
          <el-table-column label="供应商">
            <template #default="{ row }">{{ row.supplier?.name }}</template>
          </el-table-column>
          <el-table-column label="入库仓库" width="150">
            <template #default="{ row }">{{ row.warehouse?.name }}</template>
          </el-table-column>
          <el-table-column label="商品明细" min-width="220">
            <template #default="{ row }">
              <div v-for="it in row.items" :key="it.id" style="font-size: 12px">
                {{ it.product.name }} × {{ it.qty }}（已入 {{ it.inboundQty }}）
              </div>
            </template>
          </el-table-column>
          <el-table-column label="金额" width="105" align="right">
            <template #default="{ row }"><span class="mono">¥{{ Number(row.totalAmount).toFixed(2) }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="105">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'COMPLETED' ? 'success' : 'warning'">
                {{ row.status === 'COMPLETED' ? '已入库' : '待扫码入库' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="poDialog" title="新增采购单" width="680px">
      <el-form :model="poForm" label-width="95px">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
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
            <div v-for="(it, idx) in poForm.items" :key="idx" style="display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 8px">
              <el-select v-model="it.productId" placeholder="商品" @change="onSelectPoProduct(it)">
                <el-option v-for="p in products" :key="p.id" :label="`${p.name} (${p.skuCode})`" :value="p.id" />
              </el-select>
              <el-input-number v-model="it.qty" :min="1" placeholder="数量" style="width: 100%" />
              <el-input-number v-model="it.unitPrice" :min="0" :precision="2" placeholder="进价" style="width: 100%" />
              <el-button link type="danger" @click="poForm.items.splice(idx, 1)">删</el-button>
            </div>
            <el-button size="small" plain style="width: 120px" @click="poForm.items.push({ productId: '', qty: 12, unitPrice: 150 })">
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { playScanBeep, speakWarehouseVoice, useBarcodeScanner } from '../composables/useBarcodeScanner';

const auth = useAuthStore();
const activeTab = ref('scan');
const scanMode = ref<'HQ_INBOUND' | 'DEALER_INBOUND'>(auth.isHQ ? 'HQ_INBOUND' : 'DEALER_INBOUND');
const scanWarehouseId = ref('');
const selectedPoId = ref('');
const scanInput = ref('');
const scannedItems = ref<any[]>([]);
const submittingScan = ref(false);

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

async function loadData() {
  const [pos, whs, sups, prods] = await Promise.all([
    api.get('/purchase-orders'),
    api.get('/warehouses'),
    api.get('/suppliers'),
    api.get('/products'),
  ]);
  purchaseOrders.value = pos as unknown as any[];
  warehouses.value = whs as unknown as any[];
  suppliers.value = sups as unknown as any[];
  products.value = prods as unknown as any[];

  if (warehouses.value.length && !scanWarehouseId.value) {
    scanWarehouseId.value = warehouses.value[0].id;
    poForm.value.warehouseId = warehouses.value[0].id;
  }
  if (suppliers.value.length && !poForm.value.supplierId) {
    poForm.value.supplierId = suppliers.value[0].id;
  }
}

onMounted(loadData);

async function processCode(raw: string) {
  if (!raw.trim() || !scanWarehouseId.value) return;
  const res = (await api.post('/stock/scan-validate', {
    rawInput: raw.trim(),
    mode: scanMode.value,
    warehouseId: scanWarehouseId.value,
  })) as any;

  if (!res.ok) {
    playScanBeep('error');
    speakWarehouseVoice(res.message);
    ElMessage.error(res.message);
    return;
  }
  if (scannedItems.value.some((i) => i.token === res.token)) {
    playScanBeep('error');
    ElMessage.warning(`防伪码 ${res.token} 已在待入库列表中`);
    return;
  }
  scannedItems.value.unshift(res);
  playScanBeep('success');
  ElMessage.success(`识别成功：${res.productName}（+${res.unitCount} 盒）`);
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
    const res = (await api.post('/stock/inbound', {
      mode: scanMode.value,
      warehouseId: scanWarehouseId.value,
      purchaseOrderId: selectedPoId.value || undefined,
      codeInputs: scannedItems.value.map((i) => i.token),
    })) as any;
    playScanBeep('notify');
    ElMessage.success(`扫码入库完成！共入库 ${res.inboundUnitsCount} 盒，单号 ${res.stockDoc.docNo}`);
    scannedItems.value = [];
    await loadData();
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
.scan-controls {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
</style>
