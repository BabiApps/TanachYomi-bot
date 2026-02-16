// node --loader ts-node/esm .\downloadALL.ts

import * as fs from 'fs';
import path from 'path';
import Downloader from './downloader.js';
import type { TanachYomiEpisode } from './TanachYomiProcess.js';
import { config } from './config.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function downloadAllEpisodes() {
    const jsonPath = path.resolve(config.paths.bible);
    const db = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    const order: string[] = db.order;
    let successCount = 0;
    let failCount = 0;

    console.log("=== מתחיל תהליך הורדת כל פרקי התנך ===");

    for (const sefer of order) {
        console.log(`\n--- מתחיל סריקה לספר: ${sefer} ---`);
        const chaptersInfo = db[sefer];

        if (!chaptersInfo) {
            console.log(`לא נמצאו פרקים עבור ${sefer}`);
            continue;
        }

        const chapterKeys = Object.keys(chaptersInfo).sort((a, b) => parseInt(a) - parseInt(b));

        for (const key of chapterKeys) {
            const epData = chaptersInfo[key];

            const episode: TanachYomiEpisode = {
                name: epData.name,
                chapter: epData.chapter,
                soundcloud: epData.soundcloud,
                spotify: epData.spotify,
                path: epData.path
            };

            try {
                if (!episode.soundcloud) {
                    console.log(`[דילוג] לפרק ${episode.name} אין קישור SoundCloud.`);
                    continue;
                }

                console.log(`מוריד: ${episode.name}...`);

                const savedPath = await Downloader.download(episode);

                epData.path = savedPath;
                successCount++;

                await sleep(1000);

            } catch (error) {
                console.error(`❌ שגיאה בהורדת ${episode.name}:`, (error as Error).message);
                failCount++;
            }
        }
    }

    fs.writeFileSync(jsonPath, JSON.stringify(db, null, 2), 'utf8');

    console.log(`\n=== סיום התהליך ===`);
    console.log(`✅ הורדות מוצלחות (או שכבר היו קיימות): ${successCount}`);
    console.log(`❌ נכשלו: ${failCount}`);
}

downloadAllEpisodes().catch(console.error);