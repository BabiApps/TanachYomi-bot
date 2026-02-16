import { spawn } from "child_process";
import os from "os";
import { config } from '../config.js';

/**
 * Starts a Cloudflare tunnel and returns an object with the public URL and a stop function
 * @returns {Promise<{url: string, stop: function, process: ChildProcess}>}
 */
export function startTunnel() {
    return new Promise((resolve, reject) => {
        try {
            let cloudflaredCmd = "cloudflared";

            if (os.platform() === "win32") {
                cloudflaredCmd = "C:\\CloudFlare\\cloudflared-windows-amd64.exe";
            }

            const args = ["tunnel", "--url", `http://localhost:${config.port}`, "--protocol", "http2"];
            const processTunnel = spawn(cloudflaredCmd, args, { stdio: ["ignore", "pipe", "pipe"] });

            let resolved = false;

            const onUrl = (text) => {
                const match = text.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (match && !resolved) {
                    resolved = true;
                    const url = match[0];
                    const stop = async () => {
                        try {
                            processTunnel.kill();
                        } catch (e) {}
                    };
                    resolve({ url, stop, process: processTunnel });
                }
            };

            processTunnel.stdout.on("data", onUrl);
            processTunnel.stderr.on("data", onUrl);

            processTunnel.on("close", (code) => {
                if (!resolved) {
                    reject(new Error(`Tunnel exited with code ${code}`));
                }
            });

            processTunnel.on("error", (err) => {
                if (!resolved) {
                    hint();
                    reject(err);
                }
            });

        } catch (err) {
            reject(err);
        }
    });
}

function hint() {
    console.log("Hint: Make sure cloudflared is installed and accessible.");
    console.log("https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
}
