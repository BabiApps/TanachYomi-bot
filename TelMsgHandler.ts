import TelegramClient from "./telegram.js";
import TanachYomiProcess from "./TanachYomiProcess.js";
import logger from "./logger.js";
import fs from "fs";
import Tools from "./tools.js";
import { config } from './config.js';

const telegramClient = TelegramClient.getInstance();
const tanachProcess = TanachYomiProcess.getInstance();
const bot = telegramClient.bot;

// Store search results temporarily for user selection
const searchResultsCache = new Map<string, any[]>();

/**
 * רישום לאירועי הודעות
 */
bot.on('message:text', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const text = msg.text?.trim() || "";

        logger.debug(`[Telegram] Received message: ${text.substring(0, 50)}... from chat ID: ${chatId}`);

        // /help - show available commands
        if (text === '/help' || text === '/commands') {
            let helpText = `📖 *פקודות זמינות:*\n\n`;
            helpText += `*כללי:*\n`;
            helpText += `/start - קבלת הודעת ברוכים הבאים\n`;
            helpText += `/help - הצגת רשימת הפקודות\n`;
            helpText += `/info - מידע על הבוט\n`;
            helpText += `/getnext - הפרק הבא שישלח\n`;
            helpText += `/addchat - הוסף קבוצה לרשימת השידור\n`;
            helpText += `/removechat - הסר קבוצה מרשימת השידור\n`;
            helpText += `\`@${config.bot.telegramBotUsername}\` <חיפוש> - חיפוש אינליין בפרקים\n\n`;

            const adminName = tanachProcess.isAdmin(String(msg.from?.id));
            if (adminName) {
                helpText += `*פקודות מנהל:*\n`;
                helpText += `/getlog - הורד קובץ לוג\n`;
                helpText += `/clearlog - נקה את קובץ הלוג\n`;
                helpText += `/getbible - הורד קובץ פרקים\n`;
                helpText += `/getgroups - הורד רשימת קבוצות\n`;
                helpText += `/getadmins - הורד רשימת מנהלים\n`;
                helpText += `/getprogress - הורד קובץ התקדמות\n`;
                helpText += `/killbot - עצור את הבוט\n`;
            }

            return await telegramClient.sendMessage(chatId, helpText);
        }

        // /start
        if (text === '/start') {
            const str = `שלום ${msg.from?.first_name || msg.contact?.first_name}!\nברוך הבא לבוט התנ"ך היומי.\n\n` +
                `אם תרצה, תוכל לקבל ממני כל יום את הפרק היומי בתנ"ך (בפרטי או בקבוצה)\n(לחץ על כפתור הפקודות כדי לראות)\n` +
                `ובנוסף תוכל לחפש פרק ללימוד לפי בחירה, ` +
                `החיפוש מתבצע בפורמט הבא: \n` +
                `\`\`\`חפש (ספר) פרק (שם הפרק)\`\`\`\n` +
                `או בחיפוש אינליין עם הפקודה /search\n\n` +
                `נא להקדיש את הלימוד לע"נ ינון ירון בן אברהם`;

            await telegramClient.sendMessage(chatId, str);
            return;
        }

        // /addchat
        if (text === '/addchat') {
            const chatName = msg.chat.title || msg.from.username || 'NoName';
            const chatID = msg.chat.id;

            const isExist = tanachProcess.addGroup('tanach_telegram', chatName, String(chatID));

            if (!isExist) {
                await telegramClient.sendMessage(chatID, "הצ'אט " + chatName + ' נמצא כבר ברשימת התפוצה של התנ"ך היומי');
            } else {
                await telegramClient.sendMessage(chatID, "הצ'אט " + chatName + ' נוסף לרשימת התפוצה של התנ"ך היומי');
                logger.info(`#TanachYomi: The chat ${chatName} (${chatID}) has added tanach broadcast`);
            }
            return;
        }

        // /removechat
        if (text === '/removechat') {
            const chatName = msg.chat.title || msg.from.username || 'NoName';
            const chatID = msg.chat.id;

            const isExist = tanachProcess.removeGroup('tanach_telegram', String(chatID));

            if (isExist) {
                await telegramClient.sendMessage(chatID, "הצ'אט " + chatName + ' הוסר מרשימת התפוצה של התנ"ך היומי');
                logger.info(`#TanachYomi: The chat ${chatName} (${chatID}) has removed from tanach broadcast`);
            } else {
                await telegramClient.sendMessage(chatID, "הצ'אט " + chatName + ' לא נמצא ברשימת התפוצה של התנ"ך היומי');
            }
            return;
        }

        // /getlog
        if (text === '/getlog') {
            const contactID = msg.from?.id ?? "No Contact";
            const adminName = tanachProcess.isAdmin(String(contactID));

            if (!adminName) {
                return await telegramClient.sendMessage(chatId, "אינך מנהל, רק למנהלים יש גישה לפקודה זו.");
            }

            try {
                await fs.promises.access('./logs/combined.log', fs.constants.R_OK);
                await telegramClient.sendDocument(chatId, './logs/combined.log');
            } catch (err) {
                logger.error(`Failed to send log file: ${err}`);
            }

            return;
        }

        // /clearlog
        if (text === '/clearlog') {
            const contactID = msg.from?.id ?? "No Contact";
            const adminName = tanachProcess.isAdmin(String(contactID));

            if (!adminName) {
                return await telegramClient.sendMessage(chatId, "אינך מנהל, רק למנהלים יש גישה לפקודה זו.");
            }


            fs.createWriteStream('./logs/combined.log', { flags: 'w' });
            logger.info(`Admin ${adminName} has cleared the log at ${Tools.getIsraeliDate()}`);
            await telegramClient.sendMessage(chatId, "הלוג נוקה");
            return;
        }

        // /getbible
        if (text === '/getbible') {
            await telegramClient.sendDocument(chatId, config.paths.bible);
            return;
        }

        // /getgroups
        if (text === '/getgroups') {
            const contactID = msg.from?.id ?? "No Contact";
            const adminName = tanachProcess.isAdmin(String(contactID));

            if (!adminName) {
                return await telegramClient.sendMessage(chatId, "אינך מנהל, רק למנהלים יש גישה לפקודה זו.");
            }

            await telegramClient.sendDocument(chatId, config.paths.groups);
            return;
        }

        // /getadmins
        if (text === '/getadmins') {
            const contactID = msg.from?.id ?? "No Contact";
            const adminName = tanachProcess.isAdmin(String(contactID));

            if (!adminName) {
                return await telegramClient.sendMessage(chatId, "אינך מנהל, רק למנהלים יש גישה לפקודה זו.");
            }

            await telegramClient.sendDocument(chatId, config.paths.admins);
            return;
        }

        // /getnext
        if (text === '/getnext') {
            const nextChapter = tanachProcess.getCurrentEpisode();
            await telegramClient.sendMessage(chatId, 'הפרק הבא שישלח: ' + nextChapter.name);
            return;
        }

        // /getprogress
        if (text === '/getprogress') {
            await telegramClient.sendDocument(chatId, config.paths.progress);
            return;
        }

        // /getid
        if (text === '/getid') {
            await telegramClient.sendMessage(chatId, "הID של השיחה: " + chatId);
            return;
        }

        // /info
        if (text === '/info') {
            const str = config.getWelcomeMessage('telegram');
            await telegramClient.sendMessage(chatId, str);
            return;
        }

        // /killbot
        if (text === '/killbot') {
            const contactID = msg.from?.id ?? "No Contact";
            const adminName = tanachProcess.isAdmin(String(contactID));

            if (!adminName) {
                return await telegramClient.sendMessage(chatId, "אינך מנהל, רק למנהלים יש גישה לפקודה זו.");
            }

            // Send message with inline buttons for confirmation
            await telegramClient.bot.sendMessage({
                chat_id: String(chatId),
                text: "⚠️ האם אתה בטוח שברצונך לעצור את שליחת הפרק היומי?",
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ כן, עצור את שליחת הפרק היומי", callback_data: "killbot_confirm" },
                            { text: "❌ ביטול", callback_data: "killbot_cancel" }
                        ]
                    ]
                }
            });
            return;
        }

        // חיפוש
        if (text === 'חפש' || text === 'חיפוש' || text === '/search') {
            await telegramClient.sendMessage(chatId, "הקלד: חפש <שם ספר> <מספר פרק>\nלדוגמה: חפש בראשית פרק א");
            return;
        }

        if (text.startsWith("חפש ") || text.startsWith("/search ")) {
            const query = text.replace("חפש ", "").replace("/search ", "").trim();
            const contactName = (msg.chat.first_name || msg.contact?.first_name) ?? "unknown";

            if (!query) {
                return await telegramClient.sendMessage(chatId, "אנא הקלד מילת חיפוש");
            }

            logger.info(`[Telegram] Search request: ${query} from ${contactName}`);
            const results = tanachProcess.searchEpisodeByText(query);

            if (results.length === 0) {
                return await telegramClient.sendMessage(chatId, "❌ לא נמצאו תוצאות לחיפוש: " + query);
            }

            // Show all results with pagination
            if (results.length === 1) {
                const result = results[0];
                return await telegramClient.sendEpisode(chatId, result);
            }

            if (results.length > 20) {
                return await telegramClient.sendMessage(chatId,
                    `⚠️ נמצאו יותר מ-20 תוצאות (${results.length}). אנא הצמד את החיפוש.`);
            }

            // Display multiple results with inline keyboard for selection
            const cacheKey = `search_${chatId}`;
            searchResultsCache.set(cacheKey, results);

            // Create inline keyboard buttons (up to 10 per row)
            const keyboard: any[][] = [];
            for (let i = 0; i < results.length; i += 2) {
                const row = [];
                row.push({
                    text: `${i + 1}. ${results[i].name}`,
                    callback_data: `search_select_${i}`
                });
                if (i + 1 < results.length) {
                    row.push({
                        text: `${i + 2}. ${results[i + 1].name}`,
                        callback_data: `search_select_${i + 1}`
                    });
                }
                keyboard.push(row);
            }

            // Add cancel button
            keyboard.push([
                {
                    text: "❌ ביטול",
                    callback_data: "search_cancel"
                }
            ]);

            await telegramClient.bot.sendMessage({
                chat_id: String(chatId),
                text: `📚 נמצאו ${results.length} תוצאות. בחר פרק:`,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
            return;
        }



        // If message doesn't match any command, and found one episode, send it
        if (text) {
            const results = tanachProcess.searchEpisodeByText(text);
            if (results.length === 1) {
                await telegramClient.sendEpisode(chatId, results[0]);
            }
        }
    
    } catch (error: any) {
        logger.error('Error in Telegram message handler', {
            error: error.message,
            chatId: msg.chat.id
        });
    }
});

