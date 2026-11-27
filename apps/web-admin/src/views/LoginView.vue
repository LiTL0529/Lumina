<template>
  <div class="login-canvas">
    <div class="login-card">
      <section class="story">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 8V6a2 2 0 0 1 2-2h2" />
              <path d="M16 4h2a2 2 0 0 1 2 2v2" />
              <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
              <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
              <path d="M9 9h6v6H9z" />
            </svg>
          </div>
          <span class="brand-word">LUMINA</span>
        </div>
        <div class="story-main">
          <h1 class="story-title">供销溯源与<br />渠道执行系统</h1>
        </div>
        <div class="story-foot">一物一码 · 流向留痕 · 渠道规则</div>
      </section>

      <!-- 右侧：纯白表单区 -->
      <section class="panel">
        <div class="panel-inner">
          <div class="panel-head">
            <h2>{{ mode === 'register' ? '注册账号' : '登录工作台' }}</h2>
            <p>{{ mode === 'register' ? '手机号验证后快速加入所属服务商' : 'PC 与手机端数据实时同步' }}</p>
          </div>

          <div class="mode-tabs" role="tablist">
            <button type="button" :class="{ on: mode === 'sms' }" @click="switchMode('sms')">短信登录</button>
            <button type="button" :class="{ on: mode === 'password' }" @click="switchMode('password')">密码登录</button>
            <button type="button" :class="{ on: mode === 'register' }" @click="switchMode('register')">手机注册</button>
          </div>

          <!-- 1. 短信验证码登录 -->
          <el-form v-if="mode === 'sms'" :model="smsForm" label-position="top" class="login-form" @submit.prevent="submitSmsLogin">
            <el-form-item label="手机号">
              <el-input
                v-model="smsForm.phone"
                maxlength="11"
                placeholder="请输入 11 位手机号"
                size="large"
              />
            </el-form-item>
            <el-form-item label="短信验证码">
              <div class="sms-code-row">
                <el-input
                  v-model="smsForm.code"
                  maxlength="6"
                  placeholder="6 位数字验证码"
                  size="large"
                  class="mono"
                  @keyup.enter="submitSmsLogin"
                />
                <button
                  type="button"
                  class="sms-send-btn"
                  :disabled="sendingSms || smsCooldown > 0"
                  @click="handleSendSms(smsForm.phone, 'LOGIN')"
                >
                  {{ smsCooldown > 0 ? `${smsCooldown}s 后重发` : sendingSms ? '发送中…' : '获取验证码' }}
                </button>
              </div>
            </el-form-item>
            <div v-if="smsNotice" class="sms-notice" :class="smsNoticeMode === 'MOCK' ? 'mock' : 'live'">
              {{ smsNotice }}
            </div>
            <button class="submit-btn" type="button" :disabled="loading" @click="submitSmsLogin">
              {{ loading ? '正在验证…' : '短信验证登录' }}
            </button>
            <p class="sms-auto-tip">未注册手机号验证通过后将自动注册并登录</p>
          </el-form>

          <!-- 2. 账号密码登录 -->
          <el-form v-else-if="mode === 'password'" :model="form" label-position="top" class="login-form" @submit.prevent="submitPassword">
            <el-form-item label="账号 / 手机号">
              <el-input v-model="form.username" placeholder="请输入账号或已注册手机号" size="large" />
            </el-form-item>
            <el-form-item label="密码">
              <el-input
                v-model="form.password"
                type="password"
                show-password
                placeholder="请输入登录密码"
                size="large"
                @keyup.enter="submitPassword"
              />
            </el-form-item>
            <button class="submit-btn" type="button" :disabled="loading" @click="submitPassword">
              {{ loading ? '正在进入…' : '进入系统' }}
            </button>
          </el-form>

          <!-- 3. 手机短信验证码注册 -->
          <el-form v-else :model="regForm" label-position="top" class="login-form" @submit.prevent="submitRegister">
            <el-form-item label="手机号">
              <el-input v-model="regForm.phone" maxlength="11" placeholder="请输入 11 位手机号" size="large" />
            </el-form-item>
            <el-form-item label="短信验证码">
              <div class="sms-code-row">
                <el-input
                  v-model="regForm.code"
                  maxlength="6"
                  placeholder="6 位数字验证码"
                  size="large"
                  class="mono"
                />
                <button
                  type="button"
                  class="sms-send-btn"
                  :disabled="sendingSms || smsCooldown > 0"
                  @click="handleSendSms(regForm.phone, 'REGISTER')"
                >
                  {{ smsCooldown > 0 ? `${smsCooldown}s 后重发` : sendingSms ? '发送中…' : '获取验证码' }}
                </button>
              </div>
            </el-form-item>
            <div v-if="smsNotice" class="sms-notice" :class="smsNoticeMode === 'MOCK' ? 'mock' : 'live'">
              {{ smsNotice }}
            </div>
            <div class="reg-two-col">
              <el-form-item label="真实姓名">
                <el-input v-model="regForm.realName" placeholder="请输入姓名" size="large" />
              </el-form-item>
              <el-form-item label="设置登录密码">
                <el-input v-model="regForm.password" type="password" show-password placeholder="至少 6 位" size="large" />
              </el-form-item>
            </div>
            <div class="reg-two-col">
              <el-form-item label="所属代理商">
                <el-select v-model="regForm.orgId" size="large" style="width: 100%" placeholder="选择所属服务商">
                  <el-option v-for="d in dealers" :key="d.id" :label="d.name" :value="d.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="岗位角色">
                <el-select v-model="regForm.roleCode" size="large" style="width: 100%">
                  <el-option v-for="r in registerRoles" :key="r.code" :label="r.label" :value="r.code" />
                </el-select>
              </el-form-item>
            </div>
            <button class="submit-btn" type="button" :disabled="loading" @click="submitRegister">
              {{ loading ? '正在注册…' : '校验短信并注册登录' }}
            </button>
          </el-form>
        </div>

        <footer class="panel-foot">
          <span>Lumina 品牌总部</span>
          <span class="mono">v1.0</span>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../utils/api';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const mode = ref<'sms' | 'password' | 'register'>('sms');
