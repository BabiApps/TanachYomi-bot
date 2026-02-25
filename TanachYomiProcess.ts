import Tools from './tools.js';
import logger from './logger.js';
import { HDate, Location, Zmanim, months, GeoLocation } from '@hebcal/core';
import * as fs from 'fs';
import path from 'path';
import { config } from './config.js';
import WhatsAppClient from './baileys.js';
import TelegramClient from './telegram.js';

export type TanachYomiEpisode = {
    name: string,
    chapter: string,
    path?: string,
    soundcloud: string,
    spotify: string
};

type BibleType = {
    [sefer: string]: {
        [chapter: string]: TanachYomiEpisode;
    };
} & {
    order?: string[];
};

type CollectionType = "tanach_whatsapp" | "tanach_telegram";

class TanachYomiProcess {
    intervalId?: NodeJS.Timeout;

    sefer: string = "";
    chapter: number = 0;

    // use configured paths (centralized in config.paths)
    BiblePath: string = config.paths.bible;
    groupsPath: string = config.paths.groups;
    adminsPath: string = config.paths.admins;
    statePath: string = config.paths.progress;

    BIBLE: BibleType = {};
    ADMINS: { [name: string]: string } = {};
    GROUPS: { [collection: string]: { name: string, id: string }[] } = {};

    private static instance: TanachYomiProcess;
    private constructor() {
        this.init();
    }

    async init() {
        // Load bible first (so loadState can fallback to a valid sefer)
        try {
            this.loadBible();
        } catch (e) {
            // loadBible throws on fatal errors — rethrow to make startup fail fast
            throw e;
        }

        // Load state after bible is available
        this.loadState();
        // Load admins and groups (non-fatal if groups missing)
        try {
            this.loadAdmins();
        } catch (e) {
            // If admins file missing or invalid, initialize empty admins map
            logger.warn('[init] Failed to load admins, starting with empty admin list');
            this.ADMINS = {};
        }
        this.loadGroups();
    }
    public static getInstance(): TanachYomiProcess {
        if (!TanachYomiProcess.instance) {
            TanachYomiProcess.instance = new TanachYomiProcess();
        }
        return TanachYomiProcess.instance;
    }

    public async start() {
        this.startAtZeroMinute().then(() => {
            logger.info(`Started Tanach Yomi process at: ${new Date().toLocaleString()}`);
            this.startProcessLoop();
        });
    }

    async startAtZeroMinute() {
        let date = new Date();
        let waitMin = 60 - date.getMinutes();
        let waitSec = 60 - date.getSeconds();
        await Tools.sleep(1000 * 60 * (waitMin - 1));
        await Tools.sleep(1000 * waitSec + 100); //100 ms more
    }

