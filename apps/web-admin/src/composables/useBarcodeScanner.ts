import { onMounted, onUnmounted } from 'vue';

/**
 * Plays crisp audio cues for warehouse blind-scanning (no screen watching needed).
 */
export function playScanBeep(type: 'success' | 'error' | 'notify') {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1180, ctx.currentTime);
      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } else if (type === 'notify') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(784, ctx.currentTime);
      osc.frequency.setValueAtTime(1046, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.28);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(240, ctx.currentTime);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.32);
    }
  } catch {
    // Ignore audio policy restrictions before user gesture
  }
}

export function speakWarehouseVoice(text: string) {
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.rate = 1.1;
      window.speechSynthesis.speak(utter);
    }
  } catch {
    // Ignore if unavailable
  }
}

/**
 * Global USB HID barcode scanner listener:
 * Captures high-speed keyboard bursts (< 45ms between keystrokes ending in Enter)
 * even when an input box does not currently have focus.
 */
export function useBarcodeScanner(onScan: (rawCode: string) => void) {
  let buffer = '';
  let lastKeyAt = 0;

  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const isEditable =
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    // If user is typing inside an input/textarea, let the input handle Enter directly
    if (isEditable) return;

    const now = Date.now();
    if (now - lastKeyAt > 60) {
      buffer = '';
    }
    lastKeyAt = now;

    if (e.key === 'Enter') {
      if (buffer.length >= 12) {
        const scanned = buffer.trim();
        buffer = '';
        onScan(scanned);
      } else {
        buffer = '';
      }
      return;
    }

    if (e.key.length === 1) {
      buffer += e.key;
    }
  };

  onMounted(() => window.addEventListener('keydown', handleKeyDown));
  onUnmounted(() => window.removeEventListener('keydown', handleKeyDown));
}
