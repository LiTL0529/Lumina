package com.lumina.scanner;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "LuminaScanner",
    permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
    }
)
public class LuminaScannerPlugin extends Plugin {

    private static volatile LuminaScannerPlugin activeInstance;
    private final ExecutorService decodeExecutor = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        super.load();
        activeInstance = this;
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (activeInstance == this) {
            activeInstance = null;
        }
        decodeExecutor.shutdownNow();
    }

    public static void dispatchContinuousResult(String text, String format, String source) {
        LuminaScannerPlugin inst = activeInstance;
        if (inst == null || text == null || text.isEmpty()) return;
        JSObject payload = new JSObject();
        payload.put("text", text);
        payload.put("format", format != null ? format : "QR_CODE");
        payload.put("source", source != null ? source : "camera");
        inst.notifyListeners("scanResult", payload);
    }

    @PluginMethod
    public void appReady(PluginCall call) {
        MainActivity.notifyWebReady();
        call.resolve();
    }

    @PluginMethod
    public void openScanner(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback");
            return;
        }
        launchScannerActivity(call);
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            launchScannerActivity(call);
        } else {
            call.reject("摄像头权限被拒绝，请在系统设置中允许「Lumina 扫码」使用相机，或直接使用「相册识别」");
        }
    }

    private void launchScannerActivity(PluginCall call) {
        Intent intent = new Intent(getContext(), NativeScannerActivity.class);
        // Default continuous mode = true
        boolean continuous = call.hasOption("continuous")
            ? Boolean.TRUE.equals(call.getBoolean("continuous", true))
            : true;
        intent.putExtra(NativeScannerActivity.EXTRA_CONTINUOUS, continuous);
        intent.putExtra(
            NativeScannerActivity.EXTRA_CONFIRM_BEFORE_ADD,
            !call.hasOption("confirmBeforeAdd") || Boolean.TRUE.equals(call.getBoolean("confirmBeforeAdd", true))
        );

        putIfNotNull(intent, NativeScannerActivity.EXTRA_TITLE, call.getString("title"));
        putIfNotNull(intent, NativeScannerActivity.EXTRA_HINT, call.getString("hint"));
        putIfNotNull(intent, NativeScannerActivity.EXTRA_API_BASE_URL, call.getString("apiBaseUrl"));
        putIfNotNull(intent, NativeScannerActivity.EXTRA_AUTH_TOKEN, call.getString("authToken"));
        putIfNotNull(intent, NativeScannerActivity.EXTRA_WORK_MODE, call.getString("workMode"));
        putIfNotNull(intent, NativeScannerActivity.EXTRA_VALIDATE_MODE, call.getString("validateMode"));
        putIfNotNull(intent, NativeScannerActivity.EXTRA_WAREHOUSE_ID, call.getString("warehouseId"));
        putIfNotNull(intent, NativeScannerActivity.EXTRA_PRODUCT_ID, call.getString("productId"));
        putIfNotNull(intent, NativeScannerActivity.EXTRA_CODE_LEVEL, call.getString("codeLevel"));
        putIfNotNull(intent, NativeScannerActivity.EXTRA_BATCH_NO, call.getString("batchNo"));

        JSArray existingArr = call.getArray("existingCodes");
        if (existingArr != null && existingArr.length() > 0) {
            ArrayList<String> existingList = new ArrayList<>();
            for (int i = 0; i < existingArr.length(); i++) {
                String item = existingArr.optString(i, null);
                if (item != null && !item.trim().isEmpty()) {
                    existingList.add(item.trim());
                }
            }
            intent.putStringArrayListExtra(NativeScannerActivity.EXTRA_EXISTING_CODES, existingList);
        }

        startActivityForResult(call, intent, "handleScannerResult");
    }

    private void putIfNotNull(Intent intent, String key, String value) {
        if (value != null && !value.trim().isEmpty()) {
            intent.putExtra(key, value.trim());
        }
    }

    @ActivityCallback
    private void handleScannerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Intent data = result.getData();
            String text = data.getStringExtra(NativeScannerActivity.EXTRA_TEXT);
            String format = data.getStringExtra(NativeScannerActivity.EXTRA_FORMAT);
            String source = data.getStringExtra(NativeScannerActivity.EXTRA_SOURCE);
            int count = data.getIntExtra(NativeScannerActivity.EXTRA_COUNT, 0);
            boolean openManual = data.getBooleanExtra(NativeScannerActivity.EXTRA_OPEN_MANUAL, false);
            ArrayList<String> confirmed = data.getStringArrayListExtra(NativeScannerActivity.EXTRA_CONFIRMED_CODES);

            ret.put("cancelled", false);
            if (text != null) ret.put("text", text);
            if (format != null) ret.put("format", format);
            if (source != null) ret.put("source", source);
            ret.put("count", count);
            ret.put("openManual", openManual);
            if (confirmed != null) {
                JSArray arr = new JSArray();
                for (String c : confirmed) {
                    arr.put(c);
                }
                ret.put("confirmedCodes", arr);
            }
        } else {
            ret.put("cancelled", true);
            ret.put("count", 0);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void pickAndDecodeImage(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Intent picker = new Intent(MediaStore.ACTION_PICK_IMAGES);
                picker.setType("image/*");
                picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivityForResult(call, picker, "handleGalleryResult");
                return;
            }
        } catch (Exception ignored) {}
        try {
            Intent pick = new Intent(Intent.ACTION_PICK);
            pick.setDataAndType(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image/*");
            pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(call, pick, "handleGalleryResult");
            return;
        } catch (Exception ignored) {}
        Intent get = new Intent(Intent.ACTION_GET_CONTENT);
        get.setType("image/*");
        get.addCategory(Intent.CATEGORY_OPENABLE);
        get.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, Intent.createChooser(get, "选择包含二维码的图片"), "handleGalleryResult");
    }

    @ActivityCallback
    private void handleGalleryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }
        final Uri uri = result.getData().getData();
        decodeExecutor.execute(() -> {
            QrImageDecoder.DecodeResult decoded = QrImageDecoder.decodeFromUri(getContext(), uri);
            if (decoded != null) {
                JSObject ret = new JSObject();
                ret.put("cancelled", false);
                ret.put("text", decoded.text);
                ret.put("format", decoded.format);
                ret.put("source", "gallery");
                call.resolve(ret);
            } else {
                call.reject("未在该图片中识别到清晰的二维码或条形码，请确认图片包含完整二维码后重试");
            }
        });
    }
}
