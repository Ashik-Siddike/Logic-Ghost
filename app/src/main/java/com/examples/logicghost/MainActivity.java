package com.examples.logicghost;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
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
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.Button;
import android.widget.EditText;
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
import java.util.ArrayList;
import java.util.List;
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

    private EditText etServerUrl;
    private View ledServer, ledBluetooth;
    private TextView tvServerStatus, tvBluetoothStatus, tvStatus;
    private PreviewView previewView;
    private Button btnCapture;

    private LinearLayout layoutResponseContainer, layoutCheckMode, layoutCompareMode, layoutTypeMode;
    private TextView tvTagHeader, tvVoicePayload, tvCheckSelected, tvCompareBest, tvCompareReason, tvCodePayload;
    private Button btnTypeDirect, btnTypeBluetooth;

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
        etServerUrl = findViewById(R.id.etServerUrl);
        ledServer = findViewById(R.id.ledServer);
        ledBluetooth = findViewById(R.id.ledBluetooth);
        tvServerStatus = findViewById(R.id.tvServerStatus);
        tvBluetoothStatus = findViewById(R.id.tvBluetoothStatus);
        tvStatus = findViewById(R.id.tvStatus);
        previewView = findViewById(R.id.previewView);
        btnCapture = findViewById(R.id.btnCapture);

        layoutResponseContainer = findViewById(R.id.layoutResponseContainer);
        layoutCheckMode = findViewById(R.id.layoutCheckMode);
        layoutCompareMode = findViewById(R.id.layoutCompareMode);
        layoutTypeMode = findViewById(R.id.layoutTypeMode);

        tvTagHeader = findViewById(R.id.tvTagHeader);
        tvVoicePayload = findViewById(R.id.tvVoicePayload);
        tvCheckSelected = findViewById(R.id.tvCheckSelected);
        tvCompareBest = findViewById(R.id.tvCompareBest);
        tvCompareReason = findViewById(R.id.tvCompareReason);
        tvCodePayload = findViewById(R.id.tvCodePayload);

        btnTypeDirect = findViewById(R.id.btnTypeDirect);
        btnTypeBluetooth = findViewById(R.id.btnTypeBluetooth);

        // Restore previously saved server URL (Defaults to http://127.0.0.1:5000)
        String savedUrl = prefs.getString(KEY_SERVER_URL, "http://127.0.0.1:5000");
        etServerUrl.setText(savedUrl);

        etServerUrl.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                prefs.edit().putString(KEY_SERVER_URL, s.toString().trim()).apply();
            }

            @Override
            public void afterTextChanged(Editable s) {}
        });


        btnCapture.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                captureAndProcessScreen();
            }
        });

        btnTypeDirect.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerDirectServerTyping(currentPayload);
            }
        });

        btnTypeBluetooth.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerBluetoothTyping(currentPayload);
            }
        });

        Button btnUsbTether = findViewById(R.id.btnUsbTether);
        if (btnUsbTether != null) {
            btnUsbTether.setOnClickListener(v -> openUsbTetheringSettings());
        }

        Button btnGuide = findViewById(R.id.btnGuide);
        if (btnGuide != null) {
            btnGuide.setOnClickListener(v -> showSetupGuideDialog(false));
        }

        // Show setup guide on first run
        boolean setupDone = prefs.getBoolean("first_run_setup_done", false);
        if (!setupDone) {
            handler.postDelayed(() -> showSetupGuideDialog(true), 800);
        }

        View.OnClickListener btReconnectListener = new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showBluetoothDeviceSelectorDialog();
            }
        };
        ledBluetooth.setOnClickListener(btReconnectListener);
        tvBluetoothStatus.setOnClickListener(btReconnectListener);
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
                " • Connect cable to PC (Zero IP config needed!)\n\n" +
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
                    startActivity(new Intent(android.provider.Settings.ACTION_WIRELESS_SETTINGS));
                } catch (Exception e3) {
                    startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS));
                }
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUI();
        checkServerHealth();
        checkBluetoothStatus();
    }

    private void showBluetoothDeviceSelectorDialog() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            Toast.makeText(this, "Bluetooth is not supported on this device", Toast.LENGTH_SHORT).show();
            return;
        }

        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded != null && !bonded.isEmpty()) {
            final BluetoothDevice[] devices = bonded.toArray(new BluetoothDevice[0]);
            final String[] names = new String[devices.length];
            for (int i = 0; i < devices.length; i++) {
                names[i] = (devices[i].getName() != null ? devices[i].getName() : "Device") + " (" + devices[i].getAddress() + ")";
            }

            new AlertDialog.Builder(this)
                    .setTitle("Select Bluetooth Host (PC)")
                    .setItems(names, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            Toast.makeText(MainActivity.this, "Connecting to " + devices[which].getName() + "...", Toast.LENGTH_SHORT).show();
                            hidManager.connectToDevice(devices[which]);
                        }
                    })
                    .setNeutralButton("Make Discoverable", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            Intent disc = new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE);
                            disc.putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300);
                            startActivity(disc);
                        }
                    })
                    .setNegativeButton("Cancel", null)
                    .show();
        } else {
            Toast.makeText(this, "Making phone discoverable for Laptop scan...", Toast.LENGTH_LONG).show();
            Intent disc = new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE);
            disc.putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300);
            startActivity(disc);
        }
    }

    private boolean hasAllPermissions() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private void requestAppPermissions() {
        List<String> perms = new ArrayList<>();
        perms.add(Manifest.permission.CAMERA);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            perms.add(Manifest.permission.BLUETOOTH_CONNECT);
            perms.add(Manifest.permission.BLUETOOTH_ADVERTISE);
            perms.add(Manifest.permission.BLUETOOTH_SCAN);
        } else {
            perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }

        ActivityCompat.requestPermissions(this, perms.toArray(new String[0]), PERM_CODE);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERM_CODE && grantResults.length > 0) {
            boolean allGranted = true;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }
            if (allGranted || ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                startCamera();
            }
        }
    }

    private void startCamera() {
        try {
            ProcessCameraProvider cameraProvider = ProcessCameraProvider.getInstance(this).get();
            Preview preview = new Preview.Builder().build();
            preview.setSurfaceProvider(previewView.getSurfaceProvider());

            imageCapture = new ImageCapture.Builder().build();

            CameraSelector cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;
            cameraProvider.unbindAll();
            cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageCapture);
        } catch (ExecutionException | InterruptedException e) {
            Log.e(TAG, "CameraX init failed", e);
        }
    }

    private void startHealthCheckLoop() {
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                checkServerHealth();
                checkBluetoothStatus();
                handler.postDelayed(this, 3000);
            }
        }, 1000);
    }

    private void checkServerHealth() {
        String baseUrl = etServerUrl.getText().toString().trim();
        if (baseUrl.isEmpty()) return;

        Request request = new Request.Builder()
                .url(baseUrl.replaceAll("/$", "") + "/health")
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        ledServer.setBackgroundColor(Color.parseColor("#FF3333"));
                        tvServerStatus.setText("SERVER: OFFLINE");
                    }
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) {
                final boolean ok = response.isSuccessful();
                response.close();
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (ok) {
                            ledServer.setBackgroundColor(Color.parseColor("#00FF66"));
                            tvServerStatus.setText("SERVER: ONLINE");
                        } else {
                            ledServer.setBackgroundColor(Color.parseColor("#FF3333"));
                            tvServerStatus.setText("SERVER: ERROR");
                        }
                    }
                });
            }
        });
    }

    private void checkBluetoothStatus() {
        boolean connected = hidManager.isConnected();
        String deviceName = hidManager.getConnectedDeviceName();

        if (connected) {
            ledBluetooth.setBackgroundColor(Color.parseColor("#00FF66"));
            tvBluetoothStatus.setText("BT HID: PAIRED (" + deviceName + ")");
        } else {
            ledBluetooth.setBackgroundColor(Color.parseColor("#FF3333"));
            tvBluetoothStatus.setText("BT HID: UNPAIRED (TAP)");
        }
    }

    private void captureAndProcessScreen() {
        if (imageCapture == null) {
            Toast.makeText(this, "Camera not ready", Toast.LENGTH_SHORT).show();
            return;
        }

        tvStatus.setText("CAPTURING SCREEN...");
        btnCapture.setEnabled(false);

        File photoFile = new File(getCacheDir(), "capture_" + System.currentTimeMillis() + ".jpg");
        ImageCapture.OutputFileOptions opts = new ImageCapture.OutputFileOptions.Builder(photoFile).build();

        imageCapture.takePicture(opts, ContextCompat.getMainExecutor(this), new ImageCapture.OnImageSavedCallback() {
            @Override
            public void onImageSaved(@NonNull ImageCapture.OutputFileResults results) {
                tvStatus.setText("ANALYZING WITH GEMINI...");
                sendImageToServer(photoFile);
            }

            @Override
            public void onError(@NonNull ImageCaptureException exception) {
                tvStatus.setText("CAPTURE FAILED: " + exception.getMessage());
                btnCapture.setEnabled(true);
            }
        });
    }

    private void sendImageToServer(final File imageFile) {
        String baseUrl = etServerUrl.getText().toString().trim().replaceAll("/$", "");
        if (baseUrl.isEmpty()) {
            Toast.makeText(this, "Please enter Server URL first!", Toast.LENGTH_LONG).show();
            btnCapture.setEnabled(true);
            return;
        }

        String targetUrl = baseUrl + "/capture";
        RequestBody fileBody = RequestBody.create(imageFile, MediaType.parse("image/jpeg"));
        RequestBody requestBody = new MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("image", imageFile.getName(), fileBody)
                .build();

        Request request = new Request.Builder()
                .url(targetUrl)
                .post(requestBody)
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        tvStatus.setText("UPLOAD FAILED: " + e.getMessage());
                        btnCapture.setEnabled(true);
                    }
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) throws IOException {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        btnCapture.setEnabled(true);
                    }
                });

                if (!response.isSuccessful() || response.body() == null) {
                    final int code = response.code();
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            tvStatus.setText("SERVER ERROR: HTTP " + code);
                        }
                    });
                    return;
                }

                String jsonStr = response.body().string();
                response.close();

                try {
                    JsonObject json = JsonParser.parseString(jsonStr).getAsJsonObject();
                    final String tag = json.has("tag") ? json.get("tag").getAsString() : "[TYPE]";
                    final String payload = json.has("payload") ? json.get("payload").getAsString() : "";

                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            renderResponseUI(tag, payload);
                        }
                    });
                } catch (Exception e) {
                    Log.e(TAG, "JSON parse error", e);
                }
            }
        });
    }

    private void renderResponseUI(String tag, String payload) {
        this.currentPayload = payload;
        tvStatus.setText("AI READY: " + tag);

        layoutResponseContainer.setVisibility(View.VISIBLE);
        tvTagHeader.setText(tag);

        tvVoicePayload.setVisibility(View.GONE);
        layoutCheckMode.setVisibility(View.GONE);
        layoutCompareMode.setVisibility(View.GONE);
        layoutTypeMode.setVisibility(View.GONE);

        if ("[VOICE]".equalsIgnoreCase(tag)) {
            tvVoicePayload.setVisibility(View.VISIBLE);
            tvVoicePayload.setText(payload);
        } else if ("[CHECK]".equalsIgnoreCase(tag)) {
            layoutCheckMode.setVisibility(View.VISIBLE);
            tvCheckSelected.setText("Selected: " + payload);
        } else if ("[COMPARE]".equalsIgnoreCase(tag)) {
            layoutCompareMode.setVisibility(View.VISIBLE);
            String best = payload;
            String reason = "";
            if (payload.contains("|")) {
                String[] parts = payload.split("\\|", 2);
                best = parts[0].replaceAll("(?i)BEST:\\s*", "").trim();
                reason = parts[1].replaceAll("(?i)WHY:\\s*", "").trim();
            }
            tvCompareBest.setText(best);
            tvCompareReason.setText(reason.isEmpty() ? "Recommended choice" : reason);
            this.currentPayload = best;
        } else {
            layoutTypeMode.setVisibility(View.VISIBLE);
            tvCodePayload.setText(payload);
        }
    }

    /**
     * Injects keystrokes directly into PC foreground window via Desktop Server (USB / Direct LAN mode)
     */
    private void triggerDirectServerTyping(String payloadToType) {
        if (payloadToType == null || payloadToType.isEmpty()) {
            Toast.makeText(this, "No answer to type yet. Capture a screen first!", Toast.LENGTH_SHORT).show();
            return;
        }

        String baseUrl = etServerUrl.getText().toString().trim().replaceAll("/$", "");
        if (baseUrl.isEmpty()) {
            Toast.makeText(this, "Enter Desktop Server URL", Toast.LENGTH_SHORT).show();
            return;
        }

        tvStatus.setText("⚡ INJECTING VIA USB/DIRECT...");
        btnTypeDirect.setEnabled(false);

        JsonObject json = new JsonObject();
        json.addProperty("text", payloadToType);

        RequestBody body = RequestBody.create(json.toString(), MediaType.parse("application/json; charset=utf-8"));
        Request request = new Request.Builder()
                .url(baseUrl + "/type")
                .post(body)
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        tvStatus.setText("DIRECT INJECT FAILED: " + e.getMessage());
                        btnTypeDirect.setEnabled(true);
                    }
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) throws IOException {
                final boolean ok = response.isSuccessful();
                response.close();
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        btnTypeDirect.setEnabled(true);
                        if (ok) {
                            tvStatus.setText("⚡ INJECTED SUCCESSFULLY (USB)");
                            Toast.makeText(MainActivity.this, "Keystrokes typed into active PC window!", Toast.LENGTH_SHORT).show();
                        } else {
                            tvStatus.setText("DIRECT INJECT ERROR");
                        }
                    }
                });
            }
        });
    }

    /**
     * Injects keystrokes via Bluetooth HID Keyboard profile
     */
    private void triggerBluetoothTyping(String payloadToType) {
        if (payloadToType == null || payloadToType.isEmpty()) {
            Toast.makeText(this, "No answer to type yet. Capture a screen first!", Toast.LENGTH_SHORT).show();
            return;
        }

        tvStatus.setText("📶 INJECTING VIA BLUETOOTH HID...");
        hidManager.sendKeystrokes(payloadToType, new BluetoothHidManager.KeystrokeCallback() {
            @Override
            public void onSuccess() {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        tvStatus.setText("📶 BLUETOOTH TYPING DONE");
                        Toast.makeText(MainActivity.this, "Bluetooth keystrokes sent successfully!", Toast.LENGTH_SHORT).show();
                    }
                });
            }

            @Override
            public void onError(final String error) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(MainActivity.this, "HID Error: " + error, Toast.LENGTH_LONG).show();
                    }
                });
            }
        });
    }
}