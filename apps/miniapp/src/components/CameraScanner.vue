<template>
  <div class="cam-box">
    <!-- Native Android: tapping「扫码」auto-opens full-screen continuous CameraX scanner; this compact bar is shown after returning -->
    <template v-if="useNativeScanner">
      <div class="native-bar" :class="{ warn: !!errorMsg }">
        <div class="nb-status">
          <span class="nb-dot" />
          <span class="nb-text">
            {{
              starting
                ? '正在请求相机权限并打开连扫…'
                : errorMsg || '默认连扫 · 识别到产品弹窗确认后加入清单 · 自动去重'
            }}
          </span>
        </div>
        <div class="cam-tools">
          <button
            type="button"
            class="ct-btn primary"
            :disabled="starting || decodingImage"
            @click="startNativeScanner(true)"
          >
            {{ starting ? '正在打开…' : errorMsg ? '重新请求权限' : '继续连扫' }}
          </button>
          <button
            type="button"
            class="ct-btn"
            :disabled="starting || decodingImage"
            @click="pickNativeImage"
          >
            {{ decodingImage ? '正在识别…' : '相册识别' }}
          </button>
        </div>
      </div>
    </template>

    <!-- Web / Mobile H5 Fallback Scanner -->
    <template v-else>
      <div class="cam-stage" :class="{ active: running }">
        <div :id="readerId" class="cam-reader" />
        <div :id="fileReaderId" class="hidden-file-reader" aria-hidden="true" />
        <div v-if="!running" class="cam-placeholder">
          <div class="cp-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
              <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
              <line x1="7" y1="12" x2="17" y2="12" />
            </svg>
          </div>
          <div class="cp-title">{{ starting ? '正在请求摄像头权限…' : errorMsg ? '摄像头暂不可用' : '连扫已暂停' }}</div>
          <div class="cp-sub">
            {{ errorMsg || '默认连扫模式 · 识别到产品后跳出确认提示 · 自动去重' }}
          </div>
          <button type="button" class="m-btn m-btn-primary cp-btn" :disabled="starting" @click="startCamera">
            {{ starting ? '正在请求权限…' : '继续连扫' }}
          </button>
        </div>
        <div v-if="running" class="cam-overlay">
          <div class="scan-frame">
            <span class="c tl" /><span class="c tr" /><span class="c bl" /><span class="c br" />
            <div class="scan-beam" />
          </div>
          <div class="cam-tip">
            {{ paused ? '已识别产品，请在提示框中确认是否加入清单' : '连扫中 · 将二维码置于画面内，识别后自动弹窗确认' }}
          </div>
        </div>
      </div>

      <div class="cam-tools">
        <button v-if="running" type="button" class="ct-btn" @click="stopCamera">暂停连扫</button>
        <button v-else type="button" class="ct-btn primary" :disabled="starting" @click="startCamera">继续连扫</button>
        <button v-if="running && canFlip" type="button" class="ct-btn" @click="flipCamera">切换镜头</button>
        <button v-if="running && torchSupported" type="button" class="ct-btn" :class="{ on: torchOn }" @click="toggleTorch">
          {{ torchOn ? '关闪光灯' : '开闪光灯' }}
        </button>
        <label class="ct-btn file-btn" :class="{ disabled: decodingImage }">
          {{ decodingImage ? '正在识别…' : '相册识别' }}
          <input ref="fileInputRef" type="file" accept="image/*" hidden :disabled="decodingImage" @change="onPickImage" />
        </label>
      </div>
    </template>

    <div class="cam-manual">
      <input
        ref="manualInputRef"
        v-model="manualInput"
        class="m-input cm-input mono"
        placeholder="输入或粘贴防伪码 / 二维码链接"
        autocomplete="off"
        @keyup.enter="submitManual"
      />
      <button type="button" class="cm-btn" @click="submitManual">录入</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PluginListenerHandle } from '@capacitor/core';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  isNativeAndroidScanner,
  LuminaScanner,
  type NativeScanOpenOptions,
} from '../utils/nativeScanner';

export interface DecodedMeta {
  preConfirmed?: boolean;
  source?: 'camera' | 'gallery' | 'manual' | 'continuous';
}

