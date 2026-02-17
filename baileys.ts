import makeWASocket, { MiscMessageGenerationOptions, AnyMessageContent, DisconnectReason, fetchLatestBaileysVersion, WAMessage } from '@adiwajshing/baileys';
import { proto } from '@adiwajshing/baileys/WAProto/index.js';
import QRCode from 'qrcode';
import PQueue from 'p-queue';
import handleMessage, { handleEditedMessage } from './WaMsgHandler.js';
import { config } from './config.js';
import Tools from './tools.js';
import logger from './logger.js';
import BaileysBottle from 'baileys-bottle-devstroupe';
import pino from 'pino';
import { Boom } from "@hapi/boom";
import { Downloader } from './downloader.js';
import { TanachYomiEpisode } from './TanachYomiProcess.js';

class WhatsAppClient {
    static instance: WhatsAppClient | null = null;

    sock: import('@adiwajshing/baileys').WASocket | null = null;
    store: import('baileys-bottle-devstroupe/lib/bottle/StoreHandle.js').default | null = null;

    qr: string | undefined = "";
    isConnected: boolean = false;

    msgQueue: PQueue = new PQueue({
        autoStart: false,
        concurrency: 1,
        interval: 1000, // 1s
        timeout: 10000, // 10s
    });
    handlerQueue: PQueue = new PQueue({
        concurrency: 5,
        interval: 100 // 0.1s
    });

    auth: any;

    constructor() {
        if (WhatsAppClient.instance) {
            return WhatsAppClient.instance;
        }
        WhatsAppClient.instance = this;

        this.initStore();
    }

    async initStore() {
        const bottle = await BaileysBottle.init({
            type: "sqlite",
            database: "db.sqlite"
        })
        const { auth, store } = await bottle.createStore("Bot");
        this.store = store;
        this.auth = auth;
    }

    async getMessage(key: any) {
        if (this.store) {
            const msg = await this.store.loadMessage(key.remoteJid, key.id)
            return msg?.message || undefined
        }
        // only if store is present
        return { message: {} };
    }

