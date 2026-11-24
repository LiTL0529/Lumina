<template>
  <el-dialog
    :model-value="modelValue"
    width="1000px"
    top="4vh"
    class="print-dialog"
    :show-close="true"
    @close="emit('update:modelValue', false)"
  >
    <template #header>
      <div class="pd-head">
        <div>
          <div class="pd-kicker">针式套打 · 出库联单</div>
          <div class="pd-title">打印预览</div>
        </div>
        <div class="pd-controls">
          <el-select v-model="selectedTemplateId" size="default" style="width: 280px">
            <el-option v-for="t in payload?.templates || []" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
          <el-input-number v-model="copies" :min="1" :max="5" size="default" controls-position="right" style="width: 100px" />
          <span class="pd-copies">份</span>
        </div>
      </div>
    </template>

    <div v-if="loading" class="pd-loading">正在加载模板与溯源码明细…</div>

    <template v-else-if="payload">
      <div class="pd-status">
        <span class="bridge" :class="bridgeConnected ? 'on' : 'off'">
          <span class="bridge-dot" />
          {{ bridgeConnected ? `本地打印桥已连接 · ${printers.length} 台设备` : '未连接本地打印桥，可使用浏览器打印' }}
        </span>
        <el-select
          v-if="bridgeConnected && printers.length"
          v-model="selectedPrinter"
          size="small"
          style="width: 200px"
          placeholder="选择针式打印机"
        >
          <el-option v-for="p in printers" :key="p.name" :label="p.name" :value="p.name" />
        </el-select>
        <span class="paper-info">纸张 {{ activeTemplate?.paperType }}</span>
      </div>

      <div class="preview-stage">
        <div
          id="lumina-print-sheet"
          class="paper-sheet"
          :class="{ 'needle-paper': isNeedlePaper }"
          :style="sheetStyle"
        >
          <div class="sheet-title">{{ activeTemplate?.name.split(' - ')[0] || 'Lumina 销售出库单' }}</div>
          <div class="sheet-meta-grid">
            <span v-if="hasVar('customerName')"><strong>客户/机构：</strong>{{ payload.printData.customerName }}</span>
            <span v-if="hasVar('docNo')" class="mono"><strong>单号：</strong>{{ payload.printData.docNo }}</span>
            <span v-if="hasVar('docDate')" class="mono"><strong>日期：</strong>{{ payload.printData.docDate }}</span>
            <span v-if="hasVar('warehouseName')"><strong>出库仓：</strong>{{ payload.printData.warehouseName }}</span>
            <span v-if="hasVar('shippingInfo')"><strong>物流：</strong>{{ payload.printData.shippingInfo }}</span>
            <span v-if="hasVar('docRemark')"><strong>备注：</strong>{{ payload.printData.docRemark }}</span>
          </div>

          <table class="sheet-table">
            <thead>
              <tr>
                <th v-if="hasCol('index')" style="width: 36px">序号</th>
                <th v-if="hasCol('productName')">商品名称</th>
                <th v-if="hasCol('skuCode')">货号</th>
                <th v-if="hasCol('spec')">规格</th>
                <th v-if="hasCol('unitName')" style="width: 44px">单位</th>
                <th v-if="hasCol('qty')" style="width: 48px">数量</th>
                <th v-if="hasCol('unitPrice')" style="width: 68px">单价</th>
                <th v-if="hasCol('discountPercent')" style="width: 56px">折扣</th>
                <th v-if="hasCol('discountedPrice')" style="width: 68px">折后价</th>
                <th v-if="hasCol('lineAmount')" style="width: 78px">金额</th>
                <th v-if="hasCol('traceCount')" style="width: 74px">已扫溯码</th>
                <th v-if="hasCol('remark')">备注</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in payload.printData.items" :key="item.index">
                <td v-if="hasCol('index')" class="center mono">{{ item.index }}</td>
                <td v-if="hasCol('productName')">
                  {{ item.productName }}
                  <div v-if="item.traceCodes?.length && activeTemplate?.paperType === 'A4'" class="trace-mini-list mono">
                    溯源码：{{ item.traceCodes.join(', ') }}
                  </div>
                </td>
                <td v-if="hasCol('skuCode')" class="mono">{{ item.skuCode }}</td>
                <td v-if="hasCol('spec')" class="center">{{ item.spec }}</td>
                <td v-if="hasCol('unitName')" class="center">{{ item.unitName }}</td>
                <td v-if="hasCol('qty')" class="right mono">{{ item.qty }}</td>
                <td v-if="hasCol('unitPrice')" class="right mono">{{ item.unitPrice }}</td>
                <td v-if="hasCol('discountPercent')" class="right mono">{{ item.discountPercent }}</td>
                <td v-if="hasCol('discountedPrice')" class="right mono">{{ item.discountedPrice }}</td>
                <td v-if="hasCol('lineAmount')" class="right mono">{{ item.lineAmount }}</td>
                <td v-if="hasCol('traceCount')" class="center mono">{{ item.traceCount }}</td>
                <td v-if="hasCol('remark')">{{ item.remark }}</td>
              </tr>
            </tbody>
          </table>

          <div class="sheet-summary mono">
            <span v-if="hasVar('totalAmount')">本单应收：¥{{ payload.printData.totalAmount }}</span>
            <span v-if="hasVar('paidAmount')">实收：¥{{ payload.printData.paidAmount }}</span>
            <span v-if="hasVar('previousArrears')">上次欠款：¥{{ payload.printData.previousArrears }}</span>
            <span v-if="hasVar('totalArrears')">累计欠款：¥{{ payload.printData.totalArrears }}</span>
          </div>

          <div class="sheet-footer">
            <span>制单人：{{ payload.printData.creatorName }}</span>
            <span>库管复核：______________</span>
            <span>收货签收：______________</span>
            <span>Lumina 一物一码正品溯源联单</span>
          </div>
        </div>
      </div>

      <p class="pd-tip">
        多联针式纸（241×140 / 241×93mm）建议用本地打印桥静默直打，避免浏览器缩放造成走纸偏移；没有打印桥也能用浏览器打印走系统驱动。
      </p>
    </template>

    <template #footer>
      <div class="pd-foot">
        <el-button @click="emit('update:modelValue', false)">关闭</el-button>
        <div class="pd-foot-right">
          <el-button v-if="bridgeConnected" type="primary" @click="doSilentPrint">
            静默直打 {{ copies }} 份
          </el-button>
          <el-button :type="bridgeConnected ? 'default' : 'primary'" @click="doBrowserPrint">
            浏览器打印 / 导出 PDF
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { LocalPrinterInfo, NeedlePrinterBridge } from '../utils/needlePrinter';

