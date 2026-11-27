<template>
  <div class="scan-sheet">
    <div class="ss-head">
      <div>
        <div class="ss-kicker">CONTINUOUS SCANNER</div>
        <h3 class="ss-title">扫码作业（连扫 · 自动去重）</h3>
      </div>
    </div>

    <!-- 作业模式切换（与 PC 端一致的三个独立闭环） -->
    <div class="mode-pills">
      <button
        v-for="m in availableModes"
        :key="m.key"
        type="button"
        class="mp-btn"
        :class="{ on: activeMode === m.key }"
        @click="switchMode(m.key)"
      >
        {{ m.label }}
      </button>
    </div>

    <!-- 模式前置配置 -->
    <div v-if="activeMode === 'INBOUND'" class="cfg-card">
      <div v-if="isHQ" class="sub-seg">
        <button type="button" :class="{ on: inboundSub === 'REGISTER' }" @click="switchInboundSub('REGISTER')">
          新码建档入库
        </button>
        <button type="button" :class="{ on: inboundSub === 'SYSTEM' }" @click="switchInboundSub('SYSTEM')">
          系统防伪码入库
        </button>
      </div>
      <div class="m-field">
        <label class="m-label">{{ isHQ ? '入库仓库' : '代理商收货仓' }}</label>
        <MobileSelect
          v-model="selectedWarehouseId"
          :title="isHQ ? '选择入库仓库' : '选择代理商收货仓'"
          placeholder="请选择仓库"
          :options="warehouseOptions"
          @change="scannedList = []"
        />
      </div>
      <template v-if="isHQ && inboundSub === 'REGISTER'">
        <div class="m-field">
          <label class="m-label">建档商品</label>
          <MobileSelect
            v-model="registerProductId"
            title="选择建档商品"
            placeholder="请选择商品"
            :options="productOptions"
          />
        </div>
        <div class="two-col">
          <div class="m-field" style="margin-bottom: 0">
            <label class="m-label">批次号（选填）</label>
            <input v-model="registerBatchNo" class="m-input mono" placeholder="留空自动生成" />
          </div>
          <div class="m-field" style="margin-bottom: 0">
            <label class="m-label">码级别</label>
            <MobileSelect
              v-model="registerCodeLevel"
              title="选择码级别"
              placeholder="请选择级别"
              :options="codeLevelOptions"
            />
          </div>
        </div>
      </template>
    </div>

    <div v-else-if="activeMode === 'OUTBOUND'" class="cfg-card">
      <div class="m-field" style="margin-bottom: 0">
        <label class="m-label">选择待出库供货单</label>
        <MobileSelect
          v-model="selectedOrderId"
          title="选择待出库供货单"
          placeholder="请选择待出库订单"
          clearable
          :options="pendingOrderOptions"
          @change="scannedList = []"
        />
      </div>
      <div v-if="!pendingOrders.length" class="cfg-hint">
        当前暂无待出库供货单，请先在工作台「新建供货单」后再按单扫码出库
      </div>
    </div>

    <!-- 扫码区：扫码入口进入即请求相机权限并开启连扫；手工录码入口直接聚焦输入框 -->
    <CameraScanner
      ref="scannerRef"
      :auto-start="props.autoStart"
      :focus-manual="props.focusManual"
      :default-continuous="true"
      :paused="Boolean(pendingConfirm) || confirmingLookup"
      :native-options="nativeScannerOptions"
      @decoded="onCodeDecoded"
      @batch-done="onNativeBatchDone"
      @open-manual="onOpenManualFromCamera"
      @error="(m) => showBanner(m, 'err')"
    />

    <!-- 最近一次扫码反馈 -->
    <div v-if="bannerMsg" class="scan-banner" :class="bannerType">{{ bannerMsg }}</div>

    <!-- 扫码查流向结果卡片 -->
    <div v-if="activeMode === 'TRACE' && traceResult" class="trace-card">
      <div class="tc-top">
        <span class="m-chip brand">
          {{ traceResult.code.codeLevel === 'CARTON' ? '外箱码' : '单品盒码' }}
        </span>
        <span class="tc-status">{{ statusLabel(traceResult.code.status) }}</span>
      </div>
      <div class="tc-token mono">{{ formatCodeGroups(traceResult.code.codeToken) }}</div>
      <div class="tc-prod">{{ traceResult.code.product?.name }} · 批次 {{ traceResult.code.batch?.batchNo }}</div>
      <div class="tc-owner">
        归属代理商：<strong>{{ traceResult.assignedDealer?.name || '总部在库' }}</strong>
        <template v-if="traceResult.targetClinic"> → {{ traceResult.targetClinic.name }}</template>
      </div>
      <div v-if="traceResult.code.events?.length" class="tc-events">
        <div v-for="ev in traceResult.code.events.slice(-4).reverse()" :key="ev.id" class="tc-ev">
          <span class="tc-ev-time mono">{{ formatDateTime(ev.occurredAt) }}</span>
          <span class="tc-ev-txt">{{ ev.remark || ev.eventType }}</span>
        </div>
      </div>
      <router-link :to="`/v/${traceResult.code.codeToken}`" class="m-btn m-btn-outline tc-link">
        打开 C 端正品验真页面
      </router-link>
    </div>

    <!-- 入库 / 出库待提交清单（手机端直接提交） -->
    <div v-if="activeMode === 'INBOUND' || activeMode === 'OUTBOUND'" class="list-card">
      <div class="lc-head">
        <span>
          已扫待提交：<strong>{{ scannedList.length }}</strong> 码 / <strong>{{ totalUnits }}</strong> 件
        </span>
        <button v-if="scannedList.length" type="button" class="link-btn danger" @click="scannedList = []">清空</button>
      </div>

      <div v-if="!scannedList.length" class="m-empty-sm">识别到产品并确认「是」后自动加入清单，也可在上方手工录入</div>
      <div v-for="(item, idx) in scannedList" :key="item.token" class="scan-row">
        <div class="sr-main">
          <div class="sr-top">
            <span class="sr-lvl" :class="item.codeLevel === 'CARTON' ? 'carton' : 'unit'">
              {{ item.codeLevel === 'CARTON' ? '外箱' : '单盒' }}
            </span>
            <span class="mono sr-code">{{ formatCodeGroups(item.token) }}</span>
          </div>
          <div class="sr-sub">{{ item.productName }} · +{{ item.unitCount }} 盒</div>
        </div>
        <button type="button" class="link-btn danger" @click="scannedList.splice(idx, 1)">删</button>
      </div>

      <button
        type="button"
        class="m-btn m-btn-primary submit-btn"
        :disabled="!scannedList.length || submitting"
        @click="submitBatchAction"
      >
        {{ submitting ? '正在提交…' : submitButtonText }}
      </button>
    </div>

    <!-- H5 摄像头 / 相册 / 手工录入 的产品识别确认弹窗（原生 App 内由原生卡片弹窗完成确认） -->
    <Teleport to="body">
      <Transition name="cf-pop">
        <div v-if="pendingConfirm" class="confirm-mask" role="dialog" aria-modal="true">
          <div class="confirm-card">
            <div class="cf-head">
              <div class="cf-badge" aria-hidden="true">✓</div>
              <div class="cf-head-copy">
                <div class="cf-kicker">产品识别确认</div>
                <h4 class="cf-title">{{ pendingConfirm.title }}</h4>
              </div>
            </div>
            <div class="cf-body">
              <div v-if="pendingConfirm.productName" class="cf-row">
                <span class="cf-k">商品</span>
                <span class="cf-v strong">
                  {{ pendingConfirm.productName }}
                  <template v-if="pendingConfirm.skuCode">（{{ pendingConfirm.skuCode }}）</template>
                </span>
              </div>
              <div v-if="pendingConfirm.levelDesc" class="cf-row">
                <span class="cf-k">规格 / 级别</span>
                <span class="cf-v">{{ pendingConfirm.levelDesc }}</span>
              </div>
              <div class="cf-row">
                <span class="cf-k">防伪码</span>
                <span class="cf-v mono strong">{{ formatCodeGroups(pendingConfirm.displayCode) }}</span>
              </div>
              <div v-if="pendingConfirm.batchNo" class="cf-row">
                <span class="cf-k">生产批次</span>
                <span class="cf-v mono">{{ pendingConfirm.batchNo }}</span>
              </div>
              <div v-if="pendingConfirm.statusText" class="cf-row">
                <span class="cf-k">当前状态</span>
                <span class="cf-v status">{{ pendingConfirm.statusText }}</span>
              </div>
            </div>
            <div class="cf-actions">
              <button type="button" class="cf-btn ghost" @click="rejectPending">否，不加入</button>
              <button type="button" class="cf-btn primary" @click="acceptPending">
                {{ pendingConfirm.confirmLabel }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import CameraScanner, { type DecodedMeta } from './CameraScanner.vue';
import MobileSelect, { type MobileSelectOption } from './MobileSelect.vue';
import type { NativeScanOpenOptions } from '../utils/nativeScanner';
import { getAppBase, getServerOrigin, mApi } from '../utils/api';
import { formatDateTime } from '../utils/format';
import { playMobileFeedback } from '../utils/scanFeedback';

type ScanTabMode = 'INBOUND' | 'OUTBOUND' | 'TRACE';

interface PendingConfirmItem {
  kind: 'STOCK_ITEM' | 'TRACE_VIEW';
  norm: string;
  displayCode: string;
  title: string;
  confirmLabel: string;
  productName?: string;
  skuCode?: string;
  levelDesc?: string;
  batchNo?: string;
  statusText?: string;
  validatedRes?: any;
  traceData?: any;
}

const props = withDefaults(
  defineProps<{
    user: any;
    warehouses: any[];
    products: any[];
    dealers: any[];
    orders: any[];
    initialMode?: ScanTabMode | '';
    initialOrderId?: string;
    autoStart?: boolean;
    focusManual?: boolean;
  }>(),
  {
    initialMode: '',
    initialOrderId: '',
    autoStart: true,
    focusManual: false,
  },
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'committed'): void;
}>();