/**
 * Callback queries
 */
bot.on('callback_query', async (query: any) => {
    try {
        const contactID = query.from?.id ?? "No Contact";
        const adminName = tanachProcess.isAdmin(String(contactID));

        if (query.data === 'killbot_confirm') {
            if (!adminName) {
                return await telegramClient.answerCallbackQuery(query.id, "אינך מנהל.", true);
            }

            tanachProcess.stop();
            await telegramClient.answerCallbackQuery(query.id, "🛑 שליחת הפרק היומי נעצרה...");
            logger.info(`Admin ${adminName} has stopped the daily episode sending`);
        }

        if (query.data === 'killbot_cancel') {
            await telegramClient.answerCallbackQuery(query.id, "✅ הפעולה בוטלה.");
            return;
        }

        // Handle search result selection
        if (query.data?.startsWith('search_select_')) {
            const index = parseInt(query.data.replace('search_select_', ''));
            const cacheKey = `search_${query.message?.chat.id}`;
            const results = searchResultsCache.get(cacheKey);

            if (!results || !results[index]) {
                return await telegramClient.answerCallbackQuery(query.id, "❌ התוצאה אינה זמינה עוד. אנא חפש שוב.", true);
            }

            const selectedResult = results[index];
            await telegramClient.answerCallbackQuery(query.id, `✅ בחרת: ${selectedResult.name}`);
            await telegramClient.sendEpisode(String(query.message?.chat.id), selectedResult);

            // Clean up cache after selection
            searchResultsCache.delete(cacheKey);
            return;
        }

        // Handle search cancel
        if (query.data === 'search_cancel') {
            const cacheKey = `search_${query.message?.chat.id}`;
            searchResultsCache.delete(cacheKey);
            await telegramClient.answerCallbackQuery(query.id, "❌ חיפוש בוטל");
            return;
        }
    } catch (error: any) {
        logger.error('Error in Telegram callback handler', {
            error: error.message
        });
    }
});

