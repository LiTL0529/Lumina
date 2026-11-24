<template>
  <div class="login-shell">
    <section class="story">
      <div class="story-top">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
          <span class="brand-word">LUMINA</span>
        </div>
        <div class="story-kicker">供销溯源 · 渠道规则执行系统</div>
      </div>

      <div class="story-main">
        <h1 class="story-title">每一盒货，<br />都有据可查。</h1>
        <p class="story-desc">
          出厂赋码、总仓扫码入库、服务商扫码出库、机构签收、顾客验真——货走到哪一层，系统就记到哪一层。合同里的 90 天保护、270 天解绑、3.5 折红线，从此不靠台账和口头。
        </p>

        <ol class="ladder">
          <li v-for="(step, i) in ladder" :key="step.label" class="ladder-step">
            <span class="ladder-index mono">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="ladder-line" />
            <div class="ladder-body">
              <div class="ladder-label">{{ step.label }}</div>
              <div class="ladder-note">{{ step.note }}</div>
            </div>
          </li>
        </ol>
      </div>

      <div class="ticket">
        <div class="ticket-code mono">L8Q2 7ZK4 M3XD 9F1A</div>
        <div class="ticket-meta">
          <span>单品防伪码</span>
          <span class="ticket-sep">·</span>
          <span>HMAC-SHA256 签名</span>
        </div>
        <div class="ticket-cut" aria-hidden="true" />
        <div class="ticket-foot">微信扫码即可验真伪、查授权服务商</div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-inner">
        <div class="panel-head">
          <h2>登录工作台</h2>
          <p>库管用电脑、销售用手机，同一套数据。</p>
        </div>

        <el-form :model="form" label-position="top" class="login-form" @submit.prevent="submit">
          <el-form-item label="账号">
            <el-input v-model="form.username" placeholder="请输入账号" size="large" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="form.password"
              type="password"
              show-password
              placeholder="默认演示密码 123456"
              size="large"
              @keyup.enter="submit"
            />
          </el-form-item>
          <button class="submit-btn" type="button" :disabled="loading" @click="submit">
            {{ loading ? '正在进入…' : '进入系统' }}
          </button>
        </el-form>

        <div class="demo">
          <div class="demo-head">
            <span>演示账号</span>
            <span class="demo-hint">点击即登录，密码均为 123456</span>
          </div>
          <div class="demo-list">
            <button
              v-for="acc in demoAccounts"
              :key="acc.username"
              type="button"
              class="demo-row"
              @click="quickLogin(acc.username)"
            >
              <span class="demo-avatar">{{ acc.realName.slice(0, 1) }}</span>
              <span class="demo-body">
                <span class="demo-name">{{ acc.realName }}</span>
                <span class="demo-org">{{ acc.orgName }}</span>
              </span>
              <span class="demo-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>

      <footer class="panel-foot">
        <span>Lumina 品牌总部 · 渠道数字化</span>
        <span class="mono">v1.0</span>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const form = ref({ username: 'admin', password: '123456' });
const loading = ref(false);
const demoAccounts = ref<Array<{ username: string; realName: string; orgName: string }>>([]);

const ladder = [
  { label: '出厂赋码', note: '每一盒一个独立身份' },
  { label: '总仓入库', note: '箱码扫一次，整箱展开' },
  { label: '扫码出库', note: '出库码记到客户名下' },
  { label: '机构签收', note: '流向逐层落账' },
  { label: '顾客验真', note: '微信扫码认渠道' },
];

onMounted(async () => {
  try {
    demoAccounts.value = (await api.get('/auth/demo-accounts')) as unknown as typeof demoAccounts.value;
  } catch {
    // 演示账号接口不可用时仍可手工登录
  }
});

async function submit() {
  loading.value = true;
  try {
    await auth.login(form.value.username, form.value.password);
    ElMessage.success('登录成功');
    router.push('/');
  } finally {
    loading.value = false;
  }
}

async function quickLogin(username: string) {
  form.value.username = username;
  form.value.password = '123456';
  await submit();
}
</script>

<style scoped>
.login-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(420px, 0.88fr);
  background: var(--surface-2);
}

/* ---------------- 叙事区 ---------------- */
.story {
  position: relative;
  background: var(--dark);
  color: var(--dark-ink);
  padding: 34px 48px 40px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.story::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
      90deg,
      transparent 0 31px,
      rgba(255, 255, 255, 0.028) 31px 32px
    );
  pointer-events: none;
}

.story::after {
  content: '';
  position: absolute;
  right: -140px;
  top: 12%;
  width: 420px;
  height: 420px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(74, 155, 141, 0.22), transparent 62%);
  pointer-events: none;
}

