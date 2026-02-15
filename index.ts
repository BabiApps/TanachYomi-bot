import WhatsAppClient from './baileys.js';
import TelegramClient from './telegram.js';
import TanachYomiProcess from './TanachYomiProcess.js';
import logger from './logger.js';
import './TelMsgHandler.js';
import './WaMsgHandler.js';
import { startServer } from './connect/server.js';
import { config } from './config.js';

async function startBot() {
    try {
        logger.info('🚀 מתחיל את TanachYomiBot...');

        // Telegram
        logger.info('📲 מאתחל Telegram...');
        const telegramClient = TelegramClient.getInstance();
        logger.info('✅ Telegram מוכן');

        // WhatsApp
        logger.info('📱 מאתחל WhatsApp...');
        const whatsappClient = WhatsAppClient.getInstance();
        await whatsappClient.initialize();
        logger.info('✅ WhatsApp מוכן');

        // TanachYomiProcess
        logger.info('📖 מאתחל TanachYomiProcess...');
        const tanachProcess = TanachYomiProcess.getInstance();
        await tanachProcess.init();
        logger.info('✅ TanachYomiProcess מוכן');

        // Start local HTTP server + tunnel and announce URL
        logger.info('🌐 מאתחל Tunnel/Server...');
        const { url: tunnelUrl, stop: stopTunnel } = await startServer();
        logger.info(`🌐 Tunnel available: ${tunnelUrl}`);
        console.info(`Tunnel: ${tunnelUrl}`);

        // send to telegram admin if configured
        const adminChatId = config.telegram.debug;
        try {
            if (adminChatId) {
                telegramClient.sendMessage(adminChatId, `🚀 TanachYomiBot started successfully!\n🔗 Tunnel URL: ${tunnelUrl}`);
                logger.info('✅ Tunnel URL sent to Telegram admin');
            } else {
                logger.info('⚠️ Telegram admin not configured or sendMessage not available');
            }
        } catch (err: any) {
            logger.error('❌ failed to send tunnel url to telegram', { message: err.message });
        }

        // ensure tunnel closes on exit
        process.on('SIGINT', async () => {
            logger.info('🛑 SIGINT received, closing tunnel and exiting...');
            try { await stopTunnel(); } catch {}
            process.exit(0);
        });

        logger.info('🎯 התחלת main loop...');
        //await tanachProcess.start();
        await tanachProcess.startProcessLoop();

        logger.info('✨ הבוט פועל בהצלחה!');
        return { whatsappClient, telegramClient, tanachProcess, tunnelUrl, stopTunnel };

    } catch (error: any) {
        logger.error('❌ שגיאה בהתחלה:', {
            message: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}


process.on('unhandledRejection', (reason, promise) => {
    logger.error('⚠️ Unhandled Rejection:', {
        promise: promise.toString(),
        reason: reason
    });
});

process.on('uncaughtException', (error) => {
    logger.error('⚠️ Uncaught Exception:', {
        message: error.message,
        stack: error.stack
    });
    process.exit(1);
});

// סיכום SessionEntry logs (סתירה פחות רעש)
const console_info = console.info;
console.info = (...args) => {
    const message = args.join(" ");
    return message.includes("SessionEntry")
        ? console_info("Updating SessionEntry", [])
        : console_info(...args);
};

// התחל את הבוט
logger.info('='.repeat(50));
logger.info('TanachYomiBot - Hebrew Bible Daily Podcast');
logger.info('='.repeat(50));
startBot();