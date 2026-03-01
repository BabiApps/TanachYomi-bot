import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine project root so paths work when running from source or from dist
function getProjectRoot() {
    // If __dirname contains 'dist', assume compiled files are in dist and project root is parent
    if (__dirname.includes(`${path.sep}dist`) || __dirname.endsWith(`${path.sep}dist`)) {
        return path.resolve(__dirname, '..');
    }
    // Prefer process.cwd() as the launching directory (typical)
    return path.resolve(process.cwd());
}

const PROJECT_ROOT = getProjectRoot();

export const config = {
    PRODUCTION: process.env.NODE_ENV === 'production',
    port: process.env.PORT || 3000,

    // Telegram Bot settings
    telegram: {
        token: process.env.TELEGRAM_TOKEN,
        debug: process.env.TELEGRAM_DEBUG,
    },

    // WhatsApp settings
    whatsapp: {
        debug: process.env.WHATSAPP_DEBUG,
        responsibleForSending: process.env.WHATSAPP_RESPONSIBLE,
        name: 'TanachYomiBot',
    },

    // Paths (absolute, resolved from project root)
    paths: {
        root: PROJECT_ROOT,
        files: path.join(PROJECT_ROOT, 'files'),
        logs: path.join(PROJECT_ROOT, 'logs'),
        savedFiles: path.join(PROJECT_ROOT, 'saved_files'),
        bible: path.join(PROJECT_ROOT, 'saved_files', 'BIBLE_EPISODES.json'),
        backupBible: path.join(PROJECT_ROOT, 'saved_files', 'BIBLE_EPISODES.backup.json'),
        progress: path.join(PROJECT_ROOT, 'saved_files', 'BIBLE_PROGRESS.json'),
        groups: path.join(PROJECT_ROOT, 'saved_files', 'LIST_OF_GROUP.json'),
        admins: path.join(PROJECT_ROOT, 'saved_files', 'ADMINS_Tanach.json'),
    },

    bot: {
        appUrl: 'https://ygolan.org/נושאים/תנך/תנך-יומי/',
        telegramChannelUsername: 'Tanach_Yomi',
        telegramBotUsername: 'TanachYomi_bot',
        whatsappNumber: process.env.WHATSAPP_NUMBER,
        creatorTelegramUrl: 'http://t.me/shilobabila/',
    },
    
    getWelcomeMessage: (platform = 'whatsapp') => {
            const botInfo = config.bot;

        const isTelegram = platform === 'telegram';

        const link = (text, url) => {
            return isTelegram ? `[${text}](${url})` : `• ${text}: ${url}`;
        };

        return `📖 *שיעור תנ"ך יומי - ישיבת הגולן*\n\n` +

            `👋 שלום! הבוט מאפשר קבלת שיעור יומי קצר (כ-10 דק') על הפרק היומי, ` +
            `מפי הרב מוטי פרנקו. \nהשיעור כולל קריאה של הפרק, ביאור והרחבות.\n\n` +

            `💡 *איך משתמשים בבוט?*\n` +
            `מלבד השיעור היומי, ניתן לבקש כל פרק בכל זמן ע"י שליחת הודעה:\n` +
            `_"חפש שופטים פרק טו"_\n` +
            `(מומלץ לעקוב עם תנ"ך פתוח)\n\n` +

            `🔗 *פלטפורמות נוספות:*\n` +
            `${link('אתר הישיבה', config.bot.appUrl)}\n` +
            `${link('טלגרם', "https://t.me/" + config.bot.telegramChannelUsername)}\n` +
            `${link('וואטסאפ', "https://wa.me/" + config.bot.whatsappNumber)}\n\n` +

            `💻 ${link('פותח ע"י שילה בבילה', config.bot.creatorTelegramUrl)}\n` +
            `🕯 השיעורים מוקדשים לע"נ ינון ירון בן אברהם ז"ל`;
    }
}