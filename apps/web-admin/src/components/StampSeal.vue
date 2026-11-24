<template>
  <span class="seal" :class="tone" :style="{ '--seal-rotate': `${rotate}deg` }">
    <span class="seal-inner">{{ text }}</span>
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    text: string;
    tone?: 'seal' | 'brand' | 'neutral';
    rotate?: number;
  }>(),
  { tone: 'seal', rotate: -4 },
);
</script>

<style scoped>
.seal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: 1.5px solid currentColor;
  border-radius: 3px;
  transform: rotate(var(--seal-rotate));
  color: var(--seal);
  user-select: none;
  line-height: 1;
}
.seal-inner {
  display: block;
  padding: 3px 4px;
  border: 1px solid currentColor;
  border-radius: 2px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  writing-mode: horizontal-tb;
  opacity: 0.92;
}
.seal.brand {
  color: var(--brand);
}
.seal.neutral {
  color: var(--ink-3);
}
</style>
