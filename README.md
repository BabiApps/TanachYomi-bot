# Tanach Yomi Bot

A WhatsApp and Telegram bot that sends the daily Torah chapter to learn, with search functionality and admin controls.

## Features

- **Daily Distribution**: Automatically sends the daily chapter from Tanach at scheduled times
- **Multiple Platforms**: Support for both WhatsApp and Telegram
- **Search Capability**: Find any chapter by name, book, and chapter
- **Smart Selection**: Interactive inline keyboard for choosing from search results
- **Admin Commands**: Manage groups, view logs, and control the bot
- **Audio & Links**: Direct links to audio and streaming services

## Requirements

- Node.js v16+ (TypeScript support)
- npm or yarn
- WhatsApp account (for WhatsApp bot)
- Telegram Bot Token (get from @BotFather on Telegram)

## Quick Start

### 1. Installation

```bash
git clone <repository>
cd TanachYomi-bot
npm install
```

### 2. Configuration

Create a `.env` file (copy from `.env.example`):

```
TELEGRAM_BOT_TOKEN=your_token_here
DEBUG_USER_ID=your_telegram_id
```

Update `config.js` with your settings:
- Admin user IDs
- Default groups
- Bot metadata

### 3. Run the Bot

```bash
npm start
```

For WhatsApp: Scan the QR code with your phone.

For Telegram: The bot will start listening immediately.

## Development

Build TypeScript:
```bash
npm run build
```

This generates JavaScript files in the working directory.

### Download all Tanach episodes

To download missing audio from the SoundCloud URLs in `saved_files/BIBLE_EPISODES.json`, convert it to tagged MP3, and update each episode's `path`:

```bash
npm run download:all
```

The script downloads up to three episodes at a time. To use two concurrent downloads:

```bash
npm run download:all -- --concurrency=2
```

Downloads try MP3 first, then SoundCloud's MP4/AAC format if MP3 is unavailable. Temporary failures are retried up to three times. Audio downloaded in either source format (and previously cached files in another format) is converted locally to MP3 with FFmpeg and tagged with the episode title and artist using ID3.
The bundled FFmpeg binary is GPL-3.0-or-later; review its license before redistributing the application with dependencies.

Only run bulk downloads when you have permission to save the recordings.

## Deployment

For 24/7 operation on a Linux server:

```bash
sudo apt-get update
sudo apt install nodejs npm

# Install pm2 for process management
sudo npm install -g pm2

# Start bot with pm2
pm2 start index.js --name tanach

# Make pm2 start on boot
pm2 startup
pm2 save
```

Or use Docker, Heroku, AWS, etc.

## Troubleshooting

**Bot doesn't start**: Check `.env` file and Telegram token
**Search not working**: Verify `saved_files/BIBLE_EPISODES.json` exists
**WhatsApp not connecting**: Scan QR code, ensure device stays online
**Permission issues**: Check admin IDs in `config.js`

## Contributing

Feel free to submit issues and enhancement requests.

## License

MIT - See LICENSE file for details
