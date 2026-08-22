const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const os = require('os');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 5000;
const PYTHON_PROCESS_URL = 'http://127.0.0.1:5001/process';
const PYTHON_TYPE_URL = 'http://127.0.0.1:5001/type';
const PYTHON_STATUS_URL = 'http://127.0.0.1:5001/status';
const PYTHON_STEALTH_HIDE = 'http://127.0.0.1:5001/stealth/hide';
const PYTHON_STEALTH_SHOW = 'http://127.0.0.1:5001/stealth/show';
const PYTHON_KEYS_URL = 'http://127.0.0.1:5001/api/keys';
const PYTHON_CONTEXT_URL = 'http://127.0.0.1:5001/api/context';
const PYTHON_CONTEXT_CLEAR = 'http://127.0.0.1:5001/api/context/clear';
const PYTHON_CONTEXT_UPLOAD = 'http://127.0.0.1:5001/api/context/upload';
const PYTHON_SPEED_URL = 'http://127.0.0.1:5001/settings/speed';
const PYTHON_TYPE_SEQUENCE_URL = 'http://127.0.0.1:5001/api/type_sequence';
const PYTHON_TYPE_STOP_URL = 'http://127.0.0.1:5001/api/type/stop';
const PYTHON_TYPE_STATUS_URL = 'http://127.0.0.1:5001/api/type/status';

// In-memory feed of recent captures
const activityFeed = [];

app.get('/logo.png', (req, res) => {
    res.sendFile(path.join(__dirname, '../app_logo.png'));
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure Multer Storage for Screen Captures and Documents
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + path.extname(file.originalname || 'file.dat');
        cb(null, 'file_' + uniqueSuffix);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
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
            is_multi_slot: data.is_multi_slot || false,
            slots: data.slots || {},
            engine: data.engine || 'gemini-api',
            key_used: data.key_used || '',
            rules_active: data.rules_active || false
        };

        activityFeed.unshift(item);
        if (activityFeed.length > 30) activityFeed.pop();

        return res.json({
            success: true,
            tag: data.tag || '[TYPE]',
            payload: data.payload || '',
            is_multi_slot: data.is_multi_slot || false,
            slots: data.slots || {},
            raw_answer: data.raw_answer || '',
            engine: data.engine,
            key_used: data.key_used,
            rules_active: data.rules_active || false,
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
        }, { timeout: 120000 });

        return res.json(pythonResponse.data);
    } catch (err) {
        console.error('[Express] Error forwarding typing request:', err.message);
        return res.status(500).json({ error: 'Failed to inject keystrokes', details: err.message });
    }
});

/**
 * POST /type_sequence: Injects multiple slots with Tab transitions
 */
app.post('/type_sequence', async (req, res) => {
    try {
        const slots = req.body.slots || [];
        const inter_key = req.body.inter_key || 'TAB';
        const inter_delay_sec = req.body.inter_delay_sec || 1.2;

        const pythonResponse = await axios.post(PYTHON_TYPE_SEQUENCE_URL, {
            slots,
            inter_key,
            inter_delay_sec
        }, { timeout: 120000 });

        return res.json(pythonResponse.data);
    } catch (err) {
        console.error('[Express] Error forwarding sequence typing request:', err.message);
        return res.status(500).json({ error: 'Failed to inject sequence keystrokes', details: err.message });
    }
});

/**
 * POST /type/stop: Aborts active typing immediately
 */
app.post('/type/stop', async (req, res) => {
    try {
        const pythonResponse = await axios.post(PYTHON_TYPE_STOP_URL, {}, { timeout: 5000 });
        return res.json(pythonResponse.data);
    } catch (err) {
        console.error('[Express] Error stopping typing:', err.message);
        return res.status(500).json({ error: 'Failed to stop typing', details: err.message });
    }
});

/**
 * GET /type/status: Returns whether typing is active
 */
app.get('/type/status', async (req, res) => {
    try {
        const pythonResponse = await axios.get(PYTHON_TYPE_STATUS_URL, { timeout: 5000 });
        return res.json(pythonResponse.data);
    } catch (err) {
        return res.json({ is_typing: false });
    }
});

/**
 * GET /export/report: Downloads all solved captures as clean Markdown report
 */
app.get('/export/report', (req, res) => {
    let md = `# 👻 LogicGhost Session Evaluation Report\nGenerated: ${new Date().toLocaleString()}\nTotal Captures: ${activityFeed.length}\n\n---\n\n`;
    activityFeed.forEach((item, index) => {
        md += `## Task #${activityFeed.length - index} [${item.tag}] - ${item.time} (⏱️ ${item.duration})\n`;
        md += `* **Engine**: \`${item.engine}\` ${item.key_used ? '(' + item.key_used + ')' : ''}\n`;
        if (item.is_multi_slot && item.slots) {
            if (item.slots.rating) md += `* **Rating/Verdict**: ${item.slots.rating}\n\n`;
            if (item.slots.code) md += `### 💻 Code Solution:\n\`\`\`javascript\n${item.slots.code}\n\`\`\`\n\n`;
            if (item.slots.explanation) md += `### 📝 Justification / Breakdown:\n${item.slots.explanation}\n\n`;
            if (item.slots.audit) md += `### 🛡️ Audit:\n${item.slots.audit}\n\n`;
        } else {
            md += `### Payload:\n\`\`\`\n${item.payload}\n\`\`\`\n\n`;
        }
        md += `---\n\n`;
    });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="LogicGhost_Session_Report.md"');
    res.send(md);
});

/**
 * Knowledgebase Context Endpoints
 */
