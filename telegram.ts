import { TelegramBot } from 'typescript-telegram-bot-api';
import { config } from './config.js';
import logger from './logger.js';
import fs from 'fs';
import type { TanachYomiEpisode } from './TanachYomiProcess.js';
import Downloader from './downloader.js';

export default class TelegramClient {
    static instance: TelegramClient;
    bot: TelegramBot;

    private constructor() {
        if (TelegramClient.instance) {
            return TelegramClient.instance;
        }

        // אתחול הבוט עם הtoken מה-config
        this.bot = new TelegramBot({ botToken: config.telegram.token });
        this.bot.startPolling();

        TelegramClient.instance = this;
    }

    /**
     * קבל את ה-singleton instance של ה-client
     * @returns {TelegramClient}
     */
    static getInstance(): TelegramClient {
        if (!TelegramClient.instance) {
            TelegramClient.instance = new TelegramClient();
        }
        return TelegramClient.instance;
    }

    /**
     * שלח הודעת טקסט
     * @param {number|string} chatId - ID של הצ'אט
     * @param {string} text - הטקסט לשליחה
     */
    async sendMessage(chatId: number | string, text: string) {
        try {
            logger.debug(`[TelegramClient.sendMessage] sending to ${chatId}: ${text.substring(0, 50)}...`);
            const result = await this.bot.sendMessage({
                chat_id: String(chatId),
                text: text,
                parse_mode: 'Markdown'
            });
            return result;
        } catch (error: any) {
            logger.error('Failed to send Telegram message', {
                chatId,
                error: error.message,
                text: text.substring(0, 100)
            });
            throw error;
        }
    }

    /**
     * שלח תמונה
     * @param {number|string} chatId - ID של הצ'אט
     * @param {string} photoPath - קישור של התמונה או file_id
     */
    async sendPhoto(chatId: number | string, photoPath: string) {
        try {
            logger.debug(`[TelegramClient.sendPhoto] sending photo to ${chatId}`);
            const result = await this.bot.sendPhoto({
                chat_id: String(chatId),
                photo: photoPath
            });
            return result;
        } catch (error: any) {
            logger.error('Failed to send Telegram photo', {
                chatId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * שלח קובץ מסמך
     * @param {number|string} chatId - ID של הצ'אט
     * @param {string} documentPath - קישור של הקובץ או file_id
     */
    async sendDocument(chatId: number | string, documentPath: string) {
        try {
            logger.debug(`[TelegramClient.sendDocument] sending document to ${chatId}`);
            let docParam: any = documentPath;
            try {
                if (documentPath && fs.existsSync(String(documentPath))) {
                    docParam = fs.createReadStream(String(documentPath));
                }
            } catch (e) {
                // ignore fs errors and fallback to passing the path as-is
            }

            const result = await this.bot.sendDocument({
                chat_id: String(chatId),
                document: docParam
            });
            return result;
        } catch (error: any) {
            logger.error('Failed to send Telegram document', {
                chatId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * שלח קובץ אודיו
     * @param {number|string} chatId - ID של הצ'אט
     * @param {string} audioPath - קישור של הקובץ או file_id
     * @param {string} title - שם הטראק (אופציונלי)
     */
    async sendAudio(chatId: number | string, audioPath: string, title?: string) {
        try {
            logger.debug(`[TelegramClient.sendAudio] sending audio to ${chatId}`);
            // If audioPath is a local file, send as stream. Otherwise pass the string (file_id or URL).
            let audioParam: any = audioPath;
            try {
                if (audioPath && fs.existsSync(String(audioPath))) {
                    audioParam = fs.createReadStream(String(audioPath));
                }
            } catch (e) {
                // ignore fs errors and fallback to passing the path as-is
            }

            const result = await this.bot.sendAudio({
                chat_id: String(chatId),
                audio: audioParam,
                title: title
            });
            return result;
        } catch (error: any) {
            logger.error('Failed to send Telegram audio', {
                chatId,
                error: error.message
            });
            throw error;
        }
    }

    async sendEpisode(chatId: number | string, episode: TanachYomiEpisode) {
        logger.info(`[TelegramClient.sendEpisode] sending episode "${episode.name}" to chat ${chatId}`);
        try {
            // get local file path (download if not exists)
            const filePath = await Downloader.download(episode);
            
            // prepare audio
            let audioParam: any = filePath;
            try {
                if (filePath && fs.existsSync(String(filePath))) {
                    audioParam = fs.createReadStream(String(filePath));
                }
            } catch (e) {
            }

            // send audio with inline buttons for SoundCloud and Spotify
            return await this.bot.sendAudio({
                chat_id: String(chatId),
                audio: audioParam,
                title: episode.name,
                caption: episode.name,
                reply_markup: {
                    inline_keyboard: [[
                        { text: "SoundCloud", url: episode.soundcloud },
                        { text: "Spotify", url: episode.spotify }
                    ]]
                }
            });
        } catch (error: any) {
            logger.error('Failed to send Telegram episode', {
                chatId,
                episodeName: episode.name,
                error: error.message
            });
            throw error;
        }

    }

    /**
     * רשום ל-message updates
     * @param {Function} callback - הפונקציה שתתוקרא
     */
    onMessage(callback: (message: any) => Promise<void> | void) {
        this.bot.on('message', callback);
    }

    /**
     * רשום לצליחת קבלת callback query
     * @param {Function} callback - הפונקציה שתתוקרא
     */
    onCallbackQuery(callback: (query: any) => Promise<void> | void) {
        this.bot.on('callback_query', callback);
    }

    /**
     * ענה ל-callback query
     * @param {string} callbackQueryId - ID של ה-callback query
     * @param {string} text - הטקסט שיוצג
     * @param {boolean} showAlert - האם להציג כ-popup
     */
    async answerCallbackQuery(callbackQueryId: string, text: string, showAlert: boolean = false) {
        try {
            logger.debug(`[TelegramClient.answerCallbackQuery] answering ${callbackQueryId}`);
            const result = await this.bot.answerCallbackQuery({
                callback_query_id: callbackQueryId,
                text: text,
                show_alert: showAlert
            });
            return result;
        } catch (error: any) {
            logger.error('Failed to answer callback query', {
                callbackQueryId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * עדכן הודעה קיימת
     * @param {number|string} chatId - ID של הצ'אט
     * @param {number} messageId - ID של ההודעה
     * @param {string} text - הטקסט החדש
     */
    async editMessageText(chatId: number | string, messageId: number, text: string) {
        try {
            logger.debug(`[TelegramClient.editMessageText] editing message ${messageId} in chat ${chatId}`);
            const result = await this.bot.editMessageText({
                chat_id: String(chatId),
                message_id: messageId,
                text: text
            });
            return result;
        } catch (error: any) {
            logger.error('Failed to edit Telegram message', {
                chatId,
                messageId,
                error: error.message
            });
            throw error;
        }
    }
}