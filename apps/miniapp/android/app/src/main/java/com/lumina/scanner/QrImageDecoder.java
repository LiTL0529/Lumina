package com.lumina.scanner;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.net.Uri;

import androidx.exifinterface.media.ExifInterface;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.GlobalHistogramBinarizer;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.multi.qrcode.QRCodeMultiReader;

import java.io.InputStream;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

public final class QrImageDecoder {

    private static final Pattern LUMINA_TOKEN_PATTERN = Pattern.compile("(?:/v/|[?&]pair=|[0-9A-Za-z]{16})");

    public static final class DecodeResult {
        public final String text;
        public final String format;

        public DecodeResult(String text, String format) {
            this.text = text;
            this.format = format;
        }
    }

    private QrImageDecoder() {}

    public static DecodeResult decodeFromUri(Context context, Uri uri) {
        Bitmap base = loadOrientedWhiteBackedBitmap(context, uri, 2200);
        if (base == null) {
            return null;
        }
        BarcodeScanner scanner = createMlKitScanner();
        try {
            // Stage 1: Full image with white quiet-zone padding (handles tight-cropped QR PNGs + photos)
            DecodeResult r = tryMlKitWithPadding(scanner, base);
            if (r != null) return r;

            // Stage 2: Downscaled to 1080px (reduces moire & high-MP sensor noise)
            Bitmap mid = scaleDownIfLarger(base, 1080);
            if (mid != base) {
                try {
                    r = tryMlKitWithPadding(scanner, mid);
                    if (r != null) return r;
                } finally {
                    mid.recycle();
                }
            }

            // Stage 3: Multi-region crops for tall phone screenshots (center, upper, lower)
            r = tryMlKitCrops(scanner, base);
            if (r != null) return r;

            // Stage 4: ZXing MultiFormatReader (Hybrid + GlobalHistogram, normal + inverted + high-contrast)
            r = tryZxingPipeline(base);
            if (r != null) return r;

            // Stage 5: ZXing QRCodeMultiReader (multiple codes in a label sheet)
            r = tryZxingMultiQr(base);
            if (r != null) return r;

            // Stage 6: Color-inverted bitmap with ML Kit (white-on-dark QR codes)
            Bitmap inverted = createInvertedBitmap(scaleDownIfLarger(base, 1200));
            try {
                r = tryMlKitWithPadding(scanner, inverted);
                if (r != null) return r;
            } finally {
                inverted.recycle();
            }

            return null;
        } finally {
            try {
                scanner.close();
            } catch (Exception ignored) {}
            base.recycle();
        }
    }

    /**
     * Fast ZXing luminance-plane fallback for live CameraX YUV frames.
     */
    public static DecodeResult decodeLuminanceFallback(byte[] yPlane, int width, int height) {
        if (yPlane == null || width <= 0 || height <= 0 || yPlane.length < width * height) {
            return null;
        }
        try {
            PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(
                yPlane, width, height, 0, 0, width, height, false
            );
            MultiFormatReader reader = createZxingReader();
            Result res = decodeWithBinarizers(reader, source);
            if (res != null && res.getText() != null && !res.getText().trim().isEmpty()) {
                return new DecodeResult(res.getText().trim(), res.getBarcodeFormat().name());
            }
        } catch (Exception ignored) {}
        return null;
    }

    public static String mlKitFormatName(int format) {
        switch (format) {
            case Barcode.FORMAT_QR_CODE: return "QR_CODE";
            case Barcode.FORMAT_CODE_128: return "CODE_128";
            case Barcode.FORMAT_CODE_39: return "CODE_39";
            case Barcode.FORMAT_CODE_93: return "CODE_93";
            case Barcode.FORMAT_EAN_13: return "EAN_13";
            case Barcode.FORMAT_EAN_8: return "EAN_8";
            case Barcode.FORMAT_UPC_A: return "UPC_A";
            case Barcode.FORMAT_UPC_E: return "UPC_E";
            case Barcode.FORMAT_DATA_MATRIX: return "DATA_MATRIX";
            case Barcode.FORMAT_PDF417: return "PDF417";
            case Barcode.FORMAT_AZTEC: return "AZTEC";
            default: return "BARCODE";
        }
    }