app.get('/api/context', async (req, res) => {
    try {
        const r = await axios.get(PYTHON_CONTEXT_URL, { timeout: 5000 });
        return res.json(r.data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/context', async (req, res) => {
    try {
        const r = await axios.post(PYTHON_CONTEXT_URL, req.body, { timeout: 5000 });
        return res.json(r.data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/context/clear', async (req, res) => {
    try {
        const r = await axios.post(PYTHON_CONTEXT_CLEAR, {}, { timeout: 5000 });
        return res.json(r.data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/context/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path), req.file.originalname);

        const r = await axios.post(PYTHON_CONTEXT_UPLOAD, formData, {
            headers: formData.getHeaders(),
            timeout: 30000
        });

        // Cleanup temp file
        fs.unlink(req.file.path, () => {});
        return res.json(r.data);
    } catch (e) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(500).json({ error: e.response ? e.response.data : e.message });
    }
});

/**
 * Speed Configuration Endpoints
 */
app.get('/settings/speed', async (req, res) => {
    try {
        const r = await axios.get(PYTHON_SPEED_URL, { timeout: 5000 });
        return res.json(r.data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/settings/speed', async (req, res) => {
    try {
        const r = await axios.post(PYTHON_SPEED_URL, req.body, { timeout: 5000 });
        return res.json(r.data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
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
    <title>LogicGhost - Next-Gen AI Stealth Cockpit</title>
    <link rel="icon" type="image/png" href="/logo.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #07090e;
            --surface: rgba(14, 18, 27, 0.72);
            --surface-hover: rgba(22, 28, 42, 0.85);
            --surface-card: rgba(13, 17, 26, 0.68);
            --border: rgba(255, 255, 255, 0.08);
            --border-glow: rgba(0, 240, 255, 0.35);
            --cyan: #00f0ff;
            --cyan-glow: rgba(0, 240, 255, 0.25);
            --green: #00ff88;
            --green-glow: rgba(0, 255, 136, 0.25);
            --purple: #a855f7;
            --purple-glow: rgba(168, 85, 247, 0.25);
            --indigo: #6366f1;
            --amber: #fbbf24;
            --red: #f43f5e;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --text-dim: #64748b;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            background-color: var(--bg);
            background-image: 
                radial-gradient(1200px circle at var(--mouse-x, 50%) var(--mouse-y, 25%), rgba(0, 240, 255, 0.07) 0%, transparent 45%),
                radial-gradient(900px circle at 85% 15%, rgba(99, 102, 241, 0.06) 0%, transparent 50%),
                linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
            background-size: 100% 100%, 100% 100%, 32px 32px, 32px 32px;
            background-attachment: fixed;
            color: var(--text-main);
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
            min-height: 100vh;
            padding: 32px 20px 60px;
            -webkit-font-smoothing: antialiased;
        }

        .container {
            max-width: 1180px;
            margin: 0 auto;
        }

        /* 🔮 Obsidian Header Bar */
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 22px;
            background: rgba(14, 18, 27, 0.75);
            backdrop-filter: blur(24px) saturate(180%);
            border: 1px solid var(--border);
            border-radius: 18px;
            margin-bottom: 28px;
            box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), inset 0 1px 0 0 rgba(255, 255, 255, 0.1);
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 14px;
        }

        .brand-logo-wrap {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .brand-logo-wrap::after {
            content: '';
            position: absolute;
            inset: -4px;
            background: linear-gradient(135deg, var(--cyan), var(--indigo));
            border-radius: 14px;
            filter: blur(8px);
            opacity: 0.5;
            z-index: -1;
        }

        .brand-logo {
            width: 40px;
            height: 40px;
            border-radius: 12px;
            border: 1.5px solid rgba(255, 255, 255, 0.15);
            display: block;
        }

        .brand-text {
            display: flex;
            flex-direction: column;
        }

        .brand-title {
            font-size: 19px;
            font-weight: 800;
            letter-spacing: 0.8px;
            background: linear-gradient(135deg, #FFFFFF 20%, #A5F3FC 70%, var(--cyan) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .brand-subtitle {
            font-family: 'JetBrains Mono', monospace;
            font-size: 10px;
            color: var(--text-dim);
            letter-spacing: 1.5px;
            text-transform: uppercase;
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .badge-live {
            background: rgba(0, 255, 136, 0.1);
            border: 1px solid rgba(0, 255, 136, 0.3);
            color: var(--green);
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .pulse-dot {
            width: 7px;
            height: 7px;
            background: var(--green);
            border-radius: 50%;
            box-shadow: 0 0 10px var(--green);
            animation: pulse-animation 2s infinite;
        }

        @keyframes pulse-animation {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0, 255, 136, 0.7); }
            70% { transform: scale(1.15); box-shadow: 0 0 0 6px rgba(0, 255, 136, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0, 255, 136, 0); }
        }

        /* 🎛️ Grid Layout */
        .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-bottom: 24px;
        }

        @media (max-width: 860px) {
            .grid { grid-template-columns: 1fr; }
        }

        /* 💎 Cyber-Glass Card */
        .card {
            background: var(--surface-card);
            backdrop-filter: blur(24px) saturate(180%);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 24px;
            box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5), inset 0 1px 0 0 rgba(255, 255, 255, 0.05);
            transition: all 0.25s ease;
            position: relative;
            overflow: hidden;
        }

        .card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent);
        }

        .card:hover {
            border-color: rgba(0, 240, 255, 0.22);
            box-shadow: 0 24px 48px -15px rgba(0, 0, 0, 0.7), inset 0 1px 0 0 rgba(0, 240, 255, 0.2);
            transform: translateY(-1.5px);
        }

        .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }

        .card-title {
            font-size: 14px;
            font-weight: 700;
            color: #ffffff;
            display: flex;
            align-items: center;
            gap: 9px;
            letter-spacing: 0.3px;
        }

        .card-title-icon {
            font-size: 16px;
        }

        .card-tag {
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            font-weight: 600;
            padding: 3px 10px;
            border-radius: 12px;
            background: rgba(0, 240, 255, 0.08);
            border: 1px solid rgba(0, 240, 255, 0.25);
            color: var(--cyan);
        }

        .card-desc {
            font-size: 12.5px;
            color: var(--text-muted);
            line-height: 1.55;
            margin-bottom: 18px;
        }

        /* 📱 URL Box Cyber-Pill */
        .url-box {
            background: rgba(8, 11, 18, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 14px;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 12px;
            transition: all 0.2s;
        }

        .url-box:hover {
            border-color: rgba(0, 240, 255, 0.3);
            background: rgba(10, 14, 24, 0.95);
        }

        .url-box-highlight {
            border: 1px solid rgba(0, 255, 136, 0.35);
            background: rgba(0, 255, 136, 0.03);
        }

        .url-text {
            font-family: 'JetBrains Mono', monospace;
            font-size: 13.5px;
            font-weight: 600;
            color: var(--text-main);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* 🔘 Buttons */
        .btn {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: var(--text-main);
            padding: 9px 16px;
            border-radius: 12px;
            font-family: 'Plus Jakarta Sans', sans-serif;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            display: inline-flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
            user-select: none;
        }

        .btn:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.25);
            transform: translateY(-1px);
        }

        .btn:active {
            transform: translateY(0.5px) scale(0.98);
        }

        .btn-cyan {
            background: rgba(0, 240, 255, 0.1);
            border-color: rgba(0, 240, 255, 0.35);
            color: var(--cyan);
        }

        .btn-cyan:hover {
            background: var(--cyan);
            color: #030712;
            box-shadow: 0 0 20px var(--cyan-glow);
        }

        .btn-green {
            background: rgba(0, 255, 136, 0.1);
            border-color: rgba(0, 255, 136, 0.35);
            color: var(--green);
        }

        .btn-green:hover {
            background: var(--green);
            color: #030712;
            box-shadow: 0 0 20px var(--green-glow);
        }

        .btn-purple {
            background: rgba(168, 85, 247, 0.1);
            border-color: rgba(168, 85, 247, 0.35);
            color: #c084fc;
        }

        .btn-purple:hover {
            background: var(--purple);
            color: #ffffff;
            box-shadow: 0 0 20px var(--purple-glow);
        }

        .btn-red {
            background: rgba(244, 63, 94, 0.1);
            border-color: rgba(244, 63, 94, 0.35);
            color: var(--red);
        }

        .btn-red:hover {
            background: var(--red);
            color: #ffffff;
            box-shadow: 0 0 20px rgba(244, 63, 94, 0.3);
        }

        .btn-group {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            align-items: center;
        }

        /* 🎛️ Speed Preset Buttons */
        .preset-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 10px;
            margin-bottom: 18px;
        }

        .preset-btn {
            background: rgba(10, 14, 22, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: var(--text-muted);
            padding: 11px 14px;
            border-radius: 12px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            display: inline-flex;
            align-items: center;
            gap: 8px;
            text-align: left;
        }

        .preset-btn:hover {
            border-color: rgba(0, 240, 255, 0.3);
            color: #ffffff;
            background: rgba(0, 240, 255, 0.06);
            transform: translateY(-1px);
        }

        .preset-btn.active {
            background: linear-gradient(135deg, #00F0FF, #00B8D9) !important;
            color: #020817 !important;
            border-color: #ffffff !important;
            box-shadow: 0 0 24px rgba(0, 240, 255, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.6) !important;
            font-weight: 800 !important;
            transform: scale(1.02);
        }

        /* 🎚️ Range Sliders */
        .slider-wrap {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 18px;
            background: rgba(8, 11, 18, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 14px;
            padding: 16px;
        }

        @media (max-width: 600px) {
            .slider-wrap { grid-template-columns: 1fr; }
        }

        .slider-label-row {
            display: flex;
            justify-content: space-between;
            font-family: 'JetBrains Mono', monospace;
            font-size: 11.5px;
            color: var(--text-muted);
            margin-bottom: 8px;
        }

        .slider-val {
            color: var(--cyan);
            font-weight: 700;
        }

        input[type="range"] {
            width: 100%;
            height: 6px;
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.1);
            outline: none;
            accent-color: var(--cyan);
            cursor: pointer;
        }

        /* 📝 Text & Textarea Inputs */
        .input-text, .textarea-box {
            width: 100%;
            background: rgba(8, 11, 18, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 14px;
            padding: 13px 16px;
            color: #ffffff;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12.5px;
            margin-bottom: 14px;
            transition: all 0.2s;
        }

        .input-text:focus, .textarea-box:focus {
            outline: none;
            border-color: var(--cyan);
            box-shadow: 0 0 16px var(--cyan-glow);
            background: rgba(10, 14, 24, 0.95);
        }

        .textarea-box {
            resize: vertical;
            min-height: 110px;
            line-height: 1.6;
        }

        /* 📦 Animated Dropzone */
        .dropzone {
            border: 2px dashed rgba(0, 240, 255, 0.35);
            border-radius: 16px;
            padding: 24px;
            text-align: center;
            background: rgba(0, 240, 255, 0.02);
            cursor: pointer;
            transition: all 0.25s ease;
            margin-bottom: 14px;
        }

        .dropzone:hover, .dropzone.dragover {
            background: rgba(0, 240, 255, 0.08);
            border-color: var(--cyan);
            box-shadow: 0 0 24px var(--cyan-glow);
            transform: scale(1.005);
        }

        /* ⚡ Live Feed Stream */
        .feed-container {
            margin-top: 18px;
            max-height: 520px;
            overflow-y: auto;
            padding-right: 4px;
        }

        .feed-container::-webkit-scrollbar {
            width: 6px;
        }

        .feed-container::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.15);
            border-radius: 6px;
        }

        .feed-item {
            background: rgba(8, 11, 18, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.07);
            border-left: 3.5px solid var(--cyan);
            border-radius: 14px;
            padding: 16px;
            margin-bottom: 14px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
            transition: all 0.2s;
        }

        .feed-item:hover {
            border-color: rgba(255, 255, 255, 0.15);
            border-left-color: var(--cyan);
            transform: translateY(-1px);
        }

        .feed-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 10px;
            font-size: 11.5px;
            font-family: 'JetBrains Mono', monospace;
        }

        .feed-tag {
            background: linear-gradient(135deg, var(--cyan), #00B8D9);
            color: #020817;
            padding: 3px 9px;
            border-radius: 6px;
            font-weight: 800;
            letter-spacing: 0.5px;
        }

        .feed-code {
            background: #020408;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 10px;
            padding: 14px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12.5px;
            color: #38bdf8;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 220px;
            overflow-y: auto;
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- 🔮 Header Bar -->
        <header class="header">
            <div class="brand">
                <div class="brand-logo-wrap">
                    <img src="/logo.png" class="brand-logo" alt="LogicGhost Logo">
                </div>
                <div class="brand-text">
                    <div class="brand-title">LOGICGHOST HUD</div>
                    <div class="brand-subtitle">AI Stealth Operations Center</div>
                </div>
            </div>
            <div class="header-actions">
                <a href="/export/report" class="btn btn-green">
                    <span>📥</span> Export Session (.md)
                </a>
                <div class="badge-live" id="statusBadge">
                    <span class="pulse-dot"></span>
                    <span>ACTIVE & ONLINE</span>
                </div>
            </div>
        </header>

        <!-- 📱 Grid Row 1: Mobile URLs & Stealth Actions -->
        <div class="grid">
            <!-- Card 1: Connect URLs -->
            <div class="card">
                <div class="card-header">
                    <div class="card-title">
                        <span class="card-title-icon">📱</span> Mobile Connect URLs
                    </div>
                    <span class="card-tag">DUAL CHANNEL</span>
                </div>
                
                <!-- Option 1: USB Zero-Config Mode (Default & Recommended) -->
                <div style="margin-bottom: 14px;">
                    <div style="font-size: 11px; font-weight: 700; color: var(--green); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                        <span>⚡ 1. USB ZERO-CONFIG (RECOMMENDED)</span>
                        <span style="background: rgba(0,255,136,0.15); border: 1px solid rgba(0,255,136,0.3); padding: 1px 7px; border-radius: 6px; font-size: 9.5px; font-weight: 800;">NO IP NEEDED</span>
                    </div>
                    <div class="url-box url-box-highlight">
                        <span id="usbUrlText" class="url-text" style="color: var(--green);">http://127.0.0.1:5000</span>
                        <button class="btn btn-green" onclick="copyText('http://127.0.0.1:5000', 'USB URL copied to clipboard!')">📋 Copy USB</button>
                    </div>
                </div>

                <!-- Option 2: Wi-Fi / Local LAN Mode -->
                <div>
                    <div style="font-size: 11px; font-weight: 700; color: var(--cyan); margin-bottom: 6px;">📶 2. LOCAL WI-FI / LAN MODE</div>
                    <div class="url-box">
                        <span id="wifiUrlText" class="url-text" style="color: #94A3B8;">${serverUrl}</span>
                        <button class="btn btn-cyan" onclick="copyText('${serverUrl}', 'Wi-Fi URL copied to clipboard!')">📋 Copy Wi-Fi</button>
                    </div>
                </div>

                <div style="font-size: 11px; color: var(--text-dim); margin-top: 12px; line-height: 1.5;">
                    🔌 <b>USB Cable:</b> Set phone to <b>http://127.0.0.1:5000</b> (Instant connection).<br>
                    📶 <b>Same Wi-Fi:</b> Set phone to <b>${serverUrl}</b>.
                </div>
            </div>

            <!-- Card 2: Stealth & Emergency Controls -->
            <div class="card">
                <div class="card-header">
                    <div class="card-title">
                        <span class="card-title-icon">👻</span> Stealth & Emergency Controls
                    </div>
                    <span class="card-tag" style="color: var(--purple); border-color: rgba(168,85,247,0.3);">DESKTOP HOOK</span>
                </div>
                <p class="card-desc">
                    Control the desktop HUD position for maximum privacy during screen sharing, and trigger test keystroke injections.
                </p>
                <div class="btn-group">
                    <button class="btn" onclick="stealthAction('hide')">👻 Send Off-Screen</button>
                    <button class="btn btn-purple" onclick="stealthAction('show')">🖥️ Bring to Screen</button>
                    <button class="btn btn-cyan" onclick="testType()">⚡ Test Typing</button>
                    <button class="btn btn-red" onclick="stopTypingEmergency()" style="font-weight: bold;">🛑 Stop Typing</button>
                </div>
                <p id="stealthMsg" style="font-size: 11.5px; font-family: 'JetBrains Mono', monospace; color: var(--green); margin-top: 14px; min-height: 18px;"></p>
            </div>
        </div>

        <!-- 📚 Card 3: Custom Reference Context & PDF Rulebook Context Manager -->
        <div class="card" style="margin-bottom: 24px;">
            <div class="card-header">
                <div class="card-title">
                    <span class="card-title-icon">📚</span> Custom Reference Context & PDF Rulebook Knowledgebase
                </div>
                <span class="card-tag" id="contextBadge">Context: Inactive</span>
            </div>
            <p class="card-desc">
                Upload rulebook PDFs or paste custom exam guidelines/framework rules. The AI will strictly study and obey these rules before answering any capture!
            </p>

            <!-- Drag and Drop Zone -->
            <div class="dropzone" id="dropzone" onclick="document.getElementById('fileInput').click()">
                <input type="file" id="fileInput" accept=".pdf,.txt,.md,.doc,.docx" style="display:none;" onchange="handleFileSelect(event)">
                <div style="font-size: 28px; margin-bottom: 8px;">📄</div>
                <div style="font-size: 13.5px; font-weight: 700; color: var(--cyan);">Drop PDF or Guidelines File Here (or Click to Browse)</div>
                <div style="font-size: 11.5px; color: var(--text-dim); margin-top: 4px;">Supports .pdf, .txt, .md (Auto-extracted in 1 second)</div>
            </div>

            <textarea class="textarea-box" id="contextTextArea" placeholder="Or paste custom rules, guidelines, code conventions, or exam reference instructions here directly..."></textarea>

            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <div class="btn-group">
                    <button class="btn btn-green" onclick="saveContext(true)">💾 Save & Enable Rules</button>
                    <button class="btn" onclick="toggleContext()">⏸️ Toggle Enable/Disable</button>
                    <button class="btn btn-red" onclick="clearContext()">🗑️ 1-Click Clear Context</button>
                </div>
                <span id="contextStats" style="font-size: 11.5px; font-family: 'JetBrains Mono', monospace; color: var(--green); font-weight: 600;">0 Words Loaded</span>
            </div>
        </div>

        <!-- ⌨️ Card 4: Organic Human Typing Speed & Jitter Settings -->
        <div class="card" style="margin-bottom: 24px;">
            <div class="card-header">
                <div class="card-title">
                    <span class="card-title-icon">⌨️</span> Organic Human Typing Speed & Jitter Engine
                </div>
                <span class="card-tag" id="activePresetTag">Preset: Normal Human</span>
            </div>

            <!-- Real-Time Active Speed Banner -->
            <div style="background: rgba(8, 11, 18, 0.85); border: 1px solid rgba(0, 240, 255, 0.25); border-radius: 14px; padding: 14px 18px; margin-bottom: 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                <span style="font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--cyan);">
                    ⚡ <b>ACTIVE REAL-TIME SPEED:</b> <span id="currentSpeedDisplay" style="color: var(--green); font-weight: bold;">Normal Human (25ms - 55ms)</span>
                </span>
                <span id="speedEstimatedChars" style="font-size: 12px; color: var(--green); font-family: 'JetBrains Mono', monospace; font-weight: bold; background: rgba(0,255,136,0.1); padding: 3px 10px; border-radius: 8px; border: 1px solid rgba(0,255,136,0.25);">~25-40 chars/sec</span>
            </div>

            <!-- Range Sliders -->
            <div class="slider-wrap">
                <div>
                    <div class="slider-label-row">
                        <span>Min Delay</span>
                        <span class="slider-val"><span id="minVal">25</span> ms</span>
                    </div>
                    <input type="range" id="minRange" min="2" max="500" value="25" oninput="onSliderChange()">
                </div>
                <div>
                    <div class="slider-label-row">
                        <span>Max Delay</span>
                        <span class="slider-val"><span id="maxVal">55</span> ms</span>
                    </div>
                    <input type="range" id="maxRange" min="5" max="900" value="55" oninput="onSliderChange()">
                </div>
            </div>

            <!-- Speed Preset Grid -->
            <div class="preset-grid" id="presetButtonGroup">
                <button class="preset-btn" id="btn-ultra" onclick="setSpeedPreset('ultra', 3, 8)">⚡ Ultra Fast (3-8ms)</button>
                <button class="preset-btn" id="btn-fast" onclick="setSpeedPreset('fast', 12, 28)">🏃 Fast Human (12-28ms)</button>
                <button class="preset-btn" id="btn-normal" onclick="setSpeedPreset('normal', 25, 55)">🚶 Normal Human (25-55ms)</button>
                <button class="preset-btn" id="btn-relaxed" onclick="setSpeedPreset('relaxed', 60, 110)">🐢 Relaxed (60-110ms)</button>
                <button class="preset-btn" id="btn-stealth" onclick="setSpeedPreset('stealth', 110, 180)">🦥 Stealth (110-180ms)</button>
                <button class="preset-btn" id="btn-ninja" onclick="setSpeedPreset('ninja', 180, 280)">🕵️ Ghost Ninja (180-280ms)</button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <button class="btn btn-green" onclick="saveSpeedDefault()">💾 Save Speed as Default</button>
                <span id="speedSaveMsg" style="font-size: 11.5px; font-family: 'JetBrains Mono', monospace; color: var(--green); font-weight: bold;"></span>
            </div>
        </div>

        <!-- 🔑 Card 5: Multi-API Key Round-Robin Management -->
        <div class="card" style="margin-bottom: 24px;">
            <div class="card-header">
                <div class="card-title">
                    <span class="card-title-icon">🔑</span> Multi-API Key Round-Robin Manager
                </div>
                <span class="card-tag" style="color: var(--green); border-color: rgba(0,255,136,0.3);" id="activeKeysCount">0 Active Keys</span>
            </div>
            <p class="card-desc">
                Add multiple Gemini API keys separated by commas. The system will rotate through them circularly to balance requests, give rate limits time to rest, and ensure 100% uptime!
            </p>
            <input type="text" class="input-text" id="apiKeysInput" placeholder="Paste Gemini API Keys (comma-separated): AIzaSy..., AQ.Ab8..." />
            
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <div class="btn-group">
                    <button class="btn btn-cyan" onclick="saveApiKeys()">💾 Save & Update Keys</button>
                    <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer" class="btn btn-purple">
                        <span>✨ Get Gemini API Key</span>
                        <span style="font-size: 11px; opacity: 0.85;">↗</span>
                    </a>
                </div>
                <span id="keysMsg" style="font-size: 11.5px; font-family: 'JetBrains Mono', monospace; color: var(--green); font-weight: 600;"></span>
            </div>

            <div id="keysList" style="margin-top: 16px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--cyan); line-height: 1.7;"></div>
        </div>

        <!-- ⚡ Card 6: Live AI Answers & Activity Stream -->
        <div class="card">
            <div class="card-header">
                <div class="card-title">
                    <span class="card-title-icon">⚡</span> Live AI Answers & Activity Stream
                </div>
                <span class="card-tag" id="feedCount">0 Captures</span>
            </div>
            <div class="feed-container" id="feedContainer">
                <p style="color: var(--text-dim); text-align: center; padding: 30px; font-size: 13px;">No captures yet. Take a picture on your phone to see instant results!</p>
            </div>
        </div>
    </div>

    <script>
        // Track mouse position for dynamic ambient spotlight
        document.addEventListener('mousemove', (e) => {
            const x = (e.clientX / window.innerWidth) * 100;
            const y = (e.clientY / window.innerHeight) * 100;
            document.body.style.setProperty('--mouse-x', x + '%');
            document.body.style.setProperty('--mouse-y', y + '%');
        });

        function copyText(text, msg) {
            navigator.clipboard.writeText(text);
            alert(msg || 'Copied to clipboard: ' + text);
        }

        async function stealthAction(action) {
            const msgEl = document.getElementById('stealthMsg');
            msgEl.innerText = 'Applying window action...';
            try {
                const res = await fetch('/stealth/' + action, { method: 'POST' });
                const d = await res.json();
                msgEl.style.color = 'var(--green)';
                msgEl.innerText = action === 'hide' ? 'Browser hidden from taskbar and placed off-screen!' : 'Browser restored to screen center!';
            } catch (e) {
                msgEl.innerText = 'Action failed: ' + e.message;
            }
        }

        async function stopTypingEmergency() {
            const msgEl = document.getElementById('stealthMsg');
            try {
                const res = await fetch('/type/stop', { method: 'POST' });
                const d = await res.json();
                if (msgEl) {
                    msgEl.style.color = '#ef4444';
                    msgEl.innerText = '🛑 Active typing aborted immediately!';
                    setTimeout(() => { msgEl.innerText = ''; }, 3500);
                }
            } catch (e) {
                if (msgEl) msgEl.innerText = 'Stop failed: ' + e.message;
            }
        }

        // Speed Engine Logic
        let currentPreset = 'normal';

        const PRESETS = {
            'ultra': { min: 3, max: 8, name: '⚡ Ultra Fast (3-8ms)', cps: '~150+ chars/sec' },
            'fast': { min: 12, max: 28, name: '🏃 Fast Human (12-28ms)', cps: '~50-80 chars/sec' },
            'normal': { min: 25, max: 55, name: '🚶 Normal Human (25-55ms)', cps: '~25-40 chars/sec' },
            'relaxed': { min: 60, max: 110, name: '🐢 Relaxed (60-110ms)', cps: '~10-15 chars/sec' },
            'stealth': { min: 110, max: 180, name: '🦥 Stealth (110-180ms)', cps: '~6-9 chars/sec' },
            'ninja': { min: 180, max: 280, name: '🕵️ Ghost Ninja (180-280ms)', cps: '~4-6 chars/sec' }
        };

        function highlightPresetButton(presetKey, minMs, maxMs) {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            
            const btn = document.getElementById('btn-' + presetKey);
            if (btn) {
                btn.classList.add('active');
            }

            const tagEl = document.getElementById('activePresetTag');
            const displayEl = document.getElementById('currentSpeedDisplay');
            const cpsEl = document.getElementById('speedEstimatedChars');

            if (PRESETS[presetKey]) {
                tagEl.innerText = 'Preset: ' + PRESETS[presetKey].name;
                displayEl.innerText = PRESETS[presetKey].name + ' (' + PRESETS[presetKey].min + 'ms - ' + PRESETS[presetKey].max + 'ms)';
                cpsEl.innerText = PRESETS[presetKey].cps;
            } else {
                tagEl.innerText = 'Preset: Custom Range';
                displayEl.innerText = 'Custom Range (' + minMs + 'ms - ' + maxMs + 'ms)';
                const avg = (minMs + maxMs) / 2;
                const est = (1000 / Math.max(5, avg)).toFixed(1);
                cpsEl.innerText = '~' + est + ' chars/sec';
            }
        }

        function setSpeedPreset(key, min, max) {
            currentPreset = key;
            document.getElementById('minRange').value = min;
            document.getElementById('maxRange').value = max;
            document.getElementById('minVal').innerText = min;
            document.getElementById('maxVal').innerText = max;

            highlightPresetButton(key, min, max);

            fetch('/settings/speed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ min_delay_ms: min, max_delay_ms: max, preset_name: key, save: true })
            }).catch(e => {});
        }

        function onSliderChange() {
            const min = parseInt(document.getElementById('minRange').value);
            const max = parseInt(document.getElementById('maxRange').value);
            document.getElementById('minVal').innerText = min;
            document.getElementById('maxVal').innerText = max;

            let matchedPreset = 'custom';
            for (const [key, p] of Object.entries(PRESETS)) {
                if (p.min === min && p.max === max) {
                    matchedPreset = key;
                    break;
                }
            }
            currentPreset = matchedPreset;
            highlightPresetButton(matchedPreset, min, max);

            fetch('/settings/speed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ min_delay_ms: min, max_delay_ms: max, preset_name: matchedPreset, save: false })
            }).catch(e => {});
        }

        async function saveSpeedDefault() {
            const min = parseInt(document.getElementById('minRange').value);
            const max = parseInt(document.getElementById('maxRange').value);
            const msgEl = document.getElementById('speedSaveMsg');
            msgEl.innerText = 'Saving default speed...';
            try {
                await fetch('/settings/speed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ min_delay_ms: min, max_delay_ms: max, preset_name: currentPreset, save: true })
                });
                msgEl.innerText = '✅ Saved permanently! LogicGhost will boot with this speed.';
                setTimeout(() => { msgEl.innerText = ''; }, 4000);
            } catch (e) {
                msgEl.innerText = 'Failed to save: ' + e.message;
            }
        }

        async function loadSpeed() {
            try {
                const res = await fetch('/settings/speed');
                const d = await res.json();
                document.getElementById('minRange').value = d.min_delay_ms;
                document.getElementById('maxRange').value = d.max_delay_ms;
                document.getElementById('minVal').innerText = d.min_delay_ms;
                document.getElementById('maxVal').innerText = d.max_delay_ms;
                currentPreset = d.preset_name || 'normal';
                highlightPresetButton(currentPreset, d.min_delay_ms, d.max_delay_ms);
            } catch (e) {}
        }

        // Knowledge Context Logic
        let contextEnabled = false;

        async function loadContext() {
            try {
                const res = await fetch('/api/context');
                const d = await res.json();
                contextEnabled = d.enabled;
                document.getElementById('contextTextArea').value = d.text || '';
                updateContextUI(d);
            } catch (e) {}
        }

        function updateContextUI(d) {
            const badge = document.getElementById('contextBadge');
            const stats = document.getElementById('contextStats');
            if (d.enabled && d.word_count > 0) {
                badge.innerText = '✅ Context Active: ' + (d.filename || 'Custom Rules');
                badge.style.color = 'var(--green)';
                badge.style.borderColor = 'rgba(0,255,136,0.3)';
                stats.innerText = d.word_count + ' Words (~' + Math.round(d.word_count * 1.3) + ' Tokens) Active';
                stats.style.color = 'var(--green)';
            } else if (d.word_count > 0) {
                badge.innerText = '⏸️ Context Paused: ' + (d.filename || 'Custom Rules');
                badge.style.color = 'var(--amber)';
                badge.style.borderColor = 'rgba(251,191,36,0.3)';
                stats.innerText = d.word_count + ' Words (Disabled)';
                stats.style.color = 'var(--amber)';
            } else {
                badge.innerText = 'Context: Empty';
                badge.style.color = 'var(--text-dim)';
                badge.style.borderColor = 'rgba(255,255,255,0.08)';
                stats.innerText = '0 Words Loaded';
                stats.style.color = 'var(--text-dim)';
            }
        }

        async function saveContext(enable = true) {
            const text = document.getElementById('contextTextArea').value.trim();
            try {
                const res = await fetch('/api/context', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, enabled: enable, filename: 'Manual Rules' })
                });
                const d = await res.json();
                updateContextUI(d.context);
                alert(enable ? 'Rules saved and activated!' : 'Rules saved!');
            } catch (e) {
                alert('Failed to save context: ' + e.message);
            }
        }

        async function toggleContext() {
            contextEnabled = !contextEnabled;
            const text = document.getElementById('contextTextArea').value.trim();
            try {
                const res = await fetch('/api/context', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, enabled: contextEnabled })
                });
                const d = await res.json();
                updateContextUI(d.context);
            } catch (e) {}
        }

        async function clearContext() {
            if (!confirm('Are you sure you want to clear the entire custom rulebook context?')) return;
            try {
                const res = await fetch('/api/context/clear', { method: 'POST' });
                const d = await res.json();
                document.getElementById('contextTextArea').value = '';
                updateContextUI(d.context);
                alert('Context cleared successfully!');
            } catch (e) {
                alert('Failed to clear: ' + e.message);
            }
        }

        async function handleFileSelect(e) {
            const file = e.target.files[0];
            if (!file) return;
            uploadContextFile(file);
        }

        async function uploadContextFile(file) {
            const dropEl = document.getElementById('dropzone');
            dropEl.innerText = '⏳ Extracting text from ' + file.name + '...';
            const formData = new FormData();
            formData.append('file', file);
            try {
                const res = await fetch('/api/context/upload', {
                    method: 'POST',
                    body: formData
                });
                const d = await res.json();
                if (d.success) {
                    document.getElementById('contextTextArea').value = d.context.text;
                    updateContextUI(d.context);
                    alert('Successfully extracted ' + d.context.word_count + ' words from ' + file.name + '!');
                } else {
                    alert('Upload failed: ' + (d.error || 'Unknown error'));
                }
            } catch (e) {
                alert('Failed to upload: ' + e.message);
            } finally {
                dropEl.innerHTML = \`
                    <div style="font-size: 28px; margin-bottom: 8px;">📄</div>
                    <div style="font-size: 13.5px; font-weight: 700; color: var(--cyan);">Drop PDF or Guidelines File Here (or Click to Browse)</div>
                    <div style="font-size: 11.5px; color: var(--text-dim); margin-top: 4px;">Supports .pdf, .txt, .md (Auto-extracted in 1 second)</div>
                \`;
            }
        }

        // Drag and Drop listeners
        const dropzone = document.getElementById('dropzone');
        ['dragenter', 'dragover'].forEach(name => {
            dropzone.addEventListener(name, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }, false);
        });
        ['dragleave', 'drop'].forEach(name => {
            dropzone.addEventListener(name, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }, false);
        });
        dropzone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0) uploadContextFile(files[0]);
        });

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
                        text: '// [LogicGhost] Organic Human Typing Verified Successfully!\\n',
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
                    listEl.innerHTML = '<b style="color: #ffffff;">Active Rotation Queue:</b> ' + data.keys.map(k => \`<span style="background: rgba(0,240,255,0.08); border: 1px solid rgba(0,240,255,0.2); padding: 4px 10px; border-radius: 8px; margin-right: 6px; display: inline-block; margin-bottom: 6px;">Key #\${k.index}: <span style="color:#ffffff;">\${k.masked}</span></span>\`).join(' ➔ ');
                } else {
                    listEl.innerHTML = '<span style="color: #fbbf24;">No API keys saved yet. Paste keys above to enable AI Vision.</span>';
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

        async function triggerTypePayload(text) {
            if (!text) return;
            const min = parseInt(document.getElementById('minRange').value);
            const max = parseInt(document.getElementById('maxRange').value);
            const msgEl = document.getElementById('stealthMsg');
            if (msgEl) msgEl.innerText = 'Click target window in 2s to inject slot...';
            setTimeout(async () => {
                try {
                    await fetch('/type', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            text: text,
                            min_delay_ms: min,
                            max_delay_ms: max
                        })
                    });
                    if (msgEl) msgEl.innerText = 'Slot typed successfully!';
                } catch (e) {}
            }, 2000);
        }

        async function updateFeed() {
            try {
                const res = await fetch('/feed');
                const items = await res.json();
                const container = document.getElementById('feedContainer');
                document.getElementById('feedCount').innerText = items.length + ' Captures';

                if (items.length === 0) return;

                container.innerHTML = items.map(item => {
                    let slotHtml = '';
                    if (item.is_multi_slot && item.slots) {
                        if (item.slots.rating) {
                            slotHtml += \`
                                <div style="background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 10px; padding: 10px 14px; margin-bottom: 10px;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                        <span style="font-weight:700; color:#c084fc; font-size:11.5px; font-family:'JetBrains Mono';">⭐ RATING / VERDICT:</span>
                                        <button class="btn btn-purple" style="padding:3px 10px; font-size:10.5px;" onclick="triggerTypePayload('\${escapeHtml(item.slots.rating)}')">⚡ Type Rating</button>
                                    </div>
                                    <div style="font-size:12.5px; color:#ffffff; font-weight:600;">\${escapeHtml(item.slots.rating)}</div>
                                </div>\`;
                        }
                        if (item.slots.code) {
                            slotHtml += \`
                                <div style="background: #020408; border: 1px solid rgba(0, 240, 255, 0.25); border-radius: 10px; padding: 10px 14px; margin-bottom: 10px;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                        <span style="font-weight:700; color:var(--cyan); font-size:11.5px; font-family:'JetBrains Mono';">💻 CODE BOX:</span>
                                        <button class="btn btn-cyan" style="padding:3px 10px; font-size:10.5px;" onclick="triggerTypePayload('\${escapeHtml(item.slots.code)}')">⚡ Type Code</button>
                                    </div>
                                    <div class="feed-code" style="max-height:160px;">\${escapeHtml(item.slots.code)}</div>
                                </div>\`;
                        }
                        if (item.slots.explanation) {
                            slotHtml += \`
                                <div style="background: rgba(0, 255, 136, 0.06); border: 1px solid rgba(0, 255, 136, 0.25); border-radius: 10px; padding: 10px 14px; margin-bottom: 10px;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                        <span style="font-weight:700; color:var(--green); font-size:11.5px; font-family:'JetBrains Mono';">📝 JUSTIFICATION / EXPLANATION:</span>
                                        <button class="btn btn-green" style="padding:3px 10px; font-size:10.5px;" onclick="triggerTypePayload('\${escapeHtml(item.slots.explanation)}')">📝 Type Reason</button>
                                    </div>
                                    <div style="font-size:12.5px; color:#e2e8f0; white-space:pre-wrap; max-height:160px; overflow-y:auto; font-family:'Plus Jakarta Sans'; line-height:1.55;">\${escapeHtml(item.slots.explanation)}</div>
                                </div>\`;
                        }
                        if (item.slots.audit) {
                            slotHtml += \`
                                <div style="background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 10px; padding: 10px 14px;">
                                    <span style="font-weight:700; color:var(--amber); font-size:11.5px; font-family:'JetBrains Mono';">🛡️ AUDIT:</span>
                                    <div style="font-size:12px; color:#fde68a; margin-top:3px;">\${escapeHtml(item.slots.audit)}</div>
                                </div>\`;
                        }
                    } else {
                        slotHtml = \`<div class="feed-code">\${escapeHtml(item.payload)}</div>\`;
                    }

                    return \`
                        <div class="feed-item">
                            <div class="feed-header">
                                <div>
                                    <span class="feed-tag">\${item.tag}</span>
                                    \${item.is_multi_slot ? '<span style="background: rgba(168,85,247,0.15); border: 1px solid rgba(168,85,247,0.3); color: #c084fc; padding: 2px 7px; border-radius: 6px; font-size: 10px; margin-left: 6px; font-weight:bold;">✨ MULTI-SLOT RLHF</span>' : ''}
                                    \${item.rules_active ? '<span style="background: rgba(0,255,136,0.15); border: 1px solid rgba(0,255,136,0.3); color: var(--green); padding: 2px 7px; border-radius: 6px; font-size: 10px; margin-left: 6px; font-weight:bold;">📚 PDF RULES</span>' : ''}
                                </div>
                                <span style="color: var(--text-dim);">⏱️ \${item.duration} | 🕒 \${item.time} | 🤖 \${item.engine} \${item.key_used ? ' (' + item.key_used + ')' : ''}</span>
                            </div>
                            \${slotHtml}
                        </div>
                    \`;
                }).join('');
            } catch (e) {}
        }

        function escapeHtml(text) {
            return (text || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }

        setInterval(updateFeed, 2000);
        updateFeed();
        loadApiKeys();
        loadSpeed();
        loadContext();
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
