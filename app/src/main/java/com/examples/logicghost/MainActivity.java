package com.examples.logicghost;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "LogicGhost";
    private static final int PERM_CODE = 1001;
    private static final String PREFS_NAME = "LogicGhostPrefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String DEFAULT_SERVER_URL = "http://127.0.0.1:5000";

    public static class HistoryItem {
        public String tag;
        public String payload;
        public String duration;
        public String timeFormatted;
        public boolean isMultiSlot;
        public String slotCode;
        public String slotReason;
        public String slotRating;
        public String slotAudit;

        public HistoryItem(String tag, String payload, String duration, String timeFormatted,
                           boolean isMultiSlot, String slotCode, String slotReason, String slotRating, String slotAudit) {
            this.tag = tag;
            this.payload = payload;
            this.duration = duration;
            this.timeFormatted = timeFormatted;
            this.isMultiSlot = isMultiSlot;
            this.slotCode = slotCode;
            this.slotReason = slotReason;
            this.slotRating = slotRating;
            this.slotAudit = slotAudit;
        }
    }

    private final List<HistoryItem> historyList = new ArrayList<>();

    private LinearLayout layoutTopHud;
    private EditText etServerUrl;
    private View ledServer, ledBluetooth;
    private TextView tvServerStatus, tvBluetoothStatus, tvStatus;
    private PreviewView previewView;
    private ImageButton btnCapture;

    private View btnRestoreHud, btnQuickResult;
    private LinearLayout layoutResponseContainer, layoutCheckMode, layoutCompareMode, layoutTypeMode;
    private TextView tvTagHeader, tvResultDuration, tvVoicePayload, tvCheckSelected, tvCompareBest, tvCompareReason, tvCodePayload;
    private TextView btnMaximizeResult, btnCloseResult, btnCopyResult;

    // Standard Buttons
    private LinearLayout layoutStandardTypeButtons;
    private Button btnTypeDirect, btnTypeBluetooth;

    // Multi-Slot RLHF Buttons & Tabs
    private LinearLayout layoutMultiSlotTypeButtons;
    private Button btnTypeCode, btnTypeReason, btnTypeRating;
    private LinearLayout layoutMultiSlotTabs;
    private TextView tabSlotCode, tabSlotReason, tabSlotRating;

    private String currentSlotCode = "";
    private String currentSlotReason = "";
    private String currentSlotRating = "";
    private String currentSlotAudit = "";
    private boolean isMultiSlot = false;

    private boolean isResultMaximized = false;
    private ImageCapture imageCapture;
    private BluetoothHidManager hidManager;

    private final OkHttpClient httpClient = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build();

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private String currentPayload = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        hideSystemUI();

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        initViews();
        hidManager = BluetoothHidManager.getInstance(this);

        if (hasAllPermissions()) {
            startCamera();
        } else {
            requestAppPermissions();
        }

        startHealthCheckLoop();
    }

    private void hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            final WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
    }

    private void initViews() {
        layoutTopHud = findViewById(R.id.layoutTopHud);
        etServerUrl = findViewById(R.id.etServerUrl);
        ledServer = findViewById(R.id.ledServer);
        ledBluetooth = findViewById(R.id.ledBluetooth);
        tvServerStatus = findViewById(R.id.tvServerStatus);
        tvBluetoothStatus = findViewById(R.id.tvBluetoothStatus);
        tvStatus = findViewById(R.id.tvStatus);
        previewView = findViewById(R.id.previewView);
        btnCapture = findViewById(R.id.btnCapture);

        btnRestoreHud = findViewById(R.id.btnRestoreHud);
        btnQuickResult = findViewById(R.id.btnQuickResult);

        layoutResponseContainer = findViewById(R.id.layoutResponseContainer);
        layoutCheckMode = findViewById(R.id.layoutCheckMode);
        layoutCompareMode = findViewById(R.id.layoutCompareMode);
        layoutTypeMode = findViewById(R.id.layoutTypeMode);

        tvTagHeader = findViewById(R.id.tvTagHeader);
        tvResultDuration = findViewById(R.id.tvResultDuration);
        tvVoicePayload = findViewById(R.id.tvVoicePayload);
        tvCheckSelected = findViewById(R.id.tvCheckSelected);
        tvCompareBest = findViewById(R.id.tvCompareBest);
        tvCompareReason = findViewById(R.id.tvCompareReason);
        tvCodePayload = findViewById(R.id.tvCodePayload);

        btnMaximizeResult = findViewById(R.id.btnMaximizeResult);
        btnCloseResult = findViewById(R.id.btnCloseResult);
        btnCopyResult = findViewById(R.id.btnCopyResult);

        // Standard Buttons
        layoutStandardTypeButtons = findViewById(R.id.layoutStandardTypeButtons);
        btnTypeDirect = findViewById(R.id.btnTypeDirect);
        btnTypeBluetooth = findViewById(R.id.btnTypeBluetooth);

        // Multi-Slot RLHF Buttons & Tabs
        layoutMultiSlotTypeButtons = findViewById(R.id.layoutMultiSlotTypeButtons);
        btnTypeCode = findViewById(R.id.btnTypeCode);
        btnTypeReason = findViewById(R.id.btnTypeReason);
        btnTypeRating = findViewById(R.id.btnTypeRating);

        layoutMultiSlotTabs = findViewById(R.id.layoutMultiSlotTabs);
        tabSlotCode = findViewById(R.id.tabSlotCode);
        tabSlotReason = findViewById(R.id.tabSlotReason);
        tabSlotRating = findViewById(R.id.tabSlotRating);

        // Always ensure a valid URL exists (Defaults to http://127.0.0.1:5000)
        String savedUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL);
        if (savedUrl == null || savedUrl.trim().isEmpty()) {
            savedUrl = DEFAULT_SERVER_URL;
        }
        etServerUrl.setText(savedUrl);

        etServerUrl.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                String val = s.toString().trim();
                prefs.edit().putString(KEY_SERVER_URL, val.isEmpty() ? DEFAULT_SERVER_URL : val).apply();
            }

            @Override
            public void afterTextChanged(Editable s) {}
        });

        // Toggle Top HUD Collapse/Show
        View btnToggleHud = findViewById(R.id.btnToggleHud);
        if (btnToggleHud != null) {
            btnToggleHud.setOnClickListener(v -> {
                layoutTopHud.setVisibility(View.GONE);
                btnRestoreHud.setVisibility(View.VISIBLE);
            });
        }

        if (btnRestoreHud != null) {
            btnRestoreHud.setOnClickListener(v -> {
                layoutTopHud.setVisibility(View.VISIBLE);
                btnRestoreHud.setVisibility(View.GONE);
            });
        }

        // 1-Click History Button
        View btnHistory = findViewById(R.id.btnHistory);
        if (btnHistory != null) {
            btnHistory.setOnClickListener(v -> showHistoryDialog());
        }

        // 1-Click USB Tethering Button
        View btnUsbTether = findViewById(R.id.btnUsbTether);
        if (btnUsbTether != null) {
            btnUsbTether.setOnClickListener(v -> openUsbTetheringSettings());
        }

        // 1-Click Setup Guide Button
        View btnGuide = findViewById(R.id.btnGuide);
        if (btnGuide != null) {
            btnGuide.setOnClickListener(v -> showSetupGuideDialog(false));
        }

        // Capture Shutter Button
        btnCapture.setOnClickListener(v -> captureAndProcessScreen());

        // Quick View Result Floating Pill
        if (btnQuickResult != null) {
            btnQuickResult.setOnClickListener(v -> {
                layoutResponseContainer.setVisibility(View.VISIBLE);
                btnQuickResult.setVisibility(View.GONE);
            });
        }

        // Result Sheet Maximize / Restore
        if (btnMaximizeResult != null) {
            btnMaximizeResult.setOnClickListener(v -> toggleMaximizeResult());
        }

        // Result Sheet Close / Minimize
        if (btnCloseResult != null) {
            btnCloseResult.setOnClickListener(v -> {
                layoutResponseContainer.setVisibility(View.GONE);
                if (!currentPayload.isEmpty()) {
                    btnQuickResult.setVisibility(View.VISIBLE);
                }
            });
        }

        // Result Sheet Copy Button
        if (btnCopyResult != null) {
            btnCopyResult.setOnClickListener(v -> {
                if (!currentPayload.isEmpty()) {
                    ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    ClipData clip = ClipData.newPlainText("LogicGhost Payload", currentPayload);
                    clipboard.setPrimaryClip(clip);
                    Toast.makeText(MainActivity.this, "📋 Copied to clipboard!", Toast.LENGTH_SHORT).show();
                }
            });
        }

        // Standard Typing Actions
        btnTypeDirect.setOnClickListener(v -> triggerDirectServerTyping(currentPayload));
        btnTypeBluetooth.setOnClickListener(v -> triggerBluetoothTyping(currentPayload));

        // Multi-Slot RLHF Typing Actions
        btnTypeCode.setOnClickListener(v -> triggerDirectServerTyping(currentSlotCode.isEmpty() ? currentPayload : currentSlotCode));
        btnTypeReason.setOnClickListener(v -> triggerDirectServerTyping(currentSlotReason));
        btnTypeRating.setOnClickListener(v -> triggerDirectServerTyping(currentSlotRating));

        Button btnTypeAutoSequence = findViewById(R.id.btnTypeAutoSequence);
        if (btnTypeAutoSequence != null) {
            btnTypeAutoSequence.setOnClickListener(v -> triggerAutoSequenceTyping());
        }

        // Emergency Stop Typing Buttons (Standard, Multi-Slot, Header)
        View.OnClickListener stopClickListener = v -> triggerEmergencyStopTyping();

        Button btnStopResponse = findViewById(R.id.btnStopResponse);
        if (btnStopResponse != null) btnStopResponse.setOnClickListener(stopClickListener);

        Button btnStopMultiSlot = findViewById(R.id.btnStopMultiSlot);
        if (btnStopMultiSlot != null) btnStopMultiSlot.setOnClickListener(stopClickListener);

        TextView btnHeaderStopTyping = findViewById(R.id.btnHeaderStopTyping);
        if (btnHeaderStopTyping != null) btnHeaderStopTyping.setOnClickListener(stopClickListener);

        // Multi-Slot Tab Switching
        tabSlotCode.setOnClickListener(v -> selectMultiSlotTab("code"));
        tabSlotReason.setOnClickListener(v -> selectMultiSlotTab("reason"));
        tabSlotRating.setOnClickListener(v -> selectMultiSlotTab("rating"));

        View.OnClickListener btReconnectListener = v -> showBluetoothDeviceSelectorDialog();
        ledBluetooth.setOnClickListener(btReconnectListener);
        tvBluetoothStatus.setOnClickListener(btReconnectListener);
        findViewById(R.id.cardBluetoothStatus).setOnClickListener(btReconnectListener);

        // Show setup guide on first run
        boolean setupDone = prefs.getBoolean("first_run_setup_done", false);
        if (!setupDone) {
            handler.postDelayed(() -> showSetupGuideDialog(true), 800);
        }
    }

    private void selectMultiSlotTab(String tabKey) {
        tabSlotCode.setBackgroundResource(R.drawable.btn_pill_cyber);
        tabSlotCode.setTextColor(Color.parseColor("#94A3B8"));
        tabSlotReason.setBackgroundResource(R.drawable.btn_pill_cyber);
        tabSlotReason.setTextColor(Color.parseColor("#94A3B8"));
        tabSlotRating.setBackgroundResource(R.drawable.btn_pill_cyber);
        tabSlotRating.setTextColor(Color.parseColor("#94A3B8"));

        tvVoicePayload.setVisibility(View.GONE);
        layoutCheckMode.setVisibility(View.GONE);
        layoutCompareMode.setVisibility(View.GONE);
        layoutTypeMode.setVisibility(View.GONE);

        if ("reason".equalsIgnoreCase(tabKey)) {
            tabSlotReason.setBackgroundColor(Color.parseColor("#00FF88"));
            tabSlotReason.setTextColor(Color.parseColor("#000000"));
            tvVoicePayload.setVisibility(View.VISIBLE);
            tvVoicePayload.setText(currentSlotReason);
        } else if ("rating".equalsIgnoreCase(tabKey)) {
            tabSlotRating.setBackgroundColor(Color.parseColor("#A855F7"));
            tabSlotRating.setTextColor(Color.parseColor("#FFFFFF"));
            tvVoicePayload.setVisibility(View.VISIBLE);
            String text = "⭐ VERDICT / RATING:\n" + currentSlotRating;
            if (!currentSlotAudit.isEmpty()) {
                text += "\n\n🛡️ AUDIT:\n" + currentSlotAudit;
            }
            tvVoicePayload.setText(text);
        } else {
            // "code"
            tabSlotCode.setBackgroundColor(Color.parseColor("#00FF88"));
            tabSlotCode.setTextColor(Color.parseColor("#000000"));
            layoutTypeMode.setVisibility(View.VISIBLE);
            tvCodePayload.setText(currentSlotCode.isEmpty() ? currentPayload : currentSlotCode);
        }
    }

    private void toggleMaximizeResult() {
        isResultMaximized = !isResultMaximized;
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) layoutResponseContainer.getLayoutParams();
        float density = getResources().getDisplayMetrics().density;
        if (isResultMaximized) {
            params.height = FrameLayout.LayoutParams.MATCH_PARENT;
            params.bottomMargin = (int) (12 * density);
            params.topMargin = (int) (48 * density);
            params.setMarginStart((int) (12 * density));
            params.setMarginEnd((int) (12 * density));
            btnMaximizeResult.setText("🗗");
        } else {
            params.height = (int) (230 * density);
            params.bottomMargin = (int) (16 * density);
            params.topMargin = 0;
            params.setMarginStart((int) (152 * density));
            params.setMarginEnd((int) (104 * density));
            btnMaximizeResult.setText("⛶");
        }
        layoutResponseContainer.setLayoutParams(params);
    }

    /**
     * Shows Dialog with Last 10 Captures History
     */
    private void showHistoryDialog() {
        if (historyList.isEmpty()) {
            Toast.makeText(this, "No capture history yet. Take a picture first!", Toast.LENGTH_SHORT).show();
            return;
        }

        String[] items = new String[historyList.size()];
        for (int i = 0; i < historyList.size(); i++) {
            HistoryItem h = historyList.get(i);
            String snippet = h.payload.replace("\n", " ").trim();
            if (snippet.length() > 36) snippet = snippet.substring(0, 36) + "...";
            items[i] = (i + 1) + ". " + h.tag + (h.isMultiSlot ? " [RLHF]" : "") + " (" + h.timeFormatted + ")\n   " + snippet;
        }

        new AlertDialog.Builder(this)
                .setTitle("⏱️ RECENT CAPTURES HISTORY (LAST 10)")
                .setItems(items, (dialog, which) -> {
                    HistoryItem selected = historyList.get(which);
                    renderResponseUI(selected.tag, selected.payload, selected.duration,
                            selected.isMultiSlot, selected.slotCode, selected.slotReason, selected.slotRating, selected.slotAudit);
                    Toast.makeText(MainActivity.this, "Loaded " + selected.tag + " into view. Tap TYPE to type!", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Close", null)
                .show();
    }

    /**
     * Interactive Onboarding and Setup Guide Dialog
     */
    private void showSetupGuideDialog(boolean isFirstRun) {
        new AlertDialog.Builder(this)
            .setTitle("🚀 LOGICGHOST ONBOARDING & SETUP")
            .setMessage(
                "Welcome to LogicGhost!\n\n" +
                "⚡ 1. USB DEBUGGING (RECOMMENDED):\n" +
                " • Go to 'About Phone' ➔ Tap 'Build number' 7 times\n" +
                " • Open 'Developer options' ➔ Turn ON 'USB debugging'\n" +
                " • Connect cable to PC (Zero IP config needed at http://127.0.0.1:5000!)\n\n" +
                "🔌 2. USB TETHERING (OPTIONAL):\n" +
                " • Turn ON USB Tethering for direct local LAN.\n\n" +
                "📶 3. BLUETOOTH KEYBOARD MODE:\n" +
                " • Pair phone with PC in Bluetooth settings."
            )
            .setPositiveButton("🛠️ Dev Options", (dialog, which) -> openDeveloperOptions())
            .setNeutralButton("📱 About Phone", (dialog, which) -> openAboutPhoneSettings())
            .setNegativeButton(isFirstRun ? "✅ Got It" : "Close", (dialog, which) -> {
                if (isFirstRun) {
                    prefs.edit().putBoolean("first_run_setup_done", true).apply();
                }
            })
            .show();
    }

    private void openAboutPhoneSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_DEVICE_INFO_SETTINGS));
        } catch (Exception e) {
            Toast.makeText(this, "Could not open About Phone", Toast.LENGTH_SHORT).show();
        }
    }

    private void openDeveloperOptions() {
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS));
        } catch (Exception e) {
            Toast.makeText(this, "Developer options not enabled yet! Tap Build Number 7 times in About Phone.", Toast.LENGTH_LONG).show();
            openAboutPhoneSettings();
        }
    }

    private void openUsbTetheringSettings() {
        Toast.makeText(this, "Opening Tethering Settings — Turn ON USB Tethering", Toast.LENGTH_SHORT).show();
        Intent intent = new Intent();
        intent.setComponent(new android.content.ComponentName("com.android.settings", "com.android.settings.TetherSettings"));
        try {
            startActivity(intent);
        } catch (Exception e) {
            try {
                startActivity(new Intent("android.settings.TETHER_SETTINGS"));
            } catch (Exception e2) {
                try {
                    startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
                } catch (Exception e3) {
                    Toast.makeText(this, "Could not open Tethering Settings directly", Toast.LENGTH_SHORT).show();
                }
            }
        }
    }

    private boolean hasAllPermissions() {
        boolean camera = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        boolean btConnect = true;
        boolean btScan = true;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            btConnect = ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
            btScan = ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
        }

        return camera && btConnect && btScan;
    }

    private void requestAppPermissions() {
        List<String> list = new ArrayList<>();
        list.add(Manifest.permission.CAMERA);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            list.add(Manifest.permission.BLUETOOTH_CONNECT);
            list.add(Manifest.permission.BLUETOOTH_SCAN);
        }

        ActivityCompat.requestPermissions(this, list.toArray(new String[0]), PERM_CODE);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERM_CODE) {
            if (hasAllPermissions()) {
                startCamera();
            } else {
                Toast.makeText(this, "Permissions required for camera and Bluetooth HID", Toast.LENGTH_LONG).show();
            }
        }
    }

    private void startCamera() {
        ProcessCameraProvider.getInstance(this).addListener(() -> {
            try {
                ProcessCameraProvider cameraProvider = ProcessCameraProvider.getInstance(this).get();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());

                imageCapture = new ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                        .build();

                CameraSelector cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;
                cameraProvider.unbindAll();
                cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageCapture);

                updateStatusText("CAMERA READY");
            } catch (ExecutionException | InterruptedException e) {
                Log.e(TAG, "Use case binding failed", e);
                updateStatusText("CAMERA ERROR: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void captureAndProcessScreen() {
        if (imageCapture == null) {
            Toast.makeText(this, "Camera not initialized", Toast.LENGTH_SHORT).show();
            return;
        }

        updateStatusText("📸 CAPTURING FRAME...");
        File photoFile = new File(getCacheDir(), "capture_" + System.currentTimeMillis() + ".jpg");

        ImageCapture.OutputFileOptions outputOptions = new ImageCapture.OutputFileOptions.Builder(photoFile).build();
        imageCapture.takePicture(outputOptions, ContextCompat.getMainExecutor(this), new ImageCapture.OnImageSavedCallback() {
            @Override
            public void onImageSaved(@NonNull ImageCapture.OutputFileResults outputFileResults) {
                updateStatusText("⚡ SOLVING WITH GEMINI AI...");
                uploadImageToServer(photoFile);
            }

            @Override
            public void onError(@NonNull ImageCaptureException exception) {
                Log.e(TAG, "Photo capture failed: " + exception.getMessage(), exception);
                updateStatusText("CAPTURE FAILED: " + exception.getMessage());
            }
        });
    }

    private String getResolvedServerUrl() {
        String url = etServerUrl.getText().toString().trim();
        if (url.isEmpty()) {
            url = DEFAULT_SERVER_URL;
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://" + url;
        }
        return url;
    }

    private void uploadImageToServer(File file) {
        String serverUrl = getResolvedServerUrl();
        String uploadEndpoint = serverUrl.replaceAll("/+$", "") + "/capture";

        RequestBody requestBody = new MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("image", file.getName(),
                        RequestBody.create(file, MediaType.parse("image/jpeg")))
                .build();

        Request request = new Request.Builder()
                .url(uploadEndpoint)
                .post(requestBody)
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                handler.post(() -> {
                    updateStatusText("NETWORK ERROR: " + e.getMessage());
                    Toast.makeText(MainActivity.this, "Server unreachable. Check USB cable / URL.", Toast.LENGTH_SHORT).show();
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) throws IOException {
                if (!response.isSuccessful()) {
                    handler.post(() -> updateStatusText("SERVER ERROR (" + response.code() + ")"));
                    return;
                }

                String responseBody = response.body() != null ? response.body().string() : "";
                try {
                    JsonObject json = JsonParser.parseString(responseBody).getAsJsonObject();
                    String tag = json.has("tag") ? json.get("tag").getAsString() : "[TYPE]";
                    String payload = json.has("payload") ? json.get("payload").getAsString() : "";
                    String duration = json.has("duration") ? json.get("duration").getAsString() : "0.8s";
                    boolean isMulti = json.has("is_multi_slot") && json.get("is_multi_slot").getAsBoolean();

                    String code = "";
                    String reason = "";
                    String rating = "";
                    String audit = "";

                    if (json.has("slots") && json.get("slots").isJsonObject()) {
                        JsonObject slotsObj = json.getAsJsonObject("slots");
                        if (slotsObj.has("code")) code = slotsObj.get("code").getAsString();
                        if (slotsObj.has("explanation")) reason = slotsObj.get("explanation").getAsString();
                        if (slotsObj.has("rating")) rating = slotsObj.get("rating").getAsString();
                        if (slotsObj.has("audit")) audit = slotsObj.get("audit").getAsString();
                    }

                    final String finalCode = code;
                    final String finalReason = reason;
                    final String finalRating = rating;
                    final String finalAudit = audit;

                    handler.post(() -> {
                        updateStatusText("✅ SOLVED (" + duration + ")");
                        renderResponseUI(tag, payload, duration, isMulti, finalCode, finalReason, finalRating, finalAudit);

                        // Save to history
                        String timeNow = new SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(new Date());
                        historyList.add(0, new HistoryItem(tag, payload, duration, timeNow, isMulti, finalCode, finalReason, finalRating, finalAudit));
                        if (historyList.size() > 10) historyList.remove(historyList.size() - 1);
                    });
                } catch (Exception e) {
                    handler.post(() -> updateStatusText("PARSE ERROR: " + e.getMessage()));
                }
            }
        });
    }

    private void triggerHapticSolveNotification() {
        try {
            android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(android.os.VibrationEffect.createOneShot(80, android.os.VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(80);
                }
            }
        } catch (Exception ignored) {}
    }

    private void renderResponseUI(String tag, String payload, String duration,
                                  boolean isMulti, String code, String reason, String rating, String audit) {
        this.currentPayload = payload;
        this.isMultiSlot = isMulti;
        this.currentSlotCode = code != null ? code : "";
        this.currentSlotReason = reason != null ? reason : "";
        this.currentSlotRating = rating != null ? rating : "";
        this.currentSlotAudit = audit != null ? audit : "";

        triggerHapticSolveNotification();

        layoutResponseContainer.setVisibility(View.VISIBLE);
        if (btnQuickResult != null) btnQuickResult.setVisibility(View.GONE);

        tvTagHeader.setText(tag);
        if (tvResultDuration != null) tvResultDuration.setText("⏱️ " + duration);

        tvVoicePayload.setVisibility(View.GONE);
        layoutCheckMode.setVisibility(View.GONE);
        layoutCompareMode.setVisibility(View.GONE);
        layoutTypeMode.setVisibility(View.GONE);

        if (isMulti) {
            tvTagHeader.setText("[RLHF SLOTS]");
            tvTagHeader.setBackgroundColor(Color.parseColor("#A855F7"));
            layoutMultiSlotTabs.setVisibility(View.VISIBLE);
            layoutStandardTypeButtons.setVisibility(View.GONE);
            layoutMultiSlotTypeButtons.setVisibility(View.VISIBLE);

            // Select Code tab by default
            selectMultiSlotTab("code");
        } else {
            layoutMultiSlotTabs.setVisibility(View.GONE);
            layoutStandardTypeButtons.setVisibility(View.VISIBLE);
            layoutMultiSlotTypeButtons.setVisibility(View.GONE);

            if ("[VOICE]".equalsIgnoreCase(tag)) {
                tvTagHeader.setBackgroundColor(Color.parseColor("#3B82F6"));
                tvVoicePayload.setVisibility(View.VISIBLE);
                tvVoicePayload.setText(payload);
            } else if ("[CHECK]".equalsIgnoreCase(tag)) {
                tvTagHeader.setBackgroundColor(Color.parseColor("#10B981"));
                layoutCheckMode.setVisibility(View.VISIBLE);
                tvCheckSelected.setText(payload);
            } else if ("[COMPARE]".equalsIgnoreCase(tag)) {
                tvTagHeader.setBackgroundColor(Color.parseColor("#8B5CF6"));
                layoutCompareMode.setVisibility(View.VISIBLE);
                String[] parts = payload.split("\\|", 2);
                tvCompareBest.setText(parts[0].trim());
                if (parts.length > 1) {
                    tvCompareReason.setText(parts[1].trim());
                } else {
                    tvCompareReason.setText("");
                }
            } else {
                // [TYPE] Default Code Mode
                tvTagHeader.setBackgroundColor(Color.parseColor("#00FF88"));
                layoutTypeMode.setVisibility(View.VISIBLE);
                tvCodePayload.setText(payload);
            }
        }
    }

    private void triggerEmergencyStopTyping() {
        // Haptic double tick for confirmation
        try {
            android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(android.os.VibrationEffect.createWaveform(new long[]{0, 90, 60, 90}, -1));
                } else {
                    v.vibrate(200);
                }
            }
        } catch (Exception ignored) {}

        updateStatusText("🛑 ABORTING ACTIVE TYPING...");
        String serverUrl = getResolvedServerUrl();
        String stopEndpoint = serverUrl.replaceAll("/+$", "") + "/type/stop";

        Request request = new Request.Builder()
                .url(stopEndpoint)
                .post(RequestBody.create("{}", MediaType.parse("application/json; charset=utf-8")))
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                handler.post(() -> {
                    updateStatusText("🛑 TYPING STOPPED (LOCAL)");
                    Toast.makeText(MainActivity.this, "🛑 Typing aborted.", Toast.LENGTH_SHORT).show();
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) {
                handler.post(() -> {
                    updateStatusText("🛑 TYPING ABORTED • READY FOR NEXT");
                    Toast.makeText(MainActivity.this, "🛑 Typing aborted! Ready for next input.", Toast.LENGTH_SHORT).show();
                });
            }
        });
    }

    private void triggerAutoSequenceTyping() {
        List<String> list = new ArrayList<>();
        if (!currentSlotCode.isEmpty()) list.add(currentSlotCode);
        if (!currentSlotReason.isEmpty()) list.add(currentSlotReason);
        if (list.isEmpty()) {
            Toast.makeText(this, "No multi-slot content to auto-fill", Toast.LENGTH_SHORT).show();
            return;
        }

        updateStatusText("🚀 INJECTING AUTO-SEQUENCE (CODE -> TAB -> REASON)...");
        String serverUrl = getResolvedServerUrl();
        String seqEndpoint = serverUrl.replaceAll("/+$", "") + "/type_sequence";

        JsonObject json = new JsonObject();
        com.google.gson.JsonArray arr = new com.google.gson.JsonArray();
        for (String s : list) arr.add(s);
        json.add("slots", arr);
        json.addProperty("inter_key", "TAB");
        json.addProperty("inter_delay_sec", 1.2);

        RequestBody body = RequestBody.create(json.toString(), MediaType.parse("application/json; charset=utf-8"));
        Request request = new Request.Builder()
                .url(seqEndpoint)
                .post(body)
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                handler.post(() -> {
                    updateStatusText("SEQUENCE ERROR: " + e.getMessage());
                    Toast.makeText(MainActivity.this, "Auto-sequence failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) {
                handler.post(() -> {
                    if (response.isSuccessful()) {
                        updateStatusText("✅ AUTO-SEQUENCE INJECTED TO ACTIVE WINDOW");
                        Toast.makeText(MainActivity.this, "🚀 Auto-filling Code & Reason with Tab transition!", Toast.LENGTH_SHORT).show();
                    } else {
                        updateStatusText("SEQUENCE ERROR (" + response.code() + ")");
                    }
                });
            }
        });
    }

    private void triggerDirectServerTyping(String payloadToType) {
        if (payloadToType == null || payloadToType.trim().isEmpty()) {
            Toast.makeText(this, "No text/code in this slot to type.", Toast.LENGTH_SHORT).show();
            return;
        }

        updateStatusText("⚡ INJECTING KEYSTROKES TO ACTIVE WINDOW...");
        String serverUrl = getResolvedServerUrl();
        String typeEndpoint = serverUrl.replaceAll("/+$", "") + "/type";

        JsonObject json = new JsonObject();
        json.addProperty("text", payloadToType);

        RequestBody body = RequestBody.create(json.toString(), MediaType.parse("application/json; charset=utf-8"));
        Request request = new Request.Builder()
                .url(typeEndpoint)
                .post(body)
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                handler.post(() -> {
                    updateStatusText("TYPE ERROR: " + e.getMessage());
                    Toast.makeText(MainActivity.this, "Typing failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) {
                handler.post(() -> {
                    if (response.isSuccessful()) {
                        updateStatusText("✅ TYPED " + payloadToType.length() + " CHARACTERS TO PC");
                        Toast.makeText(MainActivity.this, "Typed " + payloadToType.length() + " chars into active window!", Toast.LENGTH_SHORT).show();
                    } else {
                        updateStatusText("TYPE ERROR (" + response.code() + ")");
                    }
                });
            }
        });
    }

    private void triggerBluetoothTyping(String payloadToType) {
        if (payloadToType == null || payloadToType.trim().isEmpty()) {
            Toast.makeText(this, "No text/code available to type", Toast.LENGTH_SHORT).show();
            return;
        }

        if (hidManager == null || !hidManager.isConnected()) {
            Toast.makeText(this, "Bluetooth HID Keyboard not connected. Tap BT indicator to pair.", Toast.LENGTH_LONG).show();
            showBluetoothDeviceSelectorDialog();
            return;
        }

        updateStatusText("📶 TYPING VIA BLUETOOTH HID...");
        hidManager.sendKeystrokes(payloadToType, new BluetoothHidManager.KeystrokeCallback() {
            @Override
            public void onSuccess() {
                handler.post(() -> {
                    updateStatusText("✅ BLUETOOTH TYPING COMPLETE");
                    Toast.makeText(MainActivity.this, "Keystrokes sent via Bluetooth HID!", Toast.LENGTH_SHORT).show();
                });
            }

            @Override
            public void onError(String error) {
                handler.post(() -> {
                    updateStatusText("BT ERROR: " + error);
                    Toast.makeText(MainActivity.this, "BT Typing Error: " + error, Toast.LENGTH_SHORT).show();
                });
            }
        });
    }

    private void showBluetoothDeviceSelectorDialog() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            Toast.makeText(this, "Bluetooth not supported on this device", Toast.LENGTH_SHORT).show();
            return;
        }

        if (!adapter.isEnabled()) {
            Toast.makeText(this, "Please turn ON Bluetooth first", Toast.LENGTH_SHORT).show();
            startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS));
            return;
        }

        Set<BluetoothDevice> bondedDevices = adapter.getBondedDevices();
        if (bondedDevices == null || bondedDevices.isEmpty()) {
            new AlertDialog.Builder(this)
                    .setTitle("Pair Bluetooth Host")
                    .setMessage("No paired devices found. Please pair your phone with your Computer in Windows Bluetooth Settings.")
                    .setPositiveButton("Open Bluetooth Settings", (dialog, which) -> startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)))
                    .setNegativeButton("Cancel", null)
                    .show();
            return;
        }

        final List<BluetoothDevice> deviceList = new ArrayList<>(bondedDevices);
        String[] names = new String[deviceList.size()];
        for (int i = 0; i < deviceList.size(); i++) {
            BluetoothDevice d = deviceList.get(i);
            String name = d.getName() != null ? d.getName() : d.getAddress();
            names[i] = name + " (" + d.getAddress() + ")";
        }

        new AlertDialog.Builder(this)
                .setTitle("Select Bluetooth Computer / Host")
                .setItems(names, (dialog, which) -> {
                    BluetoothDevice selected = deviceList.get(which);
                    Toast.makeText(MainActivity.this, "Connecting HID to " + selected.getName() + "...", Toast.LENGTH_SHORT).show();
                    hidManager.connectToDevice(selected);
                })
                .setNeutralButton("Open Settings", (dialog, which) -> startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void updateStatusText(String text) {
        handler.post(() -> tvStatus.setText(text));
    }

    private void startHealthCheckLoop() {
        handler.post(new Runnable() {
            @Override
            public void run() {
                checkServerStatus();
                checkBluetoothStatus();
                handler.postDelayed(this, 3000);
            }
        });
    }

    private void checkServerStatus() {
        String serverUrl = getResolvedServerUrl();
        String healthEndpoint = serverUrl.replaceAll("/+$", "") + "/health";

        Request request = new Request.Builder()
                .url(healthEndpoint)
                .get()
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                handler.post(() -> {
                    ledServer.setBackgroundColor(Color.parseColor("#FF3333")); // Red
                    tvServerStatus.setText("SERVER: OFFLINE");
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) {
                handler.post(() -> {
                    if (response.isSuccessful()) {
                        ledServer.setBackgroundColor(Color.parseColor("#00FF88")); // Green
                        tvServerStatus.setText("SERVER: ONLINE");
                    } else {
                        ledServer.setBackgroundColor(Color.parseColor("#FF3333"));
                        tvServerStatus.setText("SERVER: ERROR (" + response.code() + ")");
                    }
                });
            }
        });
    }

    private void checkBluetoothStatus() {
        if (hidManager != null && hidManager.isConnected()) {
            ledBluetooth.setBackgroundColor(Color.parseColor("#00FF88")); // Green
            String deviceName = hidManager.getConnectedDeviceName();
            tvBluetoothStatus.setText("BT: " + (deviceName.length() > 10 ? deviceName.substring(0, 8) + ".." : deviceName));
        } else {
            ledBluetooth.setBackgroundColor(Color.parseColor("#FF3333")); // Red
            tvBluetoothStatus.setText("BT: UNPAIRED");
        }
    }
}