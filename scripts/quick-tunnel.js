#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const targetUrl = process.env.QUICK_TUNNEL_TARGET || 'http://127.0.0.1:5000';
const cloudflaredBin = process.env.CLOUDFLARED_BIN || 'cloudflared';
const urlFile = process.env.QUICK_TUNNEL_URL_FILE || path.join(__dirname, '..', 'runtime', 'quick-tunnel-url.txt');
const urlJsonFile = process.env.QUICK_TUNNEL_URL_JSON_FILE || path.join(__dirname, '..', 'runtime', 'quick-tunnel-url.json');
const quickTunnelProtocol = (process.env.QUICK_TUNNEL_PROTOCOL || 'http2').toLowerCase();

let lastUrl = '';
let shuttingDown = false;

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function persistUrl(url) {
    if (!url || url === lastUrl) {
        return;
    }

    lastUrl = url;
    ensureDir(urlFile);
    ensureDir(urlJsonFile);

    fs.writeFileSync(urlFile, `${url}\n`, 'utf8');
    fs.writeFileSync(
        urlJsonFile,
        `${JSON.stringify({ url, updatedAt: new Date().toISOString() }, null, 2)}\n`,
        'utf8'
    );

    console.log(`[quick-tunnel] URL detectada: ${url}`);
}

function inspectLine(line) {
    if (!line) {
        return;
    }

    const match = line.match(/https:\/\/[-a-zA-Z0-9]+\.trycloudflare\.com/);
    if (match && match[0]) {
        persistUrl(match[0]);
    }

    console.log(`[cloudflared] ${line}`);
}

function bindStream(stream) {
    let buffer = '';

    stream.on('data', (chunk) => {
        buffer += chunk.toString();

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        lines.forEach(inspectLine);
    });

    stream.on('end', () => {
        if (buffer.trim()) {
            inspectLine(buffer.trim());
        }
    });
}

const args = [
    'tunnel',
    '--url', targetUrl,
    '--no-autoupdate',
    '--protocol', quickTunnelProtocol,
    '--metrics', '127.0.0.1:0'
];

console.log(`[quick-tunnel] Iniciando cloudflared hacia ${targetUrl}`);

const proc = spawn(cloudflaredBin, args, {
    stdio: ['ignore', 'pipe', 'pipe']
});

bindStream(proc.stdout);
bindStream(proc.stderr);

proc.on('error', (err) => {
    console.error('[quick-tunnel] Error al iniciar cloudflared:', err.message || err);
    process.exitCode = 1;
});

proc.on('exit', (code, signal) => {
    if (shuttingDown) {
        return;
    }

    console.error(`[quick-tunnel] cloudflared termino (code=${code}, signal=${signal || 'none'})`);
    process.exit(code || 1);
});

function shutdown(signal) {
    shuttingDown = true;
    console.log(`[quick-tunnel] Cerrando por señal ${signal}`);
    proc.kill('SIGTERM');

    setTimeout(() => {
        try {
            proc.kill('SIGKILL');
        } catch (_) {
            // no-op
        }
        process.exit(0);
    }, 8000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
