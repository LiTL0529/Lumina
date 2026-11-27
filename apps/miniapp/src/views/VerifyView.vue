<template>
  <div class="phone-frame canvas-white">
    <header class="verify-topbar">
      <div class="brand-row">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </div>
        <div class="brand-block">
          <div class="brand-word">LUMINA</div>
          <div class="brand-caption">官方防伪溯源</div>
        </div>
      </div>
      <router-link v-if="isNativeApp" to="/m/workbench" class="b2b-switch">返回工作台</router-link>
    </header>

    <div class="verify-body">
      <!-- 查码 -->
      <div class="search-bar">
        <input
          v-model="inputToken"
          class="m-input mono"
          placeholder="输入 16 位防伪码"
          @keyup.enter="runVerify()"
        />
        <button class="search-btn" type="button" @click="runVerify()">查验</button>
      </div>

      <div v-if="loading" class="loading-card">
        <span class="spin" />
        正在进行签名与流向核验…
      </div>

      <template v-else-if="result">
        <!-- 结论 -->
        <section class="verdict" :class="verdictClass">
          <div class="verdict-main">
            <span class="verdict-pill">{{ result.authentic ? '官方正品' : '查验未通过' }}</span>
            <h1 class="verdict-title">{{ result.headline }}</h1>
            <p class="verdict-sub">{{ result.subMessage || result.message }}</p>
          </div>
          <div class="verdict-badge" :class="verdictClass" aria-hidden="true">
            <svg v-if="result.authentic && verdictClass === 'authentic'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <svg v-else-if="result.authentic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m18 6-12 12" /><path d="m6 6 12 12" />
            </svg>
          </div>
        </section>

        <button
          v-if="result.authentic"
          type="button"
          class="verdict-meta mono"
          @click="copyCode(result.codeToken)"
        >
          <span>{{ formatCodeGroups(result.codeToken) }}</span>
          <span class="meta-seq">第 {{ result.verifySeq }} 次查验</span>
          <span v-if="copiedTip" class="copied-tip">已复制</span>
        </button>

        <template v-if="result.authentic">
          <!-- 产品档案 -->
          <section class="v-section">
            <div class="m-kicker">产品身份档案</div>
            <div class="prod-name">{{ result.product.name }}</div>
            <div class="kv-grid">
              <div class="kv-row"><span>品牌</span><strong>{{ result.product.brandName }}</strong></div>
              <div class="kv-row">
                <span>货号 / 规格</span>
                <strong class="mono">{{ result.product.skuCode }} · {{ result.product.spec }}</strong>
              </div>
              <div class="kv-row"><span>生产批号</span><strong class="mono">{{ result.batch.batchNo }}</strong></div>
              <div class="kv-row">
                <span>生产 / 有效期</span>
                <strong class="mono">{{ result.batch.mfgDate }} — {{ result.batch.expDate }}</strong>
              </div>
              <div class="kv-row price-row">
                <span>官方建议零售价</span>
                <strong class="price num">¥{{ result.product.retailPrice.toFixed(2) }}</strong>
              </div>
              <div class="kv-row">
                <span>合规零售下限</span>
                <strong class="mono">≥ ¥{{ result.product.minCompliantRetail.toFixed(2) }}（{{ result.product.retailRedlineFold }} 折）</strong>
              </div>
            </div>
          </section>

          <!-- 渠道背书 -->
          <section class="v-section">
            <div class="m-kicker">官方授权渠道</div>
            <div class="dealer-title">{{ result.channelEndorsement.dealerName }}</div>
            <div class="region-chips" v-if="result.channelEndorsement.authorizedRegions?.length">
              <span v-for="r in result.channelEndorsement.authorizedRegions" :key="r" class="m-chip">{{ r }}</span>
            </div>
            <div v-if="result.channelEndorsement.clinicName" class="clinic-row">
              授权终端机构 <strong>{{ result.channelEndorsement.clinicName }}</strong>
              <span v-if="result.channelEndorsement.clinicCity" class="muted">（{{ result.channelEndorsement.clinicCity }}）</span>
            </div>
            <div class="first-scan mono">
              首次验证 {{ formatDateTime(result.firstVerifyAt) }} · {{ result.firstVerifyCity }}
            </div>
          </section>

          <!-- 延伸服务 -->
          <section class="v-section">
            <div class="m-kicker">院线护肤服务</div>
            <div class="extend-title">{{ result.extensions.usageGuideTitle }}</div>
            <p class="extend-desc">{{ result.extensions.postCareHint }}</p>
          </section>

          <!-- 核价举报 -->
          <section class="v-section">
            <div class="report-head">
              <div>
                <div class="report-title">价格核验与举报</div>
                <div class="report-desc">发现低于 8.5 折零售或非授权渠道售卖，可匿名反馈总部</div>
              </div>
              <button class="report-toggle" type="button" @click="showReport = !showReport">
                {{ showReport ? '收起' : '去核价' }}
              </button>
            </div>

            <div v-if="showReport" class="report-body">
              <div class="m-field">
                <label class="m-label">实际购入单价（元）</label>
                <input v-model.number="reportForm.paidPrice" type="number" class="m-input" placeholder="如 520" />
              </div>
              <div class="m-field">
                <label class="m-label">购买门店 / 渠道</label>
                <input v-model="reportForm.storeName" class="m-input" placeholder="如：某美容会所" />
              </div>
              <div class="m-field">
                <label class="m-label">补充说明</label>
                <input v-model="reportForm.remark" class="m-input" placeholder="选填" />
              </div>
              <button class="m-btn m-btn-primary" @click="submitPriceReport">提交品牌流向管控中心</button>
            </div>
            <div v-if="reportDoneMsg" class="report-done">{{ reportDoneMsg }}</div>
          </section>
        </template>
      </template>

      <div v-else class="empty-card">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
          </svg>
        </div>
        <div class="empty-title">扫描包装防伪二维码</div>
        <p class="empty-desc">
          用微信扫一扫外盒二维码即可验真，也可在上方输入 16 位防伪码查验授权渠道。
        </p>
      </div>

      <!-- 演示跨区检测折叠至页底 -->
      <details class="city-demo">
        <summary>跨区检测演示 · 当前模拟所在地：{{ simCity }}</summary>
        <div class="city-demo-body">
          <label class="m-label">切换模拟扫码城市</label>
          <MobileSelect
            v-model="simCity"
            title="选择模拟扫码城市"
            placeholder="请选择模拟城市"
            :options="simCityOptions"
            @change="runVerify()"
          />
        </div>
      </details>

      <footer class="page-foot">
        <span class="mono">LUMINA · 一物一码</span>
        <span>品牌方直连核验</span>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { mApi } from '../utils/api';
