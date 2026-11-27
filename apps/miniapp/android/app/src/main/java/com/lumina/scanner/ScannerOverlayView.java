package com.lumina.scanner;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.util.AttributeSet;
import android.view.View;

/**
 * WeChat-inspired minimalist open-frame viewfinder:
 * - No opaque dark square cutout; full-frame transparent preview
 * - Subtle top/bottom gradient vignettes for crisp icon/text contrast
 * - Gentle luminous scanning beam across center sweep zone (pauses during cooldown)
 * - Soft emerald confirmation pulse + tap-to-focus ring
 */
public class ScannerOverlayView extends View {

    private final Paint topFadePaint = new Paint();
    private final Paint bottomFadePaint = new Paint();
    private final Paint beamGlowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint beamLinePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint focusPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pulsePaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    private float density = 1f;
    private float beamProgress = 0f;
    private long lastFrameTime = 0L;
    private long flashUntil = 0L;
    private volatile boolean coolingDown = false;

    private float focusX = -1f;
    private float focusY = -1f;
    private long focusUntil = 0L;

    private int cachedW = 0;
    private int cachedH = 0;

    public ScannerOverlayView(Context context) {
        super(context);
        init(context);
    }

    public ScannerOverlayView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init(context);
    }

    private void init(Context context) {
        density = context.getResources().getDisplayMetrics().density;

        beamGlowPaint.setStyle(Paint.Style.FILL);
        beamLinePaint.setStyle(Paint.Style.FILL);

        focusPaint.setColor(0xFFFFFFFF);
        focusPaint.setStyle(Paint.Style.STROKE);
        focusPaint.setStrokeWidth(1.6f * density);

        pulsePaint.setColor(0xFF10B981);
        pulsePaint.setStyle(Paint.Style.FILL);
    }

    public void setCoolingDown(boolean cooling) {
        if (this.coolingDown != cooling) {
            this.coolingDown = cooling;
            postInvalidateOnAnimation();
        }
    }

    public void showFocusRing(float x, float y) {
        focusX = x;
        focusY = y;
        focusUntil = System.currentTimeMillis() + 760L;
        postInvalidateOnAnimation();
    }

    public void flashSuccess() {
        flashUntil = System.currentTimeMillis() + 380L;
        postInvalidateOnAnimation();
    }

    private void ensureVignetteShaders(int w, int h) {
        if (w == cachedW && h == cachedH) return;
        cachedW = w;
        cachedH = h;

        float topH = Math.min(h * 0.20f, 130f * density);
        topFadePaint.setShader(new LinearGradient(
            0f, 0f, 0f, topH,
            new int[] { 0x7A000000, Color.TRANSPARENT },
            null,
            Shader.TileMode.CLAMP
        ));

        float botH = Math.min(h * 0.34f, 250f * density);
        bottomFadePaint.setShader(new LinearGradient(
            0f, h - botH, 0f, h,
            new int[] { Color.TRANSPARENT, 0xCC000000 },
            null,
            Shader.TileMode.CLAMP
        ));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int w = getWidth();
        int h = getHeight();
        if (w <= 0 || h <= 0) return;

        ensureVignetteShaders(w, h);

        // Subtle top & bottom vignettes only — full open viewfinder in the middle
        float topH = Math.min(h * 0.20f, 130f * density);
        float botH = Math.min(h * 0.34f, 250f * density);
        canvas.drawRect(0f, 0f, w, topH, topFadePaint);
        canvas.drawRect(0f, h - botH, w, h, bottomFadePaint);

        long now = System.currentTimeMillis();
        boolean flashing = now < flashUntil;

        // Smooth WeChat-style luminous sweep beam across middle band
        if (!coolingDown) {
            if (lastFrameTime == 0L) lastFrameTime = now;
            long dt = Math.min(50L, Math.max(0L, now - lastFrameTime));
            lastFrameTime = now;
            beamProgress = (beamProgress + dt / 2600f) % 1f;

            float sweepTop = h * 0.21f;
            float sweepBot = h * 0.68f;
            float beamY = sweepTop + beamProgress * (sweepBot - sweepTop);

            // Fade smoothly near top and bottom of sweep range
            float edgeAlpha = 1f;
            if (beamProgress < 0.10f) {
                edgeAlpha = beamProgress / 0.10f;
            } else if (beamProgress > 0.88f) {
                edgeAlpha = (1f - beamProgress) / 0.12f;
            }
            int lineAlpha = (int) (Math.max(0f, Math.min(1f, edgeAlpha)) * 225);
            int glowAlpha = (int) (Math.max(0f, Math.min(1f, edgeAlpha)) * 68);

            float margin = w * 0.10f;
            int coreColor = flashing ? Color.argb(lineAlpha, 52, 211, 153) : Color.argb(lineAlpha, 255, 255, 255);
            int trailColor = flashing ? Color.argb(glowAlpha, 16, 185, 129) : Color.argb(glowAlpha, 255, 255, 255);

            // Soft trailing aurora above the line
            float trailH = 42f * density;
            beamGlowPaint.setShader(new LinearGradient(
                0f, beamY - trailH, 0f, beamY,
                new int[] { Color.TRANSPARENT, trailColor },
                null,
                Shader.TileMode.CLAMP
            ));
            canvas.drawRect(margin, beamY - trailH, w - margin, beamY, beamGlowPaint);

            // Crisp fading horizontal beam
            float lineH = 2.0f * density;
            beamLinePaint.setShader(new LinearGradient(
                margin, beamY, w - margin, beamY,
                new int[] { Color.TRANSPARENT, coreColor, Color.TRANSPARENT },
                new float[] { 0f, 0.5f, 1f },
                Shader.TileMode.CLAMP
            ));
            canvas.drawRect(margin, beamY - lineH / 2f, w - margin, beamY + lineH / 2f, beamLinePaint);
        } else {
            lastFrameTime = now;
        }

        // Brief emerald center confirmation dot on recognition
        if (flashing) {
            float remain = (flashUntil - now) / 380f;
            pulsePaint.setAlpha((int) (remain * 220));
            canvas.drawCircle(w / 2f, h * 0.45f, (10f + (1f - remain) * 14f) * density, pulsePaint);
        }

        // Tap-to-focus ring
        if (now < focusUntil && focusX >= 0 && focusY >= 0) {
            float remain = (focusUntil - now) / 760f;
            int alpha = (int) (Math.min(1f, remain * 1.4f) * 230);
            focusPaint.setAlpha(alpha);
            float radius = (22f + (1f - remain) * 8f) * density;
            canvas.drawCircle(focusX, focusY, radius, focusPaint);
        }

        postInvalidateOnAnimation();
    }
}