const props = withDefaults(
  defineProps<{
    autoStart?: boolean;
    focusManual?: boolean;
    defaultContinuous?: boolean;
    debounceMs?: number;
    paused?: boolean;
    nativeOptions?: NativeScanOpenOptions;
  }>(),
  {
    autoStart: true,
    focusManual: false,
    defaultContinuous: true,
    debounceMs: 1500,
    paused: false,
  },
);

const emit = defineEmits<{
  (e: 'decoded', rawText: string, meta?: DecodedMeta): void;
  (e: 'batch-done', confirmedCodes: string[]): void;
  (e: 'open-manual'): void;
  (e: 'error', msg: string): void;
}>();

const useNativeScanner = isNativeAndroidScanner();
const uid = Math.random().toString(36).slice(2, 9);
const readerId = `lumina-cam-${uid}`;
const fileReaderId = `lumina-file-${uid}`;

const running = ref(false);
const starting = ref(false);
const decodingImage = ref(false);
const errorMsg = ref('');
const manualInput = ref('');
const manualInputRef = ref<HTMLInputElement | null>(null);
const torchSupported = ref(false);
const torchOn = ref(false);
const canFlip = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

let qrInstance: Html5Qrcode | null = null;
let cameraIds: string[] = [];
let cameraIndex = -1;
let lastCode = '';
let lastCodeAt = 0;
let nextScanAllowedAt = 0;
let nativeListener: PluginListenerHandle | null = null;

watch(
  () => props.paused,
  (nowPaused, prevPaused) => {
    // Add a 1.5s breathing interval after closing a confirmation dialog in H5 continuous mode
    if (prevPaused && !nowPaused) {
      nextScanAllowedAt = Date.now() + 1500;
    }
  },
);

function focusManualInput() {
  nextTick(() => {
    manualInputRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    manualInputRef.value?.focus();
  });
}

const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
];

function handleDecode(rawText: string, meta: DecodedMeta = {}, bypassDebounce = false) {
  const clean = String(rawText || '').trim();
  if (!clean) return;
  if (!bypassDebounce && props.paused) return;
  const now = Date.now();
  if (!bypassDebounce && now < nextScanAllowedAt) {
    return;
  }
  if (!bypassDebounce && clean === lastCode && now - lastCodeAt < props.debounceMs) {
    return;
  }
  lastCode = clean;
  lastCodeAt = now;
  emit('decoded', clean, meta);
}

// ============================================================================
// 1. Native Android CameraX (1.0x) + Bundled Offline ML Kit + ZXing Path
// ============================================================================
async function startNativeScanner(continuous = props.defaultContinuous) {
  if (starting.value || decodingImage.value) return;
  errorMsg.value = '';
  starting.value = true;
  try {
    if (nativeListener) {
      await nativeListener.remove().catch(() => {});
      nativeListener = null;
    }
    nativeListener = await LuminaScanner.addListener('scanResult', (ev) => {
      if (ev?.text) {
        handleDecode(ev.text, { preConfirmed: true, source: 'continuous' }, true);
      }
    });

    const opts = props.nativeOptions || {};
    const res = await LuminaScanner.openScanner({
      ...opts,
      continuous,
      confirmBeforeAdd: opts.confirmBeforeAdd !== false,
      title: opts.title || (continuous ? '扫码识别' : 'Lumina 扫码识别'),
      hint: opts.hint || '对准产品二维码或条形码',
    });

    if (!res?.cancelled) {
      if (Array.isArray(res?.confirmedCodes) && res.confirmedCodes.length) {
        emit('batch-done', res.confirmedCodes);
      } else if (res?.text) {
        handleDecode(res.text, { preConfirmed: true, source: res.source || 'camera' }, true);
      }
    }
    if (res?.openManual) {
      emit('open-manual');
      focusManualInput();
    }
  } catch (err: any) {
    const msg = String(err?.message || err || '无法启动原生摄像头，请允许相机权限或使用「相册识别」');
    errorMsg.value = msg;
    emit('error', msg);
  } finally {
    starting.value = false;
    if (nativeListener) {
      await nativeListener.remove().catch(() => {});
      nativeListener = null;
    }
  }
}

async function pickNativeImage() {
  if (decodingImage.value || starting.value) return;
  errorMsg.value = '';
  decodingImage.value = true;
  try {
    const res = await LuminaScanner.pickAndDecodeImage();
    if (!res?.cancelled && res?.text) {
      handleDecode(res.text, { preConfirmed: false, source: 'gallery' }, true);
    }
  } catch (err: any) {
    const msg = String(err?.message || err || '未在该图片中识别到清晰的二维码或条形码，请换一张清晰图片');
    emit('error', msg);
  } finally {
    decodingImage.value = false;
  }
}