    startProcessLoop() {
        this.intervalId = setInterval(async () => {
            logger.info(`Running Tanach Yomi process at: ${new Date().toLocaleString()}`);

            let today = new HDate(new Date());
            let tomorrow = new HDate(new Date(Date.now() + 1000 * 60 * 60 * 24));

            // Skip if tomorrow is 9 Av (fasting day)
            if (this.checkIs9Av(tomorrow)) {
                logger.info("Skipping Tanach Yomi for 9 Av on:", tomorrow.toString());
                return;
            }

            const isHolidayToday = today.getDay() === 6 || this.checkIsYomTov(today);
            const isHolidayTomorrow = tomorrow.getDay() === 6 || this.checkIsYomTov(tomorrow);

            // skip if today and tomorrow are holidays
            if (isHolidayToday && isHolidayTomorrow) {
                logger.info("Skipping Tanach Yomi for holiday on:", today.toString());
                return;
            }

            // send after tziet shabbat
            if (isHolidayToday) {
                logger.info(`[startProcessLoop] Today is a holiday | Shabbat, sending after Tziet on ${today.toString()}`);
                // get tziet shabbat
                let location = Location.lookup('Jerusalem');
                let zmanim = new Zmanim(
                    new GeoLocation('Jerusalem', location?.getLatitude()!, location?.getLongitude()!, 800, location?.getTimeZone()!),
                    new Date(),
                    false
                );
                let tziet = zmanim.tzeit()

                if (tziet.getHours() + 1 === new Date().getHours()) {
                    logger.info(`[startProcessLoop] Tziet time reached, sending Tanach Yomi`);
                    await this.sendTanachYomi();
                } else {
                    logger.debug(`[startProcessLoop] Waiting for Tziet (current hour: ${new Date().getHours()}, tziet: ${tziet.getHours()})`);
                }

                return;
            }

            // send in 10:00
            if (isHolidayTomorrow) {
                logger.info(`[startProcessLoop] Tomorrow is a holiday | Shabbat, checking for 10:00 send time`);
                if (new Date().getHours() === 10) {
                    logger.info(`[startProcessLoop] 10:00 reached, sending Tanach Yomi`);
                    await this.sendTanachYomi();
                }
                return;
            }

            // if not holiday, send in 19:00
            if (new Date().getHours() === 19) {
                logger.info(`[startProcessLoop] Regular time (19:00) reached, sending Tanach Yomi`);
                await this.sendTanachYomi();
            } else {
                logger.debug(`[startProcessLoop] Current hour: ${new Date().getHours()}, waiting for 19:00`);
            }

        }, 1000 * 60 * 60); // every hour
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
            logger.info('[TanachYomiProcess] Stopped Tanach Yomi process loop');
        }
    }

    async sendTanachYomi() {
        try {
            logger.info(`[sendTanachYomi] Starting to send Tanach Yomi at ${new Date().toLocaleString()}`);

            // Get current episode (we'll send this one)
            const currentEpisode = this.getCurrentEpisode();
            logger.info(`[sendTanachYomi] Current episode: ${this.sefer}:${this.chapter} - ${currentEpisode.name}`);

            // Move to next chapter for tomorrow
            const nextEpisode = this.addDay();
            logger.info(`[sendTanachYomi] Moved to next: ${this.sefer}:${this.chapter} - ${nextEpisode.name}`);

            // Send to all users
            await this.sendEpisode(currentEpisode);
        }
        catch (error) {
            logger.error(`[sendTanachYomi] Failed to send Tanach Yomi`, {
                error: error instanceof Error ? error.message : String(error),
                sefer: this.sefer,
                chapter: this.chapter,
                timestamp: new Date().toLocaleString()
            });
            throw error;
        }
    }

    getCurrentEpisode(): TanachYomiEpisode {
        try {
            const episode = this.BIBLE[this.sefer][this.chapter];
            if (!episode) {
                throw new Error(`Episode not found: ${this.sefer} chapter ${this.chapter}`);
            }
            return episode;
        } catch (error) {
            logger.error(`[getCurrentEpisode] Failed to get episode from ${this.sefer}:${this.chapter}`, {
                error: error instanceof Error ? error.message : String(error),
                sefer: this.sefer,
                chapter: this.chapter
            });
            throw error;
        }
    }

    /** Adjust current sefer and chapter if out of bounds */
    fixCurrentEpisode() {
        // end of sefer - check if the chapter exists
        if (this.BIBLE[this.sefer][this.chapter] === undefined) {
            // move to next sefer
            let index = this.BIBLE.order.indexOf(this.sefer);

            // validate sefer exists in order
            if (index === -1) {
                logger.error(`[fixCurrentEpisode] Sefer "${this.sefer}" not found in order array. Resetting to first sefer.`, { sefer: this.sefer });
                this.sefer = this.BIBLE.order[0];
            } else if (index + 1 < this.BIBLE.order.length) {
                const nextSefer = this.BIBLE.order[index + 1];
                logger.info(`[fixCurrentEpisode] Finished sefer "${this.sefer}", moving to "${nextSefer}"`);
                this.sefer = nextSefer;
            } else {
                // end of tanach - restart from beginning
                logger.info(`[fixCurrentEpisode] Finished entire Tanach, restarting from beginning`);
                this.sefer = this.BIBLE.order[0];
            }

            // chapters start from 1
            this.chapter = 1;
        }
    }

    setCurrentEpisode(sefer: string, chapter: number): TanachYomiEpisode | null {
        // validate sefer and chapter exist
        if (!this.BIBLE[sefer]) {
            logger.error(`Sefer "${sefer}" not found`);
            return null;
        }

        if (!this.BIBLE[sefer][chapter]) {
            logger.error(`Chapter ${chapter} not found in sefer "${sefer}"`);
            return null;
        }

        // set the episode without adjusting
        this.sefer = sefer;
        this.chapter = chapter;
        this.saveState();

        const ep = this.getCurrentEpisode();
        logger.info(`Set current episode to: ${ep.name}`);
        return ep;
    }
    
    addDay(): TanachYomiEpisode {
        try {
            this.chapter += 1;
            this.fixCurrentEpisode();
            const ep = this.getCurrentEpisode();
            logger.info(`[addDay] Advanced to next episode: ${ep.name}`, {
                sefer: this.sefer,
                chapter: this.chapter,
                episodeName: ep.name
            });
            this.saveState();
            return ep;
        } catch (error) {
            logger.error(`[addDay] Failed to advance day from ${this.sefer}:${this.chapter - 1}`, {
                error: error instanceof Error ? error.message : String(error),
                sefer: this.sefer,
                chapter: this.chapter
            });
            throw error;
        }
    }

    removeDay(): TanachYomiEpisode {
        try {
            /** middle of sefer */
            if (this.chapter > 1) {
                this.chapter -= 1;
                const ep = this.getCurrentEpisode();
                this.saveState();
                logger.info(`[removeDay] Moved back within sefer "${this.sefer}": ${ep.name}`, {
                    sefer: this.sefer,
                    chapter: this.chapter,
                    episodeName: ep.name
                });
                return ep;
            }

            /** start of sefer - move to previous sefer */
            let index = this.BIBLE.order.indexOf(this.sefer);

            if (index === -1) {
                throw new Error(`Sefer "${this.sefer}" not found in order array`);
            } else if (index > 0) {
                // move to previous sefer
                const prevSefer = this.BIBLE.order[index - 1];
                logger.info(`[removeDay] Finished sefer "${this.sefer}", moving back to "${prevSefer}"`);
                this.sefer = prevSefer;
            } else {
                // if was first sefer, go to last sefer
                const lastSefer = this.BIBLE.order[this.BIBLE.order.length - 1];
                logger.info(`[removeDay] At beginning of Tanach, moving to last sefer "${lastSefer}"`);
                this.sefer = lastSefer;
            }

            // get last chapter of previous sefer (chapters start from 1)
            const lastChapterKey = Math.max(...Object.keys(this.BIBLE[this.sefer]).map(Number).filter(n => !isNaN(n)));
            this.chapter = lastChapterKey;

            const ep = this.getCurrentEpisode();
            this.saveState();
            logger.info(`[removeDay] Moved to ${this.sefer}:${this.chapter} (${ep.name})`, {
                sefer: this.sefer,
                chapter: this.chapter,
                episodeName: ep.name
            });
            return ep;
        } catch (error) {
            logger.error(`[removeDay] Failed to remove day from ${this.sefer}:${this.chapter}`, {
                error: error instanceof Error ? error.message : String(error),
                sefer: this.sefer,
                chapter: this.chapter
            });
            throw error;
        }
    }

    /**
     * Search episode by text
     ** can return multiple episodes (e.g. Tehillim)
     * @param text 
     * @returns Array of episodes, empty array if no results
     */
    searchEpisodeByText(text: string): TanachYomiEpisode[] {
        try {
            let str = text.replace(/\s+/g, ' ').trim(); // normalize whitespace
            console.log(str);

            const sefer = this.BIBLE.order?.find((sefer) => str.includes(sefer));
            if (!sefer) {
                logger.warn(`[searchEpisodeByText] No sefer found matching: ${text}`);
                return [];
            }

            str = str.split(sefer)[1]?.trim() || "";

            if (str.startsWith("פרק")) {
                str = str.replace("פרק", "").trim();
            }
            if (str.startsWith("מזמור")) {
                str = str.replace("מזמור", "").trim();
            }

            const episodes = Object.values(this.BIBLE[sefer]).filter((value) => {
                return `${value.chapter} `.includes(` ${str} `);
            });

            logger.info(`[searchEpisodeByText] Found ${episodes.length} episodes for: ${text}`);
            return episodes;
        } catch (error) {
            logger.error(`[searchEpisodeByText] Error searching for: ${text}`, {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    checkIs9Av(day: HDate): boolean {
        if (day.getMonth() !== months.AV)
            return false;

        if (day.getDate() === 9 && day.getDay() !== 6)
            return true;
        if (day.getDate() === 10 && day.getDay() === 0)
            return true;
        return false;
    }

    checkIsYomTov(day: HDate): boolean {
        if (day.getMonth() === months.TISHREI &&
            (day.getDate() === 1 || day.getDate() === 10 || day.getDate() === 15 || day.getDate() === 22))
            return true;

        if (day.getMonth() === months.NISAN && (day.getDate() === 15 || day.getDate() === 21))
            return true;

        if (day.getMonth() === months.SIVAN && day.getDate() === 6)
            return true;

        return false;
    }

    saveState() {
        try {
            const state = {
                sefer: this.sefer,
                chapter: this.chapter
            };
            // write atomically to avoid partial writes
            const data = JSON.stringify(state, null, 2);
            this.writeAtomic(this.statePath, data);
            logger.debug(`[saveState] Saved state: ${this.sefer}:${this.chapter} to ${this.statePath}`);
        } catch (error) {
            logger.error(`[saveState] Failed to save state`, {
                error: error instanceof Error ? error.message : String(error),
                sefer: this.sefer,
                chapter: this.chapter
            });
        }
    }

    saveAdmins() {
        try {
            const adminsData = JSON.stringify(this.ADMINS, null, 2);
            this.writeAtomic(this.adminsPath, adminsData);
            logger.debug(`[saveAdmins] Saved ${Object.keys(this.ADMINS).length} admins to ${this.adminsPath}`);
        } catch (error) {
            logger.error(`[saveAdmins] Failed to save admins to ${this.adminsPath}`, {
                error: error instanceof Error ? error.message : String(error),
                filePath: this.adminsPath
            });
        }
    }

    saveGroups() {
        try {
            const groupsData = JSON.stringify(this.GROUPS, null, 2);
            this.writeAtomic(this.groupsPath, groupsData);
            const groupCount = Object.values(this.GROUPS).reduce((sum, arr) => sum + arr.length, 0);
            logger.debug(`[saveGroups] Saved ${groupCount} groups to ${this.groupsPath}`);
        } catch (error) {
            logger.error(`[saveGroups] Failed to save groups to ${this.groupsPath}`, {
                error: error instanceof Error ? error.message : String(error),
                filePath: this.groupsPath
            });
        }
    }

    loadState() {
        try {
            const data = fs.readFileSync(this.statePath, 'utf-8');
            const state = JSON.parse(data);
            this.sefer = state.sefer;
            this.chapter = state.chapter;
            logger.info(`[loadState] Successfully loaded state from ${this.statePath}: ${this.sefer}:${this.chapter}`);
        } catch (e) {
            logger.warn(`[loadState] No previous Tanach Yomi state found, starting fresh. Error: ${e instanceof Error ? e.message : String(e)}`);
            this.sefer = this.BIBLE.order[0];
            this.chapter = 1; // chapters start from 1, not 0

            // create initial state file
            this.saveState();
        }
    }

    loadBible() {
        let bibleData = this._tryLoadAndValidate(this.BiblePath);

        if (!bibleData) {
            logger.warn(`[loadBible] Main Bible file is invalid or missing. Attempting to load backup from ${config.paths.backupBible}`);
            bibleData = this._tryLoadAndValidate(config.paths.backupBible);

            // If we loaded from backup, copy it to main file for next time
            if (bibleData) {
                try {
                    const backupContent = fs.readFileSync(config.paths.backupBible, 'utf-8');
                    fs.writeFileSync(this.BiblePath, backupContent, 'utf-8');
                    logger.info(`[loadBible] Restored Bible from backup to ${this.BiblePath}`);
                } catch (error) {
                    logger.warn(`[loadBible] Could not restore backup to main file: ${(error as Error).message}`);
                }
            }
        }

        if (!bibleData) {
            const errorMsg = `[loadBible] Critical Error: Failed to load both Main and Backup Bible files.`;
            logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        this.BIBLE = bibleData;
        logger.info(`[loadBible] Successfully loaded Bible with ${this.BIBLE.order.length} sfarim.`);
    }

    _tryLoadAndValidate(filePath) {
        try {
            if (!fs.existsSync(filePath)) return null;

            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);

            // Validation: must have 'order' array and at least one sefer
            if (!data.order || Object.keys(data).length === 0) {
                logger.warn(`[loadBible] Validation failed for file: ${filePath}`);
                return null;
            }

            return data;

        } catch (error) {
            logger.error(`[loadBible] Error reading file ${filePath}: ${error.message}`);
            return null;
        }
    }

    loadAdmins() {
        try {
            const adminsData = fs.readFileSync(this.adminsPath, 'utf-8');
            this.ADMINS = JSON.parse(adminsData);
            logger.info(`[loadAdmins] Successfully loaded ${Object.keys(this.ADMINS).length} admins from ${this.adminsPath}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                logger.info(`[loadAdmins] Admins file not found, creating empty one at ${this.adminsPath}`);
                this.ADMINS = {};
                this.saveAdmins(); // Create the file
            } else {
                logger.error(`[loadAdmins] Failed to load admins from ${this.adminsPath}`, {
                    error: error instanceof Error ? error.message : String(error),
                    filePath: this.adminsPath
                });
                throw error; // Re-throw for other errors
            }
        }
    }

    loadGroups() {
        try {
            const groupsData = fs.readFileSync(this.groupsPath, 'utf-8');
            this.GROUPS = JSON.parse(groupsData);
            logger.info(`[loadGroups] Successfully loaded ${Object.keys(this.GROUPS).length} groups from ${this.groupsPath}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                logger.info(`[loadGroups] Groups file not found, creating empty one at ${this.groupsPath}`);
                this.GROUPS = { tanach_whatsapp: [], tanach_telegram: [] };
                this.saveGroups(); // Create the file
            } else {
                logger.warn(`[loadGroups] Failed to load groups from ${this.groupsPath}, initializing with empty object`, {
                    error: error instanceof Error ? error.message : String(error),
                    filePath: this.groupsPath
                });
                this.GROUPS = { tanach_whatsapp: [], tanach_telegram: [] };
            }
        }
    }

    updateEpisodePath(episode: TanachYomiEpisode, path: string) {
        try {
            const bible = JSON.parse(fs.readFileSync(this.BiblePath, 'utf-8')) as BibleType;

            // Find the correct sefer by searching through all sfarim
            let found = false;
            for (const sefer in bible) {
                if (sefer === 'order') continue; // skip the order array
                const seferEpisodes = bible[sefer];

                for (const chapterKey in seferEpisodes) {
                    const ep = seferEpisodes[chapterKey];
                    if (ep.name === episode.name && ep.chapter === episode.chapter) {
                        ep.path = path;
                        found = true;
                        break;
                    }
                }

                if (found) break;
            }

            if (!found) {
                logger.warn(`[updateEpisodePath] Episode not found in Bible: ${episode.name}:${episode.chapter}`);
            }

            // write bible file atomically
            this.writeAtomic(this.BiblePath, JSON.stringify(bible, null, 2));
            logger.info(`[updateEpisodePath] Updated path for ${episode.name}:${episode.chapter} to: ${path}`);
        } catch (error) {
            logger.error(`[updateEpisodePath] Failed to update episode path for ${episode.name}:${episode.chapter}`, {
                error: error instanceof Error ? error.message : String(error),
                episodeName: episode.name,
                chapter: episode.chapter,
                newPath: path
            });
        }
    }

    /**
     * Write file atomically: write to temp and rename.
     */
    private writeAtomic(filePath: string, data: string) {
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
            fs.writeFileSync(tmp, data, { encoding: 'utf8' });
            fs.renameSync(tmp, filePath);
        } catch (err) {
            logger.error('[writeAtomic] Failed to write file atomically', { filePath, error: err instanceof Error ? err.message : String(err) });
            // fallback to direct write
            fs.writeFileSync(filePath, data, { encoding: 'utf8' });
        }
    }

    async sendEpisode(episode: TanachYomiEpisode) {
        try {
            logger.info(`[sendEpisode] Starting to send episode: ${episode.name} (${this.sefer}:${this.chapter})`);

            const whatsappGroups = this.GROUPS['tanach_whatsapp'] || [];
            const telegramChats = this.GROUPS['tanach_telegram'] || [];

            try {
                await this.sendEpisodeTelegram(episode, telegramChats);
            } catch (error) {
                logger.error(`[sendEpisode] Failed to send episode to Telegram`, {
                    error: error instanceof Error ? error.message : String(error),
                    episodeName: episode.name,
                    sefer: this.sefer,
                    chapter: this.chapter
                });
            }

            if (whatsappGroups.length > 0) {
                await this.sendEpisodeWA(episode, whatsappGroups);
            } else {
                logger.warn(`[sendEpisode] No WhatsApp groups configured, skipping WhatsApp send`);
            }

            logger.info(`[sendEpisode] Successfully sent ${episode.name} to all configured platforms`);
        } catch (error) {
            logger.error(`[sendEpisode] Failed to send episode ${episode.name}`, {
                error: error instanceof Error ? error.message : String(error),
                episodeName: episode.name,
                sefer: this.sefer,
                chapter: this.chapter
            });
            throw error;
        }
    }

    async sendEpisodeWA(episode: TanachYomiEpisode, groups: { name: string, id: string }[] | undefined) {
        // Handle undefined or empty groups
        if (!groups || groups.length === 0) {
            logger.warn(`[sendEpisodeWA] No WhatsApp groups provided, skipping`);
            return;
        }

        // get whatsapp instance
        const whatsapp = WhatsAppClient.getInstance();

        const startTime = new Date();
        logger.info(`[sendEpisodeWA] Start sending episode to ${groups.length} WhatsApp group(s). Episode: ${episode.name}. Time: ${startTime.toLocaleString()}`);

        // send sequentially to better respect rate limits and allow predictable delays
        for (const group of groups) {
            try {
                await whatsapp.sendEpisode(group.id, episode);
                logger.info(`[sendEpisodeWA] Sent episode to WhatsApp group "${group.name}" (${group.id}): ${episode.name}`);
            } catch (error) {
                const errorMsg = `Error sending episode to WhatsApp group "${group.name}" (${group.id}): ${error instanceof Error ? error.message : String(error)}`;
                logger.error(`[sendEpisodeWA] ${errorMsg}`, {
                    error: error instanceof Error ? error.message : String(error),
                    groupId: group.id,
                    groupName: group.name,
                    episodeName: episode.name
                });

                try {
                    TelegramClient.getInstance().sendMessage(config.telegram.debug, errorMsg);

                    // Send error to bot number and debug number
                    let adminPhones = [config.bot.whatsappNumber];
                    if (config.whatsapp.debug && config.whatsapp.debug.trim()) {
                        adminPhones.unshift(config.whatsapp.debug);
                    }

                    let jids = adminPhones.map(ph => Tools.phoneToWhatsApp(ph));
                    if (jids.length > 0) {
                        await whatsapp.sendMsgToDebugUsers(jids, { text: errorMsg });
                    }
                } catch (debugError) {
                    logger.error(`[sendEpisodeWA] Failed to send debug message`, {
                        error: debugError instanceof Error ? debugError.message : String(debugError)
                    });
                }
            }

            // wait random 1-5 seconds between messages
            await Tools.sleepRandom(1000, 5000);
        }

        const endTime = new Date();
        logger.info(`Finished sending episode to WhatsApp groups. Episode: ${episode.name}. Time: ${endTime.toLocaleString()}`);
        logger.info(`Total time taken: ${(endTime.getTime() - startTime.getTime()) / 1000} seconds`);
    }

    async sendEpisodeTelegram(episode: TanachYomiEpisode, chats: { name: string, id: string }[] | undefined) {
        // Handle undefined or empty chats
        if (!chats || chats.length === 0) {
            logger.warn(`[sendEpisodeTelegram] No Telegram chats provided (except main channel). Will only send to main channel.`);
        }

        const startTime = new Date();
        logger.info(`[sendEpisodeTelegram] Start sending episode to ${chats.length} Telegram chat(s). Episode: ${episode.name}. Time: ${startTime.toLocaleString()}`);

        const telegramClient = TelegramClient.getInstance();

        // send first to the main channel
        await telegramClient.sendEpisode("@" + config.bot.telegramChannelUsername, episode);

        for (const chat of chats) {
            try {
                await telegramClient.sendEpisode(chat.id, episode);
                logger.info(`[sendEpisodeTelegram] Sent episode to Telegram chat "${chat.name}" (${chat.id}): ${episode.name}`);
            } catch (error) {
                const errorMsg = `Error sending episode to Telegram chat ${chat.id}: ${error instanceof Error ? error.message : String(error)}`;
                logger.error(`[sendEpisodeTelegram] ${errorMsg}`, {
                    error: error instanceof Error ? error.message : String(error),
                    chatId: chat.id,
                    chatName: chat.name,
                    episodeName: episode.name
                });
            }

            // wait random 0-2 seconds between messages
            await Tools.sleepRandom(0, 2000);
        }

        const endTime = new Date();
        logger.info(`[sendEpisodeTelegram] Finished sending episode to Telegram chats. Episode: ${episode.name}. Time: ${endTime.toLocaleString()}`);
        logger.info(`[sendEpisodeTelegram] Total time taken: ${(endTime.getTime() - startTime.getTime()) / 1000} seconds`);
    }

    /**
     * @param id 
     * @returns if admin, return name, else null
     */
    isAdmin(id: string): string | null {
        if (!id) return null;

        for (const [name, adminJid] of Object.entries(this.ADMINS)) {
            if (adminJid === id || id.split('@')[0] === adminJid.split('@')[0]) { // allow matching just on phone number for whatsapp
                return name;
            }
        }
        if (id === config.telegram.debug) {
            return "Telegram Debug";
        }
        if (config.whatsapp.debug && id === Tools.phoneToWhatsApp(config.whatsapp.debug)) {
            return "WhatsApp Debug";
        }

        return null;
    }

    /** @returns true if added, false if already exists */
    addAdmin(name: string, id: string): boolean {
        // check if id already exists
        for (const adminJid of Object.values(this.ADMINS)) {
            if (adminJid === id) {
                logger.warn(`[addAdmin] Admin ID already exists: ${id}`);
                return false;
            }
        }
        this.ADMINS[name] = id;
        this.saveAdmins();
        logger.info(`[addAdmin] Added new admin: "${name}" (${id})`);
        return true;
    }

    /** @returns true if removed, false if not found */
    removeAdmin(id: string): boolean {
        for (const [name, adminJid] of Object.entries(this.ADMINS)) {
            if (adminJid === id) {
                delete this.ADMINS[name];
                this.saveAdmins();
                logger.info(`[removeAdmin] Removed admin: "${name}" (${id})`);
                return true;
            }
        }
        logger.warn(`[removeAdmin] Admin not found for ID: ${id}`);
        return false;
    }

    getAdminsList(): string {
        return Object.entries(this.ADMINS).map(([name, id]) => `${name}: ${id}`).join('\n');
    }

    addGroup(collection: CollectionType, name: string, id: string): boolean {
        if (!this.GROUPS[collection]) {
            this.GROUPS[collection] = [];
        }

        const exists = this.GROUPS[collection].some(group => group.id === id);
        if (exists) {
            logger.warn(`[addGroup] Group already exists in "${collection}": ${id}`);
            return false;
        }

        this.GROUPS[collection].push({ name, id });
        this.saveGroups();
        logger.info(`[addGroup] Added group "${name}" (${id}) to collection "${collection}"`);
        return true;
    }

    removeGroup(collection: string, id: string): boolean {
        if (!this.GROUPS[collection]) {
            logger.warn(`[removeGroup] Collection "${collection}" not found`);
            return false;
        }

        const initialLength = this.GROUPS[collection].length;
        this.GROUPS[collection] = this.GROUPS[collection].filter(group => group.id !== id);
        const finalLength = this.GROUPS[collection].length;

        if (finalLength < initialLength) {
            this.saveGroups();
            logger.info(`[removeGroup] Removed group (${id}) from collection "${collection}"`);
            return true;
        }

        logger.warn(`[removeGroup] Group not found in "${collection}": ${id}`);
        return false;
    }
}

export default TanachYomiProcess;
