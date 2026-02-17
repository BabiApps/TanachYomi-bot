import WhatsAppClient from './baileys.js';
import logger from './logger.js';
import { config } from './config.js';
import { WAMessage } from '@adiwajshing/baileys';
import Tools from './tools.js';
import TanachYomiProcess, { TanachYomiEpisode } from './TanachYomiProcess.js';

const OpenedDialogs: Map<string, { codename: string, data: { [key: string]: any } }> = new Map(); // jid -> dialog data

export default async function handleMessage(msg: WAMessage) {
    const jid = msg.key.remoteJid || "";
    const jidAlt = msg.key.remoteJidAlt || "";

    const textMsg = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").trim();

    console.log("new msg", msg);
    logger.info(`WhatsApp message from ${jid}: ${textMsg}`);

    // get whatsapp instance
    const whatsapp = WhatsAppClient.getInstance();

    // test ping
    if (textMsg.includes("!ping") || textMsg.includes("!פינג")) {
        return await whatsapp.sendMsg(jid, { text: "pong" });
    }

    if (config.PRODUCTION) {
        await Tools.sleepRandom(1000, 2000); // 1-2 seconds
        await whatsapp.sock?.readMessages([msg.key])
        await Tools.sleepRandom(1500, 4000); // 1.5-4 seconds
    }

    // continue existing dialog
    if (OpenedDialogs.has(jid)) return handleOpenedDialog(jid, textMsg);


    // ADMIN COMMANDS
    // normalize debug users to whatsapp jids and check membership properly
    const debugJid = Tools.phoneToWhatsApp(config.whatsapp.debug);
    const IS_ADMIN =
        debugJid === jid || debugJid === jidAlt ||
        debugJid === msg.key.participant || debugJid === msg.key.participantAlt ||
        TanachYomiProcess.getInstance().isAdmin(jid) ||
        TanachYomiProcess.getInstance().isAdmin(jidAlt) ||
        TanachYomiProcess.getInstance().isAdmin(msg.key.participant) ||
        TanachYomiProcess.getInstance().isAdmin(msg.key.participantAlt);

    // stop/start the daily episode sending
    if (textMsg.startsWith("!עצור") || textMsg.startsWith("!stop")) {
        if (!IS_ADMIN) {
            return await whatsapp.sendMsg(jid, { text: "רק מנהלים יכולים להשתמש בפקודה זו." });
        }

        TanachYomiProcess.getInstance().stop();
        return await whatsapp.sendMsg(jid, { text: "שליחת הפרק היומי נעצרה. על מנת להפעיל מחדש יש לשלוח את הפקודה !הפעל." });
    }

    if (textMsg.startsWith("!הפעל") || textMsg.startsWith("!start")) {
        if (!IS_ADMIN) {
            return await whatsapp.sendMsg(jid, { text: "רק מנהלים יכולים להשתמש בפקודה זו." });
        }

        if (TanachYomiProcess.getInstance().intervalId) {
            return await whatsapp.sendMsg(jid, { text: "שליחת הפרק היומי כבר פועלת." });
        }

        TanachYomiProcess.getInstance().start();
        return await whatsapp.sendMsg(jid, { text: "שליחת הפרק היומי הופעלה בהצלחה!" });
    }

    // add another admin
    if (textMsg.startsWith("!הוסף-מנהל") || textMsg.startsWith("!add-admin")) {
        if (!IS_ADMIN) {
            return await whatsapp.sendMsg(jid, { text: "רק מנהלים יכולים להשתמש בפקודה זו." });
        }

        const parts = textMsg.split(" ");
        if (parts.length < 3) {
            return await whatsapp.sendMsg(jid, { text: "יש לשלוח את הפקודה בצורה: !הוסף-מנהל 0501234567 שם_המנהל" });
        }

        const phoneNumber = Tools.extractPhoneNumber(parts[1]);
        if (!phoneNumber) {
            return await whatsapp.sendMsg(jid, { text: "מספר טלפון לא חוקי. יש לשלוח את הפקודה בצורה: !הוסף-מנהל 0501234567 שם_המנהל" });
        }

        const isAdded = TanachYomiProcess.getInstance().addAdmin(parts[2], phoneNumber);
        if (isAdded) {
            return await whatsapp.sendMsg(jid, { text: `המנהל נוסף בהצלחה: ${phoneNumber}` });
        } else {
            return await whatsapp.sendMsg(jid, { text: `המנהל כבר קיים במערכת: ${phoneNumber}` });
        }
    }

    // remove admin
    if (textMsg.startsWith("!הסר-מנהל") || textMsg.startsWith("!remove-admin")) {
        if (!IS_ADMIN) {
            return await whatsapp.sendMsg(jid, { text: "רק מנהלים יכולים להשתמש בפקודה זו." });
        }

        const parts = textMsg.split(" ");
        if (parts.length < 2) {
            return await whatsapp.sendMsg(jid, { text: "יש לשלוח את הפקודה בצורה: !הסר-מנהל 0501234567" });
        }

        const phoneNumber = Tools.extractPhoneNumber(parts[1]);
        if (!phoneNumber) {
            return await whatsapp.sendMsg(jid, { text: "מספר טלפון לא חוקי. יש לשלוח את הפקודה בצורה: !הסר-מנהל 0501234567" });
        }

        const isRemoved = TanachYomiProcess.getInstance().removeAdmin(phoneNumber);
        if (isRemoved) {
            return await whatsapp.sendMsg(jid, { text: `המנהל הוסר בהצלחה: ${phoneNumber}` });
        }
        else {
            return await whatsapp.sendMsg(jid, { text: `המנהל לא נמצא במערכת: ${phoneNumber}` });
        }
    }

    // show admins
    if (textMsg.startsWith("!הצג-מנהלים") || textMsg.startsWith("!show-admins")) {
        if (!IS_ADMIN) {
            return await whatsapp.sendMsg(jid, { text: "רק מנהלים יכולים להשתמש בפקודה זו." });
        }

        const admins = TanachYomiProcess.getInstance().getAdminsList();
        if (admins === "") {
            return await whatsapp.sendMsg(jid, { text: "אין מנהלים במערכת." });
        }

        let replyText = "רשימת מנהלי הבוט:\n" + admins;
        return await whatsapp.sendMsg(jid, { text: replyText });
    }


    // show current chapter (the next to be sent)
    if (textMsg.startsWith("!הצג-יום") || textMsg.startsWith("!next") || textMsg.startsWith("!הבא")) {
        const episode = TanachYomiProcess.getInstance().getCurrentEpisode();
        return await whatsapp.sendMsg(jid, { text: `הפרק הבא שישלח: ${episode.name}` });
    }

    // change chapter progress
    if (textMsg.startsWith("!הגדר-יום") || textMsg.startsWith("!setchapter")) {
        if (!IS_ADMIN) {
            return await whatsapp.sendMsg(jid, { text: "רק מנהלים יכולים להשתמש בפקודה זו." });
        }

        OpenedDialogs.set(jid, { codename: "setSefer", data: {} });
        const episode = TanachYomiProcess.getInstance().getCurrentEpisode();

        return await whatsapp.sendMsg(jid, {
            text: `הפרק הבא שישלח: ${episode.name}\n` + `על מנת לשנות יש לשלוח את שם הספר (לדוגמא בראשית), לביטול שלח "ביטול".`
        });
    }

    if (textMsg.startsWith("!הוסף-יום") || textMsg.startsWith("!add-day")) {
        if (!IS_ADMIN) {
            return await whatsapp.sendMsg(jid, { text: "רק מנהלים יכולים להשתמש בפקודה זו." });
        }

        try {
            const ep = TanachYomiProcess.getInstance().addDay();
            return await whatsapp.sendMsg(jid, { text: `היום נוסף בהצלחה. הפרק הבא שישלח הוא: ${ep.name}` });
        } catch (error) {
            logger.error(`[WaMsgHandler] Failed to add day`, { error });
            return await whatsapp.sendMsg(jid, { text: "אירעה שגיאה בהוספת היום. אנא נסה שוב." });
        }
    }

    if (textMsg.startsWith("!הסר-יום") || textMsg.startsWith("!remove-day")) {
        if (!IS_ADMIN) {
            return await whatsapp.sendMsg(jid, { text: "רק מנהלים יכולים להשתמש בפקודה זו." });
        }

        try {
            const ep = TanachYomiProcess.getInstance().removeDay();
            return await whatsapp.sendMsg(jid, { text: `היום הוסר בהצלחה. הפרק הבא שישלח הוא: ${ep.name}` });
        } catch (error) {
            logger.error(`[WaMsgHandler] Failed to remove day`, { error });
            return await whatsapp.sendMsg(jid, { text: "אירעה שגיאה בהסרת היום. אנא נסה שוב." });
        }
    }

    // add chat to broadcast list
    if (textMsg.startsWith("!הוסף-קבוצה") || textMsg.startsWith("!add-group")) {
        if (!IS_ADMIN) {
            return await whatsapp.sendMsg(jid, { text: "רק מנהלים יכולים להשתמש בפקודה זו." });
        }

        const metadata = await whatsapp.getGroupMetadata(jid);
        const name = metadata?.subject || "Unknown";

        const isAdded = TanachYomiProcess.getInstance().addGroup("tanach_whatsapp", name, jid);

        if (isAdded) {
            return await whatsapp.sendMsg(jid, { text: `הקבוצה נוספה בהצלחה לרשימת השידור של התנ"ך היומי.` });
        } else {
            return await whatsapp.sendMsg(jid, { text: `הקבוצה כבר קיימת ברשימת השידור של התנ"ך היומי.` });
        }
    }

    // remove chat from broadcast list
    if (textMsg.startsWith("!הסר-קבוצה") || textMsg.startsWith("!remove-group")) {
        if (!IS_ADMIN) {
            return await whatsapp.sendMsg(jid, { text: "רק מנהלים יכולים להשתמש בפקודה זו." });
        }

        const isRemoved = TanachYomiProcess.getInstance().removeGroup("tanach_whatsapp", jid);
        if (isRemoved) {
            return await whatsapp.sendMsg(jid, { text: `הקבוצה הוסרה בהצלחה מרשימת השידור של התנ"ך היומי.` });
        } else {
            return await whatsapp.sendMsg(jid, { text: `הקבוצה לא נמצאה ברשימת השידור של התנ"ך היומי.` });
        }
    }

    // USER COMMANDS
    // search episode - supports: !חפש <query>, חפש <query>, !search <query>, or just <sefer name> <chapter number>
    if (textMsg.startsWith("!חפש") || textMsg.startsWith("!search") || textMsg.startsWith("חפש")) {
        const query = textMsg.replace("!חפש", "").replace("!search", "").replace("חפש", "").trim();
        if (query.length === 0) {
            return await whatsapp.sendMsg(jid, { text: "יש לשלוח את הפקודה בצורה: חפש <שם ספר> <מספר פרק>\nלדוגמה: חפש בראשית פרק א" });
        }

        const results = TanachYomiProcess.getInstance().searchEpisodeByText(query);
        if (results.length === 0) {
            return await whatsapp.sendMsg(jid, { text: `לא נמצאו תוצאות עבור החיפוש: ${query}` });
        }

        if (results.length === 1) {
            return await whatsapp.sendEpisode(jid, results[0]);
        }

        if (results.length > 10) {
            return await whatsapp.sendMsg(jid, {
                text: `נמצאו יותר מ-10 תוצאות עבור החיפוש: ${query}\n` +
                    `נסה לחפש במילים מדויקות יותר.`
            });
        }

        let replyText = `נמצאו ${results.length} תוצאות עבור החיפוש: ${query}\n\n`;
        results.forEach((ep, index) => {
            replyText += `${index + 1}. ${ep.name}\n`;
        });
        replyText += `אנא בחר את הפרק הרצוי על ידי שליחת המספר המתאים (1-${results.length}), או שלח "ביטול" לביטול.`;

        OpenedDialogs.set(jid, { codename: "searchEpisode", data: { results } });

        return await whatsapp.sendMsg(jid, { text: replyText });
    }

    // info about the bot
    if (textMsg.startsWith("!אודות") || textMsg.startsWith("!about")) {
        let str = config.getWelcomeMessage('whatsapp');
        return await whatsapp.sendMsg(jid, { text: str });
    }


    // all commands
    if (textMsg.startsWith("!עזרה") || textMsg.startsWith("עזרה") ||
        textMsg.startsWith("!help") || textMsg.startsWith("help") ||
        textMsg.startsWith("!פקודות") || textMsg.startsWith("פקודות")) {
        let helpText = "פקודות זמינות:\n\n";

        helpText += "!עזרה - הצגת הפקודות הזמינות\n";
        helpText += "!אודות - מידע על הבוט והתנ\"ך היומי\n";
        helpText += "!הצג-יום - הצגת הפרק הבא שישלח\n";
        helpText += "!חפש <מילת חיפוש> - חיפוש פרק לפי שם הספר או מספר הפרק\n";

        if (IS_ADMIN) {
            helpText += "\nפקודות מנהל:\n";
            helpText += "!הוסף-מנהל <מספר טלפון> <שם> - הוספת מנהל חדש\n";
            helpText += "!הסר-מנהל <מספר טלפון> - הסרת מנהל\n";
            helpText += "!הצג-מנהלים - הצגת רשימת המנהלים\n";
            helpText += "!הגדר-יום - שינוי הפרק הבא שישלח\n";
            helpText += "!הוסף-יום - הוספת יום לפרק הבא שישלח\n";
            helpText += "!הסר-יום - הסרת יום מהפרק הבא שישלח\n";
            helpText += "!הוסף-קבוצה - הוספת הקבוצה לרשימת השידור של התנ\"ך היומי\n";
            helpText += "!הסר-קבוצה - הסרת הקבוצה מרשימת השידור של התנ\"ך היומי\n";
            helpText += "!עצור - עצירת שליחת הפרק היומי\n";
            helpText += "!הפעל - הפעלת שליחת הפרק היומי\n";
        }

        return await whatsapp.sendMsg(jid, { text: helpText });
    }

    // default: if has text, try to search for episode and send if exactly one result found
    if (textMsg.length > 0) {
        const results = TanachYomiProcess.getInstance().searchEpisodeByText(textMsg);
        if (results.length === 1) {
            return await whatsapp.sendEpisode(jid, results[0]);
        }
    }
}