const scannerRef = ref<InstanceType<typeof CameraScanner> | null>(null);
const isHQ = computed(() => props.user?.orgType === 'HQ');

const availableModes = computed<Array<{ key: ScanTabMode; label: string }>>(() => [
  { key: 'INBOUND', label: isHQ.value ? '扫码入库' : '扫码收货' },
  { key: 'OUTBOUND', label: '订单出库' },
  { key: 'TRACE', label: '查流向' },
]);

const activeMode = ref<ScanTabMode>(props.initialMode || 'INBOUND');
const inboundSub = ref<'REGISTER' | 'SYSTEM'>('SYSTEM');
const selectedWarehouseId = ref('');
const registerProductId = ref('');
const registerBatchNo = ref('');
const registerCodeLevel = ref<'UNIT' | 'CARTON'>('UNIT');
const selectedOrderId = ref(props.initialOrderId || '');

const scannedList = ref<any[]>([]);
const submitting = ref(false);
const traceResult = ref<any>(null);
const bannerMsg = ref('');
const bannerType = ref<'ok' | 'err'>('ok');

const pendingConfirm = ref<PendingConfirmItem | null>(null);
const confirmingLookup = ref(false);
const inFlightTokens = new Set<string>();
const dismissedAtMap = new Map<string, number>();