const props = defineProps<{
  modelValue: boolean;
  orderId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'printed'): void;
}>();

interface TemplateRow {
  id: string;
  paperType: string;
  name: string;
  visibleColumns: string[];
  systemVars: string[];
  hiprintJson: unknown;
}

const loading = ref(false);
const payload = ref<{
  templates: TemplateRow[];
  printData: Record<string, any>;
} | null>(null);
const selectedTemplateId = ref('');
const copies = ref(1);
const bridgeConnected = ref(false);
const printers = ref<LocalPrinterInfo[]>([]);
const selectedPrinter = ref('');

const bridge = new NeedlePrinterBridge();

watch(
  () => [props.modelValue, props.orderId],
  async ([visible, id]) => {
    if (!visible || !id) return;
    loading.value = true;
    bridge.connect((conn, list) => {
      bridgeConnected.value = conn;
      printers.value = list;
      if (list.length && !selectedPrinter.value) {
        selectedPrinter.value = list.find((p) => p.isDefault)?.name || list[0].name;
      }
    });
    try {
      const res = (await api.get(`/print/sales-order/${id}`)) as unknown as {
        templates: TemplateRow[];
        printData: Record<string, any>;
      };
      payload.value = res;
      selectedTemplateId.value = res.templates[0]?.id || '';
    } finally {
      loading.value = false;
    }
  },
);

onUnmounted(() => bridge.disconnect());

const activeTemplate = computed(() =>
  payload.value?.templates.find((t) => t.id === selectedTemplateId.value),
);

const isNeedlePaper = computed(() =>
  ['241x140', '241x93'].includes(activeTemplate.value?.paperType || ''),
);