/**
 * Inline query handler - allows searching without sending to chat
 * User types "@botname search query" and bot shows results inline
 */
bot.on('inline_query', async (query: any) => {
    try {
        const queryText = query.query?.trim() || "";

        if (!queryText) {
            // Show help message if no query
            await bot.answerInlineQuery({
                inline_query_id: query.id,
                results: [{
                    type: 'article',
                    id: '0',
                    title: 'חפש פרק בתנ"ך',
                    description: 'הקלד: בראשית פרק א או ישעיהו פרק ג',
                    input_message_content: {
                        message_text: 'השתמש ב- /search <שם ספר> <מספר פרק>'
                    }
                }],
                cache_time: 0
            });
            return;
        }

        // Search for episodes
        const results = tanachProcess.searchEpisodeByText(queryText);

        if (results.length === 0) {
            await bot.answerInlineQuery({
                inline_query_id: query.id,
                results: [{
                    type: 'article',
                    id: '0',
                    title: 'לא נמצאו תוצאות',
                    description: `אין פרקים המתאימים ל: "${queryText}"`,
                    input_message_content: {
                        message_text: `חיפוש עבור: ${queryText} - לא נמצאו תוצאות`
                    }
                }],
                cache_time: 300
            });
            return;
        }

        // Build results array (limit to 50 results for Telegram)
        const inlineResults = results.slice(0, 50).map((episode, idx) => ({
            type: 'article' as const,
            id: `${idx}`,
            title: episode.name,
            description: `${episode.chapter}`,
            input_message_content: {
                message_text: `📖 *${episode.name}*\n\n🔊 SoundCloud: ${episode.soundcloud || 'N/A'}\n🎵 Spotify: ${episode.spotify || 'N/A'}`
            }
        }));

        await bot.answerInlineQuery({
            inline_query_id: query.id,
            results: inlineResults,
            cache_time: 300
        });
    } catch (error: any) {
        logger.error('Error in Telegram inline query handler', {
            error: error.message,
            query: query.query
        });
    }
});

logger.info('✅ Telegram handlers registered successfully');