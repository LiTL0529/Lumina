<template>
  <button
    type="button"
    class="ms-trigger"
    :class="{ placeholder: !selectedOption, disabled }"
    :disabled="disabled"
    @click="openSheet"
  >
    <span class="ms-val">
      <span class="ms-val-main">{{ selectedOption ? selectedOption.label : placeholder || '请选择' }}</span>
      <span v-if="selectedOption?.badge" class="ms-val-badge">{{ selectedOption.badge }}</span>
    </span>
    <svg class="ms-caret" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 8l4 4 4-4" />
    </svg>
  </button>

  <Teleport to="body">
    <Transition name="ms-sheet">
      <div v-if="open" class="ms-mask" role="dialog" aria-modal="true" @click.self="closeSheet">
        <div class="ms-panel">
          <div class="ms-handle" aria-hidden="true" />
          <div class="ms-head">
            <span class="ms-title">{{ title || placeholder || '请选择' }}</span>
            <div class="ms-head-actions">
              <button
                v-if="clearable && modelValue"
                type="button"
                class="ms-clear"
                @click="pick('')"
              >
                清空
              </button>
              <button type="button" class="ms-close" aria-label="关闭" @click="closeSheet">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>
          </div>

          <div class="ms-list">
            <div v-if="!options.length" class="ms-empty">暂无可选项</div>
            <button
              v-for="opt in options"
              :key="opt.value"
              type="button"
              class="ms-opt"
              :class="{ active: opt.value === modelValue }"
              @click="pick(opt.value)"
            >
              <div class="ms-opt-text">
                <span class="ms-opt-label">{{ opt.label }}</span>
                <span v-if="opt.sub" class="ms-opt-sub">{{ opt.sub }}</span>
              </div>
              <div class="ms-opt-right">
                <span v-if="opt.badge" class="ms-opt-badge">{{ opt.badge }}</span>
                <span class="ms-check" :class="{ on: opt.value === modelValue }" aria-hidden="true">
                  <svg v-if="opt.value === modelValue" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3.5 8.5l3 3 6-6.5" />
                  </svg>
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

export interface MobileSelectOption {
  value: string;
  label: string;
  sub?: string;
  badge?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: MobileSelectOption[];
    title?: string;
    placeholder?: string;
    clearable?: boolean;
    disabled?: boolean;
  }>(),
  {
    title: '',
    placeholder: '请选择',
    clearable: false,
    disabled: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'change', value: string): void;
}>();

const open = ref(false);

const selectedOption = computed(() => props.options.find((o) => o.value === props.modelValue) || null);

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeSheet();
}

function openSheet() {
  if (props.disabled) return;
  open.value = true;
  window.addEventListener('keydown', onKeyDown);
}

function closeSheet() {
  open.value = false;
  window.removeEventListener('keydown', onKeyDown);
}

function pick(val: string) {
  const changed = val !== props.modelValue;
  emit('update:modelValue', val);
  if (changed) emit('change', val);
  closeSheet();
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<style scoped>
.ms-trigger {
  width: 100%;
  min-height: 44px;
  padding: 9px 12px;
  background: #ffffff;
  border: 1px solid var(--m-line-strong, #d5d9e0);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  font-family: inherit;
  font-size: 14px;
  color: var(--m-ink, #111827);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ms-trigger:active {
  background: #f9fafb;
  border-color: #111827;
}
.ms-trigger.placeholder .ms-val-main {
  color: var(--m-muted, #9ca3af);
}
.ms-trigger.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.ms-val {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ms-val-main {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ms-val-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: #374151;
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-variant-numeric: tabular-nums;
}
.ms-caret {
  width: 17px;
  height: 17px;
  color: #6b7280;
  flex-shrink: 0;
}

.ms-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(15, 23, 42, 0.48);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.ms-panel {
  width: 100%;
  max-width: 480px;
  background: #ffffff;
  border-radius: 20px 20px 0 0;
  box-shadow: 0 -12px 40px rgba(15, 23, 42, 0.18);
  padding: 10px 14px max(18px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  max-height: 76dvh;
}
.ms-handle {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: #e5e7eb;
  margin: 0 auto 10px;
  flex-shrink: 0;
}
.ms-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 2px 4px 12px;
  border-bottom: 1px solid #f1f3f6;
  flex-shrink: 0;
}
.ms-title {
  font-size: 15.5px;
  font-weight: 600;
  color: #111827;
  letter-spacing: -0.01em;
}
.ms-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ms-clear {
  border: 0;
  background: transparent;
  color: #6b7280;
  font-size: 13px;
  font-weight: 500;
  padding: 4px 8px;
  cursor: pointer;
  font-family: inherit;
}
.ms-close {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: #f3f4f6;
  color: #4b5563;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.ms-close svg {
  width: 15px;
  height: 15px;
}
.ms-list {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 0 2px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ms-empty {
  text-align: center;
  padding: 28px 12px;
  font-size: 13px;
  color: #9ca3af;
}
.ms-opt {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 12px;
  padding: 13px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.14s ease, border-color 0.14s ease;
}
.ms-opt:active {
  background: #f3f4f6;
}
.ms-opt.active {
  background: #f5f6f8;
  border-color: #e5e7eb;
}
.ms-opt-text {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ms-opt-label {
  font-size: 14.5px;
  font-weight: 500;
  color: #1f2937;
  line-height: 1.4;
}
.ms-opt.active .ms-opt-label {
  color: #111827;
  font-weight: 600;
}
.ms-opt-sub {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.35;
}
.ms-opt-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.ms-opt-badge {
  font-size: 12px;
  font-weight: 600;
  color: #4b5563;
  background: #f3f4f6;
  padding: 3px 8px;
  border-radius: 6px;
  font-variant-numeric: tabular-nums;
}
.ms-opt.active .ms-opt-badge {
  background: #111827;
  color: #ffffff;
}
.ms-check {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  border: 1.6px solid #d1d5db;
  background: #ffffff;
  display: grid;
  place-items: center;
  color: #ffffff;
  flex-shrink: 0;
}
.ms-check.on {
  border-color: #111827;
  background: #111827;
}
.ms-check svg {
  width: 12px;
  height: 12px;
}

/* Smooth slide-up transition */
.ms-sheet-enter-active,
.ms-sheet-leave-active {
  transition: opacity 0.2s ease;
}
.ms-sheet-enter-active .ms-panel,
.ms-sheet-leave-active .ms-panel {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.ms-sheet-enter-from,
.ms-sheet-leave-to {
  opacity: 0;
}
.ms-sheet-enter-from .ms-panel,
.ms-sheet-leave-to .ms-panel {
  transform: translateY(100%);
}
</style>