const sheetStyle = computed(() => {
  const pt = activeTemplate.value?.paperType;
  if (pt === '241x93') return { width: '780px', minHeight: '340px' };
  if (pt === 'A4') return { width: '760px', minHeight: '620px' };
  return { width: '780px', minHeight: '470px' };
});

const hasCol = (k: string) => activeTemplate.value?.visibleColumns?.includes(k) ?? true;
const hasVar = (k: string) => activeTemplate.value?.systemVars?.includes(k) ?? true;

async function doSilentPrint() {
  if (!payload.value || !activeTemplate.value || !props.orderId) return;
  const ok = bridge.silentPrint({
    printer: selectedPrinter.value || undefined,
    template: activeTemplate.value.hiprintJson,
    data: payload.value.printData,
    copies: copies.value,
  });
  if (ok) {
    await api.post(`/sales-orders/${props.orderId}/print-log`);
    ElMessage.success(`已发送 ${copies.value} 份到针式打印机`);
    emit('printed');
  } else {
    ElMessage.warning('本地打印服务未就绪，改用浏览器打印');
    await doBrowserPrint();
  }
}

async function doBrowserPrint() {
  if (props.orderId) {
    await api.post(`/sales-orders/${props.orderId}/print-log`).catch(() => undefined);
    emit('printed');
  }
  window.print();
}
</script>

<style scoped>
.pd-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding-right: 28px;
}
.pd-kicker {
  font-size: 10.5px;
  letter-spacing: 0.12em;
  color: var(--ink-3);
}
.pd-title {
  font-size: 17px;
  font-weight: 650;
  margin-top: 3px;
}
.pd-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pd-copies {
  font-size: 12px;
  color: var(--ink-2);
}
.pd-loading {
  padding: 60px;
  text-align: center;
  color: var(--ink-3);
  font-size: 13px;
}
.pd-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-2);
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.bridge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ink-2);
}
.bridge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-3);
}
.bridge.on .bridge-dot {
  background: var(--jade);
  box-shadow: 0 0 0 3px rgba(47, 107, 69, 0.14);
}
.paper-info {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-3);
}

.preview-stage {
  background: #e8e5db;
  padding: 24px;
  border-radius: 8px;
  overflow-x: auto;
  display: flex;
  justify-content: center;
  border: 1px solid var(--line);
}

.paper-sheet {
  background: #fff;
  color: #111;
  padding: 22px 26px;
  box-shadow: 0 10px 26px rgba(23, 33, 31, 0.14);
  border: 1px solid #d3cec1;
  display: flex;
  flex-direction: column;
  position: relative;
  font-family: 'Songti SC', 'SimSun', var(--font-ui);
}
.paper-sheet.needle-paper {
  padding-left: 36px;
  padding-right: 36px;
  background-image:
    radial-gradient(#c6cfcc 3px, transparent 3.5px),
    radial-gradient(#c6cfcc 3px, transparent 3.5px);
  background-position: 10px 8px, calc(100% - 10px) 8px;
  background-size: 10px 24px;
  background-repeat: repeat-y;
}
.sheet-title {
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 2px;
  margin-bottom: 12px;
  border-bottom: 2px solid #222;
  padding-bottom: 6px;
}
.sheet-meta-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px 12px;
  font-size: 12px;
  margin-bottom: 12px;
}
.sheet-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-bottom: 14px;
}
.sheet-table th,
.sheet-table td {
  border: 1px solid #333;
  padding: 5px 6px;
}
.sheet-table th {
  background: #f5f7f6;
  font-weight: 600;
}
.center {
  text-align: center;
}
.right {
  text-align: right;
}
.trace-mini-list {
  font-size: 10px;
  color: #444;
  margin-top: 3px;
  word-break: break-all;
}
.sheet-summary {
  margin-top: auto;
  display: flex;
  justify-content: flex-end;
  gap: 20px;
  font-size: 13px;
  font-weight: 700;
  padding: 8px 0;
  border-top: 1px dashed #666;
}
.sheet-footer {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #444;
  margin-top: 10px;
}
.pd-tip {
  font-size: 11.5px;
  color: var(--ink-3);
  line-height: 1.7;
  margin: 12px 0 0;
}
.pd-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pd-foot-right {
  display: flex;
  gap: 8px;
}
</style>
