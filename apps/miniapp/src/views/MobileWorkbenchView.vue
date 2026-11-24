<template>
  <div class="phone-frame">
    <header class="wb-header">
      <div class="wb-brand">
        <div class="wb-word">LUMINA</div>
        <div class="wb-caption">外勤销售工作台</div>
      </div>
      <div class="wb-head-right">
        <span v-if="user" class="wb-user">{{ user.realName }}</span>
        <router-link to="/v" class="hdr-link">C 端验真</router-link>
        <button v-if="user" class="hdr-link" type="button" @click="logout">退出</button>
      </div>
    </header>

    <!-- 登录 -->
    <div v-if="!user" class="wb-body">
      <div class="m-card login-card">
        <div class="m-kicker">FIELD SALES</div>
        <h2 class="m-section-title login-title">外勤销售 / 服务商登录</h2>
        <p class="m-section-desc">手机上下单，PC 仓库即时收到待出库订单并扫码打单。</p>

        <div class="m-field">
          <label class="m-label">账号</label>
          <input v-model="loginForm.username" class="m-input" placeholder="如 sales_nc 或 dealer_nc" />
        </div>
        <div class="m-field">
          <label class="m-label">密码</label>
          <input v-model="loginForm.password" type="password" class="m-input" />
        </div>
        <button class="m-btn m-btn-primary" @click="doLogin">登录工作台</button>

        <div class="quick-row">
          <button class="m-btn m-btn-soft quick-btn" @click="quick('sales_nc')">外勤销售体验</button>
          <button class="m-btn m-btn-soft quick-btn" @click="quick('dealer_nc')">南昌服务商体验</button>
        </div>
      </div>
    </div>

    <!-- 已登录 -->
    <template v-else>
      <div class="wb-body">
        <div v-if="toastMsg" class="toast-bar" :class="toastType">{{ toastMsg }}</div>

        <!-- 下单 -->
        <div v-if="tab === 'order'" class="m-card">
          <h3 class="m-section-title">手机下单</h3>
          <p class="m-section-desc">提交后实时推送到 PC 仓库，仓管扫码出库并把码记到机构名下。</p>

          <div class="m-field">
            <label class="m-label">终端机构</label>
            <select v-model="orderForm.clinicId" class="m-select">
              <option v-for="c in clinics" :key="c.id" :value="c.id">{{ c.name }}（{{ c.city }}）</option>
            </select>
          </div>
          <div class="m-field">
            <label class="m-label">出库仓库</label>
            <select v-model="orderForm.warehouseId" class="m-select">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
          <div class="m-field">
            <label class="m-label">商品</label>
            <select v-model="orderForm.productId" class="m-select">
              <option v-for="p in products" :key="p.id" :value="p.id">
                {{ p.name }}（指导 ¥{{ p.retailPrice }}）
              </option>
            </select>
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">数量（盒）</label>
              <input v-model.number="orderForm.qty" type="number" min="1" class="m-input" />
            </div>
            <div class="m-field">
              <label class="m-label">折扣（%）</label>
              <input v-model.number="orderForm.discountPercent" type="number" min="10" max="100" class="m-input" />
            </div>
          </div>

          <div class="quote" :class="{ blocked: belowRedline }">
            <div class="quote-row">
              <span>折算单价</span>
              <span class="num">¥{{ discountedUnit.toFixed(2) }}</span>
            </div>
            <div class="quote-row">
              <span>本单合计</span>
              <span class="num quote-total">¥{{ orderTotal.toFixed(2) }}</span>
            </div>
            <div class="quote-note">
              {{ belowRedline ? '低于 3.5 折供货红线，提交会被拦截，需总部特批' : '在供货红线之上，可直接提交' }}
            </div>
          </div>

          <div class="m-field" style="margin-top: 12px">
            <label class="m-label">备注</label>
            <input v-model="orderForm.remark" class="m-input" placeholder="如：今日下午顺丰加急" />
          </div>

          <button class="m-btn m-btn-primary" @click="submitMobileOrder">提交订单并推送仓库</button>
        </div>

        <!-- 报备 -->
        <div v-else-if="tab === 'report'" class="m-card">
          <h3 class="m-section-title">现场机构报备</h3>
          <p class="m-section-desc">提交即锁定服务端时间戳。同城两个人同时报备，先提交的算数。</p>

          <div class="m-field">
            <label class="m-label">机构全称</label>
            <input v-model="reportForm.name" class="m-input" placeholder="如：南昌悦颜皮肤管理中心" />
          </div>
          <div class="two-col">
            <div class="m-field">
              <label class="m-label">所在城市</label>
              <input v-model="reportForm.city" class="m-input" />
            </div>
            <div class="m-field">
              <label class="m-label">负责人手机</label>
              <input v-model="reportForm.contactPhone" class="m-input" />
            </div>
          </div>
          <div class="m-field">
            <label class="m-label">负责人姓名</label>
            <input v-model="reportForm.contactName" class="m-input" />
          </div>

          <button class="m-btn m-btn-primary" @click="submitMobileReport">报备并锁定 90 天保护</button>
        </div>

        <!-- 库存 -->
        <div v-else-if="tab === 'stock'" class="m-card">
          <h3 class="m-section-title">在仓库存</h3>
          <p class="m-section-desc">实时同步 PC 端，下单前先看一眼有没有货。</p>

          <div v-if="!balances.length" class="m-empty">当前没有库存记录</div>
          <div v-for="b in balances" :key="b.id" class="stock-row">
            <div class="stock-main">
              <div class="stock-name">{{ b.product.name }}</div>
              <div class="stock-meta">{{ b.warehouse.name }} · <span class="mono">{{ b.product.skuCode }}</span></div>
            </div>
            <div class="stock-qty">
              <span class="num">{{ b.qty }}</span>
              <span class="stock-unit">{{ b.product.unitName }}</span>
            </div>
          </div>
        </div>

        <!-- 订单 -->
        <div v-else class="m-card">
          <h3 class="m-section-title">我的订单</h3>
          <p class="m-section-desc">状态与 PC 端一致，出库后即可查看归属到客户的码。</p>

          <div v-if="!orders.length" class="m-empty">还没有订单</div>
          <div v-for="o in orders" :key="o.id" class="order-row">
            <div class="order-top">
              <span class="mono order-doc">{{ o.docNo }}</span>
              <span class="order-status" :class="statusClass(o.status)">{{ statusLabel(o.status) }}</span>
            </div>
            <div class="order-mid">{{ o.clinic?.name || o.buyerOrg?.name }}</div>
            <div class="order-bot">
              <span class="muted">{{ (o.items || []).reduce((s: number, i: any) => s + i.qty, 0) }} 盒</span>
              <span class="num order-amount">¥{{ Number(o.totalAmount).toFixed(2) }}</span>
            </div>
          </div>
        </div>
      </div>

      <nav class="m-nav">
        <button :class="{ active: tab === 'order' }" @click="tab = 'order'">下单</button>
        <button :class="{ active: tab === 'report' }" @click="tab = 'report'">报备</button>
        <button :class="{ active: tab === 'stock' }" @click="tab = 'stock'">库存</button>
        <button :class="{ active: tab === 'orders' }" @click="tab = 'orders'">订单</button>
      </nav>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { mApi } from '../utils/api';