const form = ref({ username: '', password: '' });
const smsForm = ref({ phone: '', code: '' });
const regForm = ref({
  phone: '',
  code: '',
  realName: '',
  password: '',
  orgId: '',
  roleCode: 'SALES_REP',
});

const loading = ref(false);
const sendingSms = ref(false);
const smsCooldown = ref(0);
const smsNotice = ref('');
const smsNoticeMode = ref<'LIVE' | 'MOCK'>('LIVE');

let cooldownTimer: ReturnType<typeof setInterval> | null = null;

const dealers = ref<Array<{ id: string; name: string; city?: string }>>([]);
const registerRoles = ref<Array<{ code: string; label: string }>>([
  { code: 'SALES_REP', label: '外勤销售 / 渠道业务员' },
  { code: 'DEALER_WAREHOUSE', label: '服务商库管' },
]);


function switchMode(next: 'sms' | 'password' | 'register') {
  mode.value = next;
  smsNotice.value = '';
}

function startCooldown(sec = 60) {
  if (cooldownTimer) clearInterval(cooldownTimer);
  smsCooldown.value = sec;
  cooldownTimer = setInterval(() => {
    smsCooldown.value -= 1;
    if (smsCooldown.value <= 0 && cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  }, 1000);
}

onMounted(async () => {
  try {
    const opts = (await api.get('/auth/register-options')) as any;
    dealers.value = opts.dealers || [];
    if (opts.roles?.length) registerRoles.value = opts.roles;
    if (dealers.value.length && !regForm.value.orgId) {
      regForm.value.orgId = dealers.value[0].id;
    }
  } catch {
    // ignore
  }
});

onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer);
});

async function handleSendSms(phone: string, scene: 'LOGIN' | 'REGISTER') {
  const clean = phone.trim();
  if (!/^1[3-9]\d{9}$/.test(clean)) {
    return ElMessage.warning('请输入有效的 11 位手机号');
  }
  sendingSms.value = true;
  try {
    const res = (await api.post('/auth/sms/send', { phone: clean, scene })) as any;
    startCooldown(res.cooldownSeconds || 60);
    smsNoticeMode.value = res.mode === 'MOCK' ? 'MOCK' : 'LIVE';
    smsNotice.value = res.message || '短信验证码已发送';
    ElMessage.success(res.mode === 'MOCK' ? `演示验证码：${res.mockCode}` : '短信验证码已发送，请注意查收');
  } finally {
    sendingSms.value = false;
  }
}

async function submitPassword() {
  loading.value = true;
  try {
    await auth.login(form.value.username, form.value.password);
    ElMessage.success('登录成功');
    router.push('/');
  } finally {
    loading.value = false;
  }
}

async function submitSmsLogin() {
  if (!/^1[3-9]\d{9}$/.test(smsForm.value.phone.trim())) {
    return ElMessage.warning('请输入有效的 11 位手机号');
  }
  if (!/^\d{6}$/.test(smsForm.value.code.trim())) {
    return ElMessage.warning('请输入 6 位数字短信验证码');
  }
  loading.value = true;
  try {
    const res = await auth.loginBySms(smsForm.value.phone.trim(), smsForm.value.code.trim());
    ElMessage.success(res.isNewUser ? '首次短信验证，已自动注册并登录' : '短信验证登录成功');
    router.push('/');
  } finally {
    loading.value = false;
  }
}