    public static Barcode pickBestMlKitBarcode(List<Barcode> barcodes, int imgW, int imgH) {
        if (barcodes == null || barcodes.isEmpty()) return null;
        Barcode best = null;
        double bestScore = Double.NEGATIVE_INFINITY;
        float cx = imgW / 2.0f;
        float cy = imgH / 2.0f;
        double maxDist = Math.hypot(cx, cy) + 1.0;

        for (Barcode b : barcodes) {
            String raw = b.getRawValue();
            if (raw == null || raw.trim().isEmpty()) continue;
            double score = 0.0;
            if (LUMINA_TOKEN_PATTERN.matcher(raw).find()) {
                score += 100.0;
            }
            if (b.getFormat() == Barcode.FORMAT_QR_CODE) {
                score += 10.0;
            }
            if (b.getBoundingBox() != null) {
                float bx = b.getBoundingBox().exactCenterX();
                float by = b.getBoundingBox().exactCenterY();
                double distNorm = Math.hypot(bx - cx, by - cy) / maxDist;
                score += (1.0 - distNorm) * 20.0;
            }
            if (score > bestScore) {
                bestScore = score;
                best = b;
            }
        }
        return best;
    }

    private static BarcodeScanner createMlKitScanner() {
        BarcodeScannerOptions options = new BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS)
            .build();
        return BarcodeScanning.getClient(options);
    }

    private static DecodeResult tryMlKitWithPadding(BarcodeScanner scanner, Bitmap src) {
        Bitmap padded = addWhiteQuietZone(src);
        try {
            InputImage image = InputImage.fromBitmap(padded, 0);
            List<Barcode> barcodes = Tasks.await(scanner.process(image), 8, TimeUnit.SECONDS);
            Barcode best = pickBestMlKitBarcode(barcodes, padded.getWidth(), padded.getHeight());
            if (best != null && best.getRawValue() != null) {
                return new DecodeResult(best.getRawValue().trim(), mlKitFormatName(best.getFormat()));
            }
        } catch (Exception ignored) {
        } finally {
            padded.recycle();
        }
        return null;
    }

    private static DecodeResult tryMlKitCrops(BarcodeScanner scanner, Bitmap src) {
        int w = src.getWidth();
        int h = src.getHeight();
        if (w < 200 || h < 200) return null;

        int[][] rects = new int[][] {
            // Center 72%
            { (int) (w * 0.14f), (int) (h * 0.14f), (int) (w * 0.72f), (int) (h * 0.72f) },
            // Upper 60%
            { 0, 0, w, (int) (h * 0.60f) },
            // Lower 60%
            { 0, (int) (h * 0.40f), w, h - (int) (h * 0.40f) },
        };

        for (int[] rect : rects) {
            int cw = Math.min(rect[2], w - rect[0]);
            int ch = Math.min(rect[3], h - rect[1]);
            if (cw < 80 || ch < 80) continue;
            Bitmap crop = Bitmap.createBitmap(src, rect[0], rect[1], cw, ch);
            try {
                DecodeResult r = tryMlKitWithPadding(scanner, crop);
                if (r != null) return r;
            } finally {
                crop.recycle();
            }
        }
        return null;
    }

    private static DecodeResult tryZxingPipeline(Bitmap base) {
        MultiFormatReader reader = createZxingReader();
        int[] targetSizes = new int[] { 1200, 640 };
        for (int maxDim : targetSizes) {
            Bitmap scaled = scaleDownIfLarger(base, maxDim);
            Bitmap padded = addWhiteQuietZone(scaled);
            try {
                DecodeResult r = decodeBitmapZxing(reader, padded);
                if (r != null) return r;

                Bitmap boosted = createHighContrastGray(padded);
                try {
                    r = decodeBitmapZxing(reader, boosted);
                    if (r != null) return r;
                } finally {
                    boosted.recycle();
                }

                Bitmap inverted = createInvertedBitmap(padded);
                try {
                    r = decodeBitmapZxing(reader, inverted);
                    if (r != null) return r;
                } finally {
                    inverted.recycle();
                }
            } finally {
                padded.recycle();
                if (scaled != base) scaled.recycle();
            }
        }

        // Center 70% crop with ZXing
        int w = base.getWidth();
        int h = base.getHeight();
        if (w >= 240 && h >= 240) {
            Bitmap crop = Bitmap.createBitmap(base, (int) (w * 0.15f), (int) (h * 0.15f), (int) (w * 0.70f), (int) (h * 0.70f));
            Bitmap scaled = scaleDownIfLarger(crop, 1000);
            Bitmap padded = addWhiteQuietZone(scaled);
            try {
                DecodeResult r = decodeBitmapZxing(reader, padded);
                if (r != null) return r;
            } finally {
                padded.recycle();
                if (scaled != crop) scaled.recycle();
                crop.recycle();
            }
        }
        return null;
    }

    private static DecodeResult tryZxingMultiQr(Bitmap base) {
        Bitmap scaled = scaleDownIfLarger(base, 1400);
        Bitmap padded = addWhiteQuietZone(scaled);
        try {
            int w = padded.getWidth();
            int h = padded.getHeight();
            int[] pixels = new int[w * h];
            padded.getPixels(pixels, 0, w, 0, 0, w, h);
            RGBLuminanceSource source = new RGBLuminanceSource(w, h, pixels);
            QRCodeMultiReader multiReader = new QRCodeMultiReader();
            Map<DecodeHintType, Object> hints = createZxingHints();
            Result[] results = null;
            try {
                results = multiReader.decodeMultiple(new BinaryBitmap(new HybridBinarizer(source)), hints);
            } catch (Exception ignored) {
                try {
                    results = multiReader.decodeMultiple(new BinaryBitmap(new GlobalHistogramBinarizer(source)), hints);
                } catch (Exception ignored2) {}
            }
            if (results != null && results.length > 0) {
                for (Result r : results) {
                    if (r != null && r.getText() != null && LUMINA_TOKEN_PATTERN.matcher(r.getText()).find()) {
                        return new DecodeResult(r.getText().trim(), r.getBarcodeFormat().name());
                    }
                }
                for (Result r : results) {
                    if (r != null && r.getText() != null && !r.getText().trim().isEmpty()) {
                        return new DecodeResult(r.getText().trim(), r.getBarcodeFormat().name());
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            padded.recycle();
            if (scaled != base) scaled.recycle();
        }
        return null;
    }

    private static DecodeResult decodeBitmapZxing(MultiFormatReader reader, Bitmap bmp) {
        int w = bmp.getWidth();
        int h = bmp.getHeight();
        int[] pixels = new int[w * h];
        bmp.getPixels(pixels, 0, w, 0, 0, w, h);
        RGBLuminanceSource source = new RGBLuminanceSource(w, h, pixels);
        Result res = decodeWithBinarizers(reader, source);
        if (res != null && res.getText() != null && !res.getText().trim().isEmpty()) {
            return new DecodeResult(res.getText().trim(), res.getBarcodeFormat().name());
        }
        return null;
    }

    private static Result decodeWithBinarizers(MultiFormatReader reader, com.google.zxing.LuminanceSource source) {
        try {
            reader.reset();
            return reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source)));
        } catch (Exception ignored) {}
        try {
            reader.reset();
            return reader.decodeWithState(new BinaryBitmap(new GlobalHistogramBinarizer(source)));
        } catch (Exception ignored) {}
        return null;
    }

    private static MultiFormatReader createZxingReader() {
        MultiFormatReader reader = new MultiFormatReader();
        reader.setHints(createZxingHints());
        return reader;
    }

    private static Map<DecodeHintType, Object> createZxingHints() {
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        hints.put(DecodeHintType.ALSO_INVERTED, Boolean.TRUE);
        hints.put(DecodeHintType.CHARACTER_SET, "UTF-8");
        hints.put(DecodeHintType.POSSIBLE_FORMATS, Arrays.asList(
            BarcodeFormat.QR_CODE,
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.CODE_93,
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.DATA_MATRIX,
            BarcodeFormat.PDF_417,
            BarcodeFormat.AZTEC
        ));
        return hints;
    }

    private static Bitmap loadOrientedWhiteBackedBitmap(Context context, Uri uri, int maxDim) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream is = context.getContentResolver().openInputStream(uri)) {
                if (is == null) return null;
                BitmapFactory.decodeStream(is, null, bounds);
            }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                return null;
            }

            int sample = 1;
            int maxSide = Math.max(bounds.outWidth, bounds.outHeight);
            while ((maxSide / sample) > maxDim * 2) {
                sample *= 2;
            }

            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap raw;
            try (InputStream is = context.getContentResolver().openInputStream(uri)) {
                if (is == null) return null;
                raw = BitmapFactory.decodeStream(is, null, opts);
            }
            if (raw == null) return null;

            int orientation = ExifInterface.ORIENTATION_NORMAL;
            try (InputStream exifStream = context.getContentResolver().openInputStream(uri)) {
                if (exifStream != null) {
                    ExifInterface exif = new ExifInterface(exifStream);
                    orientation = exif.getAttributeInt(
                        ExifInterface.TAG_ORIENTATION,
                        ExifInterface.ORIENTATION_NORMAL
                    );
                }
            } catch (Exception ignored) {}

            Bitmap oriented = applyExifOrientation(raw, orientation);
            if (oriented != raw) {
                raw.recycle();
            }

            Bitmap scaled = scaleDownIfLarger(oriented, maxDim);
            if (scaled != oriented) {
                oriented.recycle();
            }

            // Composite onto solid WHITE background so transparent QR PNGs decode cleanly
            Bitmap whiteBacked = Bitmap.createBitmap(scaled.getWidth(), scaled.getHeight(), Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(whiteBacked);
            canvas.drawColor(Color.WHITE);
            canvas.drawBitmap(scaled, 0, 0, null);
            scaled.recycle();
            return whiteBacked;
        } catch (Exception e) {
            return null;
        }
    }

    private static Bitmap applyExifOrientation(Bitmap src, int orientation) {
        Matrix m = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90:
                m.postRotate(90);
                break;
            case ExifInterface.ORIENTATION_ROTATE_180:
                m.postRotate(180);
                break;
            case ExifInterface.ORIENTATION_ROTATE_270:
                m.postRotate(270);
                break;
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                m.preScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                m.preScale(1, -1);
                break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                m.preScale(-1, 1);
                m.postRotate(270);
                break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                m.preScale(-1, 1);
                m.postRotate(90);
                break;
            default:
                return src;
        }
        return Bitmap.createBitmap(src, 0, 0, src.getWidth(), src.getHeight(), m, true);
    }

    private static Bitmap scaleDownIfLarger(Bitmap src, int maxDim) {
        int w = src.getWidth();
        int h = src.getHeight();
        int longest = Math.max(w, h);
        if (longest <= maxDim) return src;
        float ratio = (float) maxDim / (float) longest;
        int nw = Math.max(1, Math.round(w * ratio));
        int nh = Math.max(1, Math.round(h * ratio));
        return Bitmap.createScaledBitmap(src, nw, nh, true);
    }

    private static Bitmap addWhiteQuietZone(Bitmap src) {
        int pad = Math.max(48, Math.min(src.getWidth(), src.getHeight()) / 12);
        Bitmap out = Bitmap.createBitmap(
            src.getWidth() + pad * 2,
            src.getHeight() + pad * 2,
            Bitmap.Config.ARGB_8888
        );
        Canvas canvas = new Canvas(out);
        canvas.drawColor(Color.WHITE);
        canvas.drawBitmap(src, pad, pad, null);
        return out;
    }

    private static Bitmap createHighContrastGray(Bitmap src) {
        Bitmap out = Bitmap.createBitmap(src.getWidth(), src.getHeight(), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint();
        ColorMatrix gray = new ColorMatrix();
        gray.setSaturation(0f);
        float c = 1.65f;
        float t = (-0.5f * c + 0.5f) * 255f;
        ColorMatrix contrast = new ColorMatrix(new float[] {
            c, 0, 0, 0, t,
            0, c, 0, 0, t,
            0, 0, c, 0, t,
            0, 0, 0, 1, 0
        });
        gray.postConcat(contrast);
        paint.setColorFilter(new ColorMatrixColorFilter(gray));
        canvas.drawBitmap(src, 0, 0, paint);
        return out;
    }

    private static Bitmap createInvertedBitmap(Bitmap src) {
        Bitmap out = Bitmap.createBitmap(src.getWidth(), src.getHeight(), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint();
        ColorMatrix inv = new ColorMatrix(new float[] {
            -1,  0,  0, 0, 255,
             0, -1,  0, 0, 255,
             0,  0, -1, 0, 255,
             0,  0,  0, 1, 0
        });
        paint.setColorFilter(new ColorMatrixColorFilter(inv));
        canvas.drawBitmap(src, 0, 0, paint);
        return out;
    }
}