const user = ref<any>(
  (() => {
    try {
      const s = localStorage.getItem('lumina_mobile_user');
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  })(),
);

const tab = ref<'order' | 'report' | 'stock' | 'orders'>('order');
const loginForm = ref({ username: 'sales_nc', password: '123456' });
const toastMsg = ref('');
const toastType = ref<'ok' | 'err'>('ok');

const clinics = ref<any[]>([]);
const warehouses = ref<any[]>([]);
const products = ref<any[]>([]);
const balances = ref<any[]>([]);
const orders = ref<any[]>([]);

const orderForm = ref({
  clinicId: '',
  warehouseId: '',
  productId: '',
  qty: 2,
  discountPercent: 55,
  remark: '',
});

const reportForm = ref({
  name: '',
  city: '南昌市',
  contactName: '',
  contactPhone: '',
});

const currentProduct = computed(() => products.value.find((p) => p.id === orderForm.value.productId));
const discountedUnit = computed(() => {
  const price = Number(currentProduct.value?.retailPrice || 0);
  return (price * orderForm.value.discountPercent) / 100;
});
const orderTotal = computed(() => discountedUnit.value * Number(orderForm.value.qty || 0));
const belowRedline = computed(() => Number(orderForm.value.discountPercent) < 35);

function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
  toastMsg.value = msg;
  toastType.value = type;
  setTimeout(() => {
    if (toastMsg.value === msg) toastMsg.value = '';
  }, 4500);
}