    async initialize() {
        // wait for store to be initialized
        if (!this.store) {
            await Tools.sleep(1000);
            return await this.initialize();
        }

        // use auth handle
        const pino_log = pino({ level: 'silent' });
        const { saveState, state } = await this.auth.useAuthHandle({
            credsFile: "./PaziBotCreds.json",
            replace: false
        });

        // fetch latest baileys version
        let { version, error } = await fetchLatestBaileysVersion();
        if (error) {
            pino_log.error({ error }, 'Error fetching latest Baileys version: using default version');
            version = [2, 3000, 1023223821];
        }

        // make wasocket
        this.sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: state.keys,
            },
            logger: pino_log,
            version,
            retryRequestDelayMs: 100,
            getMessage: this.getMessage
        });

        // bind store to wasocket
        this.store.bind(this.sock.ev)

        // setup event listeners
        this.setupEventListeners(saveState);
        return this;
    }

    /**
     * @param {function} saveCreds
     */
    setupEventListeners(saveState: any) {
        // connect whatsapp
        this.sock?.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                this.isConnected = true;
                this.msgQueue.start();
                logger.info('Baileys is connected!');

                if (this.sock?.user?.phoneNumber)
                    config.bot.whatsappNumber = this.sock?.user?.phoneNumber?.split('@')[0].split(':')[0];

                return console.log('\x1b[32m%s\x1b[0m', 'Baileys is connected!');
            }

            if (connection === 'close') {
                this.isConnected = false;
                this.msgQueue.pause();

                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
                logger.error('connection closed', {
                    error: (lastDisconnect?.error as Boom).message,
                    shouldReconnect,
                    statusCode: (lastDisconnect?.error as Boom).output?.statusCode
                });
                console.log('connection closed due to: ', (lastDisconnect?.error as Boom).message,
                    '\nreconnecting ', shouldReconnect,
                    '\nstatus code: ', (lastDisconnect?.error as Boom).output?.statusCode)

                // reconnect if not logged out
                if ((lastDisconnect?.error as Boom).output?.statusCode === DisconnectReason.timedOut
                    || (lastDisconnect?.error as Boom).output?.statusCode === DisconnectReason.connectionClosed) {
                    console.log('reconnecting in a second...')
                    Tools.sleep(1000).then(() => {
                        this.sock?.logout()
                        this.initialize()
                    })
                }
                else if (shouldReconnect) {
                    const sec = 10;
                    console.log(`refreshing connection in ${sec} seconds...`)
                    Tools.sleep(1000 * sec).then(() => {
                        console.log('refreshing connection...')
                        this.initialize()
                    })
                }
                return;
            }

            console.log('\x1b[33m%s\x1b[0m', 'connecting');

            if (update.qr) {
                logger.info('QR code received, please scan it with your WhatsApp app');
                this.qr = update.qr;

                if (!config.PRODUCTION)
                    QRCode.toString(this.qr, { type: 'utf8' }, function (err, str) {
                        console.log(str)
                    })
            }
        });

        // save credentials
        this.sock?.ev.on('creds.update', saveState)

        // handle messages
        this.sock?.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type === 'notify') {
                this.handleNewMessages(messages);
            }
            else if (type === 'append') {
                console.log("append", messages.length, " unread messages");
                this.handleNewMessages(messages, true);
            }
        })
    }

    handleNewMessages(messages: WAMessage[], isAppend = false) {
        for (const msg of messages) {
            try {
                // Skip invalid messages
                if (!msg.message) continue;
                if (msg.key.remoteJid === 'status@broadcast') continue;
                if (msg.key.remoteJid?.includes("call")) continue;
                if (isAppend && msg.key.fromMe) continue;

                // handle edited messages
                let proType = msg.message?.protocolMessage?.type;
                if (proType == proto.Message.ProtocolMessage.Type.REVOKE ||
                    proType == proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) {
                    this.handlerQueue.add(async () => {
                        await handleEditedMessage(msg);
                    });
                    continue;
                }

                // ignore messages with protocol message
                if (msg.message?.protocolMessage) continue;

                // Log message in debug mode only
                if (!config.PRODUCTION) {
                    console.log('Processing message:', msg.key.remoteJid, "/", msg.key.remoteJidAlt);
                }

                // Handle message based on environment
                const shouldHandle = !config.PRODUCTION
                    ? Tools.phoneToWhatsApp(config.whatsapp.debug) === msg.key.remoteJid
                    || Tools.phoneToWhatsApp(config.whatsapp.debug) === msg.key.remoteJidAlt
                    : true;

                if (shouldHandle) {
                    this.handlerQueue.add(async () => {
                        try {
                            await handleMessage(msg);
                        } catch (error) {
                            logger.error('Error handling message:', error);
                            if (!config.PRODUCTION) {
                                console.error('Error handling message:', error);
                            }
                        }
                    });
                }
            } catch (error) {
                logger.error('Error processing message:', error);
                if (!config.PRODUCTION) {
                    console.error('Error processing message:', error);
                }
            }
        }
    }

    // get instance of WhatsAppClient
    static getInstance() {
        if (!WhatsAppClient.instance) {
            WhatsAppClient.instance = new WhatsAppClient();
        }
        return WhatsAppClient.instance;
    }

    sendMsg(jid: string, content: AnyMessageContent, options: MiscMessageGenerationOptions = {}) {
        return this.msgQueue.add(async () => await this.sock?.sendMessage(jid, content, options));
    }

    async sendEpisode(jid: string, episode: TanachYomiEpisode) {
        const filePath = await Downloader.download(episode);
        await this.sendMsg(jid, { audio: { url: filePath }, mimetype: 'audio/mpeg' });
        return this.sendMsg(jid, { text: episode.name });
    }

    /**
     * send message to all debug users
     */
    async sendMsgToDebugUsers(jids: string[], content: AnyMessageContent, options: MiscMessageGenerationOptions = {}) {
        const promises = jids.map(jid =>
            this.msgQueue.add(async () => await this.sock?.sendMessage(jid, content, options))
        );
        await Promise.all(promises);
    }

    /**
     * get QR code
     */
    getQR(): string {
        return this.qr;
    }

    /**
     * get connection status
     */
    getConnectionStatus(): boolean {
        return this.isConnected;
    }

    getGroupMetadata(jid: string) {
        if (!this.sock) return null;
        if (!jid.endsWith('@g.us')) return null; // only for groups
        return this.sock?.groupMetadata(jid);
    }
}

export default WhatsAppClient;