// ============================================================================
// 2. Web / H5 Fallback Path (Default Continuous + Confirmation Pause)
// ============================================================================
let isUnmounted = false;

function handleBenignPlayAbort(ev: PromiseRejectionEvent) {
  const reason: any = ev?.reason;
  const msg = String(reason?.message || reason || '');
  if (reason?.name === 'AbortError' || /play\(\) request was interrupted|removed from the document/i.test(msg)) {
    ev.preventDefault();
  }
}

function ensureInstance() {
  if (!qrInstance) {
    qrInstance = new Html5Qrcode(readerId, {
      verbose: false,
      formatsToSupport: SUPPORTED_FORMATS,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true,
      },
    } as any);
  }
  return qrInstance;
}

async function startCamera() {
  if (useNativeScanner) {
    return startNativeScanner(props.defaultContinuous);
  }
  if (running.value || starting.value) return;
  errorMsg.value = '';
  starting.value = true;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前环境不支持摄像头访问，请使用相册识别或手工录入');
    }
    const inst = ensureInstance();

    if (!cameraIds.length) {
      try {
        const devices = await Html5Qrcode.getCameras();
        if (devices.length) {
          cameraIds = devices.map((d) => d.id);
          canFlip.value = devices.length > 1;
        }
      } catch {
        // ignore enumeration issues
      }
    }

    const cameraConfig =
      cameraIndex >= 0 && cameraIds.length
        ? cameraIds[cameraIndex % cameraIds.length]
        : { facingMode: { ideal: 'environment' } };

    await inst.start(
      cameraConfig as any,
      {
        fps: 12,
        videoConstraints: {
          ...(cameraIndex >= 0 && cameraIds.length
            ? { deviceId: { exact: cameraIds[cameraIndex % cameraIds.length] } }
            : { facingMode: { ideal: 'environment' } }),
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      } as any,
      (decodedText) => handleDecode(decodedText, { preConfirmed: false, source: 'camera' }),
      () => {},
    );

    if (isUnmounted) {
      await stopCamera();
      return;
    }
    running.value = true;
    torchOn.value = false;

    try {
      const caps = (inst as any).getRunningTrackCapabilities?.();
      torchSupported.value = Boolean(caps?.torch);
      const advanced: Record<string, any> = {};
      if (caps?.zoom && typeof caps.zoom.min === 'number') {
        advanced.zoom = Math.max(caps.zoom.min, Math.min(1, caps.zoom.max ?? 1));
      }
      if (Array.isArray(caps?.focusMode) && caps.focusMode.includes('continuous')) {
        advanced.focusMode = 'continuous';
      }
      if (Object.keys(advanced).length) {
        await (inst as any).applyVideoConstraints({ advanced: [advanced] });
      }
    } catch {
      torchSupported.value = false;
    }
  } catch (err: any) {
    const raw = String(err?.message || err || '');
    if (isUnmounted || err?.name === 'AbortError' || /play\(\) request was interrupted|removed from the document/i.test(raw)) {
      return;
    }
    errorMsg.value = /Permission|NotAllowed/i.test(raw)
      ? '摄像头权限被拒绝，请在系统/浏览器设置允许相机访问，或使用下方「相册识别」与手工录入'
      : raw || '无法启动摄像头，请改用「相册识别」或手工录入';
    emit('error', errorMsg.value);
  } finally {
    starting.value = false;
  }
}

async function stopCamera() {
  if (useNativeScanner || !qrInstance || !running.value) return;
  try {
    await qrInstance.stop();
  } catch {
    // ignore stop errors
  } finally {
    running.value = false;
    torchOn.value = false;
    torchSupported.value = false;
  }
}

async function flipCamera() {
  if (!cameraIds.length) return;
  await stopCamera();
  cameraIndex = cameraIndex < 0 ? 0 : (cameraIndex + 1) % cameraIds.length;
  await startCamera();
}