const hqWarehouses = computed(() => {
  const hq = props.warehouses.filter((w) => w.org?.type === 'HQ');
  return hq.length ? hq : props.warehouses;
});

const pendingOrders = computed(() =>
  props.orders.filter((o) => ['PENDING_OUTBOUND', 'PARTIAL_OUTBOUND'].includes(o.status)),
);

const codeLevelOptions: MobileSelectOption[] = [
  { value: 'UNIT', label: '单品盒码' },
  { value: 'CARTON', label: '外箱码' },
];
const warehouseOptions = computed<MobileSelectOption[]>(() =>
  props.warehouses.map((w) => ({ value: w.id, label: w.name })),
);
const productOptions = computed<MobileSelectOption[]>(() =>
  props.products.map((p) => ({ value: p.id, label: p.name, sub: p.skuCode || '' })),
);
const pendingOrderOptions = computed<MobileSelectOption[]>(() =>
  pendingOrders.value.map((o) => ({
    value: o.id,
    label: o.docNo,
    sub: o.buyerOrg?.name || o.clinic?.name || '',
    badge: o.orderScene === 'HQ_TO_DEALER' ? '发服务商' : '发机构',
  })),
);

const totalUnits = computed(() =>
  scannedList.value.reduce((s, i) => s + Number(i.unitCount || 1), 0),
);

