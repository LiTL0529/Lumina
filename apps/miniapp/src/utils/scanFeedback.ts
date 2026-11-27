let audioCtx: AudioContext | null = null;

function ensureAudio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch {
    return null;
  }
}

export function playMobileFeedback(type: 'ok' | 'err' | 'notify') {
  // Haptic feedback on Android / supported mobile browsers
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      if (type === 'ok') navigator.vibrate(55);
      else if (type === 'notify') navigator.vibrate([45, 40, 45]);
      else navigator.vibrate([120, 60, 120]);
    }
  } catch {
    // ignore
  }

  // Synthesized crisp warehouse scanner beep
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const tone = (freq: number, start: number, dur: number, gainVal: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type === 'err' ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(gainVal, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur);
    };

    if (type === 'ok') {
      tone(1280, now, 0.085, 0.14);
    } else if (type === 'notify') {
      tone(880, now, 0.075, 0.11);
      tone(1320, now + 0.085, 0.1, 0.12);
    } else {
      tone(320, now, 0.12, 0.15);
      tone(240, now + 0.14, 0.16, 0.15);
    }
  } catch {
    // ignore audio autoplay blocks
  }
}
