package com.lumina.scanner;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.media.Image;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.util.Size;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.ZoomState;
import androidx.camera.core.resolutionselector.AspectRatioStrategy;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.widget.ImageViewCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class NativeScannerActivity extends AppCompatActivity {

    public static final String EXTRA_CONTINUOUS = "continuous";
    public static final String EXTRA_CONFIRM_BEFORE_ADD = "confirmBeforeAdd";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_HINT = "hint";
    public static final String EXTRA_API_BASE_URL = "apiBaseUrl";
    public static final String EXTRA_AUTH_TOKEN = "authToken";
    public static final String EXTRA_WORK_MODE = "workMode";
    public static final String EXTRA_VALIDATE_MODE = "validateMode";
    public static final String EXTRA_WAREHOUSE_ID = "warehouseId";
    public static final String EXTRA_PRODUCT_ID = "productId";
    public static final String EXTRA_CODE_LEVEL = "codeLevel";
    public static final String EXTRA_BATCH_NO = "batchNo";
    public static final String EXTRA_EXISTING_CODES = "existingCodes";

    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_FORMAT = "format";
    public static final String EXTRA_SOURCE = "source";
    public static final String EXTRA_COUNT = "count";
    public static final String EXTRA_CONFIRMED_CODES = "confirmedCodes";
    public static final String EXTRA_OPEN_MANUAL = "openManual";

    private static final String PREFS_NAME = "lumina_scanner_prefs";
    private static final String PREF_CONTINUOUS = "continuous_mode_v2";
    private static final long CONTINUOUS_INTERVAL_MS = 1500L;
    private static final long DISMISS_COOLDOWN_MS = 3000L;
    private static final long DUP_TOAST_COOLDOWN_MS = 2200L;
    private static final Pattern VERIFY_URL_PATTERN = Pattern.compile("/v/([0-9A-Za-z]{16})(?:[/?#]|$)", Pattern.CASE_INSENSITIVE);

    private PreviewView previewView;
    private ScannerOverlayView overlayView;
    private ImageView btnClose;
    private TextView tvTitle;
    private TextView btnModeToggle;
    private TextView tvHint;
    private LinearLayout continuousStatusBar;
    private TextView tvLastCode;
    private TextView btnDoneContinuous;
    private LinearLayout btnTorchWrap;
    private ImageView btnTorchIcon;
    private TextView btnTorchLabel;
    private LinearLayout btnManualWrap;
    private ImageView btnManualIcon;
    private LinearLayout btnGalleryWrap;
    private ImageView btnGalleryIcon;
    private FrameLayout loadingOverlay;
    private View loadingCard;
    private TextView loadingText;

    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private BarcodeScanner barcodeScanner;
    private ExecutorService analysisExecutor;
    private ExecutorService galleryExecutor;
    private ExecutorService networkExecutor;
    private ToneGenerator toneGenerator;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Default to continuous scanning with product confirm prompt
    private boolean continuousMode = true;
    private boolean confirmBeforeAdd = true;
    private boolean torchOn = false;
    private boolean initialZoomApplied = false;
    private float currentZoom = 1.0f;
    private float minZoom = 1.0f;
    private float maxZoom = 4.0f;

    // Business context passed from Vue MobileScanSheet
    private String apiBaseUrl = "";
    private String authToken = "";
    private String workMode = "INBOUND";
    private String validateMode = "";
    private String warehouseId = "";
    private String productId = "";
    private String codeLevel = "UNIT";
    private String batchNo = "";

    private final AtomicBoolean finished = new AtomicBoolean(false);
    private volatile boolean pausedForGallery = false;
    private volatile boolean pausedForConfirm = false;
    private volatile long nextScanAllowedAt = 0L;
    private String defaultHint = "对准产品二维码或条形码";
    private int frameCounter = 0;

    private final Runnable cooldownDoneRunnable = () -> {
        if (isFinishing() || isDestroyed()) return;
        overlayView.setCoolingDown(false);
        tvHint.setTextColor(0xE6FFFFFF);
        tvHint.setText(defaultHint);
    };

    private final Runnable restoreHintRunnable = () -> {
        if (isFinishing() || isDestroyed()) return;
        if (System.currentTimeMillis() >= nextScanAllowedAt) {
            tvHint.setTextColor(0xE6FFFFFF);
            tvHint.setText(defaultHint);
        }
    };

    // Strict session deduplication + cooldown after choosing "否"
    private final Set<String> acceptedTokens = Collections.synchronizedSet(new HashSet<>());
    private final ArrayList<String> confirmedCodes = new ArrayList<>();
    private volatile String dismissedToken = "";
    private volatile long dismissedAt = 0L;
    private volatile String lastDupToken = "";
    private volatile long lastDupToastAt = 0L;
    private int continuousScanCount = 0;
    private Dialog activeDialog = null;

    private ScaleGestureDetector scaleGestureDetector;
    private ActivityResultLauncher<Intent> galleryLauncher;

    private static class LookupResult {
        boolean ok;
        String errorMessage;
        String canonicalToken;
        String parentToken;
        List<String> childTokens = new ArrayList<>();
        String productName;
        String skuCode;
        String spec;
        String levelLabel;
        int unitCount = 1;
        String batchNo;
        String statusLabel;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_native_scanner);

        previewView = findViewById(R.id.preview_view);
        overlayView = findViewById(R.id.scanner_overlay);
        btnClose = findViewById(R.id.btn_close);
        tvTitle = findViewById(R.id.tv_title);
        btnModeToggle = findViewById(R.id.btn_mode_toggle);
        tvHint = findViewById(R.id.tv_hint);
        continuousStatusBar = findViewById(R.id.continuous_status_bar);
        tvLastCode = findViewById(R.id.tv_last_code);
        btnDoneContinuous = findViewById(R.id.btn_done_continuous);
        btnTorchWrap = findViewById(R.id.btn_torch_wrap);
        btnTorchIcon = findViewById(R.id.btn_torch_icon);
        btnTorchLabel = findViewById(R.id.btn_torch_label);
        btnManualWrap = findViewById(R.id.btn_manual_wrap);
        btnManualIcon = findViewById(R.id.btn_manual_icon);
        btnGalleryWrap = findViewById(R.id.btn_gallery_wrap);
        btnGalleryIcon = findViewById(R.id.btn_gallery_icon);
        loadingOverlay = findViewById(R.id.loading_overlay);
        loadingCard = findViewById(R.id.loading_card);
        loadingText = findViewById(R.id.loading_text);

        applyRoundedStyles();
        applySystemInsets();

        Intent intent = getIntent();
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (intent != null && intent.hasExtra(EXTRA_CONTINUOUS)) {
            continuousMode = intent.getBooleanExtra(EXTRA_CONTINUOUS, true);
        } else {
            continuousMode = prefs.getBoolean(PREF_CONTINUOUS, true);
        }
        if (intent != null) {
            confirmBeforeAdd = intent.getBooleanExtra(EXTRA_CONFIRM_BEFORE_ADD, true);
            apiBaseUrl = safeExtra(intent, EXTRA_API_BASE_URL, "");
            authToken = safeExtra(intent, EXTRA_AUTH_TOKEN, "");
            workMode = safeExtra(intent, EXTRA_WORK_MODE, "INBOUND");
            validateMode = safeExtra(intent, EXTRA_VALIDATE_MODE, "");
            warehouseId = safeExtra(intent, EXTRA_WAREHOUSE_ID, "");
            productId = safeExtra(intent, EXTRA_PRODUCT_ID, "");
            codeLevel = safeExtra(intent, EXTRA_CODE_LEVEL, "UNIT");
            batchNo = safeExtra(intent, EXTRA_BATCH_NO, "");

            String title = intent.getStringExtra(EXTRA_TITLE);
            if (title != null && !title.trim().isEmpty()) {
                tvTitle.setText(title.trim());
            }
            String hint = intent.getStringExtra(EXTRA_HINT);
            if (hint != null && !hint.trim().isEmpty()) {
                defaultHint = hint.trim();
                tvHint.setText(defaultHint);
            }
            ArrayList<String> existing = intent.getStringArrayListExtra(EXTRA_EXISTING_CODES);
            if (existing != null) {
                for (String c : existing) {
                    String n = normalizeToken(c);
                    if (!n.isEmpty()) acceptedTokens.add(n);
                }
            }
        }
        updateModeUi();

        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);

        analysisExecutor = Executors.newSingleThreadExecutor();
        galleryExecutor = Executors.newSingleThreadExecutor();
        networkExecutor = Executors.newSingleThreadExecutor();

        BarcodeScannerOptions options = new BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS)
            .build();
        barcodeScanner = BarcodeScanning.getClient(options);

        try {
            toneGenerator = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 85);
        } catch (Exception ignored) {}

        galleryLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                pausedForGallery = false;
                if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                    Uri uri = result.getData().getData();
                    if (uri != null) {
                        decodeGalleryUri(uri);
                    }
                }
            }
        );

        setupGestures();
        setupButtons();
        startCamera();
    }

    private String safeExtra(Intent intent, String key, String fallback) {
        String v = intent.getStringExtra(key);
        return v != null ? v.trim() : fallback;
    }

    private void showLoading(String message) {
        if (loadingText != null && message != null) {
            loadingText.setText(message);
        }
        loadingOverlay.setVisibility(View.VISIBLE);
    }

    private void hideLoading() {
        loadingOverlay.setVisibility(View.GONE);
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void applyRoundedStyles() {
        float d = getResources().getDisplayMetrics().density;
        btnClose.setBackground(makeCircle(0x66000000, 0x33FFFFFF));
        btnTorchIcon.setBackground(makeCircle(0x66000000, 0x33FFFFFF));
        btnManualIcon.setBackground(makeCircle(0x66000000, 0x33FFFFFF));
        btnGalleryIcon.setBackground(makeCircle(0x66000000, 0x33FFFFFF));
        continuousStatusBar.setBackground(makePill(0xCC111827, 0x38FFFFFF, 24f * d));
        btnDoneContinuous.setBackground(makePill(0xFFFFFFFF, 0xFFFFFFFF, 17f * d));
        btnDoneContinuous.setTextColor(0xFF111827);
        if (loadingCard != null) {
            loadingCard.setBackground(makePill(0xEB111827, 0x33FFFFFF, 16f * d));
        }
    }

    private GradientDrawable makeCircle(int fillColor, int strokeColor) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.OVAL);
        gd.setColor(fillColor);
        gd.setStroke((int) Math.max(1, getResources().getDisplayMetrics().density * 0.8f), strokeColor);
        return gd;
    }

    private GradientDrawable makePill(int fillColor, int strokeColor, float radiusPx) {
        GradientDrawable gd = new GradientDrawable();
        gd.setColor(fillColor);
        gd.setCornerRadius(radiusPx);
        gd.setStroke((int) Math.max(1, getResources().getDisplayMetrics().density), strokeColor);
        return gd;
    }

    private void applySystemInsets() {
        View topBar = findViewById(R.id.top_bar);
        View bottomPanel = findViewById(R.id.bottom_panel);
        final int topBase = topBar.getPaddingTop();
        final int botBase = bottomPanel.getPaddingBottom();
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.scanner_root), (v, insets) -> {
            Insets sys = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            topBar.setPadding(topBar.getPaddingLeft(), topBase + sys.top, topBar.getPaddingRight(), topBar.getPaddingBottom());
            bottomPanel.setPadding(bottomPanel.getPaddingLeft(), bottomPanel.getPaddingTop(), bottomPanel.getPaddingRight(), botBase + sys.bottom);
            return insets;
        });
    }

    private void setupGestures() {
        scaleGestureDetector = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override
            public boolean onScale(@NonNull ScaleGestureDetector detector) {
                if (camera == null) return false;
                float next = currentZoom * detector.getScaleFactor();
                float clamped = Math.max(minZoom, Math.min(next, Math.min(maxZoom, 5.0f)));
                camera.getCameraControl().setZoomRatio(clamped);
                return true;
            }
        });

        previewView.setOnTouchListener((v, event) -> {
            scaleGestureDetector.onTouchEvent(event);
            if (!scaleGestureDetector.isInProgress() && event.getAction() == MotionEvent.ACTION_UP) {
                triggerFocusAt(event.getX(), event.getY());
                v.performClick();
            }
            return true;
        });
    }

    private void setupButtons() {
        btnClose.setOnClickListener(v -> finishWithContinuousSummary(false));
        btnDoneContinuous.setOnClickListener(v -> finishWithContinuousSummary(false));
        btnManualWrap.setOnClickListener(v -> finishWithContinuousSummary(true));

        btnModeToggle.setOnClickListener(v -> {
            continuousMode = !continuousMode;
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_CONTINUOUS, continuousMode)
                .apply();
            updateModeUi();
        });

        btnTorchWrap.setOnClickListener(v -> {
            if (camera == null || !camera.getCameraInfo().hasFlashUnit()) return;
            torchOn = !torchOn;
            camera.getCameraControl().enableTorch(torchOn);
            updateTorchUi();
        });

        btnGalleryWrap.setOnClickListener(v -> openGalleryPicker());
    }

    private void updateTorchUi() {
        if (torchOn) {
            btnTorchIcon.setBackground(makeCircle(0xFFFFFFFF, 0xFFFFFFFF));
            ImageViewCompat.setImageTintList(btnTorchIcon, ColorStateList.valueOf(0xFF111827));
            btnTorchLabel.setText("关闭照明");
            btnTorchLabel.setTextColor(0xFFFFFFFF);
        } else {
            btnTorchIcon.setBackground(makeCircle(0x66000000, 0x33FFFFFF));
            ImageViewCompat.setImageTintList(btnTorchIcon, ColorStateList.valueOf(Color.WHITE));
            btnTorchLabel.setText("轻触照亮");
            btnTorchLabel.setTextColor(0xE6FFFFFF);
        }
    }

    private void updateModeUi() {
        float d = getResources().getDisplayMetrics().density;
        boolean isTrace = "TRACE".equals(workMode);
        btnModeToggle.setVisibility(isTrace ? View.INVISIBLE : View.VISIBLE);
        btnModeToggle.setText(continuousMode ? "连扫" : "单扫");
        if (continuousMode) {
            btnModeToggle.setBackground(makePill(0xF0FFFFFF, 0xFFFFFFFF, 16f * d));
            btnModeToggle.setTextColor(0xFF111827);
        } else {
            btnModeToggle.setBackground(makePill(0x66000000, 0x45FFFFFF, 16f * d));
            btnModeToggle.setTextColor(Color.WHITE);
        }
        boolean showPill = !isTrace && continuousMode && continuousScanCount > 0;
        continuousStatusBar.setVisibility(showPill ? View.VISIBLE : View.GONE);
        if (showPill) {
            btnDoneContinuous.setText("查看清单 (" + continuousScanCount + ") ›");
        }
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                cameraProvider = future.get();
                bindCameraUseCases();
            } catch (Exception e) {
                Toast.makeText(this, "无法启动原生摄像头：" + e.getMessage(), Toast.LENGTH_LONG).show();
                setResult(Activity.RESULT_CANCELED);
                finish();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void bindCameraUseCases() {
        if (cameraProvider == null) return;
        cameraProvider.unbindAll();
        initialZoomApplied = false;

        ResolutionSelector previewSelector = new ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
            .build();

        Preview preview = new Preview.Builder()
            .setResolutionSelector(previewSelector)
            .build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());

        ResolutionSelector analysisSelector = new ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
            .setResolutionStrategy(new ResolutionStrategy(
                new Size(1280, 720),
                ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
            ))
            .build();

        ImageAnalysis analysis = new ImageAnalysis.Builder()
            .setResolutionSelector(analysisSelector)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build();

        analysis.setAnalyzer(analysisExecutor, this::analyzeFrame);

        CameraSelector selector = CameraSelector.DEFAULT_BACK_CAMERA;
        if (!hasCamera(selector)) {
            selector = CameraSelector.DEFAULT_FRONT_CAMERA;
        }

        camera = cameraProvider.bindToLifecycle(this, selector, preview, analysis);

        boolean hasFlash = camera.getCameraInfo().hasFlashUnit();
        btnTorchWrap.setVisibility(hasFlash ? View.VISIBLE : View.GONE);
        if (hasFlash) {
            updateTorchUi();
        }

        camera.getCameraInfo().getZoomState().observe(this, zoomState -> {
            if (zoomState == null) return;
            minZoom = zoomState.getMinZoomRatio();
            maxZoom = zoomState.getMaxZoomRatio();
            if (!initialZoomApplied) {
                initialZoomApplied = true;
                float targetOneX = Math.max(minZoom, Math.min(1.0f, maxZoom));
                if (Math.abs(zoomState.getZoomRatio() - targetOneX) > 0.03f) {
                    camera.getCameraControl().setZoomRatio(targetOneX);
                }
                currentZoom = targetOneX;
            } else {
                currentZoom = zoomState.getZoomRatio();
            }
        });

        ZoomState immediate = camera.getCameraInfo().getZoomState().getValue();
        if (immediate != null) {
            minZoom = immediate.getMinZoomRatio();
            maxZoom = immediate.getMaxZoomRatio();
            float targetOneX = Math.max(minZoom, Math.min(1.0f, maxZoom));
            camera.getCameraControl().setZoomRatio(targetOneX);
            initialZoomApplied = true;
            currentZoom = targetOneX;
        } else {
            camera.getCameraControl().setZoomRatio(1.0f);
        }

        mainHandler.postDelayed(() -> {
            if (!isFinishing() && previewView.getWidth() > 0 && previewView.getHeight() > 0) {
                triggerFocusAt(previewView.getWidth() / 2f, previewView.getHeight() * 0.44f);
            }
        }, 350L);
    }

    private boolean hasCamera(CameraSelector selector) {
        try {
            return cameraProvider != null && cameraProvider.hasCamera(selector);
        } catch (Exception e) {
            return false;
        }
    }

    private void triggerFocusAt(float x, float y) {
        if (camera == null) return;
        try {
            MeteringPoint point = previewView.getMeteringPointFactory().createPoint(x, y);
            FocusMeteringAction action = new FocusMeteringAction.Builder(
                point,
                FocusMeteringAction.FLAG_AF | FocusMeteringAction.FLAG_AE
            ).setAutoCancelDuration(3, TimeUnit.SECONDS).build();
            camera.getCameraControl().startFocusAndMetering(action);
            overlayView.showFocusRing(x, y);
        } catch (Exception ignored) {}
    }

    @OptIn(markerClass = ExperimentalGetImage.class)
    private void analyzeFrame(@NonNull ImageProxy imageProxy) {
        if (finished.get() || pausedForGallery || pausedForConfirm || System.currentTimeMillis() < nextScanAllowedAt) {
            imageProxy.close();
            return;
        }
        Image mediaImage = imageProxy.getImage();
        if (mediaImage == null) {
            imageProxy.close();
            return;
        }

        final int rotation = imageProxy.getImageInfo().getRotationDegrees();
        final int frameW = imageProxy.getWidth();
        final int frameH = imageProxy.getHeight();
        final boolean shouldTryZxingFallback = (++frameCounter % 6 == 0);
        final byte[] fallbackY = shouldTryZxingFallback ? copyYPlane(mediaImage) : null;

        InputImage inputImage = InputImage.fromMediaImage(mediaImage, rotation);
        barcodeScanner.process(inputImage)
            .addOnSuccessListener(barcodes -> {
                if (finished.get() || pausedForGallery || pausedForConfirm || System.currentTimeMillis() < nextScanAllowedAt) return;
                Barcode best = QrImageDecoder.pickBestMlKitBarcode(barcodes, frameW, frameH);
                if (best != null && best.getRawValue() != null && !best.getRawValue().trim().isEmpty()) {
                    onCodeDetected(
                        best.getRawValue().trim(),
                        QrImageDecoder.mlKitFormatName(best.getFormat()),
                        "camera"
                    );
                } else if (fallbackY != null) {
                    QrImageDecoder.DecodeResult z = QrImageDecoder.decodeLuminanceFallback(fallbackY, frameW, frameH);
                    if (z != null) {
                        onCodeDetected(z.text, z.format, "camera");
                    }
                }
            })
            .addOnFailureListener(e -> {
                if (finished.get() || pausedForGallery || pausedForConfirm || System.currentTimeMillis() < nextScanAllowedAt) return;
                if (fallbackY != null) {
                    QrImageDecoder.DecodeResult z = QrImageDecoder.decodeLuminanceFallback(fallbackY, frameW, frameH);
                    if (z != null) {
                        onCodeDetected(z.text, z.format, "camera");
                    }
                }
            })
            .addOnCompleteListener(task -> imageProxy.close());
    }

    private byte[] copyYPlane(Image mediaImage) {
        try {
            Image.Plane[] planes = mediaImage.getPlanes();
            if (planes == null || planes.length == 0) return null;
            Image.Plane yPlane = planes[0];
            ByteBuffer buffer = yPlane.getBuffer();
            int w = mediaImage.getWidth();
            int h = mediaImage.getHeight();
            int rowStride = yPlane.getRowStride();
            byte[] out = new byte[w * h];
            if (rowStride == w) {
                buffer.get(out, 0, Math.min(out.length, buffer.remaining()));
            } else {
                byte[] rowBuf = new byte[rowStride];
                for (int row = 0; row < h; row++) {
                    int remaining = buffer.remaining();
                    if (remaining < w) break;
                    int toRead = Math.min(rowStride, remaining);
                    buffer.get(rowBuf, 0, toRead);
                    System.arraycopy(rowBuf, 0, out, row * w, w);
                }
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    private String normalizeToken(String raw) {
        if (raw == null) return "";
        String s = raw.trim();
        if (s.isEmpty()) return "";
        Matcher m = VERIFY_URL_PATTERN.matcher(s);
        if (m.find() && m.group(1) != null) {
            return m.group(1).toUpperCase(Locale.US);
        }
        return s.replaceAll("\\s+", "").toUpperCase(Locale.US);
    }

    private String formatCodeGroups(String token) {
        if (token == null) return "";
        String t = token.trim();
        if (t.length() == 16) {
            return t.substring(0, 4) + " " + t.substring(4, 8) + " " + t.substring(8, 12) + " " + t.substring(12, 16);
        }
        return t;
    }

    private String statusToZh(String status) {
        if (status == null) return "";
        switch (status) {
            case "GENERATED": return "待入总仓（已赋码）";
            case "IN_HQ_STOCK": return "已在总仓库存中";
            case "IN_TRANSIT_TO_DEALER": return "发往服务商在途";
            case "IN_DEALER_STOCK": return "已在服务商库存中";
            case "SOLD_TO_CLINIC": return "已出库至终端机构";
            case "CONSUMED": return "终端顾客已验真";
            case "UNPACKED": return "已拆箱";
            case "VOIDED": return "已作废";
            default: return status;
        }
    }

    private void onCodeDetected(String rawText, String format, String source) {
        if (rawText == null || finished.get() || pausedForConfirm) return;
        final String clean = rawText.trim();
        if (clean.isEmpty()) return;

        final long now = System.currentTimeMillis();
        if (!"gallery".equals(source) && now < nextScanAllowedAt) {
            return;
        }

        final String normToken = normalizeToken(clean);
        if (normToken.isEmpty()) return;

        // 2. Ignore recently dismissed code briefly so dialog doesn't immediately re-pop
        if (normToken.equals(dismissedToken) && (now - dismissedAt) < DISMISS_COOLDOWN_MS) {
            return;
        }

        // 3. STRICT SESSION DEDUPLICATION
        if (acceptedTokens.contains(normToken)) {
            if (!normToken.equals(lastDupToken) || (now - lastDupToastAt) > DUP_TOAST_COOLDOWN_MS) {
                lastDupToken = normToken;
                lastDupToastAt = now;
                mainHandler.post(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    playWarningFeedback();
                    if (continuousStatusBar.getVisibility() == View.VISIBLE) {
                        tvLastCode.setTextColor(0xFFFCD34D);
                        tvLastCode.setText("已录入，自动去重跳过：" + formatCodeGroups(normToken));
                    }
                    tvHint.setTextColor(0xFFFCD34D);
                    tvHint.setText("已在清单中，自动去重跳过：" + formatCodeGroups(normToken));
                    mainHandler.removeCallbacks(restoreHintRunnable);
                    mainHandler.postDelayed(restoreHintRunnable, 2000L);
                });
            }
            return;
        }

        // 4. Pause camera analysis and verify/lookup product info before showing confirmation prompt
        pausedForConfirm = true;

        mainHandler.post(() -> {
            if (isFinishing() || isDestroyed()) return;
            overlayView.flashSuccess();

            if ("OUTBOUND".equals(workMode) && validateMode.isEmpty()) {
                playWarningFeedback();
                showNoticeDialog(
                    "未选择待出库订单",
                    "请先点击左上角关闭按钮返回，选择待出库供货单或切换至「快捷出库绑代理商」。",
                    normToken
                );
                return;
            }

            showLoading("正在识别产品信息…");
            networkExecutor.execute(() -> {
                LookupResult lookup = performProductLookup(clean, normToken);
                mainHandler.post(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    hideLoading();

                    if (!lookup.ok) {
                        playWarningFeedback();
                        showNoticeDialog("该产品码不可加入", lookup.errorMessage, normToken);
                        return;
                    }

                    String canonical = lookup.canonicalToken != null && !lookup.canonicalToken.isEmpty()
                        ? lookup.canonicalToken
                        : normToken;

                    // Re-check strict deduplication with canonical token, parent carton, and child units
                    if (isDuplicateWithRelations(canonical, lookup.parentToken, lookup.childTokens)) {
                        playWarningFeedback();
                        tvLastCode.setText("已录入，自动去重跳过：" + formatCodeGroups(canonical));
                        showNoticeDialog(
                            "该产品已在清单中",
                            "防伪码 " + formatCodeGroups(canonical) + "（或其箱/盒关联码）已加入本次清单，系统已自动去重。",
                            canonical
                        );
                        return;
                    }

                    playScanFeedback();
                    if (confirmBeforeAdd) {
                        showProductConfirmDialog(clean, canonical, lookup, format, source);
                    } else {
                        commitConfirmedCode(canonical, lookup, format, source);
                    }
                });
            });
        });
    }

    private boolean isDuplicateWithRelations(String token, String parentToken, List<String> childTokens) {
        if (acceptedTokens.contains(token)) return true;
        if (parentToken != null && !parentToken.isEmpty() && acceptedTokens.contains(parentToken)) return true;
        if (childTokens != null) {
            for (String ct : childTokens) {
                if (ct != null && acceptedTokens.contains(ct)) return true;
            }
        }
        return false;
    }

    private LookupResult performProductLookup(String rawInput, String normToken) {
        LookupResult out = new LookupResult();
        out.canonicalToken = normToken;
        out.ok = true;

        if (apiBaseUrl.isEmpty() || authToken.isEmpty()) {
            out.ok = false;
            out.errorMessage = "登录状态已失效，请返回 App 重新登录后再扫码";
            return out;
        }

        try {
            if (("INBOUND".equals(workMode) || "OUTBOUND".equals(workMode)) && !validateMode.isEmpty()) {
                JSONObject body = new JSONObject();
                body.put("rawInput", rawInput);
                body.put("mode", validateMode);
                body.put("warehouseId", warehouseId);
                if ("REGISTER_INBOUND".equals(validateMode)) {
                    if (!productId.isEmpty()) body.put("productId", productId);
                    if (!codeLevel.isEmpty()) body.put("codeLevel", codeLevel);
                    if (!batchNo.isEmpty()) body.put("batchNo", batchNo);
                }
                JSONObject resp = httpPostJson(apiBaseUrl + "/stock/scan-validate", body);
                if (resp == null) {
                    out.ok = false;
                    out.errorMessage = "网络校验超时，请检查网络后重试";
                    return out;
                }
                if (!resp.optBoolean("ok", false)) {
                    out.ok = false;
                    out.errorMessage = resp.optString("message", "该产品码校验未通过");
                    return out;
                }
                out.ok = true;
                out.canonicalToken = resp.optString("token", normToken);
                out.parentToken = resp.optString("parentToken", "");
                JSONArray children = resp.optJSONArray("childTokens");
                if (children != null) {
                    for (int i = 0; i < children.length(); i++) {
                        String ct = children.optString(i, "");
                        if (!ct.isEmpty()) out.childTokens.add(ct.toUpperCase(Locale.US));
                    }
                }
                out.productName = resp.optString("productName", "");
                out.skuCode = resp.optString("skuCode", "");
                out.spec = resp.optString("spec", "");
                String lvl = resp.optString("codeLevel", "UNIT");
                out.unitCount = resp.optInt("unitCount", 1);
                out.levelLabel = "CARTON".equals(lvl)
                    ? ("外箱码（展开 " + out.unitCount + " 盒）")
                    : "单品盒码（1 盒）";
                out.batchNo = resp.optString("batchNo", "");
                out.statusLabel = resp.optString("statusLabel", "");
                return out;
            }

            // TRACE: fetch product details from timeline endpoint
            String url = apiBaseUrl + "/trace/codes/" + URLEncoder.encode(normToken, "UTF-8") + "/timeline";
            JSONObject resp = httpGetJson(url);
            if (resp != null && resp.has("code") && !resp.isNull("code")) {
                JSONObject codeObj = resp.getJSONObject("code");
                out.canonicalToken = codeObj.optString("codeToken", normToken);
                String lvl = codeObj.optString("codeLevel", "UNIT");
                out.levelLabel = "CARTON".equals(lvl) ? "外箱码" : "单品盒码";
                out.statusLabel = statusToZh(codeObj.optString("status", ""));
                JSONObject prod = codeObj.optJSONObject("product");
                if (prod != null) {
                    out.productName = prod.optString("name", "");
                    out.skuCode = prod.optString("skuCode", "");
                    out.spec = prod.optString("spec", "");
                }
                JSONObject batch = codeObj.optJSONObject("batch");
                if (batch != null) {
                    out.batchNo = batch.optString("batchNo", "");
                }
            } else if ("TRACE".equals(workMode)) {
                out.ok = false;
                out.errorMessage = "系统中未找到防伪码 " + formatCodeGroups(normToken) + " 的记录";
            } else {
                out.productName = "外部商品条码 / 未建档码";
            }
        } catch (Exception e) {
            if ("INBOUND".equals(workMode) || "OUTBOUND".equals(workMode)) {
                out.ok = false;
                out.errorMessage = "产品信息校验失败，请检查网络连接后重试";
            } else {
                out.productName = "已识别产品码";
            }
        }
        return out;
    }

    private JSONObject httpPostJson(String endpoint, JSONObject body) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(endpoint);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(6000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            if (!authToken.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + authToken);
            }
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }
            int code = conn.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            String respStr = readStream(is);
            if (respStr == null || respStr.trim().isEmpty()) return null;
            return new JSONObject(respStr);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private JSONObject httpGetJson(String endpoint) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(endpoint);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(4500);
            conn.setReadTimeout(5000);
            if (!authToken.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + authToken);
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            String respStr = readStream(conn.getInputStream());
            if (respStr == null || respStr.trim().isEmpty()) return null;
            return new JSONObject(respStr);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String readStream(InputStream is) throws Exception {
        if (is == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line);
            }
        }
        return sb.toString();
    }

    private void showProductConfirmDialog(
        String rawInput,
        String canonicalToken,
        LookupResult lookup,
        String format,
        String source
    ) {
        dismissActiveDialog();

        final boolean isTrace = "TRACE".equals(workMode);
        final String title = isTrace ? "识别到产品，是否查看流向？" : "识别到产品，是否加入清单？";
        final String positiveText = isTrace ? "是，查看流向" : "是，加入清单";

        LinearLayout card = buildDialogCardShell(
            "✓",
            0xFFECFDF5,
            0xFF059669,
            "产品识别确认",
            title
        );

        LinearLayout infoBox = buildInfoBox();
        if (lookup.productName != null && !lookup.productName.isEmpty()) {
            String prodText = lookup.productName;
            if (lookup.skuCode != null && !lookup.skuCode.isEmpty()) {
                prodText += "（" + lookup.skuCode + "）";
            }
            addInfoRow(infoBox, "商品", prodText, true, false, 0xFF111827);
        }
        if (lookup.levelLabel != null && !lookup.levelLabel.isEmpty()) {
            String lvlText = (lookup.spec != null && !lookup.spec.isEmpty())
                ? (lookup.spec + " · " + lookup.levelLabel)
                : lookup.levelLabel;
            addInfoRow(infoBox, "规格 / 级别", lvlText, false, false, 0xFF111827);
        }
        addInfoRow(infoBox, "防伪码", formatCodeGroups(canonicalToken), true, true, 0xFF111827);
        if (lookup.batchNo != null && !lookup.batchNo.isEmpty()) {
            addInfoRow(infoBox, "生产批次", lookup.batchNo, false, true, 0xFF374151);
        }
        if (lookup.statusLabel != null && !lookup.statusLabel.isEmpty()) {
            addInfoRow(infoBox, "当前状态", lookup.statusLabel, false, false, 0xFF059669);
        }
        card.addView(infoBox);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams actLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        actLp.topMargin = dp(18);
        actions.setLayoutParams(actLp);

        TextView btnNo = buildDialogButton("否，不加入", false);
        LinearLayout.LayoutParams noLp = new LinearLayout.LayoutParams(0, dp(46), 1.0f);
        noLp.rightMargin = dp(10);
        btnNo.setLayoutParams(noLp);

        TextView btnYes = buildDialogButton(positiveText, true);
        LinearLayout.LayoutParams yesLp = new LinearLayout.LayoutParams(0, dp(46), 1.35f);
        btnYes.setLayoutParams(yesLp);

        actions.addView(btnNo);
        actions.addView(btnYes);
        card.addView(actions);

        final Dialog dialog = createStyledDialog(card, () -> {
            dismissedToken = canonicalToken;
            dismissedAt = System.currentTimeMillis();
            resumeScanningWithInterval("已跳过，1.5 秒后继续识别…");
        });
        btnNo.setOnClickListener(v -> {
            dialog.dismiss();
            dismissedToken = canonicalToken;
            dismissedAt = System.currentTimeMillis();
            resumeScanningWithInterval("已跳过，1.5 秒后继续识别…");
        });
        btnYes.setOnClickListener(v -> {
            dialog.dismiss();
            commitConfirmedCode(canonicalToken, lookup, format, source);
        });
        activeDialog = dialog;
        dialog.show();
    }

    private void showNoticeDialog(String title, String message, String cooldownToken) {
        dismissActiveDialog();

        final boolean isDup = title != null && title.contains("已在清单");
        LinearLayout card = buildDialogCardShell(
            "!",
            isDup ? 0xFFFFFBEB : 0xFFFEF2F2,
            isDup ? 0xFFD97706 : 0xFFDC2626,
            isDup ? "自动去重提示" : "扫码校验提示",
            title != null ? title : "提示"
        );

        LinearLayout infoBox = buildInfoBox();
        if (cooldownToken != null && !cooldownToken.trim().isEmpty()) {
            TextView chip = new TextView(this);
            chip.setText(formatCodeGroups(cooldownToken));
            chip.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
            chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
            chip.setTextColor(0xFF111827);
            chip.setPadding(dp(10), dp(4), dp(10), dp(4));
            chip.setBackground(makePill(0xFFFFFFFF, 0xFFE5E7EB, dp(6)));
            LinearLayout.LayoutParams chipLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            chipLp.bottomMargin = dp(8);
            chip.setLayoutParams(chipLp);
            infoBox.addView(chip);
        }

        TextView bodyTv = new TextView(this);
        bodyTv.setText(message != null ? message : "");
        bodyTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.8f);
        bodyTv.setTextColor(0xFF374151);
        bodyTv.setLineSpacing(dp(4), 1.0f);
        infoBox.addView(bodyTv);
        card.addView(infoBox);

        TextView btnOk = buildDialogButton("知道了，继续扫码", true);
        LinearLayout.LayoutParams okLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(46)
        );
        okLp.topMargin = dp(18);
        btnOk.setLayoutParams(okLp);
        card.addView(btnOk);

        final Dialog dialog = createStyledDialog(card, () -> {
            dismissedToken = cooldownToken;
            dismissedAt = System.currentTimeMillis();
            resumeScanningWithInterval("请移至下一个二维码，1.5 秒后继续识别…");
        });
        btnOk.setOnClickListener(v -> {
            dialog.dismiss();
            dismissedToken = cooldownToken;
            dismissedAt = System.currentTimeMillis();
            resumeScanningWithInterval("请移至下一个二维码，1.5 秒后继续识别…");
        });
        activeDialog = dialog;
        dialog.show();
    }

    private void resumeScanningWithInterval(String hintMsg) {
        nextScanAllowedAt = System.currentTimeMillis() + CONTINUOUS_INTERVAL_MS;
        pausedForConfirm = false;
        overlayView.setCoolingDown(true);
        mainHandler.removeCallbacks(cooldownDoneRunnable);
        mainHandler.removeCallbacks(restoreHintRunnable);
        if (hintMsg != null && !hintMsg.isEmpty()) {
            tvHint.setTextColor(0xB3FFFFFF);
            tvHint.setText(hintMsg);
        }
        mainHandler.postDelayed(cooldownDoneRunnable, CONTINUOUS_INTERVAL_MS);
    }

    private LinearLayout buildDialogCardShell(
        String badgeGlyph,
        int badgeBgColor,
        int badgeFgColor,
        String kicker,
        String title
    ) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(20), dp(20), dp(20));
        card.setBackground(makePill(0xFFFFFFFF, 0xFFECEEF2, dp(20)));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            card.setElevation(dp(14));
        }

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView badge = new TextView(this);
        badge.setText(badgeGlyph);
        badge.setGravity(Gravity.CENTER);
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f);
        badge.setTypeface(Typeface.DEFAULT_BOLD);
        badge.setTextColor(badgeFgColor);
        badge.setBackground(makePill(badgeBgColor, badgeBgColor, dp(10)));
        LinearLayout.LayoutParams badgeLp = new LinearLayout.LayoutParams(dp(34), dp(34));
        badgeLp.rightMargin = dp(11);
        badge.setLayoutParams(badgeLp);
        header.addView(badge);

        LinearLayout titleCol = new LinearLayout(this);
        titleCol.setOrientation(LinearLayout.VERTICAL);
        titleCol.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView kickerTv = new TextView(this);
        kickerTv.setText(kicker);
        kickerTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
        kickerTv.setTypeface(Typeface.DEFAULT_BOLD);
        kickerTv.setTextColor(badgeFgColor);
        titleCol.addView(kickerTv);

        TextView titleTv = new TextView(this);
        titleTv.setText(title);
        titleTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f);
        titleTv.setTypeface(Typeface.DEFAULT_BOLD);
        titleTv.setTextColor(0xFF111827);
        LinearLayout.LayoutParams tLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        tLp.topMargin = dp(2);
        titleTv.setLayoutParams(tLp);
        titleCol.addView(titleTv);

        header.addView(titleCol);
        card.addView(header);
        return card;
    }

    private LinearLayout buildInfoBox() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(14), dp(12), dp(14), dp(12));
        box.setBackground(makePill(0xFFF8F9FB, 0xFFECEEF2, dp(12)));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        lp.topMargin = dp(14);
        box.setLayoutParams(lp);
        return box;
    }

    private void addInfoRow(
        LinearLayout container,
        String label,
        String value,
        boolean bold,
        boolean mono,
        int valueColor
    ) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.TOP);
        if (container.getChildCount() > 0) {
            LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            rlp.topMargin = dp(8);
            row.setLayoutParams(rlp);
        }

        TextView k = new TextView(this);
        k.setText(label);
        k.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
        k.setTextColor(0xFF6B7280);
        LinearLayout.LayoutParams klp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        klp.rightMargin = dp(12);
        k.setLayoutParams(klp);

        TextView v = new TextView(this);
        v.setText(value);
        v.setGravity(Gravity.END);
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
        v.setTextColor(valueColor);
        v.setTypeface(mono ? Typeface.MONOSPACE : Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        v.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        row.addView(k);
        row.addView(v);
        container.addView(row);
    }

    private TextView buildDialogButton(String text, boolean primary) {
        TextView btn = new TextView(this);
        btn.setText(text);
        btn.setGravity(Gravity.CENTER);
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
        btn.setTypeface(Typeface.DEFAULT_BOLD);
        btn.setClickable(true);
        btn.setFocusable(true);
        if (primary) {
            btn.setTextColor(Color.WHITE);
            btn.setBackground(makePill(0xFF111827, 0xFF111827, dp(10)));
        } else {
            btn.setTextColor(0xFF374151);
            btn.setBackground(makePill(0xFFFFFFFF, 0xFFD1D5DB, dp(10)));
        }
        return btn;
    }

    private Dialog createStyledDialog(View cardView, Runnable onCancelAction) {
        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setCancelable(false);
        dialog.setCanceledOnTouchOutside(false);

        FrameLayout wrapper = new FrameLayout(this);
        wrapper.setPadding(dp(22), dp(22), dp(22), dp(22));
        wrapper.addView(cardView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        dialog.setContentView(wrapper);

        Window win = dialog.getWindow();
        if (win != null) {
            win.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            win.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            WindowManager.LayoutParams lp = win.getAttributes();
            int screenW = getResources().getDisplayMetrics().widthPixels;
            lp.width = Math.min(screenW, dp(388));
            lp.height = WindowManager.LayoutParams.WRAP_CONTENT;
            lp.dimAmount = 0.56f;
            lp.gravity = Gravity.CENTER;
            win.setAttributes(lp);
        }
        dialog.setOnCancelListener(d -> {
            if (onCancelAction != null) onCancelAction.run();
        });
        return dialog;
    }

    private void commitConfirmedCode(String canonicalToken, LookupResult lookup, String format, String source) {
        if ("TRACE".equals(workMode)) {
            if (finished.compareAndSet(false, true)) {
                Intent data = new Intent();
                data.putExtra(EXTRA_TEXT, canonicalToken);
                data.putExtra(EXTRA_FORMAT, format);
                data.putExtra(EXTRA_SOURCE, source);
                data.putExtra(EXTRA_COUNT, 1);
                setResult(Activity.RESULT_OK, data);
                finish();
            }
            return;
        }

        // Record in strict dedupe set (canonical + child tokens)
        acceptedTokens.add(canonicalToken);
        if (lookup.childTokens != null) {
            acceptedTokens.addAll(lookup.childTokens);
        }
        if (!confirmedCodes.contains(canonicalToken)) {
            confirmedCodes.add(canonicalToken);
        }

        if (!continuousMode) {
            if (finished.compareAndSet(false, true)) {
                Intent data = new Intent();
                data.putExtra(EXTRA_TEXT, canonicalToken);
                data.putExtra(EXTRA_FORMAT, format);
                data.putExtra(EXTRA_SOURCE, source);
                data.putExtra(EXTRA_COUNT, 1);
                data.putStringArrayListExtra(EXTRA_CONFIRMED_CODES, confirmedCodes);
                setResult(Activity.RESULT_OK, data);
                finish();
            }
            return;
        }

        continuousScanCount = confirmedCodes.size();
        String label = (lookup.productName != null && !lookup.productName.isEmpty())
            ? (lookup.productName + " · " + formatCodeGroups(canonicalToken))
            : formatCodeGroups(canonicalToken);
        tvLastCode.setTextColor(Color.WHITE);
        tvLastCode.setText("已加入：" + label);
        updateModeUi();
        LuminaScannerPlugin.dispatchContinuousResult(canonicalToken, format, source);
        resumeScanningWithInterval("已加入清单，1.5 秒后可扫下一件…");
    }

    private void dismissActiveDialog() {
        try {
            if (activeDialog != null && activeDialog.isShowing()) {
                activeDialog.dismiss();
            }
        } catch (Exception ignored) {}
        activeDialog = null;
    }

    private void openGalleryPicker() {
        pausedForGallery = true;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Intent picker = new Intent(MediaStore.ACTION_PICK_IMAGES);
                picker.setType("image/*");
                picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                galleryLauncher.launch(picker);
                return;
            }
        } catch (Exception ignored) {}
        try {
            Intent pick = new Intent(Intent.ACTION_PICK);
            pick.setDataAndType(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image/*");
            pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            galleryLauncher.launch(pick);
            return;
        } catch (Exception ignored) {}
        Intent get = new Intent(Intent.ACTION_GET_CONTENT);
        get.setType("image/*");
        get.addCategory(Intent.CATEGORY_OPENABLE);
        get.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        galleryLauncher.launch(Intent.createChooser(get, "选择包含二维码的图片"));
    }

    private void decodeGalleryUri(Uri uri) {
        showLoading("正在识别图库二维码…");
        pausedForGallery = true;
        galleryExecutor.execute(() -> {
            QrImageDecoder.DecodeResult res = QrImageDecoder.decodeFromUri(getApplicationContext(), uri);
            mainHandler.post(() -> {
                hideLoading();
                pausedForGallery = false;
                if (res != null) {
                    dismissedToken = "";
                    nextScanAllowedAt = 0L;
                    onCodeDetected(res.text, res.format, "gallery");
                } else {
                    Toast.makeText(
                        NativeScannerActivity.this,
                        "未在所选图片中识别到二维码或条形码，请换一张清晰图片",
                        Toast.LENGTH_LONG
                    ).show();
                }
            });
        });
    }

    private void playScanFeedback() {
        try {
            if (toneGenerator != null) {
                toneGenerator.startTone(ToneGenerator.TONE_PROP_BEEP, 90);
            }
        } catch (Exception ignored) {}
        vibrateMs(45);
    }

    private void playWarningFeedback() {
        try {
            if (toneGenerator != null) {
                toneGenerator.startTone(ToneGenerator.TONE_PROP_NACK, 120);
            }
        } catch (Exception ignored) {}
        vibrateMs(90);
    }

    private void vibrateMs(long ms) {
        try {
            Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(ms);
                }
            }
        } catch (Exception ignored) {}
    }

    private void finishWithContinuousSummary(boolean openManual) {
        if (finished.compareAndSet(false, true)) {
            dismissActiveDialog();
            if (openManual || !confirmedCodes.isEmpty()) {
                Intent data = new Intent();
                data.putExtra(EXTRA_COUNT, confirmedCodes.size());
                data.putExtra(EXTRA_SOURCE, openManual ? "manual" : "continuous");
                data.putExtra(EXTRA_OPEN_MANUAL, openManual);
                data.putStringArrayListExtra(EXTRA_CONFIRMED_CODES, confirmedCodes);
                setResult(Activity.RESULT_OK, data);
            } else {
                setResult(Activity.RESULT_CANCELED);
            }
            finish();
        }
    }

    @Override
    public void onBackPressed() {
        if (pausedForConfirm && activeDialog != null && activeDialog.isShowing()) {
            activeDialog.cancel();
            return;
        }
        finishWithContinuousSummary(false);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        mainHandler.removeCallbacks(cooldownDoneRunnable);
        mainHandler.removeCallbacks(restoreHintRunnable);
        dismissActiveDialog();
        try {
            if (cameraProvider != null) cameraProvider.unbindAll();
        } catch (Exception ignored) {}
        try {
            if (barcodeScanner != null) barcodeScanner.close();
        } catch (Exception ignored) {}
        try {
            if (toneGenerator != null) toneGenerator.release();
        } catch (Exception ignored) {}
        if (analysisExecutor != null) analysisExecutor.shutdownNow();
        if (galleryExecutor != null) galleryExecutor.shutdownNow();
        if (networkExecutor != null) networkExecutor.shutdownNow();
    }
}
