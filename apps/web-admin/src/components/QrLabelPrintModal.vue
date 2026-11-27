<template>
  <el-dialog
    :model-value="modelValue"
    :title="dialogTitle"
    width="min(980px, 95vw)"
    top="3vh"
    destroy-on-close
    class="qr-print-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="qp-toolbar">
      <div class="qp-controls">
        <div class="qp-field">
          <span class="qp-label">纸张版式</span>
          <el-select v-model="layoutMode" size="small" style="width: 190px">
            <el-option label="A4 贴纸网格 3×7（默认）" value="a4-3x7" />
            <el-option label="A4 紧凑网格 4×8（32/页）" value="a4-4x8" />
            <el-option label="热敏不干胶 40×30mm" value="thermal-40x30" />
            <el-option label="热敏外箱标 60×40mm" value="thermal-60x40" />
          </el-select>
        </div>

        <div class="qp-field">
          <span class="qp-label">码层级</span>
          <div class="mini-seg">
            <button type="button" :class="{ on: levelFilter === 'ALL' }" @click="levelFilter = 'ALL'">
              全部 {{ counts.all }}
            </button>
            <button type="button" :class="{ on: levelFilter === 'CARTON' }" @click="levelFilter = 'CARTON'">
              外箱 {{ counts.carton }}
            </button>
            <button type="button" :class="{ on: levelFilter === 'UNIT' }" @click="levelFilter = 'UNIT'">
              单盒 {{ counts.unit }}
            </button>
          </div>
        </div>

        <div v-if="filteredCodes.length > pageSize" class="qp-field">
          <span class="qp-label">分批打印</span>
          <el-select v-model="sliceIndex" size="small" style="width: 136px">
            <el-option
              v-for="s in sliceOptions"
              :key="s.index"
              :label="s.label"
              :value="s.index"
            />
          </el-select>
        </div>
      </div>

      <div class="qp-actions">
        <el-button size="small" :loading="zipping" :disabled="!renderedLabels.length" @click="downloadZip">
          下载高清 PNG 包 (ZIP)
        </el-button>
        <el-button size="small" type="primary" :loading="generating" :disabled="!renderedLabels.length" @click="printLabels">
          打印 / 导出 PDF（{{ renderedLabels.length }} 枚）
        </el-button>
      </div>
    </div>

    <div class="qp-meta">
      <span>商品：<strong>{{ productName || '批次商品' }}</strong></span>
      <span v-if="skuCode" class="mono">{{ skuCode }}</span>
      <span v-if="batchNo" class="mono">批次 {{ batchNo }}</span>
      <span>编码指向：<code class="mono">{{ verifyBaseUrl }}/&lt;防伪码&gt;</code></span>
    </div>

    <div v-if="generating" class="qp-loading">正在生成高清防伪二维码标签（{{ renderedLabels.length }}/{{ slicedCodes.length }}）…</div>

    <div v-else-if="!renderedLabels.length" class="qp-empty">当前筛选下没有可打印的二维码</div>

    <div v-else class="qp-preview-scroll">
      <div class="qp-grid" :class="`mode-${layoutMode}`">
        <article
          v-for="item in renderedLabels"
          :key="item.codeToken"
          class="label-card"
          :class="item.codeLevel === 'CARTON' ? 'is-carton' : 'is-unit'"
        >
          <div class="lc-head">
            <span class="lc-badge">
              {{ item.codeLevel === 'CARTON' ? `外箱码 · ${cartonQty || 6}盒/箱` : '单品盒码' }}
            </span>
            <button
              type="button"
              class="lc-dl"
              title="下载单张高清 PNG 标签"
              @click="downloadSinglePng(item)"
            >
              PNG
            </button>
          </div>
          <div class="lc-body">
            <img :src="item.qrDataUrl" :alt="item.codeToken" class="lc-qr" />
            <div class="lc-info">
              <div class="lc-prod">{{ productName || 'Lumina 正品溯源' }}</div>
              <div class="lc-token mono">{{ formatCodeGroups(item.codeToken) }}</div>
              <div class="lc-sub mono">
                <span v-if="batchNo">批号 {{ batchNo }}</span>
                <span v-if="item.parentToken">箱 {{ item.parentToken.slice(-6) }}</span>
              </div>
              <div class="lc-tip">微信扫码验真 · 一物一码</div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import QRCode from 'qrcode';
