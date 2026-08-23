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
const PYTHON_PROCESS_AUDIO_URL = 'http://127.0.0.1:5001/process_audio';
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
app.use(express.static(path.join(__dirname, 'public')));
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
 * POST /audio-capture: Receives audio recording from Android, routes to Gemini AI Engine
 */
app.post('/audio-capture', upload.single('audio'), async (req, res) => {
    const startTime = Date.now();
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided in request' });
        }

        const audioPath = req.file.path;
        console.log(`[Express] Received audio question: ${audioPath}. Processing with Gemini AI engine...`);

        const pythonResponse = await axios.post(PYTHON_PROCESS_AUDIO_URL, {
            audioPath: audioPath
        }, { timeout: 120000 });

        const data = pythonResponse.data || {};
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[Express] Audio AI processed in ${duration}s. Tag: ${data.tag || '[VOICE]'}`);

        const item = {
            id: Date.now(),
            time: new Date().toLocaleTimeString(),
            duration: duration + 's',
            audioFile: path.basename(audioPath),
            tag: data.tag || '[VOICE]',
            payload: data.payload || '',
            is_multi_slot: data.is_multi_slot || false,
            slots: data.slots || {},
            engine: data.engine || 'gemini-2.5-flash-audio',
            key_used: data.key_used || '',
            rules_active: data.rules_active || false
        };

        activityFeed.unshift(item);
        if (activityFeed.length > 30) activityFeed.pop();

        return res.json({
            success: true,
            tag: data.tag || '[VOICE]',
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
        console.error('[Express] Error processing audio capture:', err.message);
        return res.status(500).json({
            error: 'Failed to process audio capture',
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
        const response = await axios.post(PYTHON_TYPE_STOP_URL, {}, { timeout: 3000 });
        io.emit('typing_stopped', { timestamp: Date.now() });
        return res.json(response.data);
    } catch (err) {
        console.error('[Node Server Error /type/stop]', err.message);
        return res.status(500).json({ error: 'Failed to abort typing', details: err.message });
    }
});

/**
 * POST /type/pause: Pauses active typing at current character index
 */
app.post('/type/pause', async (req, res) => {
    try {
        const response = await axios.post('http://127.0.0.1:5001/api/type/pause', {}, { timeout: 3000 });
        io.emit('typing_paused', { timestamp: Date.now() });
        return res.json(response.data);
    } catch (err) {
        console.error('[Node Server Error /type/pause]', err.message);
        return res.status(500).json({ error: 'Failed to pause typing', details: err.message });
    }
});

/**
 * POST /type/resume: Resumes active typing from current character index
 */
app.post('/type/resume', async (req, res) => {
    try {
        const response = await axios.post('http://127.0.0.1:5001/api/type/resume', {}, { timeout: 3000 });
        io.emit('typing_resumed', { timestamp: Date.now() });
        return res.json(response.data);
    } catch (err) {
        console.error('[Node Server Error /type/resume]', err.message);
        return res.status(500).json({ error: 'Failed to resume typing', details: err.message });
    }
});

/**
 * POST /type/toggle_pause: Flips pause/resume state
 */
app.post('/type/toggle_pause', async (req, res) => {
    try {
        const response = await axios.post('http://127.0.0.1:5001/api/type/toggle_pause', {}, { timeout: 3000 });
        io.emit('typing_pause_toggled', { timestamp: Date.now(), is_paused: response.data.is_paused });
        return res.json(response.data);
    } catch (err) {
        console.error('[Node Server Error /type/toggle_pause]', err.message);
        return res.status(500).json({ error: 'Failed to toggle pause typing', details: err.message });
    }
});

/**
 * GET /type/status: Returns whether typing is active
 */
app.get('/type/status', async (req, res) => {
    try {
        const response = await axios.get(PYTHON_TYPE_STATUS_URL, { timeout: 3000 });
        return res.json(response.data);
    } catch (err) {
        return res.json({ is_typing: false, is_paused: false });
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
    <title>LOGICGHOST // TACTICAL AI HACKER HUD</title>
    <link rel="icon" type="image/png" href="/logo.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;800;900&family=JetBrains+Mono:ital,wght@0,300;0,400;0,600;0,700;0,800;1,400&family=Share+Tech+Mono&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-void: #020408;
            --surface-hud: rgba(6, 12, 24, 0.86);
            --surface-panel: rgba(8, 16, 32, 0.92);
            --cyan: #00f0ff;
            --cyan-glow: rgba(0, 240, 255, 0.45);
            --green: #00ff88;
            --green-glow: rgba(0, 255, 136, 0.45);
            --pink: #ff0055;
            --pink-glow: rgba(255, 0, 85, 0.45);
            --purple: #b026ff;
            --amber: #ffb800;
            --border-cyan: rgba(0, 240, 255, 0.35);
            --text-main: #e6faff;
            --text-dim: #7da5b8;
            --text-mono: 'JetBrains Mono', 'Share Tech Mono', monospace;
            --text-hud: 'Orbitron', sans-serif;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        /* 🎯 Cyberpunk Tactical Custom Cursor */
        @media (pointer: fine) {
            body, button, a, input, textarea, select, .cyber-dropzone, .speed-btn, .btn-cyber {
                cursor: none !important;
            }
        }

        .cyber-cursor-dot {
            position: fixed;
            top: -100px; left: -100px;
            width: 6px;
            height: 6px;
            background: var(--cyan);
            border-radius: 50%;
            pointer-events: none;
            z-index: 99999;
            box-shadow: 0 0 10px var(--cyan), 0 0 20px var(--cyan);
            transform: translate(-50%, -50%);
            transition: width 0.15s, height 0.15s, background-color 0.2s;
        }

        .cyber-cursor-ring {
            position: fixed;
            top: -100px; left: -100px;
            width: 30px;
            height: 30px;
            border: 1.5px solid rgba(0, 240, 255, 0.7);
            border-radius: 50%;
            pointer-events: none;
            z-index: 99998;
            transform: translate(-50%, -50%);
            transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1), height 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s;
            box-shadow: 0 0 15px rgba(0, 240, 255, 0.3), inset 0 0 8px rgba(0, 240, 255, 0.15);
        }

        .cyber-cursor-ring::before {
            content: '';
            position: absolute;
            top: 50%; left: -4px; right: -4px; height: 1px;
            background: var(--cyan);
            transform: translateY(-50%);
            opacity: 0.6;
        }

        .cyber-cursor-ring::after {
            content: '';
            position: absolute;
            left: 50%; top: -4px; bottom: -4px; width: 1px;
            background: var(--cyan);
            transform: translateX(-50%);
            opacity: 0.6;
        }

        /* Hover Lock-on Target Mode */
        .cyber-cursor-ring.cursor-hover {
            width: 48px;
            height: 48px;
            border-color: var(--pink);
            border-radius: 6px;
            box-shadow: 0 0 25px var(--pink-glow), inset 0 0 12px rgba(255, 0, 85, 0.3);
            animation: cursor-spin 4s linear infinite;
        }

        .cyber-cursor-dot.cursor-hover {
            background: var(--pink);
            box-shadow: 0 0 12px var(--pink), 0 0 20px var(--pink);
            width: 8px;
            height: 8px;
        }

        /* Click Shockwave */
        .cursor-click-wave {
            position: fixed;
            width: 16px;
            height: 16px;
            border: 2px solid var(--green);
            border-radius: 50%;
            pointer-events: none;
            z-index: 99997;
            transform: translate(-50%, -50%) scale(1);
            animation: click-wave-anim 0.38s ease-out forwards;
        }

        @keyframes click-wave-anim {
            0% { transform: translate(-50%, -50%) scale(1); opacity: 1; border-color: var(--cyan); }
            100% { transform: translate(-50%, -50%) scale(3.5); opacity: 0; border-color: var(--pink); }
        }

        @keyframes cursor-spin {
            0% { transform: translate(-50%, -50%) rotate(0deg); }
            100% { transform: translate(-50%, -50%) rotate(360deg); }
        }

        body {
            background: 
                linear-gradient(180deg, rgba(2, 4, 8, 0.88) 0%, rgba(2, 4, 8, 0.94) 45%, rgba(2, 4, 8, 0.98) 100%),
                url('/cyber_city.jpg') no-repeat center top fixed;
            background-size: cover;
            color: var(--text-main);
            font-family: var(--text-mono);
            min-height: 100vh;
            padding: 24px 18px 60px;
            position: relative;
            overflow-x: hidden;
        }

        /* ⚡ Cyberpunk Scanline & CRT Effect */
        body::before {
            content: " ";
            display: block;
            position: fixed;
            top: 0; left: 0; bottom: 0; right: 0;
            background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.3) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03));
            z-index: 999;
            background-size: 100% 3px, 6px 100%;
            pointer-events: none;
            opacity: 0.75;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            position: relative;
            z-index: 10;
        }

        /* 🥷 Tactical HUD Top Banner */
        .hud-header {
            background: rgba(4, 10, 20, 0.9);
            border: 1px solid var(--border-cyan);
            border-left: 4px solid var(--pink);
            border-right: 4px solid var(--cyan);
            padding: 18px 24px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 0 35px rgba(0, 240, 255, 0.15), inset 0 0 20px rgba(0, 240, 255, 0.05);
            position: relative;
            clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px));
        }

        .hud-header::before {
            content: "SYS_VER // 2.0.4 [MIL-SPEC]";
            position: absolute;
            top: -9px;
            left: 20px;
            background: #020408;
            border: 1px solid var(--cyan);
            color: var(--cyan);
            font-size: 9px;
            font-weight: 800;
            padding: 1px 8px;
            letter-spacing: 1.5px;
        }

        .brand-cluster {
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .brand-logo-frame {
            position: relative;
            padding: 2px;
            background: linear-gradient(135deg, var(--pink), var(--cyan));
            border-radius: 6px;
            box-shadow: 0 0 20px var(--cyan-glow);
        }

        .brand-logo {
            width: 44px;
            height: 44px;
            border-radius: 4px;
            display: block;
        }

        .brand-title {
            font-family: var(--text-hud);
            font-size: 22px;
            font-weight: 900;
            letter-spacing: 3px;
            color: #ffffff;
            text-shadow: 0 0 14px var(--cyan), 0 0 25px var(--cyan-glow);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .brand-subtitle {
            font-size: 11px;
            color: var(--pink);
            letter-spacing: 2px;
            text-transform: uppercase;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .hud-status-cluster {
            display: flex;
            align-items: center;
            gap: 14px;
            flex-wrap: wrap;
        }

        .status-beacon {
            background: rgba(0, 255, 136, 0.12);
            border: 1px solid var(--green);
            color: var(--green);
            padding: 6px 14px;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 1px;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 0 15px var(--green-glow);
            text-transform: uppercase;
        }

        .pulsing-led {
            width: 8px;
            height: 8px;
            background: var(--green);
            border-radius: 50%;
            box-shadow: 0 0 10px var(--green);
            animation: tactical-pulse 1.4s infinite;
        }

        @keyframes tactical-pulse {
            0% { transform: scale(0.9); opacity: 0.7; box-shadow: 0 0 4px var(--green); }
            50% { transform: scale(1.3); opacity: 1; box-shadow: 0 0 14px var(--green); }
            100% { transform: scale(0.9); opacity: 0.7; box-shadow: 0 0 4px var(--green); }
        }

        /* 🎛️ Tactical HUD Cards */
        .hud-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }

        @media (max-width: 860px) {
            .hud-grid { grid-template-columns: 1fr; }
        }

        .cyber-card {
            background: var(--surface-hud);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border-cyan);
            padding: 22px;
            position: relative;
            box-shadow: 0 0 25px rgba(0, 240, 255, 0.07), inset 0 0 15px rgba(0, 240, 255, 0.02);
            clip-path: polygon(0 12px, 12px 0, calc(100% - 12px) 0, 100% 12px, 100% calc(100% - 12px), calc(100% - 12px) 100%, 12px 100%, 0 calc(100% - 12px));
            transition: all 0.25s ease;
        }

        .cyber-card:hover {
            border-color: var(--cyan);
            box-shadow: 0 0 35px rgba(0, 240, 255, 0.2), inset 0 0 25px rgba(0, 240, 255, 0.06);
            transform: translateY(-2px);
        }

        /* Sci-Fi Corner Brackets */
        .cyber-card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 14px; height: 14px;
            border-top: 2px solid var(--cyan);
            border-left: 2px solid var(--cyan);
        }

        .cyber-card::after {
            content: '';
            position: absolute;
            bottom: 0; right: 0; width: 14px; height: 14px;
            border-bottom: 2px solid var(--pink);
            border-right: 2px solid var(--pink);
        }

        .card-header-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
            padding-bottom: 10px;
            border-bottom: 1px dashed rgba(0, 240, 255, 0.25);
        }

        .card-title-tactical {
            font-family: var(--text-hud);
            font-size: 13.5px;
            font-weight: 800;
            letter-spacing: 1.5px;
            color: #ffffff;
            display: flex;
            align-items: center;
            gap: 10px;
            text-transform: uppercase;
        }

        .tag-pill {
            font-size: 10px;
            font-weight: 800;
            padding: 3px 8px;
            background: rgba(0, 240, 255, 0.12);
            border: 1px solid var(--cyan);
            color: var(--cyan);
            letter-spacing: 1px;
            text-transform: uppercase;
        }

        .tag-pill-pink {
            background: rgba(255, 0, 85, 0.15);
            border-color: var(--pink);
            color: var(--pink);
        }

        .tag-pill-green {
            background: rgba(0, 255, 136, 0.15);
            border-color: var(--green);
            color: var(--green);
        }

        /* 📱 Cyber URL Boxes */
        .cyber-url-box {
            background: rgba(2, 6, 12, 0.95);
            border: 1px solid rgba(0, 240, 255, 0.3);
            padding: 12px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 12px;
            position: relative;
        }

        .cyber-url-box::before {
            content: '';
            position: absolute;
            left: 0; top: 0; bottom: 0; width: 3px;
            background: var(--cyan);
            box-shadow: 0 0 8px var(--cyan);
        }

        .cyber-url-box-highlight {
            border-color: rgba(0, 255, 136, 0.5);
        }
        .cyber-url-box-highlight::before {
            background: var(--green);
            box-shadow: 0 0 10px var(--green);
        }

        .url-val {
            font-size: 13.5px;
            font-weight: 700;
            color: #ffffff;
            letter-spacing: 0.5px;
        }

        /* 🔘 Cyberpunk Buttons */
        .btn-cyber {
            background: rgba(0, 240, 255, 0.1);
            border: 1px solid var(--cyan);
            color: var(--cyan);
            padding: 9px 16px;
            font-family: var(--text-mono);
            font-size: 11.5px;
            font-weight: 800;
            letter-spacing: 1px;
            cursor: pointer;
            text-transform: uppercase;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
            position: relative;
            clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px));
        }

        .btn-cyber:hover {
            background: var(--cyan);
            color: #020408;
            box-shadow: 0 0 20px var(--cyan), inset 0 0 10px #ffffff;
            transform: translateY(-1px);
        }

        .btn-cyber:active {
            transform: scale(0.97);
        }

        .btn-cyber-pink {
            background: rgba(255, 0, 85, 0.12);
            border-color: var(--pink);
            color: var(--pink);
        }
        .btn-cyber-pink:hover {
            background: var(--pink);
            color: #ffffff;
            box-shadow: 0 0 20px var(--pink), inset 0 0 10px #ffffff;
        }

        .btn-cyber-green {
            background: rgba(0, 255, 136, 0.12);
            border-color: var(--green);
            color: var(--green);
        }
        .btn-cyber-green:hover {
            background: var(--green);
            color: #020408;
            box-shadow: 0 0 20px var(--green), inset 0 0 10px #ffffff;
        }

        .btn-cyber-amber {
            background: rgba(255, 184, 0, 0.12);
            border-color: var(--amber);
            color: var(--amber);
        }
        .btn-cyber-amber:hover {
            background: var(--amber);
            color: #020408;
            box-shadow: 0 0 20px var(--amber), inset 0 0 10px #ffffff;
        }

        /* 🎛️ Speed Preset Tactical Matrix */
        .speed-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
            gap: 10px;
            margin-bottom: 18px;
        }

        .speed-btn {
            background: rgba(4, 8, 16, 0.85);
            border: 1px solid rgba(0, 240, 255, 0.2);
            color: var(--text-dim);
            padding: 10px 14px;
            font-family: var(--text-mono);
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 8px;
            text-align: left;
            clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px));
        }

        .speed-btn:hover {
            border-color: var(--cyan);
            color: #ffffff;
            background: rgba(0, 240, 255, 0.08);
            box-shadow: 0 0 12px rgba(0, 240, 255, 0.3);
        }

        .speed-btn.active {
            background: var(--cyan) !important;
            color: #020408 !important;
            border-color: #ffffff !important;
            box-shadow: 0 0 24px var(--cyan), inset 0 0 8px rgba(255, 255, 255, 0.8) !important;
            font-weight: 900 !important;
            transform: scale(1.02);
        }

        /* 🎚️ Cyber Sliders */
        .slider-matrix {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 16px;
            background: rgba(2, 6, 14, 0.85);
            border: 1px solid rgba(0, 240, 255, 0.25);
            padding: 16px;
        }

        @media (max-width: 600px) {
            .slider-matrix { grid-template-columns: 1fr; }
        }

        .slider-header {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: var(--cyan);
            font-weight: 700;
            margin-bottom: 8px;
            letter-spacing: 1px;
        }

        input[type="range"] {
            width: 100%;
            height: 6px;
            background: #020408;
            border: 1px solid rgba(0, 240, 255, 0.4);
            accent-color: var(--cyan);
            cursor: pointer;
        }

        /* 📝 Cyber Inputs & Textareas */
        .cyber-input, .cyber-textarea {
            width: 100%;
            background: rgba(2, 6, 14, 0.95);
            border: 1px solid rgba(0, 240, 255, 0.3);
            padding: 12px 16px;
            color: #ffffff;
            font-family: var(--text-mono);
            font-size: 12px;
            margin-bottom: 14px;
            outline: none;
            transition: all 0.2s;
        }

        .cyber-input:focus, .cyber-textarea:focus {
            border-color: var(--cyan);
            box-shadow: 0 0 16px var(--cyan-glow);
            background: rgba(4, 10, 22, 0.98);
        }

        .cyber-textarea {
            resize: vertical;
            min-height: 100px;
            line-height: 1.6;
        }

        /* 📦 Holographic Dropzone */
        .cyber-dropzone {
            border: 2px dashed rgba(0, 240, 255, 0.45);
            background: rgba(0, 240, 255, 0.03);
            padding: 22px;
            text-align: center;
            cursor: pointer;
            margin-bottom: 14px;
            transition: all 0.25s;
            position: relative;
        }

        .cyber-dropzone:hover, .cyber-dropzone.dragover {
            background: rgba(0, 240, 255, 0.1);
            border-color: var(--cyan);
            box-shadow: 0 0 25px var(--cyan-glow);
        }

        /* ⚡ Live Feed Stream */
        .feed-box {
            margin-top: 16px;
            max-height: 520px;
            overflow-y: auto;
            padding-right: 6px;
        }

        .feed-box::-webkit-scrollbar { width: 5px; }
        .feed-box::-webkit-scrollbar-thumb { background: var(--cyan); }

        .feed-tactical-item {
            background: rgba(4, 10, 20, 0.92);
            border: 1px solid rgba(0, 240, 255, 0.25);
            border-left: 4px solid var(--cyan);
            padding: 16px;
            margin-bottom: 14px;
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.6);
            position: relative;
        }

        .feed-tactical-item:hover {
            border-color: var(--cyan);
            box-shadow: 0 0 25px rgba(0, 240, 255, 0.25);
        }

        .feed-code-block {
            background: #010204;
            border: 1px solid rgba(0, 240, 255, 0.25);
            padding: 14px;
            font-family: var(--text-mono);
            font-size: 12.5px;
            color: #38bdf8;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 220px;
            overflow-y: auto;
            line-height: 1.5;
        }

        /* Tactical HUD Card Art Banner */
        .card-art-banner {
            width: 100%;
            height: 110px;
            border-radius: 2px;
            border: 1px solid rgba(0, 240, 255, 0.3);
            margin-bottom: 14px;
            background-size: cover;
            background-position: center;
            position: relative;
            overflow: hidden;
        }

        .card-art-banner::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, transparent 40%, rgba(2, 4, 8, 0.9) 100%);
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- 🥷 Tactical HUD Top Banner -->
        <header class="hud-header">
            <div class="brand-cluster">
                <div class="brand-logo-frame">
                    <img src="/logo.png" class="brand-logo" alt="Logo">
                </div>
                <div>
                    <div class="brand-title">LOGICGHOST // HUD</div>
                    <div class="brand-subtitle">⚡ TACTICAL AI OPERATIONS MAINFRAME</div>
                </div>
            </div>

            <div class="hud-status-cluster">
                <a href="/export/report" class="btn-cyber btn-cyber-green">
                    <span>📥</span> EXPORT SESSION (.MD)
                </a>
                <div class="status-beacon">
                    <span class="pulsing-led"></span>
                    <span id="statusBadge">MAINFRAME ONLINE</span>
                </div>
            </div>
        </header>

        <!-- 📱 Grid Row 1: Mobile URLs & Stealth Actions -->
        <div class="hud-grid">
            <!-- Card 1: Connect URLs -->
            <div class="cyber-card">
                <div class="card-header-bar">
                    <div class="card-title-tactical">
                        <span>📱</span> SECURE LINK CHANNELS
                    </div>
                    <span class="tag-pill">DUAL_PORT</span>
                </div>

                <!-- Option 1: USB Zero-Config Mode (Default & Recommended) -->
                <div style="margin-bottom: 14px;">
                    <div style="font-size: 11px; font-weight: 800; color: var(--green); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                        <span>⚡ [CHANNEL 01] USB ZERO-CONFIG (RECOMMENDED)</span>
                        <span class="tag-pill tag-pill-green" style="font-size: 9px;">NO IP NEEDED</span>
                    </div>
                    <div class="cyber-url-box cyber-url-box-highlight">
                        <span id="usbUrlText" class="url-val" style="color: var(--green);">http://127.0.0.1:5000</span>
                        <button class="btn-cyber btn-cyber-green" onclick="copyText('http://127.0.0.1:5000', 'USB Link Copied!')">📋 COPY USB</button>
                    </div>
                </div>

                <!-- Option 2: Wi-Fi / Local LAN Mode -->
                <div>
                    <div style="font-size: 11px; font-weight: 800; color: var(--cyan); margin-bottom: 6px;">📶 [CHANNEL 02] WIRELESS LAN MODE</div>
                    <div class="cyber-url-box">
                        <span id="wifiUrlText" class="url-val" style="color: #94A3B8;">${serverUrl}</span>
                        <button class="btn-cyber" onclick="copyText('${serverUrl}', 'Wi-Fi Link Copied!')">📋 COPY WI-FI</button>
                    </div>
                </div>

                <div style="font-size: 11px; color: var(--text-dim); margin-top: 14px; line-height: 1.5;">
                    🔌 <b>USB Hardware Link:</b> Target <b>http://127.0.0.1:5000</b> (Instant Zero-Latency).<br>
                    📶 <b>Local Cyber Grid:</b> Target <b>${serverUrl}</b>.
                </div>
            </div>

            <!-- Card 2: Stealth & Emergency Controls -->
            <div class="cyber-card">
                <div class="card-header-bar">
                    <div class="card-title-tactical">
                        <span>👻</span> STEALTH & EMERGENCY HOOKS
                    </div>
                    <span class="tag-pill tag-pill-pink">PROCTOR_SHIELD</span>
                </div>

                <!-- Card Art Illustration -->
                <div class="card-art-banner" style="background-image: url('/cyber_hud.jpg');"></div>

                <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px;">
                    <button class="btn-cyber" onclick="stealthAction('hide')">👻 SEND OFF-SCREEN</button>
                    <button class="btn-cyber btn-cyber-pink" onclick="stealthAction('show')">🖥️ RESTORE HUD</button>
                    <button class="btn-cyber btn-cyber-green" onclick="testType()">⚡ TEST INJECTION</button>
                    <button class="btn-cyber btn-cyber-pink" onclick="stopTypingEmergency()" style="border-width: 2px;">🛑 ABORT TYPING</button>
                </div>
                <p id="stealthMsg" style="font-size: 11px; color: var(--green); font-weight: 700; min-height: 18px;"></p>
            </div>
        </div>

        <!-- 📚 Card 3: Custom Reference Context & PDF Rulebook Context Manager -->
        <div class="cyber-card" style="margin-bottom: 20px;">
            <div class="card-header-bar">
                <div class="card-title-tactical">
                    <span>📚</span> KNOWLEDGEBASE & PDF RULEBOOK MATRIX
                </div>
                <span class="tag-pill" id="contextBadge">CONTEXT: INACTIVE</span>
            </div>
            <p style="font-size: 12px; color: var(--text-dim); margin-bottom: 14px;">
                Inject framework guidelines, API references, or exam rulebooks. The AI neural engine will strictly enforce these rules on every capture!
            </p>

            <!-- Holographic Dropzone -->
            <div class="cyber-dropzone" id="dropzone" onclick="document.getElementById('fileInput').click()">
                <input type="file" id="fileInput" accept=".pdf,.txt,.md,.doc,.docx" style="display:none;" onchange="handleFileSelect(event)">
                <div style="font-size: 28px; margin-bottom: 6px;">📄</div>
                <div style="font-size: 13px; font-weight: 800; color: var(--cyan); letter-spacing: 1px;">DROP RULEBOOK / PDF FILE (OR CLICK TO UPLOAD)</div>
                <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">Supports .pdf, .txt, .md // High-Speed Extraction</div>
            </div>

            <textarea class="cyber-textarea" id="contextTextArea" placeholder="// Enter custom rules, constraints, coding guidelines, or prompt extensions here..."></textarea>

            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="btn-cyber btn-cyber-green" onclick="saveContext(true)">💾 SAVE & ACTIVATE</button>
                    <button class="btn-cyber" onclick="toggleContext()">⏸️ PAUSE / RESUME</button>
                    <button class="btn-cyber btn-cyber-pink" onclick="clearContext()">🗑️ WIPE CONTEXT</button>
                </div>
                <span id="contextStats" style="font-size: 11.5px; color: var(--green); font-weight: 800;">0 WORDS LOADED</span>
            </div>
        </div>

        <!-- ⌨️ Card 4: Organic Human Typing Speed & Jitter Settings -->
        <div class="cyber-card" style="margin-bottom: 20px;">
            <div class="card-header-bar">
                <div class="card-title-tactical">
                    <span>⌨️</span> QUANTUM TYPING OVERCLOCK & JITTER ENGINE
                </div>
                <span class="tag-pill" id="activePresetTag">PRESET: NORMAL HUMAN</span>
            </div>

            <!-- Active Speed Telemetry Banner -->
            <div style="background: rgba(2, 6, 14, 0.95); border: 1px solid var(--cyan); padding: 14px 18px; margin-bottom: 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                <span style="font-size: 13px; color: var(--cyan); font-weight: 800; letter-spacing: 1px;">
                    ⚡ CURRENT INJECTION VELOCITY: <span id="currentSpeedDisplay" style="color: var(--green);">Normal Human (25ms - 55ms)</span>
                </span>
                <span id="speedEstimatedChars" style="font-size: 12px; color: #020408; background: var(--green); padding: 3px 10px; font-weight: 900; box-shadow: 0 0 10px var(--green);">~25-40 CHARS/SEC</span>
            </div>

            <!-- Precision Delay Sliders -->
            <div class="slider-matrix">
                <div>
                    <div class="slider-header">
                        <span>MINIMUM FLIGHT DELAY</span>
                        <span style="color: var(--green); font-weight: 900;"><span id="minVal">25</span> MS</span>
                    </div>
                    <input type="range" id="minRange" min="2" max="500" value="25" oninput="onSliderChange()">
                </div>
                <div>
                    <div class="slider-header">
                        <span>MAXIMUM FLIGHT DELAY</span>
                        <span style="color: var(--green); font-weight: 900;"><span id="maxVal">55</span> MS</span>
                    </div>
                    <input type="range" id="maxRange" min="5" max="900" value="55" oninput="onSliderChange()">
                </div>
            </div>

            <!-- Preset Buttons Matrix -->
            <div class="speed-grid" id="presetButtonGroup">
                <button class="speed-btn" id="btn-ultra" onclick="setSpeedPreset('ultra', 3, 8)">⚡ [01] ULTRA (3-8MS)</button>
                <button class="speed-btn" id="btn-fast" onclick="setSpeedPreset('fast', 12, 28)">🏃 [02] FAST (12-28MS)</button>
                <button class="speed-btn" id="btn-normal" onclick="setSpeedPreset('normal', 25, 55)">🚶 [03] NORMAL (25-55MS)</button>
                <button class="speed-btn" id="btn-relaxed" onclick="setSpeedPreset('relaxed', 60, 110)">🐢 [04] RELAXED (60-110MS)</button>
                <button class="speed-btn" id="btn-stealth" onclick="setSpeedPreset('stealth', 110, 180)">🦥 [05] STEALTH (110-180MS)</button>
                <button class="speed-btn" id="btn-ninja" onclick="setSpeedPreset('ninja', 180, 280)">🕵️ [06] NINJA (180-280MS)</button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <button class="btn-cyber btn-cyber-green" onclick="saveSpeedDefault()">💾 COMMIT AS DEFAULT BOOT VELOCITY</button>
                <span id="speedSaveMsg" style="font-size: 11.5px; color: var(--green); font-weight: 800;"></span>
            </div>
        </div>

        <!-- 🔑 Card 5: Multi-API Key Round-Robin Management -->
        <div class="cyber-card" style="margin-bottom: 20px;">
            <div class="card-header-bar">
                <div class="card-title-tactical">
                    <span>🔑</span> MULTI-API KEY ROUND-ROBIN VAULT
                </div>
                <span class="tag-pill tag-pill-green" id="activeKeysCount">0 ACTIVE KEYS</span>
            </div>

            <!-- Card Art Illustration -->
            <div class="card-art-banner" style="background-image: url('/cyber_keys.jpg'); height: 100px;"></div>

            <p style="font-size: 12px; color: var(--text-dim); margin-bottom: 14px;">
                Rotate unlimited Gemini API keys automatically to bypass rate limits and guarantee uninterrupted 24/7 vision intelligence.
            </p>
            <input type="text" class="cyber-input" id="apiKeysInput" placeholder="Paste Gemini API Keys (comma-separated): AIzaSy..., AQ.Ab8..." />
            
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="btn-cyber" onclick="saveApiKeys()">💾 SAVE & ROTATE KEYS</button>
                    <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer" class="btn-cyber btn-cyber-pink">
                        <span>✨ GET GEMINI API KEY</span>
                        <span style="font-size: 11px; opacity: 0.9;">↗</span>
                    </a>
                </div>
                <span id="keysMsg" style="font-size: 11.5px; color: var(--green); font-weight: 800;"></span>
            </div>

            <div id="keysList" style="margin-top: 16px; font-size: 11.5px; color: var(--cyan); line-height: 1.8;"></div>
        </div>

        <!-- ⚡ Card 6: Live AI Answers & Activity Stream -->
        <div class="cyber-card">
            <div class="card-header-bar">
                <div class="card-title-tactical">
                    <span>⚡</span> LIVE AI TELEMETRY & CAPTURE FEED
                </div>
                <span class="tag-pill" id="feedCount">0 CAPTURES</span>
            </div>
            <div class="feed-box" id="feedContainer">
                <p style="color: var(--text-dim); text-align: center; padding: 30px; font-size: 13px;">[NO TELEMETRY RECORDED] SNAP A PHOTO FROM YOUR MOBILE TO INITIATE STREAM.</p>
            </div>
        </div>
    </div>

    <script>
        function copyText(text, msg) {
            navigator.clipboard.writeText(text);
            alert(msg || 'Copied: ' + text);
        }

        async function stealthAction(action) {
            const msgEl = document.getElementById('stealthMsg');
            msgEl.innerText = '[PROCESSING SYSTEM HOOK...]';
            try {
                const res = await fetch('/stealth/' + action, { method: 'POST' });
                const d = await res.json();
                msgEl.style.color = 'var(--green)';
                msgEl.innerText = action === 'hide' ? '✅ HUD DISPLACED OFF-SCREEN (HIDDEN)' : '✅ HUD ANCHORED TO DESKTOP SCREEN';
            } catch (e) {
                msgEl.innerText = '❌ ACTION FAILED: ' + e.message;
            }
        }

        async function stopTypingEmergency() {
            const msgEl = document.getElementById('stealthMsg');
            try {
                const res = await fetch('/type/stop', { method: 'POST' });
                const d = await res.json();
                if (msgEl) {
                    msgEl.style.color = 'var(--pink)';
                    msgEl.innerText = '🛑 EMERGENCY OVERRIDE: ACTIVE INJECTION ABORTED!';
                    setTimeout(() => { msgEl.innerText = ''; }, 3500);
                }
            } catch (e) {
                if (msgEl) msgEl.innerText = 'OVERRIDE ERROR: ' + e.message;
            }
        }

        // Speed Engine Logic
        let currentPreset = 'normal';

        const PRESETS = {
            'ultra': { min: 3, max: 8, name: '⚡ [01] ULTRA (3-8MS)', cps: '~150+ CHARS/SEC' },
            'fast': { min: 12, max: 28, name: '🏃 [02] FAST (12-28MS)', cps: '~50-80 CHARS/SEC' },
            'normal': { min: 25, max: 55, name: '🚶 [03] NORMAL (25-55MS)', cps: '~25-40 CHARS/SEC' },
            'relaxed': { min: 60, max: 110, name: '🐢 [04] RELAXED (60-110MS)', cps: '~10-15 CHARS/SEC' },
            'stealth': { min: 110, max: 180, name: '🦥 [05] STEALTH (110-180MS)', cps: '~6-9 CHARS/SEC' },
            'ninja': { min: 180, max: 280, name: '🕵️ [06] NINJA (180-280MS)', cps: '~4-6 CHARS/SEC' }
        };

        function highlightPresetButton(presetKey, minMs, maxMs) {
            document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
            
            const btn = document.getElementById('btn-' + presetKey);
            if (btn) {
                btn.classList.add('active');
            }

            const tagEl = document.getElementById('activePresetTag');
            const displayEl = document.getElementById('currentSpeedDisplay');
            const cpsEl = document.getElementById('speedEstimatedChars');

            if (PRESETS[presetKey]) {
                tagEl.innerText = 'PRESET: ' + PRESETS[presetKey].name;
                displayEl.innerText = PRESETS[presetKey].name + ' (' + PRESETS[presetKey].min + 'ms - ' + PRESETS[presetKey].max + 'ms)';
                cpsEl.innerText = PRESETS[presetKey].cps;
            } else {
                tagEl.innerText = 'PRESET: CUSTOM MATRIX';
                displayEl.innerText = 'CUSTOM MATRIX (' + minMs + 'ms - ' + maxMs + 'ms)';
                const avg = (minMs + maxMs) / 2;
                const est = (1000 / Math.max(5, avg)).toFixed(1);
                cpsEl.innerText = '~' + est + ' CHARS/SEC';
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
            msgEl.innerText = '[COMMITTING TO HARD DISK...]';
            try {
                await fetch('/settings/speed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ min_delay_ms: min, max_delay_ms: max, preset_name: currentPreset, save: true })
                });
                msgEl.innerText = '✅ DEFAULT VELOCITY COMMITTED PERMANENTLY!';
                setTimeout(() => { msgEl.innerText = ''; }, 4000);
            } catch (e) {
                msgEl.innerText = 'FAILED: ' + e.message;
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
                badge.innerText = '✅ ACTIVE: ' + (d.filename || 'CUSTOM RULES');
                badge.className = 'tag-pill tag-pill-green';
                stats.innerText = d.word_count + ' WORDS (~' + Math.round(d.word_count * 1.3) + ' TOKENS) ACTIVE';
                stats.style.color = 'var(--green)';
            } else if (d.word_count > 0) {
                badge.innerText = '⏸️ PAUSED: ' + (d.filename || 'CUSTOM RULES');
                badge.className = 'tag-pill tag-pill-pink';
                stats.innerText = d.word_count + ' WORDS (STANDBY)';
                stats.style.color = 'var(--amber)';
            } else {
                badge.innerText = 'CONTEXT: EMPTY';
                badge.className = 'tag-pill';
                stats.innerText = '0 WORDS LOADED';
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
                alert(enable ? 'Context rules committed & activated!' : 'Rules saved!');
            } catch (e) {
                alert('Failed: ' + e.message);
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
            if (!confirm('Wipe complete rulebook context matrix?')) return;
            try {
                const res = await fetch('/api/context/clear', { method: 'POST' });
                const d = await res.json();
                document.getElementById('contextTextArea').value = '';
                updateContextUI(d.context);
                alert('Context matrix cleared!');
            } catch (e) {
                alert('Clear error: ' + e.message);
            }
        }

        async function handleFileSelect(e) {
            const file = e.target.files[0];
            if (!file) return;
            uploadContextFile(file);
        }

        async function uploadContextFile(file) {
            const dropEl = document.getElementById('dropzone');
            dropEl.innerText = '⏳ SCANNING & EXTRACTING ' + file.name + '...';
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
                    alert('EXTRACTED ' + d.context.word_count + ' WORDS FROM ' + file.name + '!');
                } else {
                    alert('Upload failed: ' + (d.error || 'Unknown error'));
                }
            } catch (e) {
                alert('Upload error: ' + e.message);
            } finally {
                dropEl.innerHTML = \`
                    <div style="font-size: 28px; margin-bottom: 6px;">📄</div>
                    <div style="font-size: 13px; font-weight: 800; color: var(--cyan); letter-spacing: 1px;">DROP RULEBOOK / PDF FILE (OR CLICK TO UPLOAD)</div>
                    <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">Supports .pdf, .txt, .md // High-Speed Extraction</div>
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
            msgEl.innerText = '🎯 CLICK TARGET EDITOR IN 2 SECONDS...';
            setTimeout(async () => {
                await fetch('/type', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        text: '// [LOGICGHOST] Cyberpunk Neural Injection Verified Successfully!\\n',
                        min_delay_ms: min,
                        max_delay_ms: max
                    })
                });
                msgEl.innerText = '✅ INJECTION COMPLETED!';
            }, 2000);
        }

        async function loadApiKeys() {
            try {
                const res = await fetch('/api/keys');
                const data = await res.json();
                document.getElementById('activeKeysCount').innerText = data.total + ' ACTIVE KEYS';
                
                const listEl = document.getElementById('keysList');
                if (data.keys && data.keys.length > 0) {
                    listEl.innerHTML = '<b style="color: #ffffff;">VAULT ROTATION QUEUE:</b> ' + data.keys.map(k => \`<span style="background: rgba(0,240,255,0.12); border: 1px solid var(--cyan); padding: 4px 10px; margin-right: 6px; display: inline-block; margin-bottom: 6px; font-weight:700;">KEY #\${k.index}: <span style="color:#ffffff;">\${k.masked}</span></span>\`).join(' ➔ ');
                } else {
                    listEl.innerHTML = '<span style="color: var(--amber);">[VAULT EMPTY] Paste API keys above to enable neural vision stream.</span>';
                }
            } catch (e) {}
        }

        async function saveApiKeys() {
            const val = document.getElementById('apiKeysInput').value.trim();
            if (!val) {
                alert('Enter at least one Gemini API Key!');
                return;
            }
            const msgEl = document.getElementById('keysMsg');
            msgEl.innerText = '[ENCRYPTING & SAVING KEYS...]';
            try {
                const res = await fetch('/api/keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keys: val })
                });
                const d = await res.json();
                msgEl.innerText = '✅ ' + d.total + ' KEYS LOADED INTO VAULT!';
                document.getElementById('apiKeysInput').value = '';
                loadApiKeys();
            } catch (e) {
                msgEl.innerText = 'ERROR: ' + e.message;
            }
        }

        async function triggerTypePayload(text) {
            if (!text) return;
            const min = parseInt(document.getElementById('minRange').value);
            const max = parseInt(document.getElementById('maxRange').value);
            const msgEl = document.getElementById('stealthMsg');
            if (msgEl) msgEl.innerText = '🎯 CLICK TARGET WINDOW IN 2s TO INJECT SLOT...';
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
                    if (msgEl) msgEl.innerText = '✅ SLOT INJECTED SUCCESSFULLY!';
                } catch (e) {}
            }, 2000);
        }

        async function updateFeed() {
            try {
                const res = await fetch('/feed');
                const items = await res.json();
                const container = document.getElementById('feedContainer');
                document.getElementById('feedCount').innerText = items.length + ' CAPTURES';

                if (items.length === 0) return;

                container.innerHTML = items.map(item => {
                    let slotHtml = '';
                    if (item.is_multi_slot && item.slots) {
                        if (item.slots.rating) {
                            slotHtml += \`
                                <div style="background: rgba(255, 0, 85, 0.08); border: 1px solid var(--pink); padding: 10px 14px; margin-bottom: 10px;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                        <span style="font-weight:800; color:var(--pink); font-size:11.5px;">⭐ [SLOT 01] RATING // VERDICT:</span>
                                        <button class="btn-cyber btn-cyber-pink" style="padding:3px 10px; font-size:10px;" onclick="triggerTypePayload('\${escapeHtml(item.slots.rating)}')">⚡ TYPE RATING</button>
                                    </div>
                                    <div style="font-size:13px; color:#ffffff; font-weight:700;">\${escapeHtml(item.slots.rating)}</div>
                                </div>\`;
                        }
                        if (item.slots.code) {
                            slotHtml += \`
                                <div style="background: #010204; border: 1px solid var(--cyan); padding: 10px 14px; margin-bottom: 10px;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                        <span style="font-weight:800; color:var(--cyan); font-size:11.5px;">💻 [SLOT 02] CODE PAYLOAD:</span>
                                        <button class="btn-cyber" style="padding:3px 10px; font-size:10px;" onclick="triggerTypePayload('\${escapeHtml(item.slots.code)}')">⚡ INJECT CODE</button>
                                    </div>
                                    <div class="feed-code-block" style="max-height:160px;">\${escapeHtml(item.slots.code)}</div>
                                </div>\`;
                        }
                        if (item.slots.explanation) {
                            slotHtml += \`
                                <div style="background: rgba(0, 255, 136, 0.06); border: 1px solid var(--green); padding: 10px 14px; margin-bottom: 10px;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                        <span style="font-weight:800; color:var(--green); font-size:11.5px;">📝 [SLOT 03] EXPLANATION // RATIONALE:</span>
                                        <button class="btn-cyber btn-cyber-green" style="padding:3px 10px; font-size:10px;" onclick="triggerTypePayload('\${escapeHtml(item.slots.explanation)}')">📝 TYPE REASON</button>
                                    </div>
                                    <div style="font-size:12.5px; color:#e6faff; white-space:pre-wrap; max-height:160px; overflow-y:auto; line-height:1.6;">\${escapeHtml(item.slots.explanation)}</div>
                                </div>\`;
                        }
                        if (item.slots.audit) {
                            slotHtml += \`
                                <div style="background: rgba(255, 184, 0, 0.08); border: 1px solid var(--amber); padding: 10px 14px;">
                                    <span style="font-weight:800; color:var(--amber); font-size:11.5px;">🛡️ [SLOT 04] SECURITY & AUDIT:</span>
                                    <div style="font-size:12px; color:#fde68a; margin-top:3px;">\${escapeHtml(item.slots.audit)}</div>
                                </div>\`;
                        }
                    } else {
                        slotHtml = \`<div class="feed-code-block">\${escapeHtml(item.payload)}</div>\`;
                    }

                    return \`
                        <div class="feed-tactical-item">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; font-size:11px;">
                                <div>
                                    <span class="tag-pill">\${item.tag}</span>
                                    \${item.is_multi_slot ? '<span class="tag-pill tag-pill-pink" style="margin-left:6px;">✨ MULTI-SLOT RLHF</span>' : ''}
                                    \${item.rules_active ? '<span class="tag-pill tag-pill-green" style="margin-left:6px;">📚 PDF ENFORCED</span>' : ''}
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

        // 🎯 Cyberpunk Tactical Crosshair Cursor Tracker
        const cursorDot = document.createElement('div');
        cursorDot.className = 'cyber-cursor-dot';
        document.body.appendChild(cursorDot);

        const cursorRing = document.createElement('div');
        cursorRing.className = 'cyber-cursor-ring';
        document.body.appendChild(cursorRing);

        let mouseX = -100;
        let mouseY = -100;
        let ringX = -100;
        let ringY = -100;

        window.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
            cursorDot.style.left = mouseX + 'px';
            cursorDot.style.top = mouseY + 'px';
            if (ringX === -100) {
                ringX = mouseX;
                ringY = mouseY;
            }
        });

        // Smooth Lerp tracking for HUD reticle ring
        function animateCursor() {
            if (mouseX !== -100) {
                ringX += (mouseX - ringX) * 0.25;
                ringY += (mouseY - ringY) * 0.25;
                cursorRing.style.left = ringX + 'px';
                cursorRing.style.top = ringY + 'px';
            }
            requestAnimationFrame(animateCursor);
        }
        requestAnimationFrame(animateCursor);

        // Hover detection on interactable components
        function attachCursorHover() {
            const interactables = document.querySelectorAll('button, a, input, textarea, select, .cyber-dropzone, .speed-btn, .btn-cyber, .cyber-url-box');
            interactables.forEach(el => {
                el.addEventListener('mouseenter', () => {
                    cursorRing.classList.add('cursor-hover');
                    cursorDot.classList.add('cursor-hover');
                });
                el.addEventListener('mouseleave', () => {
                    cursorRing.classList.remove('cursor-hover');
                    cursorDot.classList.remove('cursor-hover');
                });
            });
        }

        // Click Laser Shockwave
        window.addEventListener('mousedown', (e) => {
            const wave = document.createElement('div');
            wave.className = 'cursor-click-wave';
            wave.style.left = e.clientX + 'px';
            wave.style.top = e.clientY + 'px';
            document.body.appendChild(wave);
            setTimeout(() => wave.remove(), 400);
        });

        setInterval(updateFeed, 2000);
        updateFeed().then(() => attachCursorHover());
        loadApiKeys().then(() => attachCursorHover());
        loadSpeed().then(() => attachCursorHover());
        loadContext().then(() => attachCursorHover());
        setTimeout(attachCursorHover, 500);
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
