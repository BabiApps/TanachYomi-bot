import express from 'express';
import WhatsAppClient from '../baileys.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { startTunnel } from './tunnel.js';

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

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

export async function startServer({ port = process.env.PORT || 3000 } = {}) {
    const server = app.listen(Number(port));

    await new Promise((resolve, reject) => {
        server.on('listening', () => resolve(null));
        server.on('error', (err) => reject(err));
    });

    let url = `http://localhost:${port}`;
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
            try { await tunnelObj.stop(); } catch (e) {}
        } else if (tunnelObj && tunnelObj.process && typeof tunnelObj.process.kill === 'function') {
            try { tunnelObj.process.kill(); } catch (e) {}
        }
        try { server.close(); } catch (e) {}
    };

    return { url, stop, server, tunnel: tunnelObj };
}