const activeValidateContext = computed(() => {
  let validateMode: NativeScanOpenOptions['validateMode'] = '';
  let warehouseId = selectedWarehouseId.value;

  if (activeMode.value === 'INBOUND') {
    validateMode = isHQ.value
      ? inboundSub.value === 'REGISTER'
        ? 'REGISTER_INBOUND'
        : 'HQ_INBOUND'
      : 'DEALER_INBOUND';
  } else if (activeMode.value === 'OUTBOUND') {
    const ord = pendingOrders.value.find((o) => o.id === selectedOrderId.value);
    if (ord) {
      warehouseId = ord.warehouseId;
      validateMode = ord.orderScene === 'HQ_TO_DEALER' ? 'HQ_OUTBOUND' : 'DEALER_OUTBOUND';
    }
  }
  return { validateMode, warehouseId };
});

const nativeScannerTitle = computed(() => {
  if (activeMode.value === 'TRACE') return '扫码查流向';
  if (activeMode.value === 'INBOUND') {
    if (isHQ.value && inboundSub.value === 'REGISTER') return '新码建档入库';
    return isHQ.value ? '总仓扫码入库' : '代理商扫码收货';
  }
  return '按单扫码出库';
});

const existingNormalizedCodes = computed(() => {
  const set = new Set<string>();
  for (const item of scannedList.value) {
    if (item.token) set.add(String(item.token).toUpperCase());
    if (Array.isArray(item.childTokens)) {
      for (const ct of item.childTokens) {
        if (ct) set.add(String(ct).toUpperCase());
      }
    }
  }
  return Array.from(set);
});

const nativeScannerOptions = computed<NativeScanOpenOptions>(() => {
  const ctx = activeValidateContext.value;
  return {
    continuous: true,
    confirmBeforeAdd: true,
    title: nativeScannerTitle.value,
    hint: '对准产品二维码或条形码',
    apiBaseUrl: `${getServerOrigin()}${getAppBase()}/api/v1`,
    authToken: localStorage.getItem('lumina_mobile_token') || '',
    workMode: activeMode.value,
    validateMode: ctx.validateMode,
    warehouseId: ctx.warehouseId || '',
    productId: registerProductId.value || '',
    codeLevel: registerCodeLevel.value,
    batchNo: registerBatchNo.value || '',
    existingCodes: existingNormalizedCodes.value,
  };
});

const submitButtonText = computed(() => {
  if (activeMode.value === 'INBOUND') {
    if (isHQ.value && inboundSub.value === 'REGISTER') return `确认扫码建档入库（${totalUnits.value} 件）`;
    return isHQ.value ? `确认总仓入库（${totalUnits.value} 盒）` : `确认代理商收货（${totalUnits.value} 盒）`;
  }
  return `确认按订单扫码出库（${totalUnits.value} 盒）`;
});

function normalizeCode(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/\/v\/([0-9A-Za-z]{16})(?:[/?#]|$)/i);
  if (m) return m[1].toUpperCase();
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const q = u.searchParams.get('code') || u.searchParams.get('token') || u.searchParams.get('sn');
      const cand = (q || u.pathname.split('/').filter(Boolean).pop() || '').trim();
      if (cand) return cand.toUpperCase();
    } catch {
      // fall through
    }
  }
  return s.replace(/\s+/g, '').toUpperCase();
}

function formatCodeGroups(token?: string | null) {
  if (!token) return '—';
  const clean = token.trim();
  return clean.length === 16 ? clean.replace(/(.{4})(?=.)/g, '$1 ') : clean;
}

