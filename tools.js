import WhatsAppClient from './baileys.js';

export default class Tools {
    static extractPhoneNumber(text) {
        const phoneMatch = text.match(/(\+972|0)([23489]|5[0123456789])([-\s]?)(\d{7})/);
        if (phoneMatch) {
            return phoneMatch[0];
        }
    }
    /**
     * @param {string} phone
     * @returns {string}
     */
    static formatPhoneNumber(phone) {
        phone = phone.toString().replace(/[^\d]/g, '');
        return phone.startsWith('972') ? phone
            : phone.startsWith('05') ? `972${phone.slice(1)}`
                : `972${phone}`;
    }

    /**
     * @param {string} phone
     * @returns {string} jid format
     */
    static phoneToWhatsApp(phone) {
        return this.formatPhoneNumber(phone) + '@s.whatsapp.net';
    }

    /**
     * @param {string} phone
     * @returns {boolean}
     */
    static isPhoneNumber(phone) {
        return this.formatPhoneNumber(phone).length === 10;
    }

    /**
     * @param {string} phone - without "@s.whatsapp.net" 
     * @returns {Promise<boolean>}
     */
    static async validateOnWhatsApp(phone) {
        const formattedPhone = this.phoneToWhatsApp(phone);
        const whatsapp_instance = WhatsAppClient.getInstance();
        try {
            if (!whatsapp_instance || !whatsapp_instance.sock || typeof whatsapp_instance.sock.onWhatsApp !== 'function') return false;
            const res = await whatsapp_instance.sock.onWhatsApp(formattedPhone);
            return Array.isArray(res) ? !!res[0]?.exists : !!res?.exists;
        } catch (e) {
            return false;
        }
    }

    /**
     * @param {string} letter
     * @param {boolean} isArrayIndex
     * @returns {number}
     */
    static culomnLetterToCulomnNumber(letter, isArrayIndex = false) {
        return isArrayIndex
            ? letter.charCodeAt(0) - 'A'.charCodeAt(0)
            : letter.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
    }

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    static async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * @param {number} min
     * @param {number} max
     * @returns {Promise<number>}
     */
    static async sleepRandom(min, max) {
        return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
    }

    /**
     * https://stackoverflow.com/a/41167909
     * @param {number} n the num to check
     * @param {number} a first num
     * @param {number} b secound num
     * @returns 
     */
    static isBetween(n, a, b) {
        return (n - a) * (n - b) <= 0
    }

    static cleanUrlParameters(url) {
        return url.split('?')[0];
    }

    static getIsraeliDate(date = new Date()) {
        // Use Intl.DateTimeFormat for more reliable timezone conversion
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Jerusalem',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        const parts = formatter.formatToParts(date);
        const partsMap = {};
        parts.forEach(part => {
            partsMap[part.type] = part.value;
        });

        // Construct a date string in UTC and parse it
        const israeliDate = new Date(
            `${partsMap.year}-${partsMap.month}-${partsMap.day}T${partsMap.hour}:${partsMap.minute}:${partsMap.second}Z`
        );

        return israeliDate;
    }

    /**
     * בדוק אם מילים מהמערך כלולות בטקסט
     * @param {string} str - הטקסט לחיפוש
     * @param {string[]} array - מערך של מילים לחפש
     * @returns {number} - הindex של המילה הראשונה שנמצאה, או -1 אם לא נמצאה
     */
    static isWordsInString(str, array) {
        for (let elem of array) {
            if (str.includes(" " + elem + " ")) return str.indexOf(" " + elem + " ");
        }
        return -1;
    }
}
