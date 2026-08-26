package com.examples.logicghost;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothHidDevice;
import android.bluetooth.BluetoothHidDeviceAppSdpSettings;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.util.Log;

import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@SuppressLint("MissingPermission")
public class BluetoothHidManager implements BluetoothProfile.ServiceListener {

    private static final String TAG = "BluetoothHidManager";
    private static BluetoothHidManager instance;

    private BluetoothAdapter bluetoothAdapter;
    private BluetoothHidDevice bluetoothHidDevice;
    private BluetoothDevice connectedDevice;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    // Standard USB HID Keyboard Report Descriptor (8 bytes) with explicit byte casting
    private static final byte[] KEYBOARD_COMBO_DESCRIPTOR = new byte[]{
        (byte) 0x05, (byte) 0x01, // USAGE_PAGE (Generic Desktop)
        (byte) 0x09, (byte) 0x06, // USAGE (Keyboard)
        (byte) 0xA1, (byte) 0x01, // COLLECTION (Application)
        (byte) 0x85, (byte) 0x01, // REPORT_ID (1)
        (byte) 0x05, (byte) 0x07, // USAGE_PAGE (Keyboard)
        (byte) 0x19, (byte) 0xE0, // USAGE_MINIMUM (Keyboard LeftControl)
        (byte) 0x29, (byte) 0xE7, // USAGE_MAXIMUM (Keyboard Right GUI)
        (byte) 0x15, (byte) 0x00, // LOGICAL_MINIMUM (0)
        (byte) 0x25, (byte) 0x01, // LOGICAL_MAXIMUM (1)
        (byte) 0x75, (byte) 0x01, // REPORT_SIZE (1)
        (byte) 0x95, (byte) 0x08, // REPORT_COUNT (8)
        (byte) 0x81, (byte) 0x02, // INPUT (Data,Var,Abs)
        (byte) 0x95, (byte) 0x01, // REPORT_COUNT (1)
        (byte) 0x75, (byte) 0x08, // REPORT_SIZE (8)
        (byte) 0x81, (byte) 0x03, // INPUT (Cnst,Var,Abs)
        (byte) 0x95, (byte) 0x06, // REPORT_COUNT (6)
        (byte) 0x75, (byte) 0x08, // REPORT_SIZE (8)
        (byte) 0x15, (byte) 0x00, // LOGICAL_MINIMUM (0)
        (byte) 0x25, (byte) 0x65, // LOGICAL_MAXIMUM (101)
        (byte) 0x19, (byte) 0x00, // USAGE_MINIMUM (Reserved)
        (byte) 0x29, (byte) 0x65, // USAGE_MAXIMUM (Keyboard Application)
        (byte) 0x81, (byte) 0x00, // INPUT (Data,Ary,Abs)
        (byte) 0xC0               // END_COLLECTION
    };

    public interface KeystrokeCallback {
        void onSuccess();
        void onError(String error);
    }

    public static synchronized BluetoothHidManager getInstance(Context context) {
        if (instance == null) {
            instance = new BluetoothHidManager(context.getApplicationContext());
        }
        return instance;
    }