async function doLogin() {
  try {
    const res = (await mApi.post('/auth/login', loginForm.value)) as any;
    localStorage.setItem('lumina_mobile_token', res.accessToken);
    localStorage.setItem('lumina_mobile_user', JSON.stringify(res.user));
    user.value = res.user;
    await loadData();
  } catch (err: any) {
    showToast(err.response?.data?.message || '登录失败', 'err');
  }
}

function quick(u: string) {
  loginForm.value.username = u;
  loginForm.value.password = '123456';
  doLogin();
}

function logout() {
  localStorage.removeItem('lumina_mobile_token');
  localStorage.removeItem('lumina_mobile_user');
  user.value = null;
}

async function loadData() {
  if (!user.value) return;
  const [c, w, p, b, o] = await Promise.all([
    mApi.get('/clinics'),
    mApi.get('/warehouses'),
    mApi.get('/products'),
    mApi.get('/stock/balances'),
    mApi.get('/sales-orders'),
  ]);
  clinics.value = (c as unknown as any[]).filter((x) => x.bindStatus !== 'PUBLIC_POOL');
  warehouses.value = w as unknown as any[];
  products.value = p as unknown as any[];
  balances.value = b as unknown as any[];
  orders.value = o as unknown as any[];

  if (!orderForm.value.clinicId && clinics.value.length) orderForm.value.clinicId = clinics.value[0].id;
  if (!orderForm.value.warehouseId && warehouses.value.length) orderForm.value.warehouseId = warehouses.value[0].id;
  if (!orderForm.value.productId && products.value.length) orderForm.value.productId = products.value[0].id;
}

async function submitMobileOrder() {
  const prod = products.value.find((p) => p.id === orderForm.value.productId);
  if (!prod) return;
  try {
    const res = (await mApi.post('/sales-orders', {
      orderScene: 'DEALER_TO_CLINIC',
      clinicId: orderForm.value.clinicId,
      warehouseId: orderForm.value.warehouseId,
      remark: orderForm.value.remark || '外勤手机端提交',
      items: [
        {
          productId: prod.id,
          qty: orderForm.value.qty,
          unitPrice: Number(prod.retailPrice),
          discountPercent: orderForm.value.discountPercent,
        },
      ],
    })) as any;
    showToast(`下单成功（${res.order.docNo}），仓库已收到待出库提醒`, 'ok');
    orderForm.value.remark = '';
    await loadData();
  } catch (err: any) {
    showToast(err.response?.data?.message || '下单被红线拦截', 'err');
  }
}

async function submitMobileReport() {
  if (!reportForm.value.name.trim()) return showToast('请输入机构名称', 'err');
  try {
    const res = (await mApi.post('/clinics/report', reportForm.value)) as any;
    showToast(`${res.message}（${res.serverTimestamp.slice(0, 19)}）`, 'ok');
    reportForm.value.name = '';
    await loadData();
  } catch (err: any) {
    showToast(err.response?.data?.message || '报备冲突', 'err');
  }
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    DRAFT: '草稿',
    PENDING_APPROVAL: '待特批',
    PENDING_OUTBOUND: '待出库',
    PARTIAL_OUTBOUND: '部分出库',
    COMPLETED: '已出库',
    CANCELLED: '已撤销',
  };
  return m[s] || s;
}

