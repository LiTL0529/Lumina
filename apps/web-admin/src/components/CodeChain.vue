<template>
  <div class="code-chain" :class="{ compact }">
    <div
      v-for="(stage, i) in stages"
      :key="stage.key || i"
      class="chain-node"
      :class="[stage.state || 'idle']"
    >
      <div class="chain-track">
        <span class="chain-line left" v-if="i > 0" />
        <span class="chain-dot" />
        <span class="chain-line right" v-if="i < stages.length - 1" />
      </div>
      <div class="chain-label">{{ stage.label }}</div>
      <div v-if="stage.value" class="chain-value">{{ stage.value }}</div>
      <div v-if="stage.note" class="chain-note">{{ stage.note }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    stages: Array<{
      key?: string;
      label: string;
      value?: string | number;
      note?: string;
      state?: 'done' | 'active' | 'idle' | 'alert';
    }>;
    compact?: boolean;
  }>(),
  { compact: false },
);
</script>

<style scoped>
.code-chain {
  display: flex;
  width: 100%;
  align-items: flex-start;
}

.chain-node {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
  position: relative;
  padding: 0 4px;
}

.chain-track {
  position: relative;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chain-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--surface);
  border: 1.5px solid var(--line-strong);
  z-index: 2;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.chain-line {
  position: absolute;
  top: 50%;
  height: 1px;
  width: 50%;
  background-image: linear-gradient(to right, var(--line-strong) 0 4px, transparent 4px 8px);
  background-size: 8px 1px;
  background-repeat: repeat-x;
}
.chain-line.left {
  left: 0;
}
.chain-line.right {
  right: 0;
}

.chain-label {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--ink-3);
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chain-value {
  font-family: var(--font-num);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: 19px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.25;
  margin-top: 3px;
  letter-spacing: -0.01em;
}

.chain-note {
  font-size: 10.5px;
  color: var(--ink-3);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chain-node.done .chain-dot {
  background: var(--brand);
  border-color: var(--brand);
}
.chain-node.done .chain-line {
  background-image: linear-gradient(to right, var(--brand-line) 0 4px, transparent 4px 8px);
  background-size: 8px 1px;
}

.chain-node.active .chain-dot {
  background: var(--brand);
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-tint);
}
.chain-node.active .chain-label {
  color: var(--brand-ink);
  font-weight: 600;
}

.chain-node.alert .chain-dot {
  background: var(--seal);
  border-color: var(--seal);
  box-shadow: 0 0 0 3px var(--seal-tint);
}
.chain-node.alert .chain-value {
  color: var(--seal);
}

.compact .chain-value {
  font-size: 14px;
}
.compact .chain-label {
  font-size: 11px;
}
.compact .chain-track {
  height: 14px;
}

@media (max-width: 640px) {
  .code-chain {
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .chain-node {
    min-width: 88px;
  }
}
</style>
