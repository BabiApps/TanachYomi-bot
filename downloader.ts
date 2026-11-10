import scdl from 'soundcloud-downloader';
import * as fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import type { TanachYomiEpisode } from './TanachYomiProcess.js';
import TanachYomiProcess from './TanachYomiProcess.js';
import Tools from './tools.js';
import NodeID3 from 'node-id3';
import ffmpegPath from 'ffmpeg-static';
import { config } from './config.js';
import logger from './logger.js';

export type DownloadableEpisode = Pick<TanachYomiEpisode, 'name' | 'chapter' | 'soundcloud'> & {
    path?: string;
};

const DOWNLOAD_FORMATS = [
    { format: scdl.default.FORMATS.MP3, extension: 'mp3', label: 'MP3' },
    { format: 'audio/mp4; codecs="mp4a.40.2"', extension: 'm4a', label: 'MP4/AAC' }
] as const;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const downloadSoundCloudFormat = scdl.default.downloadFormat.bind(scdl.default) as (
    url: string,
    format: string
) => Promise<NodeJS.ReadableStream>;

const basePath: string = path.resolve(config.paths.files || './files');
if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getErrorDetails(error: unknown): string {
    if (error instanceof AggregateError) {
        const nestedErrors = Array.from(error.errors, getErrorDetails);
        return nestedErrors.length > 0
            ? `${error.message}: ${nestedErrors.join('; ')}`
            : error.message;
    }

    return getErrorMessage(error);
}

function isFormatUnavailable(error: unknown): boolean {
    return getErrorMessage(error).includes('Could not find media with specified format');
}

function isRetryable(error: unknown): boolean {
    const message = getErrorMessage(error);
    if (/Status code:\s*(408|429|5\d{2})/.test(message)) return true;

    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = String(error.code);
        return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ERR_NETWORK'].includes(code);
    }

    return false;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function saveStream(stream: NodeJS.ReadableStream, filePath: string): Promise<void> {
    await pipeline(stream, fs.createWriteStream(filePath));
}

async function convertToMp3(inputPath: string, outputPath: string): Promise<void> {
    const executablePath = typeof ffmpegPath === 'string' ? ffmpegPath : null;
    if (!executablePath) {
        throw new Error('FFmpeg is unavailable on this platform; cannot convert the audio to MP3.');
    }

    await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn(executablePath, [
            '-nostdin',
            '-y',
            '-i', inputPath,
            '-vn',
            '-codec:a', 'libmp3lame',
            '-q:a', '2',
            '-loglevel', 'error',
            '-f', 'mp3',
            outputPath
        ], { windowsHide: true });
        let stderr = '';

        ffmpeg.stderr?.setEncoding('utf8');
        ffmpeg.stderr?.on('data', chunk => { stderr += chunk; });
        ffmpeg.once('error', error => reject(new Error(`Failed to start FFmpeg: ${error.message}`)));
        ffmpeg.once('close', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`FFmpeg exited with code ${code}: ${stderr.trim() || 'no diagnostic output'}`));
            }
        });
    });
}

class Downloader {

    /**
     * downloads the episode from SoundCloud and saves it to local file system
     * @param episode 
     * @returns path to file
    */
    static async download(episode: DownloadableEpisode, options: { updateBible?: boolean } = {}): Promise<string> {
        const updateBiblePath = (filePath: string) => {
            if (options.updateBible !== false) {
                TanachYomiProcess.getInstance().updateEpisodePath(episode, filePath);
            }
        };

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

        // Prefer an existing canonical MP3 file.
        if (episode.path && path.extname(episode.path).toLowerCase() === '.mp3' && fs.existsSync(episode.path)) {
            logger.info(`[Downloader] Using local MP3 for "${episode.name}".`);
            return episode.path;
        }

        if (fs.existsSync(filePath)) {
            logger.info(`[Downloader] Using local MP3 for "${episode.name}".`);
            try {
                updateBiblePath(filePath);
            } catch (error) {
                logger.error(`[Downloader] Failed to update Bible path for "${episode.name}"`, {
                    error: getErrorDetails(error),
                    episodeName: episode.name,
                    filePath
                });
                throw error;
            }
            return filePath;
        }

        const tempId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const convertedPath = `${filePath}.converted-${tempId}.mp3`;

        // Convert a previously downloaded local file instead of fetching it again.
        if (episode.path && fs.existsSync(episode.path)) {
            try {
                await convertToMp3(episode.path, convertedPath);
                const tagsWritten = NodeID3.write({
                    title: episode.name,
                    artist: 'הרב מוטי פרנקו (ישיבת הגולן)'
                }, convertedPath);
                if (tagsWritten instanceof Error) throw tagsWritten;
                fs.renameSync(convertedPath, filePath);
                updateBiblePath(filePath);
                logger.info(`[Downloader] Converted local audio to MP3 for "${episode.name}".`);
                return filePath;
            } catch (error) {
                logger.error(`[Downloader] Failed to convert local audio for "${episode.name}"`, {
                    error: getErrorDetails(error),
                    episodeName: episode.name,
                    sourcePath: episode.path
                });
                throw error;
            } finally {
                if (fs.existsSync(convertedPath)) fs.unlinkSync(convertedPath);
            }
        }

        const cleanUrl = Tools.cleanUrlParameters(episode.soundcloud);
        const sourcePaths = DOWNLOAD_FORMATS.map(({ extension }) => `${filePath}.source-${tempId}.${extension}`);
        const errors: Error[] = [];

        try {
            for (const [formatIndex, { format, extension, label }] of DOWNLOAD_FORMATS.entries()) {
                const formatSourcePath = sourcePaths[formatIndex];
                let downloaded = false;

                for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                    try {
                        const stream = await downloadSoundCloudFormat(cleanUrl, format);
                        await saveStream(stream, formatSourcePath);
                        downloaded = true;
                        break;
                    } catch (error) {
                        if (fs.existsSync(formatSourcePath)) fs.unlinkSync(formatSourcePath);
                        if (isFormatUnavailable(error)) {
                            errors.push(error instanceof Error ? error : new Error(getErrorMessage(error)));
                            break;
                        }

                        const wrappedError = new Error(
                            `${label} download attempt ${attempt}/${MAX_ATTEMPTS} failed: ${getErrorMessage(error)}`
                        );
                        errors.push(wrappedError);

                        if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
                            break;
                        }

                        const waitMs = RETRY_DELAY_MS * 2 ** (attempt - 1);
                        await delay(waitMs);
                    }
                }

                if (!downloaded) continue;

                if (extension === 'mp3') {
                    fs.renameSync(formatSourcePath, convertedPath);
                } else {
                    await convertToMp3(formatSourcePath, convertedPath);
                }

                const tagsWritten = NodeID3.write({
                    title: episode.name,
                    artist: 'הרב מוטי פרנקו (ישיבת הגולן)'
                }, convertedPath);
                if (tagsWritten instanceof Error) throw tagsWritten;
                fs.renameSync(convertedPath, filePath);
                updateBiblePath(filePath);
                logger.info(`[Downloader] Downloaded "${episode.name}" as ${label} and saved as MP3.`);
                return filePath;
            }

            throw new AggregateError(errors, `No supported audio format could be downloaded for "${episode.name}".`);
        } catch (error) {
            logger.error(`[Downloader] Failed to process episode "${episode.name}"`, {
                error: getErrorDetails(error),
                episodeName: episode.name,
                soundcloud: episode.soundcloud
            });
            throw error;
        } finally {
            for (const tempPath of [...sourcePaths, convertedPath]) {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            }
        }
    }
}

export default Downloader;
export { Downloader };