function showBanner(msg: string, type: 'ok' | 'err' = 'ok') {
  bannerMsg.value = msg;
  bannerType.value = type;
}

function findStockDuplicate(token: string, parentToken?: string | null, childTokens?: string[]): string | null {
  if (scannedList.value.some((x) => x.token === token)) {
    return `码 ${token} 已在待提交清单中，已自动去重`;
  }
  if (parentToken && scannedList.value.some((x) => x.token === parentToken)) {
    return `码 ${token} 所属外箱 ${parentToken} 已在清单中，无需重复录入`;
  }
  if (scannedList.value.some((x) => Array.isArray(x.childTokens) && x.childTokens.includes(token))) {
    return `码 ${token} 所属外箱已在清单中，无需重复录入`;
  }
  if (Array.isArray(childTokens) && childTokens.length) {
    const hit = childTokens.find((ct) => scannedList.value.some((x) => x.token === ct));
    if (hit) {
      return `外箱 ${token} 内单品码 ${hit} 已在清单中，请勿箱盒混扫重复`;
    }
  }
  return null;
}

function initSelections() {
  if (!selectedWarehouseId.value && props.warehouses.length) {
    // 总部账号默认落在总仓，服务商账号默认本组织仓
    selectedWarehouseId.value = (isHQ.value ? hqWarehouses.value[0] : props.warehouses[0])?.id || '';
  }
  if (!registerProductId.value && props.products.length) {
    registerProductId.value = props.products[0].id;
  }
  if (selectedOrderId.value && !pendingOrders.value.some((o) => o.id === selectedOrderId.value)) {
    selectedOrderId.value = pendingOrders.value[0]?.id || '';
  } else if (!selectedOrderId.value && pendingOrders.value.length) {
    selectedOrderId.value = pendingOrders.value[0].id;
  }
}

watch(() => [props.warehouses, props.products, props.orders], initSelections, {
  immediate: true,
});

function switchMode(m: ScanTabMode) {
  activeMode.value = m;
  scannedList.value = [];
  traceResult.value = null;
  pendingConfirm.value = null;
  bannerMsg.value = '';
}

function switchInboundSub(sub: 'REGISTER' | 'SYSTEM') {
  inboundSub.value = sub;
  scannedList.value = [];
  pendingConfirm.value = null;
}

async function onNativeBatchDone(confirmedCodes: string[]) {
  for (const code of confirmedCodes || []) {
    await onCodeDecoded(code, { preConfirmed: true, source: 'continuous' });
  }
}

function onOpenManualFromCamera() {
  showBanner('已切换至手工录码，可直接输入或粘贴防伪码', 'ok');
}

function rejectPending() {
  if (pendingConfirm.value) {
    dismissedAtMap.set(pendingConfirm.value.norm, Date.now());
    showBanner(`已忽略 ${pendingConfirm.value.displayCode}，继续扫码`, 'ok');
  }
  pendingConfirm.value = null;
}

function addValidatedToList(res: any) {
  const dup = findStockDuplicate(res.token, res.parentToken, res.childTokens);
  if (dup) {
    playMobileFeedback('err');
    showBanner(dup, 'err');
    return;
  }
  scannedList.value.unshift(res);
  playMobileFeedback('ok');
  showBanner(
    `✓ 已加入清单：${res.productName}（${res.codeLevel === 'CARTON' ? '外箱' : '单盒'} +${res.unitCount} 盒）`,
    'ok',
  );
}

function acceptPending() {
  const item = pendingConfirm.value;
  pendingConfirm.value = null;
  if (!item) return;

  if (item.kind === 'TRACE_VIEW') {
    traceResult.value = item.traceData;
    playMobileFeedback('ok');
    showBanner(`查询成功：${item.productName || item.displayCode}（${item.statusText || ''}）`, 'ok');
    return;
  }
  if (item.kind === 'STOCK_ITEM' && item.validatedRes) {
    addValidatedToList(item.validatedRes);
  }
}

