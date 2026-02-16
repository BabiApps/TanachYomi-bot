import express from 'express';
import WhatsAppClient from '../baileys.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { startTunnel } from './tunnel.js';
import { config } from '../config.js';

const app = express();

app.get("/status", (req, res) => {
    const whatsapp = WhatsAppClient.getInstance()
    res.json({
        connected: whatsapp.getConnectionStatus(),
        qr: whatsapp.getQR() || null
    });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve index.html path so it works both in source and when running from dist
function resolveConnectIndex() {
    const candidates = [
        path.join(__dirname, 'index.html'), // compiled location (dist/connect/index.html)
        path.join(process.cwd(), 'connect', 'index.html'), // project-root/connect/index.html
        path.join(config.paths.root, 'connect', 'index.html')
    ];
    for (const p of candidates) {
        try { if (fs.existsSync(p)) return p; } catch (e) { }
    }
    return null;
}

app.get("/", (req, res) => {
    const indexPath = resolveConnectIndex();
    if (indexPath) return res.sendFile(indexPath);
    res.status(404).send('Not Found');
});

export async function startServer() {
    const server = app.listen(Number(config.port));

    await new Promise((resolve, reject) => {
        server.on('listening', () => resolve(null));
        server.on('error', (err) => reject(err));
    });

    let url = `http://localhost:${config.port}`;
    let tunnelObj = null;

    try {
        tunnelObj = await startTunnel();
        if (tunnelObj && tunnelObj.url) url = tunnelObj.url;
        console.info(`Tunnel started at ${url}`);
    } catch (err) {
        console.warn('Error starting tunnel:', err?.message || err);
    }

    const stop = async () => {
        if (tunnelObj && typeof tunnelObj.stop === 'function') {
            try { await tunnelObj.stop(); } catch (e) { }
        } else if (tunnelObj && tunnelObj.process && typeof tunnelObj.process.kill === 'function') {
            try { tunnelObj.process.kill(); } catch (e) { }
        }
        try { server.close(); } catch (e) { }
    };

    return { url, stop, server, tunnel: tunnelObj };
}