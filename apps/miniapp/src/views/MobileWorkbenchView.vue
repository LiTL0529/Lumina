<template>
  <div class="phone-frame">
    <header class="wb-header">
      <div>
        <div style="font-size: 15px; font-weight: 700">Lumina 外勤销售移动工作台</div>
        <div style="font-size: 11px; color: #9fc4bf">{{ user ? `${user.realName} · ${user.orgName}` : '未登录' }}</div>
      </div>
      <div style="display: flex; gap: 8px">
        <router-link to="/v" class="hdr-link">C端验真</router-link>
        <button v-if="user" class="hdr-link" @click="logout">退出</button>
      </div>
    </header>

    <!-- Login View if unauthenticated -->
    <div v-if="!user" class="wb-body">
      <div class="m-card">
        <h2 style="margin: 0 0 14px; font-size: 17px">外勤销售 / 服务商登录</h2>
        <div class="m-field">
          <label class="m-label">账号</label>
          <input v-model="loginForm.username" class="m-input" placeholder="如 sales_nc 或 dealer_nc" />
        </div>
        <div class="m-field">
          <label class="m-label">密码</label>
          <input v-model="loginForm.password" type="password" class="m-input" />
        </div>
        <button class="m-btn m-btn-primary" @click="doLogin">登录移动工作台</button>
        <div style="margin-top: 12px; display: flex; gap: 8px">
          <button class="m-btn m-btn-soft" style="font-size: 12px; padding: 8px" @click="quick('sales_nc')">外勤销售体验</button>
          <button class="m-btn m-btn-soft" style="font-size: 12px; padding: 8px" @click="quick('dealer_nc')">南昌服务商体验</button>
        </div>
      </div>
    </div>

    <!-- Authenticated Mobile Workbench -->
    <template v-else>
      <div class="wb-body">
        <div v-if="toastMsg" class="toast-bar" :class="toastType">{{ toastMsg }}</div>

        <!-- Tab 1: Mobile Quick Order (Pushes real-time WS alert to PC Warehouse!) -->
        <div v-if="tab === 'order'" class="m-card">
          <h3 class="sec-h">手机快捷下单（实时推送仓库打单）</h3>
          <div class="m-field">
            <label class="m-label">选择终端机构</label>
            <select v-model="orderForm.clinicId" class="m-select">
              <option v-for="c in clinics" :key="c.id" :value="c.id">
                {{ c.name }} ({{ c.city }})
              </option>
            </select>
          </div>
          <div class="m-field">
            <label class="m-label">出库仓库</label>
            <select v-model="orderForm.warehouseId" class="m-select">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
          <div class="m-field">
            <label class="m-label">选择商品</label>
            <select v-model="orderForm.productId" class="m-select">
              <option v-for="p in products" :key="p.id" :value="p.id">
                {{ p.name }} (指导¥{{ p.retailPrice }})
              </option>
            </select>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
            <div class="m-field">
              <label class="m-label">数量（盒）</label>
              <input v-model.number="orderForm.qty" type="number" min="1" class="m-input" />
            </div>
            <div class="m-field">
              <label class="m-label">折扣（%，红线≥35）</label>
              <input v-model.number="orderForm.discountPercent" type="number" min="10" max="100" class="m-input" />
            </div>
          </div>
          <div class="m-field">
            <label class="m-label">备注</label>
            <input v-model="orderForm.remark" class="m-input" placeholder="如：今日下午顺丰加急发出" />
          </div>
          <button class="m-btn m-btn-primary" @click="submitMobileOrder">
            提交订单并推送至 PC 仓库
          </button>
        </div>

        <!-- Tab 2: Field Clinic Reporting -->
        <div v-else-if="tab === 'report'" class="m-card">
          <h3 class="sec-h">外勤现场机构报备（锁 90 天保护）</h3>
          <div class="m-field">
            <label class="m-label">机构全称</label>
            <input v-model="reportForm.name" class="m-input" placeholder="如：南昌悦颜皮肤管理中心" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
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
          <button class="m-btn m-btn-primary" @click="submitMobileReport">
            立即抢单报备（生成系统时间戳）
          </button>
        </div>

        <!-- Tab 3: Live Stock Lookup -->
        <div v-else-if="tab === 'stock'" class="m-card">
          <h3 class="sec-h">实时在仓库存查询</h3>
          <div v-for="b in balances" :key="b.id" class="stock-row">
            <div>
              <div style="font-weight: 600; font-size: 14px">{{ b.product.name }}</div>
              <div style="font-size: 11.5px; color: var(--m-muted)">{{ b.warehouse.name }} · {{ b.product.skuCode }}</div>
            </div>
            <div class="mono" style="font-size: 16px; font-weight: 700; color: var(--m-primary)">
              {{ b.qty }} {{ b.product.unitName }}
            </div>
          </div>
        </div>

        <!-- Tab 4: Orders Status -->
        <div v-else class="m-card">
          <h3 class="sec-h">近期订单与发货进度</h3>
          <div v-for="o in orders" :key="o.id" class="stock-row" style="flex-direction: column; align-items: stretch; gap: 4px">
            <div style="display: flex; justify-content: space-between">
              <strong class="mono" style="font-size: 13px">{{ o.docNo }}</strong>
              <span style="font-size: 11.5px; color: var(--m-primary); font-weight: 600">{{ o.status }}</span>
            </div>
            <div style="font-size: 12.5px; color: var(--m-sub)">
              {{ o.clinic?.name || o.buyerOrg?.name }} · ¥{{ Number(o.totalAmount).toFixed(2) }}
            </div>
          </div>
        </div>
      </div>

      <nav class="bottom-nav">
        <button :class="{ active: tab === 'order' }" @click="tab = 'order'">移动下单</button>
        <button :class="{ active: tab === 'report' }" @click="tab = 'report'">机构报备</button>
        <button :class="{ active: tab === 'stock' }" @click="tab = 'stock'">查库存</button>
        <button :class="{ active: tab === 'orders' }" @click="tab = 'orders'">我的订单</button>
      </nav>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
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
    showToast(`下单成功（${res.order.docNo}），已实时推送至仓库 PC 端准备扫码打单！`, 'ok');
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
    showToast(`${res.message}（时间戳：${res.serverTimestamp.slice(0, 19)}）`, 'ok');
    reportForm.value.name = '';
    await loadData();
  } catch (err: any) {
    showToast(err.response?.data?.message || '报备冲突', 'err');
  }
}