    private BluetoothHidManager(Context context) {
        try {
            bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
            if (bluetoothAdapter != null) {
                bluetoothAdapter.getProfileProxy(context, this, BluetoothProfile.HID_DEVICE);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to get profile proxy", e);
        }
    }

    @Override
    public void onServiceConnected(int profile, BluetoothProfile proxy) {
        if (profile == BluetoothProfile.HID_DEVICE) {
            bluetoothHidDevice = (BluetoothHidDevice) proxy;
            Log.d(TAG, "BluetoothHidDevice profile connected");
            registerHidApp();
        }
    }

    @Override
    public void onServiceDisconnected(int profile) {
        if (profile == BluetoothProfile.HID_DEVICE) {
            bluetoothHidDevice = null;
            connectedDevice = null;
            Log.d(TAG, "BluetoothHidDevice profile disconnected");
        }
    }

    private void registerHidApp() {
        if (bluetoothHidDevice == null) return;

        BluetoothHidDeviceAppSdpSettings sdpSettings = new BluetoothHidDeviceAppSdpSettings(
            "Wireless Keyboard",
            "Standard Bluetooth Keyboard",
            "Generic",
            BluetoothHidDevice.SUBCLASS1_KEYBOARD,
            KEYBOARD_COMBO_DESCRIPTOR
        );

        bluetoothHidDevice.registerApp(
            sdpSettings,
            null,
            null,
            executor,
            new BluetoothHidDevice.Callback() {
                @Override
                public void onAppStatusChanged(BluetoothDevice registeredDevice, boolean state) {
                    super.onAppStatusChanged(registeredDevice, state);
                    Log.d(TAG, "HID App registration status: " + state);
                    if (state) {
                        connectBondedHost();
                    }
                }

                @Override
                public void onConnectionStateChanged(BluetoothDevice device, int state) {
                    super.onConnectionStateChanged(device, state);
                    Log.d(TAG, "Device " + device.getName() + " connection state: " + state);
                    if (state == BluetoothProfile.STATE_CONNECTED) {
                        connectedDevice = device;
                    } else if (state == BluetoothProfile.STATE_DISCONNECTED) {
                        if (connectedDevice != null && connectedDevice.getAddress().equals(device.getAddress())) {
                            connectedDevice = null;
                        }
                    }
                }
            }
        );
    }

    public boolean connectToDevice(BluetoothDevice device) {
        if (bluetoothHidDevice != null && device != null) {
            connectedDevice = device;
            Log.d(TAG, "Connecting explicitly to HID Host: " + device.getName());
            return bluetoothHidDevice.connect(device);
        }
        return false;
    }

    public void connectBondedHost() {
        if (bluetoothHidDevice == null || bluetoothAdapter == null) return;
        try {
            Set<BluetoothDevice> bonded = bluetoothAdapter.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice device : bonded) {
                    Log.d(TAG, "Attempting proactive HID connect to: " + device.getName());
                    bluetoothHidDevice.connect(device);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error connecting to bonded host", e);
        }
    }

    public boolean isConnected() {
        try {
            List<BluetoothDevice> devices = (bluetoothHidDevice != null) ? bluetoothHidDevice.getConnectedDevices() : null;
            return (connectedDevice != null) || (devices != null && !devices.isEmpty());
        } catch (Exception e) {
            return false;
        }
    }

    public String getConnectedDeviceName() {
        try {
            List<BluetoothDevice> devices = (bluetoothHidDevice != null) ? bluetoothHidDevice.getConnectedDevices() : null;
            BluetoothDevice active = (connectedDevice != null) ? connectedDevice : ((devices != null && !devices.isEmpty()) ? devices.get(0) : null);
            return (active != null && active.getName() != null) ? active.getName() : "None";
        } catch (Exception e) {
            return "None";
        }
    }

    private int minDelayMs = 18;
    private int maxDelayMs = 50;
    private volatile boolean isTypingActive = false;
    private volatile boolean isTypingPaused = false;
    private volatile boolean shouldStopTyping = false;

    public void setTypingSpeedRange(int minMs, int maxMs) {
        this.minDelayMs = Math.max(2, minMs);
        this.maxDelayMs = Math.max(this.minDelayMs, maxMs);
    }

    public void pauseTyping() {
        isTypingPaused = true;
    }

    public void resumeTyping() {
        isTypingPaused = false;
    }

    public boolean togglePauseTyping() {
        isTypingPaused = !isTypingPaused;
        return isTypingPaused;
    }

    public void stopTyping() {
        shouldStopTyping = true;
        isTypingPaused = false;
        isTypingActive = false;
        if (bluetoothHidDevice != null && connectedDevice != null) {
            try {
                bluetoothHidDevice.sendReport(connectedDevice, 1, new byte[]{0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00});
            } catch (Exception ignored) {}
        }
    }

    public boolean isTypingActive() {
        return isTypingActive;
    }

    public boolean isTypingPaused() {
        return isTypingPaused;
    }

    public void sendKeystrokes(String text, KeystrokeCallback callback) {
        List<BluetoothDevice> devices = (bluetoothHidDevice != null) ? bluetoothHidDevice.getConnectedDevices() : null;
        BluetoothDevice targetDevice = (connectedDevice != null) ? connectedDevice : ((devices != null && !devices.isEmpty()) ? devices.get(0) : null);

        if (bluetoothHidDevice == null || targetDevice == null) {
            if (callback != null) callback.onError("No paired Bluetooth HID computer connected. Please pair in Windows Bluetooth Settings.");
            return;
        }

        shouldStopTyping = false;
        isTypingPaused = false;
        isTypingActive = true;

        executor.execute(() -> {
            try {
                // Safety Flush: Release any stuck keys prior to starting
                byte[] cleanRelease = new byte[]{0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
                bluetoothHidDevice.sendReport(targetDevice, 1, cleanRelease);
                Thread.sleep(15);

                java.util.Random rng = new java.util.Random();
                for (char c : text.toCharArray()) {
                    if (shouldStopTyping) {
                        Log.d(TAG, "Bluetooth typing stopped by emergency abort.");
                        bluetoothHidDevice.sendReport(targetDevice, 1, cleanRelease);
                        break;
                    }

                    // Handle Pause / Resume at exact character
                    if (isTypingPaused) {
                        bluetoothHidDevice.sendReport(targetDevice, 1, cleanRelease);
                        while (isTypingPaused && !shouldStopTyping) {
                            Thread.sleep(40);
                        }
                    }
                    if (shouldStopTyping) {
                        bluetoothHidDevice.sendReport(targetDevice, 1, cleanRelease);
                        break;
                    }

                    if (c == '\r') continue; // Skip carriage return to prevent duplicate breaks

                    int[] hidCode = charToHidCode(c);
                    int modifier = hidCode[0];
                    int keycode = hidCode[1];

                    if (keycode == 0 && modifier == 0 && c != ' ') {
                        continue; // Skip unrecognized unsupported characters cleanly
                    }

                    int keyHoldTime = 12 + rng.nextInt(12); // 12ms - 24ms realistic contact
                    int charDelay = minDelayMs + rng.nextInt(Math.max(1, maxDelayMs - minDelayMs + 1));

                    // Extra micro-pause for spaces and brackets
                    if (c == '\n' || c == ' ' || c == '{' || c == '}' || c == '(' || c == ')') {
                        charDelay += 20 + rng.nextInt(40);
                    }

                    // Key Press Report (8 Bytes)
                    byte[] pressReport = new byte[]{(byte) modifier, 0x00, (byte) keycode, 0x00, 0x00, 0x00, 0x00, 0x00};
                    bluetoothHidDevice.sendReport(targetDevice, 1, pressReport);
                    Thread.sleep(keyHoldTime);

                    // Key Release Report
                    bluetoothHidDevice.sendReport(targetDevice, 1, cleanRelease);
                    Thread.sleep(charDelay);
                }
                // Final safety release
                bluetoothHidDevice.sendReport(targetDevice, 1, cleanRelease);
                isTypingActive = false;
                if (!shouldStopTyping && callback != null) callback.onSuccess();
            } catch (Exception e) {
                isTypingActive = false;
                if (callback != null) callback.onError(e.getMessage());
            }
        });
    }

    private int[] charToHidCode(char c) {
        int shift = 0x02; // Left Shift modifier
        if (c >= 'a' && c <= 'z') return new int[]{0, 0x04 + (c - 'a')};
        if (c >= 'A' && c <= 'Z') return new int[]{shift, 0x04 + (c - 'A')};
        if (c >= '1' && c <= '9') return new int[]{0, 0x1E + (c - '1')};
        if (c == '0') return new int[]{0, 0x27};

        switch (c) {
            case '\r': return new int[]{0, 0};
            case '!': return new int[]{shift, 0x1E};
            case '@': return new int[]{shift, 0x1F};
            case '#': return new int[]{shift, 0x20};
            case '$': return new int[]{shift, 0x21};
            case '%': return new int[]{shift, 0x22};
            case '^': return new int[]{shift, 0x23};
            case '&': return new int[]{shift, 0x24};
            case '*': return new int[]{shift, 0x25};
            case '(': return new int[]{shift, 0x26};
            case ')': return new int[]{shift, 0x27};
            case ' ': return new int[]{0, 0x2C};
            case '\n': return new int[]{0, 0x28};
            case '\t': return new int[]{0, 0x2B};
            case '-': return new int[]{0, 0x2D};
            case '_': return new int[]{shift, 0x2D};
            case '=': return new int[]{0, 0x2E};
            case '+': return new int[]{shift, 0x2E};
            case '[': return new int[]{0, 0x2F};
            case '{': return new int[]{shift, 0x2F};
            case ']': return new int[]{0, 0x30};
            case '}': return new int[]{shift, 0x30};
            case '\\': return new int[]{0, 0x31};
            case '|': return new int[]{shift, 0x31};
            case ';': return new int[]{0, 0x33};
            case ':': return new int[]{shift, 0x33};
            case '\'': return new int[]{0, 0x34};
            case '"': return new int[]{shift, 0x34};
            case '`': return new int[]{0, 0x35};
            case '~': return new int[]{shift, 0x35};
            case ',': return new int[]{0, 0x36};
            case '<': return new int[]{shift, 0x36};
            case '.': return new int[]{0, 0x37};
            case '>': return new int[]{shift, 0x37};
            case '/': return new int[]{0, 0x38};
            case '?': return new int[]{shift, 0x38};
            default: return new int[]{0, 0x2C};
        }
    }
}
