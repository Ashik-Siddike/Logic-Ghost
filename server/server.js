const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const os = require('os');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;
const PYTHON_PROCESS_URL = 'http://127.0.0.1:5001/process';
const PYTHON_TYPE_URL = 'http://127.0.0.1:5001/type';
const PYTHON_STATUS_URL = 'http://127.0.0.1:5001/status';
const PYTHON_STEALTH_HIDE = 'http://127.0.0.1:5001/stealth/hide';
const PYTHON_STEALTH_SHOW = 'http://127.0.0.1:5001/stealth/show';
const PYTHON_KEYS_URL = 'http://127.0.0.1:5001/api/keys';

// In-memory feed of recent captures
const activityFeed = [];

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure Multer Storage for Screen Captures
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + path.extname(file.originalname || 'capture.jpg');
        cb(null, 'capture_' + uniqueSuffix);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

/**
 * Returns prioritized LAN / Wi-Fi IP address
 */
function getNetworkIpInfo() {
    const interfaces = os.networkInterfaces();
    let preferredIp = '127.0.0.1';
    let allIps = [];

    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                allIps.push({ name, ip: net.address });
                if (
                    name.toLowerCase().includes('wi-fi') || 
                    name.toLowerCase().includes('wlan') || 
                    name.toLowerCase().includes('ethernet') || 
                    name.toLowerCase().includes('local area') ||
                    name.toLowerCase().includes('rndis')
                ) {
                    if (preferredIp === '127.0.0.1' || name.toLowerCase().includes('wi-fi')) {
                        preferredIp = net.address;
                    }
                }
            }
        }
    }

    if (preferredIp === '127.0.0.1' && allIps.length > 0) {
        preferredIp = allIps[0].ip;
    }

    return { primaryIp: preferredIp, allIps };
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

/**
 * POST /capture: Receives image from Android, routes to Python AI Engine
 */
