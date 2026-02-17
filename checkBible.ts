// הרצה: node --loader ts-node/esm .\checkBible.ts

import * as fs from 'fs';
import path from 'path';
import scdl from 'soundcloud-downloader';
import type { TanachYomiEpisode } from './TanachYomiProcess.js';
import { config } from './config.js';
import { SCDL } from 'soundcloud-downloader/src/index.js';

const scdlApi = scdl.default || scdl;

function extractAlfaOnly(title: string, sefer: string): string {
    let withoutSefer = title;
    
    // 1. פיצול לפי שם הספר
    if (title.includes(sefer)) {
        withoutSefer = title.split(sefer)[1] || "";
    } else {
        const baseSeferMatch = sefer.match(/(.+?)\s+[אב]$/);
        const base = baseSeferMatch ? baseSeferMatch[1] : sefer;
        if (base === "תהילים" && title.includes("תהלים")) {
            withoutSefer = title.split("תהלים")[1] || "";
        } else if (title.includes(base)) {
            withoutSefer = title.split(base)[1] || "";
        }
    }

    // 2. פיצול לפי פרק/מזמור (אם לא קיים, ניקח את מה שנשאר כמו בישעיהו)
    let afterPerek = withoutSefer;
    const perekRegex = /(?:פרקים|פרק|מזמורים|מזמורי|מזמור)/;
    const perekSplit = withoutSefer.split(perekRegex);
    if (perekSplit.length > 1) {
        afterPerek = perekSplit[1];
    }

    // 3. עצירה לפני פסוקים/אותיות כדי לא לקחת נתונים מיותרים
    const stopWordsRegex = /(?:פסוקים|פסוק|פס|חלק|אותיות|אות|-|\+|\sו)/;
    const beforeStopWords = afterPerek.split(stopWordsRegex)[0];

    // 4. ניקוי מוחלט - השארת אותיות עבריות בלבד
    return beforeStopWords.replace(/[^א-ת]/g, '');
}

function cleanUrl(url: string): string {
    return url.split('?')[0];
}

const CONCURRENCY_LIMIT = 5;

async function checkAllEpisodes() {
    const jsonPath = path.resolve(config.paths.backupBible);
    const db = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    const order: string[] = db.order;
    let successCount = 0;
    let failCount = 0;
    let mismatchCount = 0;

    console.log("=== מתחיל סריקה לפי חיתוך אותיות ===");

    const tasks: (() => Promise<void>)[] = [];

    for (const sefer of order) {
        const chaptersInfo = db[sefer];
        if (!chaptersInfo) continue;

        const chapterKeys = Object.keys(chaptersInfo).sort((a, b) => parseInt(a) - parseInt(b));

        for (const key of chapterKeys) {
            const epData = chaptersInfo[key];

            tasks.push(async () => {
                const episode: TanachYomiEpisode = {
                    name: epData.name,
                    chapter: epData.chapter,
                    soundcloud: epData.soundcloud,
                    spotify: epData.spotify,
                    path: epData.path
                };

                if (!episode.soundcloud) return;

                try {
                    const cleanSoundcloudUrl = cleanUrl(episode.soundcloud);
                    const trackInfo = await (scdlApi as SCDL).getInfo(cleanSoundcloudUrl);
                    const soundCloudTitle = trackInfo.title || "";

                    // חילוץ האותיות נטו מתוך השם ב-JSON
                    const expectedAlfa = extractAlfaOnly(episode.name, sefer);
                    
                    // חילוץ האותיות נטו מתוך הכותרת ב-SoundCloud
                    const actualAlfa = extractAlfaOnly(soundCloudTitle, sefer);

                    // בדיקה אם הקישור תואם באמת
                    if (expectedAlfa !== actualAlfa) {
                        console.warn(`\n⚠️ חוסר התאמה אותר!`);
                        console.warn(`[JSON] מצפה למצוא: "${episode.name}"`);
                        console.warn(`[SoundCloud] השם בפועל: "${soundCloudTitle}"`);
                        console.warn(`(חולץ מה-JSON: "${expectedAlfa}" | חולץ מסאונדקלאוד: "${actualAlfa}")`);
                        mismatchCount++;
                    }

                    successCount++;

                } catch (error) {
                    failCount++;
                }
            });
        }
    }

    console.log(`\n⏳ מעבד משימות...`);

    const executing: Promise<void>[] = [];
    for (const task of tasks) {
        const p = task().finally(() => {
            executing.splice(executing.indexOf(p), 1);
        });
        executing.push(p);

        if (executing.length >= CONCURRENCY_LIMIT) {
            await Promise.race(executing);
        }
    }
    await Promise.all(executing);

    console.log(`\n============================`);
    console.log(`✅ נבדקו: ${successCount}`);
    console.log(`⚠️ חוסר התאמה (שגיאות בפועל): ${mismatchCount}`);
    console.log(`============================`);
}

checkAllEpisodes().catch(console.error);