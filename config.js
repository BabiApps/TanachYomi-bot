import dotenv from 'dotenv';
dotenv.config();

export const config = {
    PRODUCTION: process.env.NODE_ENV === 'production',

    // Telegram Bot settings
    telegram: {
        token: process.env.TELEGRAM_TOKEN,
        debug: process.env.TELEGRAM_DEBUG,
    },

    // WhatsApp settings
    whatsapp: {
        debug: process.env.WHATSAPP_DEBUG,
        name: 'TanachYomiBot',
    },

    // Paths
    paths: {
        files: './files',
        savedFiles: './saved_files',
        bible: './saved_files/BIBLE_EPISODES.json',
        backupBible: './saved_files/BIBLE_EPISODES.backup.json',
        progress: './saved_files/BIBLE_PROGRESS.json',
        groups: './saved_files/LIST_OF_GROUP.json',
        admins: './saved_files/ADMINS_Tanach.json',
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