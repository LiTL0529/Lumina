<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">销售出库、3.5折红线管控与针式套打</h1>
        <p class="page-subtitle">自动拦截破 3.5 折（含赠品/抹零综合折率）开单、支持扫码出库自动拆箱与退货原码回仓</p>
      </div>
      <div style="display: flex; gap: 10px">
        <el-button @click="returnDialog = true">销售退货扫码回仓</el-button>
        <el-button type="primary" @click="openCreateOrder">+ 新建销售 / 供货单</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="surface-card">
      <el-tab-pane label="销售 / 代理供货单据" name="orders">
        <el-table :data="salesOrders" size="small">
          <el-table-column prop="docNo" label="单号" width="145">
            <template #default="{ row }"><span class="mono">{{ row.docNo }}</span></template>
          </el-table-column>
          <el-table-column label="业务类型" width="115">
            <template #default="{ row }">
              <el-tag size="small" :type="row.orderScene === 'HQ_TO_DEALER' ? 'primary' : 'success'">
                {{ row.orderScene === 'HQ_TO_DEALER' ? '总仓→服务商' : '服务商→机构' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="客户 / 服务商" min-width="160">
            <template #default="{ row }">
              <strong>{{ row.buyerOrg?.name || row.clinic?.name }}</strong>
              <div style="font-size: 11px; color: var(--text-muted)">仓：{{ row.warehouse?.name }}</div>
            </template>
          </el-table-column>
          <el-table-column label="商品与出库进度" min-width="200">
            <template #default="{ row }">
              <div v-for="it in row.items" :key="it.id" style="font-size: 12px">
                {{ it.product.name }}
                <el-tag v-if="it.isGift" size="small" type="info">赠</el-tag>
                × {{ it.qty }}（已扫 <strong class="mono">{{ it.outboundQty }}</strong>）
              </div>
            </template>
          </el-table-column>
          <el-table-column label="综合折率" width="95" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="Number(row.compositeDiscountRatio) < 0.35 ? 'danger' : 'success'">
                {{ (Number(row.compositeDiscountRatio) * 10).toFixed(2) }} 折
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="应收金额" width="105" align="right">
            <template #default="{ row }"><span class="mono">¥{{ Number(row.totalAmount).toFixed(2) }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag size="small" :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="row.status === 'PENDING_OUTBOUND' || row.status === 'PARTIAL_OUTBOUND'"
                size="small"
                type="primary"
                @click="openOutboundScan(row)"
              >
                扫码出库
              </el-button>
              <el-button
                v-if="auth.isHQ && row.status === 'PENDING_APPROVAL'"
                size="small"
                type="warning"
                @click="approveOrder(row, true)"
              >
                特批放行
              </el-button>
              <el-button size="small" plain @click="openPrint(row.id)">
                针式打单{{ row.printCount ? `(${row.printCount})` : '' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="销售退货回仓记录" name="returns">
        <el-table :data="returnOrders" size="small" empty-text="暂无退货记录">
          <el-table-column prop="docNo" label="退货单号" width="150">
            <template #default="{ row }"><span class="mono">{{ row.docNo }}</span></template>
          </el-table-column>
          <el-table-column label="退回仓库" width="160">
            <template #default="{ row }">{{ row.warehouse?.name }}</template>
          </el-table-column>
          <el-table-column label="退货机构" width="160">
            <template #default="{ row }">{{ row.clinic?.name || '-' }}</template>
          </el-table-column>
          <el-table-column label="退回防伪码明细" min-width="260">
            <template #default="{ row }">
              <div v-for="it in row.items" :key="it.id" style="font-size: 12px">
                {{ it.product.name }} × {{ it.qty }}：
                <span class="mono">{{ (it.returnedCodes || []).join(', ') }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="退款金额" width="110" align="right">
            <template #default="{ row }"><span class="mono">¥{{ Number(row.totalRefundAmount).toFixed(2) }}</span></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- Create Sales Order Modal with Live 3.5折 Redline Check -->
    <el-dialog v-model="createDialog" title="新建销售 / 供货单（实时 3.5 折红线校验）" width="880px" top="4vh">
      <el-form :model="orderForm" label-width="95px">
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px">
          <el-form-item label="业务场景" required>
            <el-select v-model="orderForm.orderScene" style="width: 100%">
              <el-option v-if="auth.isHQ" label="总仓 → 服务商供货" value="HQ_TO_DEALER" />
              <el-option label="服务商 → 终端机构" value="DEALER_TO_CLINIC" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="orderForm.orderScene === 'HQ_TO_DEALER'" label="目标服务商" required>
            <el-select v-model="orderForm.buyerOrgId" style="width: 100%" placeholder="选择服务商">
              <el-option
                v-for="d in dealers"
                :key="d.id"
                :label="`${d.name}${d.supplyFrozen ? ' [已停供]' : ''}`"
                :value="d.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-else label="终端机构" required>
            <el-select v-model="orderForm.clinicId" style="width: 100%" placeholder="选择已绑定机构">
              <el-option v-for="c in clinics" :key="c.id" :label="`${c.name} (${c.city})`" :value="c.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="出库仓库" required>
            <el-select v-model="orderForm.warehouseId" style="width: 100%">
              <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
            </el-select>
          </el-form-item>
        </div>

        <el-table :data="orderForm.items" size="small" border style="margin-bottom: 10px">
          <el-table-column label="商品" min-width="210">
            <template #default="{ row }">
              <el-select v-model="row.productId" style="width: 100%" @change="onPickProduct(row)">
                <el-option
                  v-for="p in products"
                  :key="p.id"
                  :label="`${p.name} (指导¥${p.retailPrice})`"
                  :value="p.id"
                />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="数量" width="105">
            <template #default="{ row }">
              <el-input-number v-model="row.qty" :min="1" size="small" style="width: 100%" @change="runRedlinePreview" />
            </template>
          </el-table-column>
          <el-table-column label="单价(元)" width="115">
            <template #default="{ row }">
              <el-input-number v-model="row.unitPrice" :min="0" :precision="2" size="small" style="width: 100%" @change="runRedlinePreview" />
            </template>
          </el-table-column>
          <el-table-column label="折扣(%)" width="105">
            <template #default="{ row }">
              <el-input-number v-model="row.discountPercent" :min="0" :max="100" size="small" :disabled="row.isGift" style="width: 100%" @change="runRedlinePreview" />
            </template>
          </el-table-column>
          <el-table-column label="赠品" width="66" align="center">
            <template #default="{ row }">
              <el-checkbox v-model="row.isGift" @change="runRedlinePreview" />
            </template>
          </el-table-column>
          <el-table-column label="小计" width="95" align="right">
            <template #default="{ row }">
              <span class="mono">¥{{ row.isGift ? '0.00' : ((row.qty * row.unitPrice * row.discountPercent) / 100).toFixed(2) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="" width="55" align="center">
            <template #default="{ $index }">
              <el-button link type="danger" @click="removeOrderLine($index)">删</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-button size="small" plain @click="addOrderLine">+ 添加商品行（支持勾选赠品测试红线防绕过）</el-button>

        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 14px">
          <el-form-item label="抹零金额">
            <el-input-number v-model="orderForm.roundingAmount" :min="0" :precision="2" style="width: 100%" @change="runRedlinePreview" />
          </el-form-item>
          <el-form-item label="运费/其他">
            <el-input-number v-model="orderForm.otherFee" :min="0" :precision="2" style="width: 100%" />
          </el-form-item>
          <el-form-item label="本单实收">
            <el-input-number v-model="orderForm.paidAmount" :min="0" :precision="2" style="width: 100%" />
          </el-form-item>
          <el-form-item label="发货方式">
            <el-input v-model="orderForm.shippingMethod" />
          </el-form-item>
        </div>

        <div v-if="redlinePreview" class="redline-banner" :class="redlinePreview.passed ? 'pass' : 'fail'">
          <div>
            <strong>
              {{ redlinePreview.passed ? '3.5 折供货红线校验通过' : '触发 3.5 折供货红线阻断！' }}
            </strong>
            <span class="mono" style="margin-left: 10px">
              整单综合折率：{{ (redlinePreview.compositeRatio * 10).toFixed(2) }} 折
              （指导总额 ¥{{ redlinePreview.totalRetailValue }} / 实收折算 ¥{{ redlinePreview.totalNetReceivable }}）
            </span>
            <div v-for="(v, idx) in redlinePreview.violations" :key="idx" style="margin-top: 4px; font-size: 12px">
              • {{ v.message }}
            </div>
          </div>
          <el-checkbox v-if="!redlinePreview.passed" v-model="orderForm.requestSpecialApproval">
            发起总部破价特批
          </el-checkbox>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="createDialog = false">取消</el-button>
        <el-button @click="submitOrder(true)">存草稿</el-button>
        <el-button type="primary" :loading="savingOrder" @click="submitOrder(false)">
          {{ redlinePreview && !redlinePreview.passed && orderForm.requestSpecialApproval ? '提交总部破价特批' : '确认下单并推送仓库' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- Barcode Outbound Scanning Modal -->
    <el-dialog v-model="outboundDialog" :title="`扫码出库核验台 · 单号 ${activeOutboundOrder?.docNo || ''}`" width="760px">
      <div v-if="activeOutboundOrder" style="margin-bottom: 12px; font-size: 13px">
        目标客户：<strong>{{ activeOutboundOrder.buyerOrg?.name || activeOutboundOrder.clinic?.name }}</strong>
        · 出库仓：<strong>{{ activeOutboundOrder.warehouse?.name }}</strong>
        <div style="margin-top: 6px; display: flex; gap: 10px; flex-wrap: wrap">
          <el-tag v-for="it in activeOutboundOrder.items" :key="it.id" size="small" type="info">
            {{ it.product.name }}：待出 {{ it.qty - it.outboundQty }} 盒
          </el-tag>
        </div>
      </div>

      <div class="scan-input-bar">
        <el-input
          v-model="outScanInput"
          placeholder="扫描或输入箱码/单品盒码（若从整箱中单盒拆零出库，系统将自动拆箱并锁定防重复扫箱）"
          @keyup.enter="handleOutScan"
        />
        <el-button type="primary" @click="handleOutScan">校验加入</el-button>
      </div>

      <el-table :data="outScanned" size="small" empty-text="请扫描待出库商品的箱码或盒码">
        <el-table-column prop="token" label="已扫防伪码" width="180">
          <template #default="{ row }"><span class="code-chip">{{ row.token }}</span></template>
        </el-table-column>
        <el-table-column label="码级别" width="90">
          <template #default="{ row }">{{ row.codeLevel === 'CARTON' ? '外箱' : '单盒' }}</template>
        </el-table-column>
        <el-table-column prop="productName" label="商品" />
        <el-table-column prop="unitCount" label="出库盒数" width="90" align="right" />
        <el-table-column label="" width="65">
          <template #default="{ $index }">
            <el-button link type="danger" @click="outScanned.splice($index, 1)">删</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div style="margin-top: 12px">
        <el-input v-model="outTrackingNo" placeholder="物流快递单号（可选，打印联单时自动带出）" />
      </div>

      <template #footer>
        <el-button @click="outboundDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!outScanned.length" :loading="submittingOut" @click="confirmOutbound">
          确认扫码出库并记账
        </el-button>
      </template>
    </el-dialog>

    <!-- Return Order Modal -->
    <el-dialog v-model="returnDialog" title="销售退货扫码回仓（自动解除下游归属）" width="560px">
      <el-form :model="returnForm" label-width="95px">
        <el-form-item label="退回仓库" required>
          <el-select v-model="returnForm.warehouseId" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="原销售单号">
          <el-input v-model="returnForm.originalSalesNo" placeholder="可选，便于溯源备注" />
        </el-form-item>
        <el-form-item label="退回单品码" required>
          <el-input
            v-model="returnForm.codesText"
            type="textarea"
            :rows="4"
            placeholder="请扫码或输入退货的单品盒码，每行一个或用逗号分隔"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="returnDialog = false">取消</el-button>
        <el-button type="primary" @click="submitReturn">确认退货回仓</el-button>
      </template>
    </el-dialog>

    <PrintOrderModal
      v-model="printVisible"
      :order-id="printOrderId"
      @printed="loadAll"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import PrintOrderModal from '../components/PrintOrderModal.vue';
import { playScanBeep, speakWarehouseVoice, useBarcodeScanner } from '../composables/useBarcodeScanner';

const auth = useAuthStore();
const activeTab = ref('orders');
const salesOrders = ref<any[]>([]);
const returnOrders = ref<any[]>([]);
const dealers = ref<any[]>([]);
const clinics = ref<any[]>([]);
const warehouses = ref<any[]>([]);
const products = ref<any[]>([]);

const createDialog = ref(false);
const savingOrder = ref(false);
const redlinePreview = ref<any>(null);
const orderForm = ref({
  orderScene: auth.isHQ ? 'HQ_TO_DEALER' : 'DEALER_TO_CLINIC',
  buyerOrgId: '',
  clinicId: '',
  warehouseId: '',
  roundingAmount: 0,
  otherFee: 0,
  paidAmount: 0,
  shippingMethod: '顺丰物流',
  requestSpecialApproval: false,
  items: [{ productId: '', qty: 2, unitPrice: 880, discountPercent: 40, isGift: false }],
});

const outboundDialog = ref(false);
const activeOutboundOrder = ref<any>(null);
const outScanInput = ref('');
const outScanned = ref<any[]>([]);
const outTrackingNo = ref('');
const submittingOut = ref(false);

const returnDialog = ref(false);
const returnForm = ref({ warehouseId: '', originalSalesNo: '', codesText: '' });

const printVisible = ref(false);
const printOrderId = ref<string | null>(null);

async function loadAll() {
  const [so, ro, orgs, cls, whs, prods] = await Promise.all([
    api.get('/sales-orders'),
    api.get('/return-orders'),
    api.get('/orgs'),
    api.get('/clinics'),
    api.get('/warehouses'),
    api.get('/products'),
  ]);
  salesOrders.value = so as unknown as any[];
  returnOrders.value = ro as unknown as any[];
  dealers.value = (orgs as unknown as any[]).filter((o) => o.type === 'DEALER');
  clinics.value = cls as unknown as any[];
  warehouses.value = whs as unknown as any[];
  products.value = prods as unknown as any[];
  if (warehouses.value.length && !returnForm.value.warehouseId) {
    returnForm.value.warehouseId = warehouses.value[0].id;
  }
}

onMounted(loadAll);

function openCreateOrder() {
  orderForm.value.warehouseId = warehouses.value[0]?.id || '';
  orderForm.value.buyerOrgId = dealers.value[0]?.id || '';
  orderForm.value.clinicId = clinics.value.find((c) => c.bindStatus !== 'PUBLIC_POOL')?.id || clinics.value[0]?.id || '';
  if (products.value.length && !orderForm.value.items[0].productId) {
    orderForm.value.items[0].productId = products.value[0].id;
    orderForm.value.items[0].unitPrice = Number(products.value[0].retailPrice);
  }
  orderForm.value.requestSpecialApproval = false;
  createDialog.value = true;
  runRedlinePreview();
}

function onPickProduct(row: any) {
  const p = products.value.find((x) => x.id === row.productId);
  if (p) row.unitPrice = Number(p.retailPrice);
  runRedlinePreview();
}

function addOrderLine() {
  const p = products.value[0];
  orderForm.value.items.push({
    productId: p?.id || '',
    qty: 1,
    unitPrice: Number(p?.retailPrice || 698),
    discountPercent: 40,
    isGift: false,
  });
  runRedlinePreview();
}

function removeOrderLine(idx: number) {
  orderForm.value.items.splice(idx, 1);
  runRedlinePreview();
}

async function runRedlinePreview() {
  const valid = orderForm.value.items.filter((i) => i.productId && i.qty > 0);
  if (!valid.length) {
    redlinePreview.value = null;
    return;
  }
  try {
    redlinePreview.value = await api.post('/sales-orders/check-redline', {
      items: valid,
      roundingAmount: orderForm.value.roundingAmount,
    });
  } catch {
    // ignore
  }
}

async function submitOrder(asDraft: boolean) {
  savingOrder.value = true;
  try {
    await api.post('/sales-orders', { ...orderForm.value, asDraft });
    ElMessage.success(asDraft ? '已存为草稿' : '订单提交成功');
    createDialog.value = false;
    await loadAll();
  } catch (err: any) {
    if (err.response?.data?.code === 'REDLINE_VIOLATION') {
      ElMessage.error(err.response.data.message);
    }
  } finally {
    savingOrder.value = false;
  }
}

async function approveOrder(row: any, approve: boolean) {
  await api.post(`/sales-orders/${row.id}/special-approve`, { approve });
  ElMessage.success(approve ? '已特批放行，仓库可扫码出库' : '已驳回');
  await loadAll();
}

function openOutboundScan(row: any) {
  activeOutboundOrder.value = row;
  outScanned.value = [];
  outScanInput.value = '';
  outTrackingNo.value = row.trackingNo || '';
  outboundDialog.value = true;
}

async function processOutScan(raw: string) {
  if (!raw.trim() || !activeOutboundOrder.value) return;
  const mode =
    activeOutboundOrder.value.orderScene === 'HQ_TO_DEALER' ? 'HQ_OUTBOUND' : 'DEALER_OUTBOUND';
  const res = (await api.post('/stock/scan-validate', {
    rawInput: raw.trim(),
    mode,
    warehouseId: activeOutboundOrder.value.warehouseId,
  })) as any;

  if (!res.ok) {
    playScanBeep('error');
    speakWarehouseVoice(res.message);
    ElMessage.error(res.message);
    return;
  }
  if (outScanned.value.some((x) => x.token === res.token)) {
    playScanBeep('error');
    ElMessage.warning('请勿重复扫描同一个码');
    return;
  }
  outScanned.value.unshift(res);
  playScanBeep('success');
}

async function handleOutScan() {
  await processOutScan(outScanInput.value);
  outScanInput.value = '';
}

useBarcodeScanner((code) => {
  if (outboundDialog.value) processOutScan(code);
});

async function confirmOutbound() {
  submittingOut.value = true;
  try {
    const res = (await api.post('/stock/outbound', {
      salesOrderId: activeOutboundOrder.value.id,
      codeInputs: outScanned.value.map((x) => x.token),
      trackingNo: outTrackingNo.value || undefined,
    })) as any;
    playScanBeep('notify');
    ElMessage.success(
      `出库成功！共扫描出库 ${res.outboundUnitsCount} 盒${res.autoUnpackedCartonsCount ? `（自动拆箱 ${res.autoUnpackedCartonsCount} 箱）` : ''}`,
    );
    const idForPrint = activeOutboundOrder.value.id;
    outboundDialog.value = false;
    await loadAll();
    openPrint(idForPrint);
  } finally {
    submittingOut.value = false;
  }
}

function openPrint(orderId: string) {
  printOrderId.value = orderId;
  printVisible.value = true;
}

async function submitReturn() {
  const tokens = returnForm.value.codesText
    .split(/[\s,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!tokens.length) return ElMessage.warning('请输入至少 1 个退货单品码');
  await api.post('/return-orders', {
    warehouseId: returnForm.value.warehouseId,
    originalSalesNo: returnForm.value.originalSalesNo || undefined,
    codeInputs: tokens,
  });
  ElMessage.success(`退货回仓完成，${tokens.length} 盒溯源码已恢复在库状态`);
  returnDialog.value = false;
  returnForm.value.codesText = '';
  await loadAll();
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    DRAFT: '草稿',
    PENDING_APPROVAL: '红线待特批',
    PENDING_OUTBOUND: '待扫码出库',
    PARTIAL_OUTBOUND: '部分出库',
    COMPLETED: '已出库完成',
    CANCELLED: '已撤销',
  };
  return m[s] || s;
}

function statusTagType(s: string): any {
  if (s === 'COMPLETED') return 'success';
  if (s === 'PENDING_APPROVAL') return 'danger';
  if (s === 'CANCELLED') return 'info';
  return 'warning';
}
</script>
