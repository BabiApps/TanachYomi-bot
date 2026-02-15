import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';

// Ensure logs directory exists (use absolute path from config)
try {
    if (!fs.existsSync(config.paths.logs)) {
        fs.mkdirSync(config.paths.logs, { recursive: true });
    }
} catch (e) {
    // ignore
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'TanachYomi' },
    transports: [
        new winston.transports.File({
            filename: path.join(config.paths.logs, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: path.join(config.paths.logs, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: path.join(config.paths.logs, 'debug.log'),
            level: 'debug', 
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        })
    ]
});

// אם אנחנו לא בסביבת ייצור, נוסיף גם לוגים לקונסול
if (!config.PRODUCTION) {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

export default logger; 