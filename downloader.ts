import { Client } from 'soundcloud-scraper';
import * as fs from 'fs';
import path from 'path';
import type { TanachYomiEpisode } from './TanachYomiProcess.js';
import TanachYomiProcess from './TanachYomiProcess.js';
import Tools from './tools.js';
import NodeID3 from 'node-id3';
import { config } from './config.js';
import logger from './logger.js';

const basePath: string = path.resolve(config.paths.files || './files');
if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

class Downloader {

    /**
     * downloads the episode from SoundCloud and saves it to local file system
     * @param episode 
     * @returns path to file
    */
    static async download(episode: TanachYomiEpisode): Promise<string> {
        // if episode already has a valid path, return it
        if (episode.path && fs.existsSync(episode.path)) {
            logger.info(`[Downloader] Episode "${episode.name}" already downloaded at ${episode.path}`);
            return episode.path;
        }

        const client: Client = new Client();

        // Extract sefer from episode name more safely
        // Format is usually "ספר_פרק #" e.g. "בראשית פרק 1"
        const nameParts = episode.name?.split(' ') || [];
        const sefer = nameParts.slice(0, -2).join(' ') || episode.name?.replace(/\d+$/, '').trim() || 'unknown';
        const seferDir = path.join(basePath, sefer);
        const filePath = path.join(seferDir, `${episode.name}.mp3`);

        // create directory if not exists
        if (!fs.existsSync(seferDir)) {
            fs.mkdirSync(seferDir, { recursive: true });
        }

        // check if file exists
        if (fs.existsSync(filePath)) {
            TanachYomiProcess.getInstance().updateEpisodePath(episode, filePath);
            return filePath;
        }

        // download from soundcloud
        logger.info(`[Downloader] Downloading episode "${episode.name}" from SoundCloud...`);
        
        const info = await client.getSongInfo(Tools.cleanUrlParameters(episode.soundcloud), { fetchStreamURL: true });
        const streamURL = info.streamURL;

        const response = await fetch(streamURL);
        const fileStream = fs.createWriteStream(filePath);

        await new Promise<void>(async (resolve, reject) => {
            const body = response.body;
            if (!body) {
                return reject(new Error('No response body'));
            }

            try {
                const reader = (body as any).getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        fileStream.write(Buffer.from(value as Uint8Array));
                    }
                    fileStream.end();
                } finally {
                    // release the reader's lock if supported
                    if (typeof reader.releaseLock === 'function') {
                        try { reader.releaseLock(); } catch { /* ignore */ }
                    }
                }

                fileStream.on("finish", () => {
                    NodeID3.write({
                        title: episode.name,
                        artist: "הרב מוטי פרנקו (ישיבת הגולן)"
                    }, filePath);

                    resolve();
                });
                fileStream.on("error", (err) => {
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });

        logger.info(`[Downloader] Finished downloading episode "${episode.name}" to ${filePath}`);
        TanachYomiProcess.getInstance().updateEpisodePath(episode, filePath);
        return filePath;
    }
}
export default Downloader;
export { Downloader };