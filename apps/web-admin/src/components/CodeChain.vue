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
      <div class="chain-card-inner">
        <div class="chain-label">{{ stage.label }}</div>
        <div
          v-if="stage.value !== undefined && stage.value !== null && stage.value !== ''"
          class="chain-value"
        >
          {{ stage.value }}
        </div>
        <div v-if="stage.note" class="chain-note">{{ stage.note }}</div>
      </div>
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
  align-items: stretch;
  gap: 0;
}

.chain-node {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
  position: relative;
  display: flex;
  flex-direction: column;
}

.chain-track {
  position: relative;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}

.chain-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--line-strong);
  z-index: 2;
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.chain-line {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  height: 2px;
  width: 50%;
  background: var(--line);
}
.chain-line.left {
  left: 0;
}
.chain-line.right {
  right: 0;
}

.chain-card-inner {
  margin: 0 5px;
  padding: 11px 10px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  flex: 1;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.chain-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-2);
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chain-value {
  font-family: var(--font-ui);
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
  font-size: 20px;
  font-weight: 700;
  color: var(--ink);
  line-height: 1.25;
  margin-top: 4px;
  letter-spacing: -0.02em;
}

.chain-note {
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chain-node.done .chain-dot {
  background: var(--brand);
  border-color: var(--brand);
}
.chain-node.done .chain-line {
  background: var(--brand-line);
}

.chain-node.active .chain-dot {
  background: var(--brand);
  border-color: var(--brand);
  box-shadow: 0 0 0 5px rgba(13, 148, 136, 0.16);
}
.chain-node.active .chain-line.left {
  background: var(--brand-line);
}
.chain-node.active .chain-card-inner {
  background: var(--brand-tint);
  border-color: var(--brand-line);
}
.chain-node.active .chain-label {
  color: var(--brand-ink);
  font-weight: 600;
}
.chain-node.active .chain-value {
  color: var(--brand-ink);
}

.chain-node.alert .chain-dot {
  background: var(--seal);
  border-color: var(--seal);
  box-shadow: 0 0 0 5px rgba(225, 29, 72, 0.15);
}
.chain-node.alert .chain-card-inner {
  background: var(--seal-tint);
  border-color: var(--seal-line);
}
.chain-node.alert .chain-value {
  color: var(--seal);
}

.compact .chain-card-inner {
  margin: 0 3px;
  padding: 7px 6px;
}
.compact .chain-value {
  font-size: 14.5px;
}
.compact .chain-label {
  font-size: 11px;
}
.compact .chain-track {
  height: 16px;
  margin-bottom: 6px;
}

@media (max-width: 640px) {
  .code-chain {
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .chain-node {
    min-width: 108px;
  }
}
</style>