function statusClass(s: string) {
  if (s === 'COMPLETED') return 'done';
  if (s === 'PENDING_APPROVAL') return 'bad';
  return 'open';
}

onMounted(loadData);
</script>

<style scoped>
.wb-header {
  background: #101c1a;
  color: #fff;
  padding: 15px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.wb-word {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #eef4f1;
}
.wb-caption {
  font-size: 10.5px;
  color: #7f9a94;
  margin-top: 2px;
}
.wb-head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wb-user {
  font-size: 11.5px;
  color: #b7cbc6;
  margin-right: 2px;
}
.hdr-link {
  background: transparent;
  color: #cfe3dc;
  border: 1px solid rgba(207, 227, 220, 0.22);
  border-radius: 4px;
  padding: 5px 9px;
  font-size: 11px;
  text-decoration: none;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.wb-body {
  padding: 14px 14px 76px;
  flex: 1;
}
.login-card {
  margin-top: 8px;
}
.login-title {
  font-size: 17px;
  margin-top: 2px;
}
.quick-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.quick-btn {
  font-size: 12px;
  padding: 9px 8px;
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.toast-bar {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  margin-bottom: 12px;
  line-height: 1.5;
}
.toast-bar.ok {
  background: #eef4ee;
  color: #2f6b45;
  border: 1px solid #cfe0d3;
}
.toast-bar.err {
  background: var(--m-seal-soft);
  color: var(--m-seal);
  border: 1px solid #e8c4bc;
}

/* 报价 */
.quote {
  background: var(--m-surface-2);
  border: 1px solid var(--m-line);
  border-radius: 8px;
  padding: 11px 13px;
}
.quote.blocked {
  background: var(--m-seal-soft);
  border-color: #e8c4bc;
}
.quote-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12.5px;
  color: var(--m-sub);
  padding: 2px 0;
}
.quote-total {
  font-size: 18px;
  color: var(--m-ink);
  font-weight: 600;
}
.quote-note {
  font-size: 10.5px;
  color: var(--m-muted);
  margin-top: 6px;
  border-top: 1px solid var(--m-line);
  padding-top: 6px;
  line-height: 1.5;
}
.quote.blocked .quote-note {
  color: var(--m-seal);
  border-top-color: #e8c4bc;
}

/* 库存 */
.stock-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--m-line);
}
.stock-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.stock-main {
  min-width: 0;
}
.stock-name {
  font-size: 13.5px;
  font-weight: 500;
}
.stock-meta {
  font-size: 11px;
  color: var(--m-muted);
  margin-top: 2px;
}
.stock-qty {
  display: flex;
  align-items: baseline;
  gap: 2px;
  flex-shrink: 0;
}
.stock-qty .num {
  font-size: 18px;
  font-weight: 600;
  color: var(--m-primary-dark);
}
.stock-unit {
  font-size: 10.5px;
  color: var(--m-muted);
}

/* 订单 */
.order-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--m-line);
}
.order-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.order-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.order-doc {
  font-size: 12px;
  color: var(--m-primary-dark);
  font-weight: 600;
}
.order-status {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid transparent;
}
.order-status.open {
  background: var(--m-primary-soft);
  border-color: var(--m-primary-line);
  color: var(--m-primary-dark);
}
.order-status.done {
  background: #eef4ee;
  border-color: #cfe0d3;
  color: var(--m-success);
}
.order-status.bad {
  background: var(--m-seal-soft);
  border-color: #e8c4bc;
  color: var(--m-seal);
}
.order-mid {
  font-size: 13px;
  margin-top: 5px;
}
.order-bot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 4px;
}
.order-amount {
  font-size: 14px;
  font-weight: 600;
}
.muted {
  font-size: 11px;
  color: var(--m-muted);
}
.m-empty {
  padding: 26px 0;
  text-align: center;
  font-size: 12px;
  color: var(--m-muted);
}
</style>