app.post('/capture', upload.single('image'), async (req, res) => {
    const startTime = Date.now();
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided in request' });
        }

        const imagePath = req.file.path;
        console.log(`[Express] Received screen capture: ${imagePath}. Processing with AI engine...`);

        const pythonResponse = await axios.post(PYTHON_PROCESS_URL, {
            imagePath: imagePath
        }, { timeout: 120000 });

        const data = pythonResponse.data || {};
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[Express] AI processed in ${duration}s. Tag: ${data.tag || '[TYPE]'}`);

        const item = {
            id: Date.now(),
            time: new Date().toLocaleTimeString(),
            duration: duration + 's',
            imageFile: path.basename(imagePath),
            tag: data.tag || '[TYPE]',
            payload: data.payload || '',
            engine: data.engine || 'gemini-api',
            key_used: data.key_used || ''
        };

        activityFeed.unshift(item);
        if (activityFeed.length > 30) activityFeed.pop();

        return res.json({
            success: true,
            tag: data.tag || '[TYPE]',
            payload: data.payload || '',
            raw_answer: data.raw_answer || '',
            engine: data.engine,
            key_used: data.key_used,
            duration: duration + 's'
        });
    } catch (err) {
        console.error('[Express] Error processing capture:', err.message);
        return res.status(500).json({
            error: 'Failed to process image capture',
            details: err.response ? err.response.data : err.message
        });
    }
});

/**
 * POST /type: Triggers server-side native Windows typing with customizable speed range
 */
app.post('/type', async (req, res) => {
    try {
        const text = req.body.text;
        const min_delay_ms = req.body.min_delay_ms;
        const max_delay_ms = req.body.max_delay_ms;

        if (!text) {
            return res.status(400).json({ error: 'Text is required for typing' });
        }

        console.log(`[Express] Forwarding typing request (${text.length} chars, range=${min_delay_ms}-${max_delay_ms}ms) to Python engine...`);
        const pythonResponse = await axios.post(PYTHON_TYPE_URL, { 
            text,
            min_delay_ms,
            max_delay_ms
        }, { timeout: 60000 });

        return res.json(pythonResponse.data);
    } catch (err) {
        console.error('[Express] Error forwarding typing request:', err.message);
        return res.status(500).json({ error: 'Failed to inject keystrokes', details: err.message });
    }
});

/**
 * API Key Management Endpoints
 */
app.get('/api/keys', async (req, res) => {
    try {
        const r = await axios.get(PYTHON_KEYS_URL, { timeout: 5000 });
        return res.json(r.data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/keys', async (req, res) => {
    try {
        const r = await axios.post(PYTHON_KEYS_URL, req.body, { timeout: 5000 });
        return res.json(r.data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

/**
 * POST /stealth/hide: Hides off-screen browser from taskbar
 */
app.post('/stealth/hide', async (req, res) => {
    try {
        const r = await axios.post(PYTHON_STEALTH_HIDE, {}, { timeout: 5000 });
        return res.json(r.data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

/**
 * POST /stealth/show: Restores browser to visible screen center
 */
app.post('/stealth/show', async (req, res) => {
    try {
        const r = await axios.post(PYTHON_STEALTH_SHOW, {}, { timeout: 5000 });
        return res.json(r.data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

/**
 * GET /feed: Returns recent AI activities
 */
app.get('/feed', (req, res) => {
    res.json(activityFeed);
});

/**
 * GET /health: Health check endpoint
 */
app.get('/health', (req, res) => {
    const netInfo = getNetworkIpInfo();
    res.json({
        status: 'ok',
        service: 'LogicGhost Desktop Server',
        primaryIp: netInfo.primaryIp,
        allIps: netInfo.allIps,
        timestamp: Date.now()
    });
});

/**
 * GET /: Live Glassmorphic Web Control Dashboard
 */
app.get('/', (req, res) => {
    const netInfo = getNetworkIpInfo();
    const serverUrl = `http://${netInfo.primaryIp}:${PORT}`;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LogicGhost - Desktop AI Control HUD</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #07090e;
            --card-bg: rgba(16, 22, 36, 0.85);
            --border: rgba(0, 240, 255, 0.2);
            --cyan: #00f0ff;
            --green: #00ff88;
            --purple: #a855f7;
            --text: #f1f5f9;
            --text-dim: #94a3b8;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg);
            background-image: radial-gradient(circle at 50% 0%, rgba(0, 240, 255, 0.08), transparent 70%);
            color: var(--text);
            font-family: 'Inter', sans-serif;
            min-height: 100vh;
            padding: 24px;
        }
        .container { max-width: 1100px; margin: 0 auto; }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 24px;
        }
        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .brand-title {
            font-family: 'JetBrains Mono', monospace;
            font-size: 22px;
            font-weight: 800;
            letter-spacing: 2px;
            color: var(--cyan);
            text-shadow: 0 0 12px rgba(0, 240, 255, 0.5);
        }
        .badge {
            background: rgba(0, 255, 136, 0.15);
            border: 1px solid var(--green);
            color: var(--green);
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .badge::before {
            content: '';
            width: 6px;
            height: 6px;
            background: var(--green);
            border-radius: 50%;
            box-shadow: 0 0 6px var(--green);
        }
        .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 24px;
        }
        .card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 14px;
            padding: 20px;
            backdrop-filter: blur(12px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }
        .card-title {
            font-family: 'JetBrains Mono', monospace;
            font-size: 13px;
            color: var(--cyan);
            letter-spacing: 1.5px;
            margin-bottom: 14px;
            text-transform: uppercase;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .url-box {
            background: rgba(0, 0, 0, 0.6);
            border: 1px solid rgba(0, 240, 255, 0.3);
            border-radius: 8px;
            padding: 12px 16px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 16px;
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }
        .btn {
            background: rgba(0, 240, 255, 0.12);
            border: 1px solid var(--cyan);
            color: var(--cyan);
            padding: 10px 16px;
            border-radius: 8px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .btn:hover {
            background: var(--cyan);
            color: #000;
            box-shadow: 0 0 16px rgba(0, 240, 255, 0.6);
            transform: translateY(-1px);
        }
        .btn-purple {
            background: rgba(168, 85, 247, 0.15);
            border-color: var(--purple);
            color: var(--purple);
        }
        .btn-purple:hover {
            background: var(--purple);
            color: #fff;
            box-shadow: 0 0 16px rgba(168, 85, 247, 0.6);
        }
        .btn-group { display: flex; gap: 10px; flex-wrap: wrap; }
        .feed-container {
            margin-top: 16px;
            max-height: 480px;
            overflow-y: auto;
        }
        .feed-item {
            background: rgba(0, 0, 0, 0.4);
            border-left: 3px solid var(--cyan);
            border-radius: 6px;
            padding: 14px;
            margin-bottom: 12px;
        }
        .feed-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 12px;
            font-family: 'JetBrains Mono', monospace;
        }
        .feed-tag {
            background: var(--cyan);
            color: #000;
            padding: 2px 8px;
            border-radius: 4px;
            font-weight: 800;
        }
        .feed-code {
            background: #000;
            border-radius: 6px;
            padding: 12px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 13px;
            color: #38bdf8;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 200px;
            overflow-y: auto;
        }
        .input-text {
            width: 100%;
            background: rgba(0, 0, 0, 0.6);
            border: 1px solid rgba(0, 240, 255, 0.3);
            border-radius: 8px;
            padding: 10px 14px;
            color: #fff;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="brand">
                <div class="brand-title">LOGICGHOST HUD</div>
            </div>
            <div class="badge" id="statusBadge">Active & Online</div>
        </div>

        <div class="grid">
            <div class="card">
                <div class="card-title">📱 Mobile Connect URL</div>
                <div class="url-box">
                    <span id="serverUrlText">${serverUrl}</span>
                    <button class="btn" onclick="copyUrl()">📋 Copy</button>
                </div>
                <p style="font-size: 12px; color: var(--text-dim);">Enter this exact URL into your LogicGhost Android Mobile App (or use <b>http://127.0.0.1:5000</b> via USB Debugging).</p>
            </div>

            <div class="card">
                <div class="card-title">👻 Stealth Window Controls</div>
                <div class="btn-group">
                    <button class="btn" onclick="stealthAction('hide')">👻 Send Off-Screen</button>
                    <button class="btn btn-purple" onclick="stealthAction('show')">🖥️ Bring to Screen</button>
                    <button class="btn" onclick="testType()">⚡ Test Typing</button>
                </div>
                <p id="stealthMsg" style="font-size: 11px; color: var(--green); margin-top: 10px;"></p>
            </div>
        </div>

        <!-- Multi-API Key Round-Robin Management -->
        <div class="card" style="margin-bottom: 24px;">
            <div class="card-title">
                <span>🔑 Multi-API Key Round-Robin Manager</span>
                <span style="font-size: 11px; color: var(--green);" id="activeKeysCount">0 Active Keys</span>
            </div>
            <p style="font-size: 12px; color: var(--text-dim); margin-bottom: 12px;">
                Add multiple Gemini API keys separated by commas. The system will rotate through them circularly to balance requests, give rate limits time to rest, and ensure 100% uptime!
            </p>
            <input type="text" class="input-text" id="apiKeysInput" placeholder="Paste Gemini API Keys (comma-separated): AIzaSy..., AQ.Ab8..." />
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <button class="btn" onclick="saveApiKeys()">💾 Save & Update Keys</button>
                <span id="keysMsg" style="font-size: 11px; color: var(--green);"></span>
            </div>
            <div id="keysList" style="margin-top: 12px; font-family: 'JetBrains Mono'; font-size: 11px; color: var(--cyan);"></div>
        </div>

        <div class="card" style="margin-bottom: 24px;">
            <div class="card-title">⌨️ Organic Human Typing Speed & Jitter Settings</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px;">
                <div>
                    <label style="font-size: 12px; font-family: 'JetBrains Mono'; color: var(--cyan);">Min Delay: <span id="minVal">18</span>ms</label>
                    <input type="range" id="minRange" min="2" max="200" value="18" style="width: 100%; accent-color: var(--cyan);" oninput="updateSpeedUI()">
                </div>
                <div>
                    <label style="font-size: 12px; font-family: 'JetBrains Mono'; color: var(--cyan);">Max Delay: <span id="maxVal">50</span>ms</label>
                    <input type="range" id="maxRange" min="5" max="400" value="50" style="width: 100%; accent-color: var(--cyan);" oninput="updateSpeedUI()">
                </div>
            </div>
            <div class="btn-group">
                <button class="btn" onclick="setPreset(5, 15)">⚡ Ultra (5-15ms)</button>
                <button class="btn" onclick="setPreset(18, 45)">🏃 Fast Human (18-45ms)</button>
                <button class="btn" onclick="setPreset(35, 85)">🚶 Realistic Human (35-85ms)</button>
                <button class="btn btn-purple" onclick="setPreset(80, 180)">🐢 Ultra Stealth (80-180ms)</button>
            </div>
        </div>

        <div class="card">
            <div class="card-title">
                <span>⚡ Live AI Answers & Activity Stream</span>
                <span style="font-size: 11px; color: var(--text-dim);" id="feedCount">0 Captures</span>
            </div>
            <div class="feed-container" id="feedContainer">
                <p style="color: var(--text-dim); text-align: center; padding: 20px;">No captures yet. Take a picture on your phone to see instant results!</p>
            </div>
        </div>
    </div>

    <script>
        function copyUrl() {
            navigator.clipboard.writeText(document.getElementById('serverUrlText').innerText);
            alert('Mobile URL copied to clipboard!');
        }

        async function stealthAction(action) {
            const msgEl = document.getElementById('stealthMsg');
            msgEl.innerText = 'Applying window action...';
            try {
                const res = await fetch('/stealth/' + action, { method: 'POST' });
                const d = await res.json();
                msgEl.innerText = action === 'hide' ? 'Browser hidden from taskbar and placed off-screen!' : 'Browser restored to screen center!';
            } catch (e) {
                msgEl.innerText = 'Action failed: ' + e.message;
            }
        }

        function updateSpeedUI() {
            const min = document.getElementById('minRange').value;
            const max = document.getElementById('maxRange').value;
            document.getElementById('minVal').innerText = min;
            document.getElementById('maxVal').innerText = max;
            fetch('http://127.0.0.1:5001/settings/speed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ min_delay_ms: parseInt(min), max_delay_ms: parseInt(max) })
            }).catch(e => {});
        }

        function setPreset(min, max) {
            document.getElementById('minRange').value = min;
            document.getElementById('maxRange').value = max;
            updateSpeedUI();
        }

        async function testType() {
            const min = parseInt(document.getElementById('minRange').value);
            const max = parseInt(document.getElementById('maxRange').value);
            const msgEl = document.getElementById('stealthMsg');
            msgEl.innerText = 'Click inside any text editor in 2 seconds to test typing...';
            setTimeout(async () => {
                await fetch('/type', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        text: '// [LogicGhost] Organic Human Typing Verified Successfully!\n',
                        min_delay_ms: min,
                        max_delay_ms: max
                    })
                });
                msgEl.innerText = 'Typing completed!';
            }, 2000);
        }

        async function loadApiKeys() {
            try {
                const res = await fetch('/api/keys');
                const data = await res.json();
                document.getElementById('activeKeysCount').innerText = data.total + ' Active Key(s) in Rotation';
                
                const listEl = document.getElementById('keysList');
                if (data.keys && data.keys.length > 0) {
                    listEl.innerHTML = '<b>Active Rotation Queue:</b> ' + data.keys.map(k => \`<span style="background: rgba(0,240,255,0.15); padding: 2px 8px; border-radius: 4px; margin-right: 6px;">Key #\${k.index}: \${k.masked}</span>\`).join(' ➔ ');
                } else {
                    listEl.innerHTML = '<span style="color: #f59e0b;">No API keys saved yet. Paste keys above to enable AI Vision.</span>';
                }
            } catch (e) {}
        }

        async function saveApiKeys() {
            const val = document.getElementById('apiKeysInput').value.trim();
            if (!val) {
                alert('Please enter at least one Gemini API Key!');
                return;
            }
            const msgEl = document.getElementById('keysMsg');
            msgEl.innerText = 'Saving keys...';
            try {
                const res = await fetch('/api/keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keys: val })
                });
                const d = await res.json();
                msgEl.innerText = 'Successfully saved ' + d.total + ' keys!';
                document.getElementById('apiKeysInput').value = '';
                loadApiKeys();
            } catch (e) {
                msgEl.innerText = 'Failed to save keys: ' + e.message;
            }
        }

        async function updateFeed() {
            try {
                const res = await fetch('/feed');
                const items = await res.json();
                const container = document.getElementById('feedContainer');
                document.getElementById('feedCount').innerText = items.length + ' Captures';

                if (items.length === 0) return;

                container.innerHTML = items.map(item => \`
                    <div class="feed-item">
                        <div class="feed-header">
                            <span class="feed-tag">\${item.tag}</span>
                            <span style="color: var(--text-dim);">⏱️ \${item.duration} | 🕒 \${item.time} | 🤖 \${item.engine} \${item.key_used ? ' (' + item.key_used + ')' : ''}</span>
                        </div>
                        <div class="feed-code">\${escapeHtml(item.payload)}</div>
                    </div>
                \`).join('');
            } catch (e) {}
        }

        function escapeHtml(text) {
            return (text || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }

        setInterval(updateFeed, 2000);
        updateFeed();
        loadApiKeys();
    </script>
</body>
</html>`);
});

// Start Express Server
app.listen(PORT, '0.0.0.0', () => {
    const netInfo = getNetworkIpInfo();
    console.log(`=======================================================`);
    console.log(` [LogicGhost] Express Desktop Server Active on Port ${PORT}`);
    console.log(` 📱 ENTER THIS URL IN YOUR MOBILE APP: http://${netInfo.primaryIp}:${PORT}`);
    console.log(` 🌐 Dashboard: http://${netInfo.primaryIp}:${PORT}`);
    console.log(` 💚 Health Check: http://${netInfo.primaryIp}:${PORT}/health`);
    console.log(`=======================================================`);
});