async function onCodeDecoded(raw: string, meta?: DecodedMeta) {
  const preConfirmed = Boolean(meta?.preConfirmed);
  const norm = normalizeCode(raw);
  if (!norm) return;

  if (!preConfirmed) {
    const prevDismiss = dismissedAtMap.get(norm) || 0;
    if (Date.now() - prevDismiss < 3000) return;
  }

  // 1. 查流向
  if (activeMode.value === 'TRACE') {
    if (inFlightTokens.has(norm)) return;
    inFlightTokens.add(norm);
    confirmingLookup.value = true;
    try {
      const tl = (await mApi.get(`/trace/codes/${encodeURIComponent(norm)}/timeline`)) as any;
      if (preConfirmed) {
        traceResult.value = tl;
        playMobileFeedback('ok');
        showBanner(`查询成功：${tl.code.product?.name}（${statusLabel(tl.code.status)}）`, 'ok');
      } else {
        playMobileFeedback('ok');
        pendingConfirm.value = {
          kind: 'TRACE_VIEW',
          norm,
          displayCode: tl.code.codeToken || norm,
          title: '识别到产品，是否查看流向？',
          confirmLabel: '是，查看流向',
          productName: tl.code.product?.name,
          skuCode: tl.code.product?.skuCode,
          levelDesc: tl.code.codeLevel === 'CARTON' ? '外箱码' : '单品盒码',
          batchNo: tl.code.batch?.batchNo,
          statusText: statusLabel(tl.code.status),
          traceData: tl,
        };
      }
    } catch (err: any) {
      playMobileFeedback('err');
      showBanner(err.response?.data?.message || '未找到该防伪码记录', 'err');
    } finally {
      confirmingLookup.value = false;
      inFlightTokens.delete(norm);
    }
    return;
  }

  // 2. 入库 / 出库：本地去重 → 后端校验 → 关联去重 → 确认加入
  const preDup = findStockDuplicate(norm);
  if (preDup) {
    if (!preConfirmed) {
      playMobileFeedback('err');
      showBanner(preDup, 'err');
    }
    return;
  }

  const { validateMode, warehouseId } = activeValidateContext.value;
  if (!validateMode) {
    playMobileFeedback('err');
    return showBanner('请先选择要核验的待出库供货单', 'err');
  }

  if (inFlightTokens.has(norm)) return;
  inFlightTokens.add(norm);
  confirmingLookup.value = true;
  try {
    const res = (await mApi.post('/stock/scan-validate', {
      rawInput: raw,
      mode: validateMode,
      warehouseId,
      ...(validateMode === 'REGISTER_INBOUND'
        ? {
            productId: registerProductId.value,
            codeLevel: registerCodeLevel.value,
            batchNo: registerBatchNo.value || undefined,
          }
        : {}),
    })) as any;

    if (!res.ok) {
      playMobileFeedback('err');
      return showBanner(res.message || '该码校验未通过', 'err');
    }

    const postDup = findStockDuplicate(res.token, res.parentToken, res.childTokens);
    if (postDup) {
      if (!preConfirmed) {
        playMobileFeedback('err');
        showBanner(postDup, 'err');
      }
      return;
    }

    if (preConfirmed) {
      addValidatedToList(res);
    } else {
      playMobileFeedback('ok');
      pendingConfirm.value = {
        kind: 'STOCK_ITEM',
        norm: res.token,
        displayCode: res.token,
        title: '识别到产品，是否加入清单？',
        confirmLabel: '是，加入清单',
        productName: res.productName,
        skuCode: res.skuCode,
        levelDesc: `${res.spec ? `${res.spec} · ` : ''}${
          res.codeLevel === 'CARTON' ? `外箱码（展开 ${res.unitCount} 盒）` : '单品盒码（1 盒）'
        }`,
        batchNo: res.batchNo,
        statusText: res.statusLabel,
        validatedRes: res,
      };
    }
  } catch (err: any) {
    playMobileFeedback('err');
    showBanner(err.response?.data?.message || '扫码校验失败', 'err');
  } finally {
    confirmingLookup.value = false;
    inFlightTokens.delete(norm);
  }
}