onMounted(loadData);
</script>

<style scoped>
.wb-header {
  background: #102321;
  color: #fff;
  padding: 14px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.hdr-link {
  background: rgba(255, 255, 255, 0.12);
  color: #e8cd97;
  border: none;
  border-radius: 99px;
  padding: 5px 10px;
  font-size: 11.5px;
  text-decoration: none;
  cursor: pointer;
}
.wb-body {
  padding: 14px 14px 76px;
  flex: 1;
}
.sec-h {
  margin: 0 0 14px;
  font-size: 15.5px;
  font-weight: 700;
}
.toast-bar {
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 12px;
}
.toast-bar.ok {
  background: #ecfdf3;
  color: #15803d;
  border: 1px solid #bbf7d0;
}
.toast-bar.err {
  background: #fdf2f2;
  color: #c81e1e;
  border: 1px solid #fecaca;
}
.stock-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 11px 0;
  border-bottom: 1px solid var(--m-border);
}
.stock-row:last-child {
  border-bottom: none;
}
.bottom-nav {
  position: sticky;
  bottom: 0;
  background: #fff;
  border-top: 1px solid var(--m-border);
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}
.bottom-nav button {
  padding: 13px 4px;
  background: none;
  border: none;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--m-muted);
  cursor: pointer;
}
.bottom-nav button.active {
  color: var(--m-primary);
  border-top: 2px solid var(--m-primary);
}
</style>
