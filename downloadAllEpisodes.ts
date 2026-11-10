import * as fs from 'fs';
import path from 'path';
import { config } from './config.js';
import Downloader, { type DownloadableEpisode } from './downloader.js';

type JsonRecord = Record<string, unknown>;
type BibleData = JsonRecord & { order: string[] };

type DownloadJob = {
    sefer: string;
    chapterKey: string;
    episode: DownloadableEpisode;
    episodeData: JsonRecord;
};

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 3;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadBible(filePath: string): BibleData {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isRecord(parsed) || !Array.isArray(parsed.order) || !parsed.order.every(item => typeof item === 'string')) {
        throw new Error(`Invalid Bible JSON structure in ${filePath}: expected an "order" array.`);
    }

    return parsed as BibleData;
}

function getConcurrency(): number {
    const argument = process.argv.find(value => value.startsWith('--concurrency='));
    if (!argument) return DEFAULT_CONCURRENCY;

    const concurrency = Number(argument.slice('--concurrency='.length));
    if (!Number.isInteger(concurrency) || concurrency < 2 || concurrency > MAX_CONCURRENCY) {
        throw new Error('Concurrency must be either 2 or 3 (example: --concurrency=2).');
    }
    return concurrency;
}

function collectJobs(bible: BibleData): { jobs: DownloadJob[]; skipped: number } {
    const jobs: DownloadJob[] = [];
    let skipped = 0;

    for (const sefer of bible.order) {
        const episodes = bible[sefer];
        if (!isRecord(episodes)) {
            throw new Error(`Invalid or missing chapter list for sefer "${sefer}".`);
        }

        const chapterKeys = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
        for (const chapterKey of chapterKeys) {
            const episodeData = episodes[chapterKey];
            if (!isRecord(episodeData) || typeof episodeData.name !== 'string' || typeof episodeData.chapter !== 'string') {
                throw new Error(`Invalid episode data for ${sefer}, chapter ${chapterKey}.`);
            }

            if (typeof episodeData.soundcloud !== 'string' || !episodeData.soundcloud.trim()) {
                console.warn(`[Skip] ${episodeData.name}: no SoundCloud URL.`);
                skipped++;
                continue;
            }

            const episode: DownloadableEpisode = {
                name: episodeData.name,
                chapter: episodeData.chapter,
                soundcloud: episodeData.soundcloud,
                ...(typeof episodeData.path === 'string' ? { path: episodeData.path } : {})
            };
            jobs.push({ sefer, chapterKey, episode, episodeData });
        }
    }

    return { jobs, skipped };
}

function saveBibleAtomically(filePath: string, bible: BibleData): void {
    const tempPath = `${filePath}.tmp-${process.pid}`;
    try {
        fs.writeFileSync(tempPath, JSON.stringify(bible, null, 2), 'utf8');
        fs.renameSync(tempPath, filePath);
    } catch (error) {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        throw error;
    }
}

async function downloadAllEpisodes(): Promise<void> {
    const biblePath = path.resolve(config.paths.bible);
    const bible = loadBible(biblePath);
    const { jobs, skipped: missingUrlCount } = collectJobs(bible);
    const concurrency = getConcurrency();

    let nextJob = 0;
    let downloadedCount = 0;
    let alreadyDownloadedCount = 0;
    let failedCount = 0;

    console.log(`Starting download of ${jobs.length} episodes with concurrency ${concurrency}.`);

    async function worker(): Promise<void> {
        while (nextJob < jobs.length) {
            const job = jobs[nextJob++];

            if (
                job.episode.path &&
                path.extname(job.episode.path).toLowerCase() === '.mp3' &&
                fs.existsSync(job.episode.path)
            ) {
                console.log(`[Skip] ${job.episode.name}: already exists.`);
                alreadyDownloadedCount++;
                continue;
            }

            try {
                const filePath = await Downloader.download(job.episode, { updateBible: false });
                job.episodeData.path = filePath;
                saveBibleAtomically(biblePath, bible);
                downloadedCount++;
                console.log(`[Done] ${job.sefer} ${job.chapterKey}: ${filePath}`);
            } catch (error) {
                failedCount++;
                console.error(`[Failed] ${job.sefer} ${job.chapterKey} (${job.episode.name}):`, error);
            }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    console.log(
        `Finished. Downloaded/updated: ${downloadedCount}; already present: ${alreadyDownloadedCount}; ` +
        `missing URL: ${missingUrlCount}; failed: ${failedCount}.`
    );

    if (failedCount > 0) process.exitCode = 1;
}

downloadAllEpisodes().catch(error => {
    console.error('Bulk download failed:', error);
    process.exitCode = 1;
});