import { formatDateTime } from '../utils/format';
import MobileSelect, { type MobileSelectOption } from '../components/MobileSelect.vue';

const simCityOptions: MobileSelectOption[] = [
  { value: '南昌市', label: '南昌市', badge: '授权区' },
  { value: '宜春市', label: '宜春市', badge: '授权区' },
  { value: '杭州市', label: '杭州市', badge: '跨区' },
  { value: '北京市', label: '北京市', badge: '跨区' },
];

const route = useRoute();
const isNativeApp =
  typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());
const inputToken = ref((route.params.token as string) || '');
const simCity = ref('南昌市');
const loading = ref(false);
const result = ref<any>(null);
const copiedTip = ref(false);

function formatCodeGroups(token?: string | null) {
  if (!token) return '—';
  const clean = token.trim();
  return clean.length === 16 ? clean.replace(/(.{4})(?=.)/g, '$1 ') : clean;
}

function copyCode(token?: string) {
  if (!token) return;
  navigator.clipboard?.writeText(token);
  copiedTip.value = true;
  setTimeout(() => {
    copiedTip.value = false;
  }, 1800);
}

const showReport = ref(false);
const reportForm = ref({ paidPrice: 580, storeName: '', remark: '' });
const reportDoneMsg = ref('');

const verdictClass = computed(() => {
  if (!result.value) return '';
  if (!result.value.authentic || result.value.riskLevel === 'HIGH_FREQ_WARNING') return 'danger';
  if (result.value.riskLevel === 'REPEAT_OK') return 'warn';
  return 'authentic';
});