async function submitRegister() {
  if (!/^1[3-9]\d{9}$/.test(regForm.value.phone.trim())) {
    return ElMessage.warning('请输入有效的 11 位手机号');
  }
  if (!/^\d{6}$/.test(regForm.value.code.trim())) {
    return ElMessage.warning('请输入 6 位数字短信验证码');
  }
  if (regForm.value.realName.trim().length < 2) {
    return ElMessage.warning('请输入真实姓名（至少 2 个字）');
  }
  if (regForm.value.password.length < 6) {
    return ElMessage.warning('请设置至少 6 位登录密码');
  }
  loading.value = true;
  try {
    await auth.registerBySms({
      phone: regForm.value.phone.trim(),
      code: regForm.value.code.trim(),
      realName: regForm.value.realName.trim(),
      password: regForm.value.password,
      orgId: regForm.value.orgId || undefined,
      roleCode: regForm.value.roleCode,
    });
    ElMessage.success('注册成功，已自动登录');
    router.push('/');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-canvas {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px 20px;
  background: #ffffff;
}

.login-card {
  width: 100%;
  max-width: 880px;
  min-height: 540px;
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  border: 1px solid var(--border-hairline);
  border-radius: 8px;
  overflow: hidden;
  background: #ffffff;
}

.story {
  background: var(--bg-rail);
  border-right: 1px solid var(--border-hairline);
  padding: 36px 36px 30px;
  display: flex;
  flex-direction: column;
}
.brand {
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
}
.brand-mark svg {
  width: 16px;
  height: 16px;
}
.brand-word {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--ink-primary);
}
.story-main {
  flex: 1;
  display: flex;
  align-items: center;
}
.story-title {
  margin: 0;
  font-size: 26px;
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
}
.story-foot {
  font-size: 12px;
  color: var(--ink-muted);
  letter-spacing: 0.02em;
}

.panel {
  display: flex;
  flex-direction: column;
  padding: 44px 52px 24px;
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
  font-weight: 600;
  letter-spacing: -0.01em;
}
.panel-head p {
  margin: 0 0 24px;
  font-size: 13px;
  color: var(--ink-muted);
}

.mode-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-bottom: 1px solid var(--border-hairline);
  margin-bottom: 22px;
}
.mode-tabs button {
  border: 0;
  background: transparent;
  padding: 9px 4px 10px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--ink-muted);
  cursor: pointer;
  font-family: inherit;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.mode-tabs button:hover {
  color: var(--ink-primary);
}
.mode-tabs button.on {
  color: var(--ink-primary);
  font-weight: 600;
  border-bottom-color: #111827;
}

.login-form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.login-form :deep(.el-form-item__label) {
  margin-bottom: 6px;
}
.sms-code-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.sms-code-row :deep(.el-input) {
  flex: 1;
  min-width: 0;
}
.sms-send-btn {
  flex-shrink: 0;
  min-width: 108px;
  height: 40px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: #ffffff;
  color: var(--ink-primary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.sms-send-btn:hover:not(:disabled) {
  border-color: #9ca3af;
  background: var(--bg-hover);
}
.sms-send-btn:disabled {
  color: var(--ink-muted);
  cursor: not-allowed;
}
.sms-notice {
  margin: -4px 0 14px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
}
.sms-notice.live {
  background: var(--status-ok-bg);
  border: 1px solid var(--status-ok-line);
  color: var(--status-ok);
}
.sms-notice.mock {
  background: var(--status-warn-bg);
  border: 1px solid var(--status-warn-line);
  color: var(--status-warn);
}
.reg-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 10px;
}
.submit-btn {
  width: 100%;
  height: 42px;
  margin-top: 6px;
  border: 0;
  background: #111827;
  color: #ffffff;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease;
}
.submit-btn:hover:not(:disabled) {
  background: #1f2937;
}
.submit-btn:disabled {
  background: #9ca3af;
  cursor: default;
}
.sms-auto-tip {
  margin: 12px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--ink-muted);
}
.panel-foot {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--ink-muted);
  padding-top: 16px;
  margin-top: 24px;
}

@media (max-width: 820px) {
  .login-canvas {
    padding: 0;
    align-items: start;
  }
  .login-card {
    grid-template-columns: 1fr;
    border: 0;
    border-radius: 0;
    min-height: 100vh;
  }
  .story {
    border-right: 0;
    border-bottom: 1px solid var(--border-hairline);
    padding: 20px;
  }
  .story-main,
  .story-foot {
    display: none;
  }
  .panel {
    padding: 28px 20px 18px;
  }
  .reg-two-col {
    grid-template-columns: 1fr;
  }
}
</style>