async function handleOpenedDialog(jid: string, textMsg: string) {
    const dialog = OpenedDialogs.get(jid);
    if (!dialog) return;

    const codename = dialog.codename;
    const data = dialog.data;

    switch (codename) {
        case "setSefer": {
            if (textMsg === "ביטול" || textMsg === "בטל") {
                OpenedDialogs.delete(jid);
                return await WhatsAppClient.getInstance().sendMsg(jid, { text: "הגדרת הפרק בוטלה." });
            }

            const AllEpisodes = TanachYomiProcess.getInstance().BIBLE[textMsg];
            if (!AllEpisodes) {
                return await WhatsAppClient.getInstance().sendMsg(jid, { text: `הספר "${textMsg}" לא נמצא בתנ"ך היומי. אנא נסה שוב או שלח "ביטול" לביטול.` });
            }

            const episodeCount = Object.keys(AllEpisodes).length;
            let replyText = `נמצאו ${episodeCount} פרקים בספר ${textMsg}:\n\n`;
            Object.entries(AllEpisodes).forEach(([key, ep]) => {
                replyText += `${key}. ${ep.name}\n`;
            });
            replyText += `אנא בחר את הפרק הרצוי על ידי שליחת המספר המתאים (1-${episodeCount}), או שלח "ביטול" לביטול.`;

            OpenedDialogs.set(jid, {
                codename: "setChapter",
                data: {
                    episodes: AllEpisodes,
                    sefer: textMsg
                }
            });

            return await WhatsAppClient.getInstance().sendMsg(jid, { text: replyText });
        }

        case "setChapter": {
            if (textMsg === "ביטול" || textMsg === "בטל") {
                OpenedDialogs.delete(jid);
                return await WhatsAppClient.getInstance().sendMsg(jid, { text: "הגדרת הפרק בוטלה." });
            }

            const choice = parseInt(textMsg);
            const episodes = data.episodes as { [key: string]: TanachYomiEpisode };
            const sefer = data.sefer as string;

            const whatsapp = WhatsAppClient.getInstance();
            // Convert choice to string key to match dictionary
            const choiceKey = choice.toString();

            if (isNaN(choice) || !(choiceKey in episodes)) {
                return await whatsapp.sendMsg(jid, { text: `בחירה לא חוקית. אנא שלח מספר בין 1 ל-${Object.keys(episodes).length}, או שלח "ביטול" לביטול.` });
            }

            const ep = TanachYomiProcess.getInstance().setCurrentEpisode(sefer, choice);
            if (!ep) {
                return await whatsapp.sendMsg(jid, { text: `אירעה שגיאה בהגדרת הפרק. אנא נסה שוב.` });
            }

            OpenedDialogs.delete(jid);
            return await whatsapp.sendMsg(jid, { text: `הפרק הבא שישלח הוגדר בהצלחה ל: ${ep.name}` });
        }

        case "searchEpisode": {
            if (textMsg === "ביטול" || textMsg === "בטל") {
                OpenedDialogs.delete(jid);
                const whatsapp = WhatsAppClient.getInstance();
                return await whatsapp.sendMsg(jid, { text: "חיפוש הפרק בוטל." });
            }

            const choice = parseInt(textMsg);
            const results = data.results as TanachYomiEpisode[];

            const whatsapp = WhatsAppClient.getInstance();

            if (isNaN(choice) || choice < 1 || choice > results.length) {
                return await whatsapp.sendMsg(jid, { text: `בחירה לא חוקית. אנא שלח מספר בין 1 ל-${results.length}, או שלח "ביטול" לביטול.` });
            }

            const ep = results[choice - 1];
            OpenedDialogs.delete(jid);

            return await whatsapp.sendEpisode(jid, ep);
        }

        default:
            logger.warn(`Unknown dialog codename: ${codename}`);
            OpenedDialogs.delete(jid);
            return;
    }

}


export async function handleEditedMessage(msg: WAMessage) {
    const jid = msg.key.remoteJid || "";
    const textMsg = msg.message?.protocolMessage?.editedMessage?.conversation || "";

    logger.info(`WhatsApp edited message from ${jid}: ${textMsg}`);
}