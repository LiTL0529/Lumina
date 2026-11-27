package com.lumina.scanner;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.PathInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static volatile MainActivity activeInstance;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private FrameLayout splashOverlay;
    private View splashContentGroup;
    private View splashFooterView;
    private boolean splashDismissed = false;
    private boolean minDurationReached = false;
    private boolean webReady = false;

    private final Runnable minDurationTask = () -> {
        minDurationReached = true;
        maybeDismissSplash();
    };

    private final Runnable safetyTimeoutTask = () -> {
        webReady = true;
        minDurationReached = true;
        maybeDismissSplash();
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        // Immediate seamless handoff to our pixel-matched native brand overlay (zero double-zoom/glitch)
        splashScreen.setOnExitAnimationListener(provider -> provider.remove());

        registerPlugin(LuminaScannerPlugin.class);
        super.onCreate(savedInstanceState);
        activeInstance = this;

        configureLightSystemBars();

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView wv = getBridge().getWebView();
            wv.setBackgroundColor(Color.WHITE);
        }

        if (savedInstanceState == null) {
            showLuxuryBrandSplash();
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(minDurationTask);
        mainHandler.removeCallbacks(safetyTimeoutTask);
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.onDestroy();
    }

    public static void notifyWebReady() {
        MainActivity inst = activeInstance;
        if (inst == null) return;
        inst.mainHandler.post(() -> {
            inst.webReady = true;
            inst.maybeDismissSplash();
        });
    }

    private void configureLightSystemBars() {
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.WHITE);
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(true);
            controller.setAppearanceLightNavigationBars(true);
        }
    }

    private void showLuxuryBrandSplash() {
        ViewGroup contentRoot = findViewById(android.R.id.content);
        if (contentRoot == null) return;

        PathInterpolator luxuryEase = new PathInterpolator(0.22f, 1.0f, 0.36f, 1.0f);

        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.WHITE);
        overlay.setClickable(true);
        overlay.setFocusable(true);
        overlay.setElevation(dp(40));

        // Subtle ambient top-to-bottom pure white luxury canvas
        GradientDrawable bgGrad = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { 0xFFFFFFFF, 0xFFFAFBFD, 0xFFFFFFFF }
        );
        overlay.setBackground(bgGrad);

        // Center column
        LinearLayout centerGroup = new LinearLayout(this);
        centerGroup.setOrientation(LinearLayout.VERTICAL);
        centerGroup.setGravity(Gravity.CENTER_HORIZONTAL);
        FrameLayout.LayoutParams centerLp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        centerLp.bottomMargin = dp(20);

        // Icon stage with breathing halo + obsidian emblem + clipped scan-light sweep
        FrameLayout iconStage = new FrameLayout(this);
        int stageSize = dp(104);
        LinearLayout.LayoutParams stageLp = new LinearLayout.LayoutParams(stageSize, stageSize);
        iconStage.setLayoutParams(stageLp);

        View haloRing = new View(this);
        GradientDrawable haloDrawable = new GradientDrawable();
        haloDrawable.setShape(GradientDrawable.RECTANGLE);
        haloDrawable.setCornerRadius(dp(24));
        haloDrawable.setColor(0x00111827);
        haloDrawable.setStroke(dp(1), 0x24111827);
        haloRing.setBackground(haloDrawable);
        FrameLayout.LayoutParams haloLp = new FrameLayout.LayoutParams(dp(84), dp(84), Gravity.CENTER);
        haloRing.setAlpha(0f);
        haloRing.setScaleX(0.90f);
        haloRing.setScaleY(0.90f);
        iconStage.addView(haloRing, haloLp);

        // Clipped 76dp obsidian rounded emblem container
        int markSize = dp(76);
        final float markRadius = dp(18);
        FrameLayout markContainer = new FrameLayout(this);
        markContainer.setElevation(dp(10));
        markContainer.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), markRadius);
            }
        });
        markContainer.setClipToOutline(true);

        ImageView markImage = new ImageView(this);
        markImage.setImageResource(R.drawable.ic_lumina_mark);
        markImage.setScaleType(ImageView.ScaleType.FIT_XY);
        markContainer.addView(markImage, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // Delicate translucent scan-light sweep across the emblem
        View scanBeam = new View(this);
        GradientDrawable beamGrad = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { 0x00FFFFFF, 0x45FFFFFF, 0xCCFFFFFF, 0x45FFFFFF, 0x00FFFFFF }
        );
        scanBeam.setBackground(beamGrad);
        scanBeam.setAlpha(0f);
        scanBeam.setTranslationY(-dp(20));
        markContainer.addView(scanBeam, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(16),
            Gravity.TOP
        ));

        markContainer.setScaleX(0.95f);
        markContainer.setScaleY(0.95f);
        iconStage.addView(markContainer, new FrameLayout.LayoutParams(markSize, markSize, Gravity.CENTER));
        centerGroup.addView(iconStage);

        // Wordmark: LUMINA
        TextView brandTitle = new TextView(this);
        brandTitle.setText("LUMINA");
        brandTitle.setTextColor(0xFF111827);
        brandTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 21f);
        brandTitle.setLetterSpacing(0.30f);
        brandTitle.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        brandTitle.setGravity(Gravity.CENTER);
        brandTitle.setAlpha(0f);
        brandTitle.setTranslationY(dp(10));
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        titleLp.topMargin = dp(18);
        centerGroup.addView(brandTitle, titleLp);

        // Subtitle
        TextView subtitle = new TextView(this);
        subtitle.setText("品牌供销溯源 · 移动工作台");
        subtitle.setTextColor(0xFF6B7280);
        subtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
        subtitle.setLetterSpacing(0.08f);
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setAlpha(0f);
        subtitle.setTranslationY(dp(8));
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        subLp.topMargin = dp(7);
        centerGroup.addView(subtitle, subLp);

        // Minimalist hairline progress pill
        FrameLayout progressTrack = new FrameLayout(this);
        GradientDrawable trackBg = new GradientDrawable();
        trackBg.setCornerRadius(dp(2));
        trackBg.setColor(0xFFE5E7EB);
        progressTrack.setBackground(trackBg);
        progressTrack.setAlpha(0f);
        int trackW = dp(44);
        int trackH = dp(2.5f);
        LinearLayout.LayoutParams trackLp = new LinearLayout.LayoutParams(trackW, trackH);
        trackLp.topMargin = dp(22);

        View progressFill = new View(this);
        GradientDrawable fillBg = new GradientDrawable();
        fillBg.setCornerRadius(dp(2));
        fillBg.setColor(0xFF111827);
        progressFill.setBackground(fillBg);
        progressFill.setPivotX(0f);
        progressFill.setScaleX(0.05f);
        progressTrack.addView(progressFill, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        centerGroup.addView(progressTrack, trackLp);

        overlay.addView(centerGroup, centerLp);

        // Bottom signature
        TextView footer = new TextView(this);
        footer.setText("一物一码 · 正品防伪溯源");
        footer.setTextColor(0xFF9CA3AF);
        footer.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f);
        footer.setLetterSpacing(0.14f);
        footer.setGravity(Gravity.CENTER);
        footer.setAlpha(0f);
        FrameLayout.LayoutParams footerLp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL
        );
        footerLp.bottomMargin = dp(42);
        overlay.addView(footer, footerLp);

        contentRoot.addView(overlay, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        this.splashOverlay = overlay;
        this.splashContentGroup = centerGroup;
        this.splashFooterView = footer;

        // 1. Emblem settle
        markContainer.animate()
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(420)
            .setInterpolator(luxuryEase)
            .start();

        // 2. Subtle outer halo breath
        AnimatorSet haloAnim = new AnimatorSet();
        ObjectAnimator haloSx = ObjectAnimator.ofFloat(haloRing, View.SCALE_X, 0.90f, 1.18f);
        ObjectAnimator haloSy = ObjectAnimator.ofFloat(haloRing, View.SCALE_Y, 0.90f, 1.18f);
        ObjectAnimator haloAlpha = ObjectAnimator.ofFloat(haloRing, View.ALPHA, 0f, 0.85f, 0f);
        haloAnim.playTogether(haloSx, haloSy, haloAlpha);
        haloAnim.setStartDelay(120);
        haloAnim.setDuration(680);
        haloAnim.setInterpolator(new DecelerateInterpolator(1.6f));
        haloAnim.start();

        // 3. Precision scan-light sweep across viewfinder icon
        AnimatorSet beamAnim = new AnimatorSet();
        ObjectAnimator beamY = ObjectAnimator.ofFloat(scanBeam, View.TRANSLATION_Y, -dp(14), markSize + dp(4));
        ObjectAnimator beamAlpha = ObjectAnimator.ofFloat(scanBeam, View.ALPHA, 0f, 0.95f, 0.95f, 0f);
        beamAnim.playTogether(beamY, beamAlpha);
        beamAnim.setStartDelay(160);
        beamAnim.setDuration(540);
        beamAnim.setInterpolator(luxuryEase);
        beamAnim.start();

        // 4. Editorial typography entrance
        brandTitle.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(110)
            .setDuration(420)
            .setInterpolator(luxuryEase)
            .start();

        subtitle.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(210)
            .setDuration(400)
            .setInterpolator(luxuryEase)
            .start();

        progressTrack.animate()
            .alpha(1f)
            .setStartDelay(240)
            .setDuration(260)
            .start();

        progressFill.animate()
            .scaleX(1f)
            .setStartDelay(240)
            .setDuration(660)
            .setInterpolator(luxuryEase)
            .start();

        footer.animate()
            .alpha(1f)
            .setStartDelay(260)
            .setDuration(400)
            .start();

        // Gate dismissal on both aesthetic beat (920ms) and WebView first paint (max 2200ms)
        mainHandler.postDelayed(minDurationTask, 920);
        mainHandler.postDelayed(safetyTimeoutTask, 2200);
    }

    private void maybeDismissSplash() {
        if (splashDismissed || splashOverlay == null) return;
        if (!minDurationReached || !webReady) return;
        splashDismissed = true;
        mainHandler.removeCallbacks(minDurationTask);
        mainHandler.removeCallbacks(safetyTimeoutTask);

        final FrameLayout overlay = splashOverlay;
        final View group = splashContentGroup;
        final View footer = splashFooterView;
        PathInterpolator exitEase = new PathInterpolator(0.4f, 0f, 0.2f, 1f);

        if (group != null) {
            group.animate()
                .scaleX(1.035f)
                .scaleY(1.035f)
                .translationY(-dp(8))
                .alpha(0f)
                .setDuration(300)
                .setInterpolator(exitEase)
                .start();
        }
        if (footer != null) {
            footer.animate()
                .alpha(0f)
                .setDuration(220)
                .start();
        }
        overlay.animate()
            .alpha(0f)
            .setDuration(320)
            .setInterpolator(exitEase)
            .setListener(new AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(Animator animation) {
                    ViewGroup parent = (ViewGroup) overlay.getParent();
                    if (parent != null) {
                        parent.removeView(overlay);
                    }
                    splashOverlay = null;
                    splashContentGroup = null;
                    splashFooterView = null;
                }
            })
            .start();
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
