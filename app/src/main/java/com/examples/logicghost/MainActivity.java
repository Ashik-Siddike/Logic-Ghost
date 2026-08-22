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
import android.hardware.SensorManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Log;
import android.view.OrientationEventListener;
import android.view.ScaleGestureDetector;
import android.view.Surface;
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
import androidx.camera.core.Camera;
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
import java.util.Collections;
import java.util.Comparator;
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
    private static final String KEY_TTS_VOICE = "tts_selected_voice";
    private static final String KEY_TTS_SPEED = "tts_speech_rate";
    private static final int REQUEST_CODE_PERMISSIONS = 101;

    private static final String[] REQUIRED_PERMISSIONS = new String[]{
            Manifest.permission.CAMERA,
            Manifest.permission.BLUETOOTH,
            Manifest.permission.BLUETOOTH_ADMIN,
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.VIBRATE
    };

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
    private TextView btnQuickSpeak, btnSpeakResult;
    private LinearLayout layoutResponseContainer, layoutCheckMode, layoutCompareMode, layoutTypeMode, layoutVoiceMode;
    private TextView tvTagHeader, tvResultDuration, tvVoicePayload, tvCheckSelected, tvCompareBest, tvCompareReason, tvCodePayload;
    private TextView btnMaximizeResult, btnCloseResult, btnCopyResult;

    // Native Text-to-Speech Engine
    private TextToSpeech tts;
    private boolean isTtsSpeaking = false;

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

    // Camera & Zoom Control
    private Camera camera;
    private ScaleGestureDetector scaleGestureDetector;
    private TextView btnZoom1x, btnZoom15x, btnZoom2x, btnZoom3x;
    private float currentZoomLevel = 1.0f;

    // Professional Camera Orientation Sensor & In-Place Rotation
    private OrientationEventListener orientationEventListener;
    private int currentDeviceRotationDegrees = 0;

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
        btnQuickSpeak = findViewById(R.id.btnQuickSpeak);

        layoutResponseContainer = findViewById(R.id.layoutResponseContainer);
        layoutVoiceMode = findViewById(R.id.layoutVoiceMode);
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
        btnSpeakResult = findViewById(R.id.btnSpeakResult);

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

        // Quick Zoom Pills Binding
        btnZoom1x = findViewById(R.id.btnZoom1x);
        btnZoom15x = findViewById(R.id.btnZoom15x);
        btnZoom2x = findViewById(R.id.btnZoom2x);
        btnZoom3x = findViewById(R.id.btnZoom3x);

        if (btnZoom1x != null) btnZoom1x.setOnClickListener(v -> setCameraZoom(1.0f));
        if (btnZoom15x != null) btnZoom15x.setOnClickListener(v -> setCameraZoom(1.5f));
        if (btnZoom2x != null) btnZoom2x.setOnClickListener(v -> setCameraZoom(2.0f));
        if (btnZoom3x != null) btnZoom3x.setOnClickListener(v -> setCameraZoom(3.0f));

        // Pinch-to-Zoom Gesture Recognition
        scaleGestureDetector = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override
            public boolean onScale(@NonNull ScaleGestureDetector detector) {
                if (camera != null) {
                    androidx.camera.core.ZoomState zoomState = camera.getCameraInfo().getZoomState().getValue();
                    float current = zoomState != null ? zoomState.getZoomRatio() : 1.0f;
                    setCameraZoom(current * detector.getScaleFactor());
                }
                return true;
            }
        });

        previewView.setOnTouchListener((v, event) -> {
            scaleGestureDetector.onTouchEvent(event);
            return true;
        });

        initOrientationSensor();

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

        // 1-Click TTS Voice Model Selector Button
        View btnVoiceSettings = findViewById(R.id.btnVoiceSettings);
        if (btnVoiceSettings != null) {
            btnVoiceSettings.setOnClickListener(v -> showVoiceSelectionDialog());
        }

        // 1-Click Typing Speed Controller Button
        View btnSpeedSettings = findViewById(R.id.btnSpeedSettings);
        if (btnSpeedSettings != null) {
            btnSpeedSettings.setOnClickListener(v -> showSpeedSettingsDialog());
        }

        // Capture Shutter Button (Instant Touch Down Haptic Click)
        btnCapture.setHapticFeedbackEnabled(true);
        btnCapture.setOnTouchListener((v, event) -> {
            if (event.getAction() == android.view.MotionEvent.ACTION_DOWN) {
                triggerHapticShutterNotification(v);
            }
            return false;
        });
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

        // Long click on Type buttons opens Typing Speed Controller
        View.OnLongClickListener speedLongListener = v -> {
            showSpeedSettingsDialog();
            return true;
        };
        btnTypeDirect.setOnLongClickListener(speedLongListener);
        btnTypeBluetooth.setOnLongClickListener(speedLongListener);
        btnTypeCode.setOnLongClickListener(speedLongListener);

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

        // Text-to-Speech Read Aloud / Listen Actions (Click to Speak, Long-Click for Voice Selector)
        View.OnClickListener ttsClickListener = v -> toggleSpeakCurrentResult();
        View.OnLongClickListener ttsLongClickListener = v -> {
            showVoiceSelectionDialog();
            return true;
        };

        if (btnSpeakResult != null) {
            btnSpeakResult.setOnClickListener(ttsClickListener);
            btnSpeakResult.setOnLongClickListener(ttsLongClickListener);
        }
        if (btnQuickSpeak != null) {
            btnQuickSpeak.setOnClickListener(ttsClickListener);
            btnQuickSpeak.setOnLongClickListener(ttsLongClickListener);
        }

        initTextToSpeech();

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
        tabSlotCode.setBackgroundResource(R.drawable.btn_pill_cute_glass);
        tabSlotCode.setTextColor(Color.parseColor("#94A3B8"));
        tabSlotReason.setBackgroundResource(R.drawable.btn_pill_cute_glass);
        tabSlotReason.setTextColor(Color.parseColor("#94A3B8"));
        tabSlotRating.setBackgroundResource(R.drawable.btn_pill_cute_glass);
        tabSlotRating.setTextColor(Color.parseColor("#94A3B8"));

        tvVoicePayload.setVisibility(View.GONE);
        layoutCheckMode.setVisibility(View.GONE);
        layoutCompareMode.setVisibility(View.GONE);
        layoutTypeMode.setVisibility(View.GONE);

        if ("reason".equalsIgnoreCase(tabKey)) {
            tabSlotReason.setBackgroundResource(R.drawable.btn_pill_cute_primary);
            tabSlotReason.setTextColor(Color.parseColor("#020B14"));
            tvVoicePayload.setVisibility(View.VISIBLE);
            tvVoicePayload.setText(currentSlotReason);
        } else if ("rating".equalsIgnoreCase(tabKey)) {
            tabSlotRating.setBackgroundResource(R.drawable.btn_pill_cute_purple);
            tabSlotRating.setTextColor(Color.parseColor("#FFFFFF"));
            tvVoicePayload.setVisibility(View.VISIBLE);
            String text = "⭐ VERDICT / RATING:\n" + currentSlotRating;
            if (!currentSlotAudit.isEmpty()) {
                text += "\n\n🛡️ AUDIT:\n" + currentSlotAudit;
            }
            tvVoicePayload.setText(text);
        } else {
            // "code"
            tabSlotCode.setBackgroundResource(R.drawable.btn_pill_cute_primary);
            tabSlotCode.setTextColor(Color.parseColor("#020B14"));
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
                        .setTargetRotation(Surface.ROTATION_90)
                        .build();

                CameraSelector cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;
                cameraProvider.unbindAll();
                camera = cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageCapture);

                updateStatusText("CAMERA READY • PINCH TO ZOOM");
            } catch (ExecutionException | InterruptedException e) {
                Log.e(TAG, "Use case binding failed", e);
                updateStatusText("CAMERA ERROR: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void setCameraZoom(float targetRatio) {
        if (camera == null) return;
        androidx.camera.core.ZoomState zoomState = camera.getCameraInfo().getZoomState().getValue();
        float minRatio = zoomState != null ? zoomState.getMinZoomRatio() : 1.0f;
        float maxRatio = zoomState != null ? zoomState.getMaxZoomRatio() : 8.0f;
        float clamped = Math.max(minRatio, Math.min(targetRatio, maxRatio));

        camera.getCameraControl().setZoomRatio(clamped);
        currentZoomLevel = clamped;
        updateZoomPillsUI(clamped);
    }

    private void updateZoomPillsUI(float zoom) {
        if (btnZoom1x == null) return;
        resetZoomPill(btnZoom1x);
        resetZoomPill(btnZoom15x);
        resetZoomPill(btnZoom2x);
        resetZoomPill(btnZoom3x);

        if (Math.abs(zoom - 1.0f) < 0.2f) {
            highlightZoomPill(btnZoom1x);
        } else if (Math.abs(zoom - 1.5f) < 0.2f) {
            highlightZoomPill(btnZoom15x);
        } else if (Math.abs(zoom - 2.0f) < 0.2f) {
            highlightZoomPill(btnZoom2x);
        } else if (Math.abs(zoom - 3.0f) < 0.35f) {
            highlightZoomPill(btnZoom3x);
        }
    }

    private void highlightZoomPill(TextView tv) {
        if (tv == null) return;
        tv.setBackgroundResource(R.drawable.btn_pill_cute_primary);
        tv.setTextColor(Color.parseColor("#020B14"));
    }

    private void resetZoomPill(TextView tv) {
        if (tv == null) return;
        tv.setBackgroundColor(Color.TRANSPARENT);
        tv.setTextColor(Color.parseColor("#94A3B8"));
    }

    private void initOrientationSensor() {
        orientationEventListener = new OrientationEventListener(this, SensorManager.SENSOR_DELAY_UI) {
            @Override
            public void onOrientationChanged(int orientation) {
                if (orientation == ORIENTATION_UNKNOWN) return;
                int surfaceRotation;
                int targetDegrees;

                if (orientation >= 315 || orientation < 45) {
                    surfaceRotation = Surface.ROTATION_0;
                    targetDegrees = 270;
                } else if (orientation >= 45 && orientation < 135) {
                    surfaceRotation = Surface.ROTATION_270;
                    targetDegrees = 180;
                } else if (orientation >= 135 && orientation < 225) {
                    surfaceRotation = Surface.ROTATION_180;
                    targetDegrees = 90;
                } else {
                    surfaceRotation = Surface.ROTATION_90;
                    targetDegrees = 0;
                }

                if (imageCapture != null) {
                    imageCapture.setTargetRotation(surfaceRotation);
                }

                if (targetDegrees != currentDeviceRotationDegrees) {
                    currentDeviceRotationDegrees = targetDegrees;
                    animateUIElementsRotation(targetDegrees);
                }
            }
        };

        if (orientationEventListener.canDetectOrientation()) {
            orientationEventListener.enable();
        }
    }

    private void animateUIElementsRotation(int targetDegrees) {
        View[] rotatableViews = new View[]{
                btnCapture,
                btnZoom1x, btnZoom15x, btnZoom2x, btnZoom3x,
                findViewById(R.id.btnHistory),
                findViewById(R.id.btnUsbTether),
                findViewById(R.id.btnGuide),
                findViewById(R.id.btnVoiceSettings),
                findViewById(R.id.btnSpeedSettings),
                findViewById(R.id.btnToggleHud),
                btnQuickResult,
                btnQuickSpeak,
                btnTypeDirect,
                btnTypeBluetooth,
                findViewById(R.id.btnStopResponse),
                btnTypeCode,
                btnTypeReason,
                btnTypeRating,
                findViewById(R.id.btnTypeAutoSequence),
                findViewById(R.id.btnStopMultiSlot)
        };

        for (View v : rotatableViews) {
            if (v != null) {
                v.animate()
                        .rotation(targetDegrees)
                        .setDuration(250)
                        .start();
            }
        }
    }

    private void triggerHapticShutterNotification(View view) {
        // 1. Hardware View Haptic Tap (Bypasses system quiet mode)
        try {
            if (view != null) {
                view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP,
                        android.view.HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING);
                view.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY,
                        android.view.HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING);
            }
        } catch (Exception ignored) {}

        // 2. Direct Vibrator Hardware Pulse (100% Guaranteed on all Android / Samsung)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                android.os.VibratorManager vm = (android.os.VibratorManager) getSystemService(VIBRATOR_MANAGER_SERVICE);
                if (vm != null) {
                    android.os.Vibrator v = vm.getDefaultVibrator();
                    if (v != null && v.hasVibrator()) {
                        v.vibrate(android.os.VibrationEffect.createOneShot(75, 255));
                    }
                }
            } else {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(android.os.VibrationEffect.createOneShot(75, 255));
                    } else {
                        v.vibrate(75);
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private void captureAndProcessScreen() {
        triggerHapticShutterNotification(btnCapture);

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

    private void showSpeedSettingsDialog() {
        final String[] presetKeys = {"ultra", "fast", "normal", "relaxed", "stealth", "ninja"};
        final String[] presetNames = {
                "⚡ Ultra Fast (3ms - 8ms) [Instant]",
                "🏃 Fast Human (12ms - 28ms) [Fast]",
                "🚶 Normal Human (25ms - 55ms) [Default]",
                "🐢 Relaxed Human (60ms - 110ms)",
                "🦥 Ultra Stealth (110ms - 180ms)",
                "🕵️ Ghost Ninja (180ms - 280ms)"
        };
        final int[][] presetRanges = {
                {3, 8},
                {12, 28},
                {25, 55},
                {60, 110},
                {110, 180},
                {180, 280}
        };

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String currentPreset = prefs.getString("typing_speed_preset", "normal");
        int selectedIndex = 2; // normal by default
        for (int i = 0; i < presetKeys.length; i++) {
            if (presetKeys[i].equalsIgnoreCase(currentPreset)) {
                selectedIndex = i;
                break;
            }
        }

        final int[] chosen = {selectedIndex};

        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("⚡ Typing Speed & Jitter Control");
        builder.setSingleChoiceItems(presetNames, selectedIndex, (dialog, which) -> {
            chosen[0] = which;
        });

        builder.setPositiveButton("💾 Apply Speed", (dialog, which) -> {
            int idx = chosen[0];
            String selectedKey = presetKeys[idx];
            int minMs = presetRanges[idx][0];
            int maxMs = presetRanges[idx][1];

            prefs.edit().putString("typing_speed_preset", selectedKey).apply();
            applySpeedToServer(selectedKey, minMs, maxMs);
            Toast.makeText(MainActivity.this, "✅ Speed set to: " + presetNames[idx], Toast.LENGTH_SHORT).show();
        });

        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private void applySpeedToServer(String presetName, int minMs, int maxMs) {
        String serverUrl = getResolvedServerUrl();
        String speedEndpoint = serverUrl.replaceAll("/+$", "") + "/settings/speed";

        JsonObject json = new JsonObject();
        json.addProperty("preset_name", presetName);
        json.addProperty("min_delay_ms", minMs);
        json.addProperty("max_delay_ms", maxMs);
        json.addProperty("save", true);

        RequestBody body = RequestBody.create(json.toString(), MediaType.parse("application/json; charset=utf-8"));
        Request request = new Request.Builder()
                .url(speedEndpoint)
                .post(body)
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {}

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) {
                response.close();
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

        if (layoutVoiceMode != null) layoutVoiceMode.setVisibility(View.GONE);
        tvVoicePayload.setVisibility(View.GONE);
        layoutCheckMode.setVisibility(View.GONE);
        layoutCompareMode.setVisibility(View.GONE);
        layoutTypeMode.setVisibility(View.GONE);

        if (btnQuickSpeak != null) {
            btnQuickSpeak.setVisibility(View.VISIBLE);
        }
        updateTtsUiState(false);

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
                if (layoutVoiceMode != null) layoutVoiceMode.setVisibility(View.VISIBLE);
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
                try {
                    handler.post(() -> {
                        updateStatusText("🛑 TYPING ABORTED • READY FOR NEXT");
                        Toast.makeText(MainActivity.this, "🛑 Typing aborted! Ready for next input.", Toast.LENGTH_SHORT).show();
                    });
                } finally {
                    response.close();
                }
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
                try {
                    handler.post(() -> {
                        if (response.isSuccessful()) {
                            updateStatusText("✅ AUTO-SEQUENCE INJECTED TO ACTIVE WINDOW");
                            Toast.makeText(MainActivity.this, "🚀 Auto-filling Code & Reason with Tab transition!", Toast.LENGTH_SHORT).show();
                        } else {
                            updateStatusText("SEQUENCE ERROR (" + response.code() + ")");
                        }
                    });
                } finally {
                    response.close();
                }
            }
        });
    }

    private void initTextToSpeech() {
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                float savedRate = prefs.getFloat(KEY_TTS_SPEED, 0.98f);
                tts.setSpeechRate(savedRate);
                tts.setPitch(1.0f);

                String savedVoiceName = prefs.getString(KEY_TTS_VOICE, "");
                boolean voiceApplied = false;
                if (!savedVoiceName.isEmpty() && tts.getVoices() != null) {
                    for (Voice v : tts.getVoices()) {
                        if (v.getName().equalsIgnoreCase(savedVoiceName)) {
                            tts.setVoice(v);
                            voiceApplied = true;
                            break;
                        }
                    }
                }

                if (!voiceApplied) {
                    int result = tts.setLanguage(Locale.US);
                    if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                        tts.setLanguage(Locale.getDefault());
                    }
                }

                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {
                        handler.post(() -> updateTtsUiState(true));
                    }

                    @Override
                    public void onDone(String utteranceId) {
                        handler.post(() -> updateTtsUiState(false));
                    }

                    @Override
                    public void onError(String utteranceId) {
                        handler.post(() -> updateTtsUiState(false));
                    }
                });
            } else {
                Log.e("LogicGhost", "Failed to initialize TextToSpeech");
            }
        });
    }

    private void showVoiceSelectionDialog() {
        if (tts == null) {
            Toast.makeText(this, "TTS Engine initializing...", Toast.LENGTH_SHORT).show();
            return;
        }

        Set<Voice> voices = tts.getVoices();
        if (voices == null || voices.isEmpty()) {
            Toast.makeText(this, "No TTS voice models found on device", Toast.LENGTH_SHORT).show();
            return;
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String currentVoiceName = prefs.getString(KEY_TTS_VOICE, "");
        if (currentVoiceName.isEmpty() && tts.getVoice() != null) {
            currentVoiceName = tts.getVoice().getName();
        }

        // Filter and sort English / installed voices
        List<Voice> voiceList = new ArrayList<>();
        for (Voice v : voices) {
            if (v.getLocale() != null && v.getLocale().getLanguage().startsWith("en")) {
                voiceList.add(v);
            }
        }
        if (voiceList.isEmpty()) {
            voiceList.addAll(voices);
        }

        // Sort by Country code and name
        Collections.sort(voiceList, (a, b) -> {
            String cA = a.getLocale() != null ? a.getLocale().getCountry() : "";
            String cB = b.getLocale() != null ? b.getLocale().getCountry() : "";
            int cComp = cA.compareTo(cB);
            if (cComp != 0) return cComp;
            return a.getName().compareTo(b.getName());
        });

        String[] displayNames = new String[voiceList.size()];
        int selectedIndex = 0;

        for (int i = 0; i < voiceList.size(); i++) {
            Voice v = voiceList.get(i);
            String country = v.getLocale() != null ? v.getLocale().getCountry() : "EN";
            String flag = "US".equalsIgnoreCase(country) ? "🇺🇸" :
                          "GB".equalsIgnoreCase(country) ? "🇬🇧" :
                          "IN".equalsIgnoreCase(country) ? "🇮🇳" :
                          "NG".equalsIgnoreCase(country) ? "🇳🇬" :
                          "AU".equalsIgnoreCase(country) ? "🇦🇺" :
                          "CA".equalsIgnoreCase(country) ? "🇨🇦" : "🌐";

            displayNames[i] = flag + " Google, " + country + "\n" + v.getName();
            if (v.getName().equalsIgnoreCase(currentVoiceName)) {
                selectedIndex = i;
            }
        }

        final int[] chosenIndex = {selectedIndex};

        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("🗣️ Select Google Voice Model");
        builder.setSingleChoiceItems(displayNames, selectedIndex, (dialog, which) -> {
            chosenIndex[0] = which;
            Voice v = voiceList.get(which);
            tts.setVoice(v);
            // Play quick audio preview
            String sample = "Hello! I am Google " + (v.getLocale() != null ? v.getLocale().getDisplayCountry() : "English") + " voice for your interview answers.";
            Bundle params = new Bundle();
            params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "SampleTest_" + System.currentTimeMillis());
            tts.speak(sample, TextToSpeech.QUEUE_FLUSH, params, params.getString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID));
        });

        builder.setPositiveButton("💾 Apply & Save", (dialog, which) -> {
            if (chosenIndex[0] >= 0 && chosenIndex[0] < voiceList.size()) {
                Voice v = voiceList.get(chosenIndex[0]);
                tts.setVoice(v);
                prefs.edit().putString(KEY_TTS_VOICE, v.getName()).apply();
                Toast.makeText(MainActivity.this, "✅ Voice set to: " + v.getName(), Toast.LENGTH_SHORT).show();
            }
        });

        builder.setNeutralButton("⚙️ System TTS", (dialog, which) -> {
            try {
                Intent intent = new Intent("com.android.settings.TTS_SETTINGS");
                startActivity(intent);
            } catch (Exception e) {
                try {
                    Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                    startActivity(intent);
                } catch (Exception ignored) {}
            }
        });

        builder.setNegativeButton("Cancel", null);
        AlertDialog dialog = builder.create();
        dialog.show();
    }

    private void updateTtsUiState(boolean speaking) {
        isTtsSpeaking = speaking;
        if (btnSpeakResult != null) {
            btnSpeakResult.setText(speaking ? "⏹️" : "🔊");
            btnSpeakResult.setBackgroundResource(speaking ? R.drawable.btn_pill_cute_danger : R.drawable.btn_pill_cute_glass);
        }
        if (btnQuickSpeak != null) {
            btnQuickSpeak.setText(speaking ? "⏹️ STOP VOICE" : "🔊 LISTEN (TTS)");
            btnQuickSpeak.setTextColor(speaking ? Color.parseColor("#FF4D6D") : Color.parseColor("#38BDF8"));
            btnQuickSpeak.setBackgroundResource(speaking ? R.drawable.btn_pill_cute_danger : R.drawable.btn_pill_cute_glass);
        }
    }

    private void toggleSpeakCurrentResult() {
        if (tts == null) {
            Toast.makeText(this, "TTS Engine initializing...", Toast.LENGTH_SHORT).show();
            return;
        }

        if (isTtsSpeaking) {
            tts.stop();
            updateTtsUiState(false);
            Toast.makeText(this, "🔇 Speech stopped", Toast.LENGTH_SHORT).show();
            return;
        }

        String textToSpeak = getActiveTextForSpeech();
        if (textToSpeak == null || textToSpeak.trim().isEmpty()) {
            Toast.makeText(this, "No answer to read aloud", Toast.LENGTH_SHORT).show();
            return;
        }

        String cleaned = cleanTextForSpeech(textToSpeak);
        Bundle params = new Bundle();
        params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "LogicGhost_TTS_" + System.currentTimeMillis());
        tts.speak(cleaned, TextToSpeech.QUEUE_FLUSH, params, params.getString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID));
        updateTtsUiState(true);
        Toast.makeText(this, "🔊 Reading answer into headphones...", Toast.LENGTH_SHORT).show();
    }

    private String getActiveTextForSpeech() {
        if (isMultiSlot) {
            if (!currentSlotReason.isEmpty()) return currentSlotReason;
            if (!currentSlotRating.isEmpty()) return currentSlotRating;
            return currentSlotCode;
        }
        return currentPayload;
    }

    private String cleanTextForSpeech(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("(?i)\\[VOICE\\]", "")
                .replaceAll("(?i)\\[CHECK\\]", "")
                .replaceAll("(?i)\\[COMPARE\\]", "")
                .replaceAll("(?i)\\[TYPE\\]", "")
                .replaceAll("(?i)<<<SLOT:[A-Z]+>>>", "")
                .replaceAll("```[a-zA-Z]*", "")
                .replaceAll("`", "")
                .replaceAll("[*#_~]", "")
                .replaceAll("•", ", ")
                .replaceAll("\\s+", " ")
                .trim();
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
                try {
                    handler.post(() -> {
                        if (response.isSuccessful()) {
                            updateStatusText("✅ TYPED " + payloadToType.length() + " CHARACTERS TO PC");
                            Toast.makeText(MainActivity.this, "⚡ Typing " + payloadToType.length() + " chars into active window!", Toast.LENGTH_SHORT).show();
                        } else {
                            updateStatusText("TYPE ERROR (" + response.code() + ")");
                        }
                    });
                } finally {
                    response.close();
                }
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

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (orientationEventListener != null) {
            orientationEventListener.disable();
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
    }
}