async function runVerify() {
  const token = inputToken.value.trim();
  if (!token) return;
  loading.value = true;
  reportDoneMsg.value = '';
  try {
    result.value = await mApi.get(`/public/verify/${encodeURIComponent(token)}`, {
      params: { city: simCity.value },
    });
  } finally {
    loading.value = false;
  }
}

async function submitPriceReport() {
  if (!result.value?.codeToken || !reportForm.value.paidPrice) return;
  const res = (await mApi.post('/public/verify/price-report', {
    codeToken: result.value.codeToken,
    paidPrice: reportForm.value.paidPrice,
    storeName: reportForm.value.storeName,
    city: simCity.value,
    remark: reportForm.value.remark,
  })) as any;
  reportDoneMsg.value = res.message;
  showReport.value = false;
}

onMounted(() => {
  if (inputToken.value) runVerify();
});
</script>

<style scoped>
.verify-topbar {
  flex-shrink: 0;
  background: #ffffff;
  border-bottom: 1px solid var(--m-line);
  padding: calc(11px + env(safe-area-inset-top)) 18px 11px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.brand-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #111827;
  color: #ffffff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.brand-mark svg {
  width: 16px;
  height: 16px;
}
.brand-word {
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--m-ink);
  line-height: 1.15;
}
.brand-caption {
  font-size: 11px;
  color: var(--m-muted);
  margin-top: 2px;
}
.b2b-switch {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--m-ink);
  text-decoration: none;
  border: 1px solid var(--m-line-strong);
  background: #ffffff;
  min-height: 36px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  white-space: nowrap;
}

.verify-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 18px 18px calc(28px + env(safe-area-inset-bottom));
}

.search-bar {
  display: flex;
  gap: 8px;
}
.search-btn {
  flex-shrink: 0;
  border: 0;
  background: #111827;
  color: #ffffff;
  border-radius: 6px;
  padding: 0 18px;
  min-height: 42px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}

.loading-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
  color: var(--m-muted);
  padding: 36px 0;
}
.spin {
  width: 15px;
  height: 15px;
  border: 2px solid var(--m-line-strong);
  border-top-color: #111827;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 结论 */
.verdict {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-top: 20px;
  padding: 18px 16px;
  border-radius: 10px;
  border: 1px solid var(--m-line);
  background: #ffffff;
}
.verdict.authentic {
  border-color: var(--m-success-line);
  background: var(--m-success-soft);
}
.verdict.warn {
  border-color: var(--m-gold-line);
  background: var(--m-gold-soft);
}
.verdict.danger {
  border-color: var(--m-seal-line);
  background: var(--m-seal-soft);
}
.verdict-main {
  flex: 1;
  min-width: 0;
}
.verdict-pill {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--m-sub);
}
.verdict.authentic .verdict-pill {
  color: var(--m-success);
}
.verdict.warn .verdict-pill {
  color: var(--m-gold);
}
.verdict.danger .verdict-pill {
  color: var(--m-seal);
}
.verdict-title {
  margin: 6px 0 5px;
  font-size: 18px;
  line-height: 1.35;
  font-weight: 600;
  color: var(--m-ink);
  text-wrap: balance;
}
.verdict-sub {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--m-sub);
  text-wrap: pretty;
}
@media (max-width: 390px) {
  .verdict {
    gap: 10px;
    padding: 15px 14px;
  }
  .verdict-title {
    font-size: 16px;
    letter-spacing: -0.01em;
  }
  .verdict-sub {
    font-size: 12px;
    line-height: 1.55;
  }
  .verdict-badge {
    width: 32px;
    height: 32px;
  }
}
.verdict-badge {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: #ffffff;
}
.verdict-badge svg {
  width: 19px;
  height: 19px;
}
.verdict-badge.authentic {
  background: var(--m-success);
}
.verdict-badge.warn {
  background: var(--m-gold);
}
.verdict-badge.danger {
  background: var(--m-seal);
}