.story-top {
  display: flex;
  align-items: center;
  gap: 16px;
  position: relative;
  z-index: 2;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand-mark {
  width: 28px;
  height: 28px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  padding: 5px 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}
.brand-mark span {
  background: #cfe3dc;
  border-radius: 1px;
}
.brand-mark span:nth-child(2) {
  transform: scaleY(0.62);
  align-self: center;
}
.brand-mark span:nth-child(3) {
  transform: scaleY(0.8);
  align-self: center;
}
.brand-word {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: #eef4f1;
}
.story-kicker {
  font-size: 11.5px;
  color: #7f9a94;
  padding-left: 16px;
  border-left: 1px solid rgba(255, 255, 255, 0.14);
}

.story-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-width: 520px;
  position: relative;
  z-index: 2;
  padding: 36px 0 28px;
}

.story-title {
  margin: 0 0 18px;
  font-size: clamp(32px, 3.4vw, 46px);
  line-height: 1.24;
  font-weight: 600;
  letter-spacing: -0.03em;
  color: #f4f8f6;
}

.story-desc {
  margin: 0 0 30px;
  font-size: 13.5px;
  line-height: 1.85;
  color: #a9bdb8;
  max-width: 44ch;
}

.ladder {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.ladder-step {
  display: flex;
  align-items: flex-start;
  gap: 0;
  position: relative;
}
.ladder-index {
  width: 26px;
  font-size: 10.5px;
  color: #5f7a74;
  padding-top: 4px;
  letter-spacing: 0.04em;
}
.ladder-line {
  width: 1px;
  background: rgba(255, 255, 255, 0.12);
  margin: 6px 14px 0 0;
  align-self: stretch;
  min-height: 30px;
  position: relative;
}
.ladder-step::before {
  content: '';
  position: absolute;
  left: 29px;
  top: 7px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #4f8f85;
  box-shadow: 0 0 0 3px rgba(79, 143, 133, 0.16);
}
.ladder-body {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 17px;
}
.ladder-label {
  font-size: 13px;
  color: #dfe9e6;
  font-weight: 500;
  min-width: 64px;
}
.ladder-note {
  font-size: 11.5px;
  color: #7f9a94;
}

/* 票根 */
.ticket {
  position: relative;
  z-index: 2;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 14px 16px 12px;
  background: rgba(255, 255, 255, 0.035);
  max-width: 340px;
}
.ticket-code {
  font-size: 16px;
  letter-spacing: 0.14em;
  color: #e9f2ef;
  font-weight: 600;
}
.ticket-meta {
  margin-top: 5px;
  font-size: 10.5px;
  color: #78938d;
  display: flex;
  gap: 6px;
}
.ticket-sep {
  color: #4d625e;
}
.ticket-cut {
  height: 1px;
  margin: 11px 0 9px;
  background-image: linear-gradient(to right, rgba(255, 255, 255, 0.22) 0 4px, transparent 4px 8px);
  background-size: 8px 1px;
  background-repeat: repeat-x;
}
.ticket-foot {
  font-size: 10.5px;
  color: #6d8781;
}

/* ---------------- 表单区 ---------------- */
.panel {
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  padding: 32px 44px 20px;
  border-left: 1px solid var(--line);
}

.panel-inner {
  flex: 1;
  width: 100%;
  max-width: 380px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.panel-head h2 {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.panel-head p {
  margin: 0 0 26px;
  font-size: 12.5px;
  color: var(--ink-2);
}

.login-form :deep(.el-form-item) {
  margin-bottom: 16px;
}

.submit-btn {
  width: 100%;
  height: 42px;
  margin-top: 6px;
  border: 1px solid var(--brand);
  background: var(--brand);
  color: #fff;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 0.15s ease;
}
.submit-btn:hover:not(:disabled) {
  background: var(--brand-ink);
  border-color: var(--brand-ink);
}
.submit-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

.demo {
  margin-top: 26px;
  border-top: 1px solid var(--line);
  padding-top: 16px;
}
.demo-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 12px;
  color: var(--ink-2);
  margin-bottom: 8px;
}
.demo-hint {
  font-size: 11px;
  color: var(--ink-3);
}
.demo-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.demo-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 5px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.13s ease;
}
.demo-row:hover {
  background: var(--surface-3);
}
.demo-avatar {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: var(--surface);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand-ink);
  flex-shrink: 0;
}
.demo-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.demo-name {
  font-size: 12.5px;
  color: var(--ink);
  font-weight: 500;
}
.demo-org {
  font-size: 10.5px;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.demo-arrow {
  margin-left: auto;
  color: var(--ink-3);
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.13s ease;
}
.demo-row:hover .demo-arrow {
  opacity: 1;
}

.panel-foot {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--ink-3);
  border-top: 1px solid var(--line);
  padding-top: 12px;
  margin-top: 20px;
}

@media (max-width: 960px) {
  .login-shell {
    grid-template-columns: 1fr;
  }
  .story {
    padding: 22px 22px 24px;
  }
  .story-main {
    padding: 22px 0 18px;
  }
  .story-title {
    font-size: 30px;
  }
  .story-desc {
    margin-bottom: 18px;
  }
  .ladder,
  .ticket,
  .story-kicker {
    display: none;
  }
  .panel {
    border-left: 0;
    padding: 26px 22px 18px;
  }
}
</style>