async function submitBatchAction() {
  if (!scannedList.value.length) return;
  submitting.value = true;
  try {
    const codeInputs = scannedList.value.map((x) => x.token);
    if (activeMode.value === 'INBOUND') {
      if (isHQ.value && inboundSub.value === 'REGISTER') {
        const res = (await mApi.post('/stock/inbound-register', {
          warehouseId: selectedWarehouseId.value,
          productId: registerProductId.value,
          batchNo: registerBatchNo.value || undefined,
          codeLevel: registerCodeLevel.value,
          codeInputs,
          remark: '手机端扫码建档入库',
        })) as any;
        playMobileFeedback('notify');
        showBanner(`建档入库成功：${res.inboundUnitsCount} 件（批次 ${res.batchNo}），PC 端已实时同步`, 'ok');
      } else {
        const res = (await mApi.post('/stock/inbound', {
          mode: isHQ.value ? 'HQ_INBOUND' : 'DEALER_INBOUND',
          warehouseId: selectedWarehouseId.value,
          codeInputs,
          remark: isHQ.value ? '手机端总仓扫码入库' : '手机端代理商扫码收货',
        })) as any;
        playMobileFeedback('notify');
        showBanner(
          `${isHQ.value ? '总仓入库' : '代理商收货'}成功：${res.inboundUnitsCount} 盒（单号 ${res.stockDoc.docNo}）`,
          'ok',
        );
      }
    } else if (activeMode.value === 'OUTBOUND') {
      if (!selectedOrderId.value) {
        playMobileFeedback('err');
        return showBanner('请先选择待出库供货单', 'err');
      }
      const res = (await mApi.post('/stock/outbound', {
        salesOrderId: selectedOrderId.value,
        codeInputs,
        remark: '手机端按订单扫码出库',
      })) as any;
      playMobileFeedback('notify');
      showBanner(`按单出库成功：${res.outboundUnitsCount} 盒，PC 端已实时同步`, 'ok');
    }
    scannedList.value = [];
    emit('committed');
  } catch (err: any) {
    playMobileFeedback('err');
    showBanner(err.response?.data?.message || '提交失败', 'err');
  } finally {
    submitting.value = false;
  }
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    GENERATED: '待入总仓（已赋码）',
    IN_HQ_STOCK: '总仓在库',
    IN_TRANSIT_TO_DEALER: '发往服务商在途',
    IN_DEALER_STOCK: '服务商在库',
    SOLD_TO_CLINIC: '已出库至机构',
    CONSUMED: '终端已验真',
    UNPACKED: '已拆箱',
  };
  return map[s] || s;
}

onMounted(initSelections);
</script>