import { ElMessage } from 'element-plus';
import { formatCodeGroups } from '../utils/format';
import { APP_BASE } from '../utils/api';

export interface PrintableTraceCode {
  codeToken: string;
  codeLevel: string;
  parentToken?: string | null;
  status?: string;
}

interface RenderedLabel extends PrintableTraceCode {
  verifyUrl: string;
  qrDataUrl: string;
}

const props = defineProps<{
  modelValue: boolean;
  title?: string;
  batchNo?: string;
  productName?: string;
  skuCode?: string;
  cartonQty?: number;
  codes: PrintableTraceCode[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
}>();

const layoutMode = ref<'a4-3x7' | 'a4-4x8' | 'thermal-40x30' | 'thermal-60x40'>('a4-3x7');
const levelFilter = ref<'ALL' | 'CARTON' | 'UNIT'>('ALL');
const sliceIndex = ref(0);
const pageSize = 84; // 4 pages of A4 3x7 per batch so rendering stays instant
const generating = ref(false);
const zipping = ref(false);
const renderedLabels = ref<RenderedLabel[]>([]);

const verifyBaseUrl = computed(() => {
  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:5174${APP_BASE}/v`;
  }
  return `${window.location.origin}${APP_BASE}/v`;
});

const dialogTitle = computed(() => props.title || `批量生成与打印防伪二维码标签${props.batchNo ? ` · ${props.batchNo}` : ''}`);

const counts = computed(() => {
  const all = props.codes || [];
  let carton = 0;
  let unit = 0;
  for (const c of all) {
    if (c.codeLevel === 'CARTON') carton++;
    else unit++;
  }
  return { all: all.length, carton, unit };
});

const filteredCodes = computed(() => {
  const all = props.codes || [];
  if (levelFilter.value === 'ALL') return all;
  return all.filter((c) => c.codeLevel === levelFilter.value);
});

const sliceOptions = computed(() => {
  const total = filteredCodes.value.length;
  const opts: Array<{ index: number; label: string }> = [];
  for (let i = 0; i * pageSize < total; i++) {
    const start = i * pageSize + 1;
    const end = Math.min(total, (i + 1) * pageSize);
    opts.push({ index: i, label: `第 ${start}–${end} 枚` });
  }
  return opts;
});

const slicedCodes = computed(() => {
  const start = sliceIndex.value * pageSize;
  return filteredCodes.value.slice(start, start + pageSize);
});

watch(levelFilter, () => {
  sliceIndex.value = 0;
});

async function buildQrImages() {
  if (!props.modelValue) return;
  const list = slicedCodes.value;
  if (!list.length) {
    renderedLabels.value = [];
    return;
  }
  generating.value = true;
  try {
    const out: RenderedLabel[] = [];
    for (const item of list) {
      const verifyUrl = `${verifyBaseUrl.value}/${item.codeToken}`;
      const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#111c1a', light: '#ffffff' },
      });
      out.push({ ...item, verifyUrl, qrDataUrl });
    }
    renderedLabels.value = out;
  } finally {
    generating.value = false;
  }
}

watch(
  () => [props.modelValue, props.codes, levelFilter.value, sliceIndex.value],
  () => {
    if (props.modelValue) buildQrImages();
  },
  { immediate: true },
);

async function renderCompositePngBlob(item: RenderedLabel): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 420;
  canvas.height = 500;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Header strip
  const isCarton = item.codeLevel === 'CARTON';
  ctx.fillStyle = isCarton ? '#14655c' : '#f3f2ed';
  ctx.fillRect(0, 0, canvas.width, 52);

  ctx.fillStyle = isCarton ? '#ffffff' : '#17211f';
  ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    isCarton ? `LUMINA 外箱溯源码（${props.cartonQty || 6}盒/箱）` : 'LUMINA 单品防伪溯源码',
    canvas.width / 2,
    33,
  );

  // QR code image
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = item.qrDataUrl;
  });
  ctx.drawImage(img, 70, 70, 280, 280);

  // Code text & product details
  ctx.fillStyle = '#17211f';
  ctx.font = '600 20px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(formatCodeGroups(item.codeToken), canvas.width / 2, 384);

  ctx.fillStyle = '#33423f';
  ctx.font = '500 17px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  const prodText = (props.productName || 'Lumina 正品溯源').slice(0, 20);
  ctx.fillText(prodText, canvas.width / 2, 418);

  ctx.fillStyle = '#6c7a76';
  ctx.font = '400 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  const metaLine = [props.batchNo ? `批号 ${props.batchNo}` : '', item.parentToken ? `箱 ${item.parentToken.slice(-6)}` : '']
    .filter(Boolean)
    .join(' · ');
  if (metaLine) ctx.fillText(metaLine, canvas.width / 2, 446);

  ctx.fillStyle = '#14655c';
  ctx.font = '500 14px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  ctx.fillText('微信扫码验真伪 · 查官方授权渠道', canvas.width / 2, 476);

  // Subtle border
  ctx.strokeStyle = '#d3cec1';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png');
  });
}

async function downloadSinglePng(item: RenderedLabel) {
  const blob = await renderCompositePngBlob(item);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${item.codeLevel === 'CARTON' ? 'CARTON' : 'UNIT'}_${item.codeToken}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

// Lightweight zero-dependency PKZIP store builder (CRC32 + local/central headers)
function buildUncompressedZip(entries: Array<{ name: string; data: Uint8Array }>): Blob {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + size;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...localParts, ...centralParts, eocd] as BlobPart[], { type: 'application/zip' });
}

async function downloadZip() {
  if (!renderedLabels.value.length) return;
  zipping.value = true;
  try {
    const entries: Array<{ name: string; data: Uint8Array }> = [];
    for (let i = 0; i < renderedLabels.value.length; i++) {
      const item = renderedLabels.value[i];
      const blob = await renderCompositePngBlob(item);
      const buf = new Uint8Array(await blob.arrayBuffer());
      const prefix = item.codeLevel === 'CARTON' ? 'CARTON' : 'UNIT';
      entries.push({ name: `${String(i + 1).padStart(3, '0')}_${prefix}_${item.codeToken}.png`, data: buf });
    }
    const zipBlob = buildUncompressedZip(entries);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${props.batchNo || 'lumina'}_qrcodes_${entries.length}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    ElMessage.success(`已打包下载 ${entries.length} 张高清防伪二维码 PNG`);
  } finally {
    zipping.value = false;
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function printLabels() {
  if (!renderedLabels.value.length) return;
  const isThermal = layoutMode.value.startsWith('thermal-');
  const pageCss =
    layoutMode.value === 'a4-3x7'
      ? `@page { size: A4 portrait; margin: 8mm; } .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }`
      : layoutMode.value === 'a4-4x8'
        ? `@page { size: A4 portrait; margin: 6mm; } .sheet { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; } .lbl { padding: 2.2mm; } .qr { width: 17mm; height: 17mm; } .tok { font-size: 7.5pt; } .prod { font-size: 7.5pt; }`
        : layoutMode.value === 'thermal-40x30'
          ? `@page { size: 40mm 30mm; margin: 0; } .sheet { display: block; } .lbl { width: 40mm; height: 30mm; page-break-after: always; border: none; padding: 1.8mm; } .qr { width: 20mm; height: 20mm; } .prod { font-size: 7.5pt; } .tok { font-size: 7pt; }`
          : `@page { size: 60mm 40mm; margin: 0; } .sheet { display: block; } .lbl { width: 60mm; height: 40mm; page-break-after: always; border: none; padding: 2.5mm; } .qr { width: 27mm; height: 27mm; } .prod { font-size: 9pt; } .tok { font-size: 8.5pt; }`;

  const prodHtml = escapeHtml(props.productName || 'Lumina 正品溯源');
  const batchHtml = escapeHtml(props.batchNo || '');
  const cardsHtml = renderedLabels.value
    .map((item) => {
      const isCarton = item.codeLevel === 'CARTON';
      const badge = isCarton ? `外箱 · ${props.cartonQty || 6}盒/箱` : '单品盒码';
      const parentInfo = item.parentToken ? ` · 箱${escapeHtml(item.parentToken.slice(-6))}` : '';
      return `
        <div class="lbl ${isCarton ? 'carton' : 'unit'}">
          <div class="hd">${badge}</div>
          <div class="bd">
            <img class="qr" src="${item.qrDataUrl}" />
            <div class="inf">
              <div class="prod">${prodHtml}</div>
              <div class="tok">${escapeHtml(formatCodeGroups(item.codeToken))}</div>
              <div class="sub">${batchHtml ? `批号 ${batchHtml}` : ''}${parentInfo}</div>
              <div class="tip">微信扫码验真 · 查授权渠道</div>
            </div>
          </div>
        </div>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>Lumina 防伪二维码标签打印</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: #17211f; }
  ${pageCss}
  .lbl { border: 0.3mm dashed #b8b3a6; border-radius: ${isThermal ? '0' : '2mm'}; padding: 2.8mm; break-inside: avoid; display: flex; flex-direction: column; justify-content: space-between; background: #fff; }
  .lbl.carton { border-color: #14655c; border-style: solid; }
  .hd { font-size: 7.5pt; font-weight: 600; padding: 0.8mm 2mm; border-radius: 1mm; margin-bottom: 1.5mm; background: #f3f2ed; color: #17211f; }
  .lbl.carton .hd { background: #14655c; color: #fff; }
  .bd { display: flex; align-items: center; gap: 2.2mm; flex: 1; }
  .qr { width: 22mm; height: 22mm; flex-shrink: 0; image-rendering: pixelated; }
  .inf { min-width: 0; flex: 1; }
  .prod { font-size: 8.5pt; font-weight: 600; line-height: 1.25; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .tok { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 8pt; font-weight: 600; margin-top: 1.2mm; word-break: break-all; color: #0c453f; }
  .sub { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 6.5pt; color: #6c7a76; margin-top: 0.8mm; }
  .tip { font-size: 6.5pt; color: #14655c; margin-top: 1mm; }
</style></head><body><div class="sheet">${cardsHtml}</div></body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1500);
  }, 260);
}
</script>

<style scoped>
.qp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.qp-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.qp-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.qp-label {
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap;
}
.qp-actions {
  display: inline-flex;
  gap: 8px;
  flex-wrap: wrap;
}
.qp-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.mini-seg {
  display: inline-flex;
  padding: 2px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 6px;
}
.mini-seg button {
  border: 0;
  background: transparent;
  padding: 4px 9px;
  font-size: 12px;
  color: var(--ink-2);
  cursor: pointer;
  border-radius: 4px;
  font-family: inherit;
}
.mini-seg button.on {
  background: var(--surface);
  color: var(--brand-ink);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.qp-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 9px 12px;
  margin: 12px 0;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  font-size: 12px;
  color: var(--ink-2);
}
.qp-loading,
.qp-empty {
  text-align: center;
  padding: 44px 16px;
  color: var(--ink-3);
  font-size: 13px;
}
.qp-preview-scroll {
  max-height: 58vh;
  overflow-y: auto;
  padding: 4px 2px;
}
.qp-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.qp-grid.mode-a4-4x8 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.qp-grid.mode-thermal-40x30,
.qp-grid.mode-thermal-60x40 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.label-card {
  border: 1px dashed var(--line-strong);
  border-radius: 7px;
  background: #fff;
  padding: 8px 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label-card.is-carton {
  border-style: solid;
  border-color: var(--brand-line);
}
.lc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.lc-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--surface-2);
  color: var(--ink-2);
}
.label-card.is-carton .lc-badge {
  background: var(--brand);
  color: #fff;
}
.lc-dl {
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink-2);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10.5px;
  cursor: pointer;
  font-family: var(--font-mono);
}
.lc-dl:hover {
  border-color: var(--brand);
  color: var(--brand);
}
.lc-body {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lc-qr {
  width: 76px;
  height: 76px;
  flex-shrink: 0;
  border-radius: 4px;
  border: 1px solid var(--line);
}
.lc-info {
  min-width: 0;
  flex: 1;
}
.lc-prod {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.lc-token {
  font-size: 11px;
  font-weight: 600;
  color: var(--brand-ink);
  margin-top: 4px;
  word-break: break-all;
}
.lc-sub {
  font-size: 10px;
  color: var(--ink-3);
  margin-top: 2px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.lc-tip {
  font-size: 10px;
  color: var(--brand);
  margin-top: 3px;
}
@media (max-width: 820px) {
  .qp-grid,
  .qp-grid.mode-a4-4x8 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .qp-grid,
  .qp-grid.mode-a4-4x8,
  .qp-grid.mode-thermal-40x30,
  .qp-grid.mode-thermal-60x40 {
    grid-template-columns: 1fr;
  }
}
</style>