async function toggleTorch() {
  if (!qrInstance || !running.value || !torchSupported.value) return;
  try {
    const next = !torchOn.value;
    await (qrInstance as any).applyVideoConstraints({
      advanced: [{ torch: next }],
    });
    torchOn.value = next;
  } catch {
    torchSupported.value = false;
  }
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderVariantCanvas(
  img: HTMLImageElement,
  maxDim: number,
  cropRatio = 1,
  invert = false,
): HTMLCanvasElement {
  const sw = Math.round(img.naturalWidth * cropRatio);
  const sh = Math.round(img.naturalHeight * cropRatio);
  const sx = Math.round((img.naturalWidth - sw) / 2);
  const sy = Math.round((img.naturalHeight - sh) / 2);

  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const pad = Math.max(36, Math.round(Math.min(dw, dh) * 0.08));

  const canvas = document.createElement('canvas');
  canvas.width = dw + pad * 2;
  canvas.height = dh + pad * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (invert) {
    ctx.filter = 'invert(1)';
  }
  ctx.drawImage(img, sx, sy, sw, sh, pad, pad, dw, dh);
  return canvas;
}

async function canvasToPngFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
  return new File([blob], name, { type: 'image/png' });
}

async function decodeImageFileMultiPass(file: File): Promise<string> {
  const img = await loadImageElement(file);
  const variants: HTMLCanvasElement[] = [
    renderVariantCanvas(img, 1600, 1, false),
    renderVariantCanvas(img, 960, 1, false),
    renderVariantCanvas(img, 1200, 0.72, false),
    renderVariantCanvas(img, 1000, 1, true),
  ];

  const NativeDetector = (window as any).BarcodeDetector;
  if (typeof NativeDetector === 'function') {
    try {
      const detector = new NativeDetector({
        formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'data_matrix'],
      });
      for (const canvas of variants) {
        const found = await detector.detect(canvas);
        if (found?.length && found[0]?.rawValue) {
          return String(found[0].rawValue).trim();
        }
      }
    } catch {
      // fall through to Html5Qrcode
    }
  }

  const fileInst = new Html5Qrcode(fileReaderId, {
    verbose: false,
    formatsToSupport: SUPPORTED_FORMATS,
  });
  try {
    for (let i = 0; i < variants.length; i++) {
      try {
        const png = await canvasToPngFile(variants[i], `scan_${i}.png`);
        const decoded = await fileInst.scanFile(png, false);
        if (decoded && decoded.trim()) {
          return decoded.trim();
        }
      } catch {
        // try next variant
      }
    }
    const rawDecoded = await fileInst.scanFile(file, false);
    if (rawDecoded && rawDecoded.trim()) {
      return rawDecoded.trim();
    }
  } finally {
    try {
      fileInst.clear();
    } catch {
      // ignore
    }
  }
  throw new Error('decode_failed');
}

async function onPickImage(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  decodingImage.value = true;
  const wasRunning = running.value;
  if (wasRunning) await stopCamera();
  try {
    const decoded = await decodeImageFileMultiPass(file);
    handleDecode(decoded, { preConfirmed: false, source: 'gallery' }, true);
  } catch {
    emit('error', '未在该图片中识别到清晰的二维码或条形码，请换一张更清晰的图片');
  } finally {
    decodingImage.value = false;
    if (fileInputRef.value) fileInputRef.value.value = '';
    if (wasRunning) startCamera();
  }
}

function submitManual() {
  const val = manualInput.value.trim();
  if (!val) return;
  handleDecode(val, { preConfirmed: false, source: 'manual' }, true);
  manualInput.value = '';
}

onMounted(() => {
  isUnmounted = false;
  window.addEventListener('unhandledrejection', handleBenignPlayAbort);
  if (props.focusManual) {
    focusManualInput();
  } else if (props.autoStart) {
    startCamera();
  }
});