<style scoped>
.scan-sheet {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ss-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.ss-kicker {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--m-muted);
}
.ss-title {
  margin: 2px 0 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--m-ink);
}
.ss-close {
  border: 1px solid var(--m-line-strong);
  background: #ffffff;
  color: var(--m-ink);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
}
.mode-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mp-btn {
  flex: 1;
  min-width: 78px;
  min-height: 36px;
  border: 1px solid var(--m-line-strong);
  background: #ffffff;
  color: var(--m-sub);
  border-radius: 6px;
  padding: 6px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.mp-btn.on {
  background: #111827;
  border-color: #111827;
  color: #ffffff;
  font-weight: 600;
}
.cfg-card,
.list-card,
.trace-card {
  background: #ffffff;
  border: 1px solid var(--m-line);
  border-radius: var(--m-radius);
  padding: 14px;
}
.cfg-hint {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--m-muted);
}
.sub-seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 3px;
  background: var(--m-surface-3);
  border-radius: 8px;
  margin-bottom: 12px;
}
.sub-seg button {
  border: 0;
  background: transparent;
  padding: 7px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--m-sub);
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.sub-seg button.on {
  background: #ffffff;
  color: #111827;
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--m-line);
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.scan-banner {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.5;
  font-weight: 500;
}
.scan-banner.ok {
  background: var(--m-success-soft);
  color: var(--m-success);
  border: 1px solid var(--m-success-line);
}
.scan-banner.err {
  background: var(--m-seal-soft);
  color: var(--m-seal);
  border: 1px solid var(--m-seal-line);
}
.lc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12.5px;
  color: var(--m-sub);
  margin-bottom: 8px;
}
.link-btn {
  border: 0;
  background: transparent;
  color: var(--m-primary);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  padding: 2px 4px;
}
.link-btn.danger {
  color: var(--m-seal);
}
.m-empty-sm {
  text-align: center;
  font-size: 12px;
  color: var(--m-muted);
  padding: 14px 0;
}
.scan-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid var(--m-line);
}
.sr-main {
  min-width: 0;
  flex: 1;
}
.sr-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sr-lvl {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}
.sr-lvl.carton {
  background: var(--m-gold-soft);
  color: var(--m-gold);
}
.sr-lvl.unit {
  background: var(--m-primary-soft);
  color: var(--m-primary-dark);
}
.sr-code {
  font-size: 12px;
  font-weight: 600;
  color: var(--m-ink);
  word-break: break-all;
}
.sr-sub {
  font-size: 11px;
  color: var(--m-muted);
  margin-top: 2px;
}
.submit-btn {
  margin-top: 10px;
}
.submit-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.tc-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tc-status {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--m-primary-dark);
}
.tc-token {
  margin-top: 6px;
  font-size: 15px;
  font-weight: 700;
  color: var(--m-primary-dark);
}
.tc-prod {
  font-size: 12.5px;
  color: var(--m-ink);
  margin-top: 4px;
}
.tc-owner {
  font-size: 12px;
  color: var(--m-sub);
  margin-top: 3px;
}
.tc-events {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--m-line);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tc-ev {
  display: flex;
  flex-direction: column;
  font-size: 11.5px;
}
.tc-ev-time {
  font-size: 10.5px;
  color: var(--m-muted);
}
.tc-ev-txt {
  color: var(--m-ink);
}
.tc-link {
  margin-top: 10px;
  text-decoration: none;
  padding: 9px 12px;
  font-size: 13px;
}

/* 产品识别确认弹窗（与原生安卓卡片风格完全一致） */
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: rgba(15, 23, 42, 0.56);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
}
.confirm-card {
  width: 100%;
  max-width: 356px;
  background: #ffffff;
  border: 1px solid #eceef2;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 22px 48px rgba(15, 23, 42, 0.26);
}
.cf-head {
  display: flex;
  align-items: center;
  gap: 11px;
}
.cf-badge {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #ecfdf5;
  color: #059669;
  font-size: 16px;
  font-weight: 700;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.cf-head-copy {
  min-width: 0;
  flex: 1;
}
.cf-kicker {
  font-size: 11.5px;
  font-weight: 600;
  color: #059669;
}
.cf-title {
  margin: 2px 0 0;
  font-size: 17px;
  font-weight: 700;
  color: #111827;
}
.cf-body {
  margin-top: 14px;
  padding: 12px 14px;
  background: #f8f9fb;
  border: 1px solid #eceef2;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cf-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  font-size: 13px;
}
.cf-k {
  color: #6b7280;
  flex-shrink: 0;
}
.cf-v {
  color: #111827;
  text-align: right;
  word-break: break-all;
}
.cf-v.strong {
  font-weight: 600;
}
.cf-v.status {
  color: #059669;
  font-weight: 500;
}
.cf-actions {
  margin-top: 18px;
  display: grid;
  grid-template-columns: 1fr 1.35fr;
  gap: 10px;
}
.cf-btn {
  min-height: 46px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}
.cf-btn.ghost {
  background: #ffffff;
  border: 1px solid #d1d5db;
  color: #374151;
}
.cf-btn.primary {
  background: #111827;
  border: 1px solid #111827;
  color: #ffffff;
}
.cf-pop-enter-active,
.cf-pop-leave-active {
  transition: opacity 0.18s ease;
}
.cf-pop-enter-active .confirm-card,
.cf-pop-leave-active .confirm-card {
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.cf-pop-enter-from,
.cf-pop-leave-to {
  opacity: 0;
}
.cf-pop-enter-from .confirm-card,
.cf-pop-leave-to .confirm-card {
  transform: scale(0.95) translateY(8px);
}
</style>
