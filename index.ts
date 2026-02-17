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
        // Telegram
        const telegramClient = TelegramClient.getInstance();
        logger.info('✅ Telegram is ready');

        // WhatsApp
        const whatsappClient = WhatsAppClient.getInstance();
        await whatsappClient.initialize();
        logger.info('✅ WhatsApp is ready');

        // TanachYomiProcess
        const tanachProcess = TanachYomiProcess.getInstance();
        await tanachProcess.init();
        logger.info('📖 TanachYomiProcess is ready');

        // Start local HTTP server + tunnel and announce URL
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
            try { await stopTunnel(); } catch { }
            process.exit(0);
        });

        if (config.PRODUCTION) {
            logger.info('⚡ Running in PRODUCTION mode - starting episode scheduler');
            await tanachProcess.start();
        } else {
            logger.info('⚡ Running in DEVELOPMENT mode - skipping Zero-Minute, starting episode sending immediately');
            tanachProcess.startProcessLoop();
        }

        logger.info('✨ TanachYomiBot is up and running!');
        return { whatsappClient, telegramClient, tanachProcess, tunnelUrl, stopTunnel };

    } catch (error: any) {
        logger.error('❌ Failed to start TanachYomiBot', {
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

const console_info = console.info;
console.info = (...args: any[]) => {
    const message = args.join(" ");
    return message.includes("SessionEntry")
        ? console_info("Updating SessionEntry", [])
        : console_info(...args);
};

logger.info('='.repeat(50));
logger.info('TanachYomiBot - Hebrew Bible Daily Podcast');
logger.info('='.repeat(50));
startBot();