.verdict-meta {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--m-ink);
  background: var(--m-surface-2);
  border: 1px solid var(--m-line);
  border-radius: 6px;
  padding: 9px 12px;
  margin-top: 10px;
  cursor: pointer;
}
.meta-seq {
  font-family: var(--m-font);
  color: var(--m-muted);
}
.copied-tip {
  color: var(--m-success);
  font-family: var(--m-font);
  font-weight: 600;
}

/* 留白分段（去框套框） */
.v-section {
  padding: 20px 0;
  border-bottom: 1px solid var(--m-line);
}
.prod-name {
  font-size: 17px;
  font-weight: 600;
  margin: 2px 0 14px;
  color: var(--m-ink);
}
.kv-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.kv-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.kv-row span {
  color: var(--m-muted);
  flex-shrink: 0;
}
.kv-row strong {
  text-align: right;
  font-weight: 500;
  color: var(--m-ink);
  min-width: 0;
  word-break: break-word;
}
.price-row {
  align-items: baseline;
  border-top: 1px solid var(--m-line);
  padding-top: 10px;
  margin-top: 2px;
}
.price {
  font-size: 20px;
  font-weight: 600;
  color: var(--m-ink);
}
.dealer-title {
  font-size: 15.5px;
  font-weight: 600;
  color: var(--m-ink);
  margin-bottom: 8px;
}
.region-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.clinic-row {
  font-size: 13px;
  color: var(--m-sub);
  margin-bottom: 6px;
}
.clinic-row strong {
  color: var(--m-ink);
}
.muted {
  color: var(--m-muted);
}
.first-scan {
  font-size: 11.5px;
  color: var(--m-muted);
}
.extend-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--m-ink);
  margin-bottom: 5px;
}
.extend-desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--m-sub);
}
.report-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.report-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--m-ink);
}
.report-desc {
  font-size: 12px;
  color: var(--m-muted);
  line-height: 1.55;
  margin-top: 3px;
}
.report-toggle {
  border: 1px solid var(--m-line-strong);
  background: #ffffff;
  border-radius: 6px;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 11px;
  font-size: 12px;
  font-weight: 500;
  color: var(--m-ink);
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
}
.report-body {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--m-line);
}
.report-done {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--m-success);
  font-weight: 600;
}

.empty-card {
  text-align: center;
  padding: 52px 16px;
}
.empty-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--m-surface-3);
  color: var(--m-ink);
  display: grid;
  place-items: center;
  margin: 0 auto 14px;
}
.empty-icon svg {
  width: 22px;
  height: 22px;
}
.empty-title {
  font-size: 15.5px;
  font-weight: 600;
  color: var(--m-ink);
}
.empty-desc {
  font-size: 12.5px;
  color: var(--m-muted);
  line-height: 1.7;
  margin: 8px 0 0;
}

/* 折叠至页底的跨区城市演示 */
.city-demo {
  margin-top: 24px;
  border: 1px solid var(--m-line);
  border-radius: 8px;
  background: var(--m-surface-2);
  padding: 10px 12px;
}
.city-demo summary {
  font-size: 12px;
  color: var(--m-muted);
  cursor: pointer;
  list-style: none;
}
.city-demo-body {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--m-line);
}

.page-foot {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--m-muted);
  padding: 20px 2px 0;
}
</style>