onBeforeUnmount(() => {
  isUnmounted = true;
  if (nativeListener) {
    nativeListener.remove().catch(() => {});
    nativeListener = null;
  }
  try {
    const host = document.getElementById(readerId);
    const videos = host ? Array.from(host.querySelectorAll('video')) : [];
    for (const v of videos) {
      try {
        v.pause();
        const stream = v.srcObject as MediaStream | null;
        stream?.getTracks().forEach((t) => t.stop());
        v.srcObject = null;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  stopCamera()
    .catch(() => {})
    .finally(() => {
      try {
        qrInstance?.clear();
      } catch {
        // ignore
      }
      setTimeout(() => {
        window.removeEventListener('unhandledrejection', handleBenignPlayAbort);
      }, 300);
    });
});

defineExpose({ startCamera, stopCamera, startNativeScanner, focusManualInput });
</script>

<style scoped>
.cam-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.native-bar {
  background: #ffffff;
  border: 1px solid var(--m-line);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nb-status {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--m-sub);
}
.nb-dot {
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--m-success, #059669);
  flex-shrink: 0;
}
.native-bar.warn .nb-dot {
  background: var(--m-seal, #dc2626);
}
.native-bar.warn .nb-text {
  color: var(--m-seal, #dc2626);
}
.native-bar .cam-tools .ct-btn {
  flex: 1;
  justify-content: center;
  min-height: 40px;
}
.cam-stage {
  position: relative;
  width: 100%;
  min-height: 196px;
  border-radius: 10px;
  overflow: hidden;
  background: #111827;
  border: 1px solid #1f2937;
}
.cam-stage.active {
  min-height: 280px;
}
.cam-reader {
  width: 100%;
}
.cam-reader :deep(video) {
  width: 100% !important;
  height: auto !important;
  max-height: 390px !important;
  object-fit: contain !important;
  background: #111827;
  display: block;
}
.cam-reader :deep(#qr-shaded-region) {
  display: none !important;
}
.hidden-file-reader {
  display: none;
}
.cam-placeholder {
  min-height: 192px;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #f9fafb;
}
.cp-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #ffffff;
  display: grid;
  place-items: center;
}
.cp-icon svg {
  width: 21px;
  height: 21px;
}
.cp-title {
  margin-top: 10px;
  font-size: 14.5px;
  font-weight: 600;
}
.cp-sub {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.5;
  color: #9ca3af;
  max-width: 280px;
}
.native-actions {
  margin-top: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cp-btn {
  margin-top: 14px;
  width: auto;
  min-height: 40px;
  padding: 9px 18px;
  font-size: 13px;
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
  border-color: #ffffff;
}
.native-actions .cp-btn {
  margin-top: 0;
}
.cp-btn-sub {
  width: auto;
  min-height: 40px;
  padding: 9px 16px;
  font-size: 13px;
  border-radius: 8px;
  background: transparent;
  color: #f9fafb;
  border: 1px solid rgba(255, 255, 255, 0.28);
}
.cam-overlay {
  pointer-events: none;
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.28);
}
.scan-frame {
  position: relative;
  width: 176px;
  height: 176px;
}
.scan-frame .c {
  position: absolute;
  width: 18px;
  height: 18px;
  border-color: #ffffff;
  border-style: solid;
}
.scan-frame .tl { top: 0; left: 0; border-width: 2.5px 0 0 2.5px; border-radius: 4px 0 0 0; }
.scan-frame .tr { top: 0; right: 0; border-width: 2.5px 2.5px 0 0; border-radius: 0 4px 0 0; }
.scan-frame .bl { bottom: 0; left: 0; border-width: 0 0 2.5px 2.5px; border-radius: 0 0 0 4px; }
.scan-frame .br { bottom: 0; right: 0; border-width: 0 2.5px 2.5px 0; border-radius: 0 0 4px 0; }
.scan-beam {
  position: absolute;
  left: 6px;
  right: 6px;
  height: 1.5px;
  background: rgba(255, 255, 255, 0.9);
  animation: scan-sweep 2.2s ease-in-out infinite;
}
@keyframes scan-sweep {
  0%, 100% { top: 10px; opacity: 0.65; }
  50% { top: calc(100% - 12px); opacity: 1; }
}
.cam-tip {
  margin-top: 12px;
  font-size: 11.5px;
  color: #f9fafb;
  background: rgba(17, 24, 39, 0.78);
  padding: 4px 12px;
  border-radius: 6px;
}
.cam-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ct-btn {
  border: 1px solid var(--m-line-strong);
  background: #ffffff;
  color: var(--m-sub);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
}
.ct-btn:disabled,
.ct-btn.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.ct-btn.primary {
  background: #111827;
  border-color: #111827;
  color: #ffffff;
}
.ct-btn.on {
  background: var(--m-gold-soft);
  border-color: var(--m-gold-line);
  color: var(--m-gold);
}
.cam-manual {
  display: flex;
  gap: 8px;
}
.cm-input {
  flex: 1;
  min-width: 0;
  min-height: 42px;
  padding: 9px 12px;
  font-size: 13px;
}
.cm-btn {
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
  flex-shrink: 0;
}
</style>
