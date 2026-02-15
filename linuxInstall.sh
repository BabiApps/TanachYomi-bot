#!/bin/bash

# Tanach Yomi Bot - Linux Installation Script
# This script automates setup on Ubuntu/Debian systems

set -e

echo "=========================================="
echo "Tanach Yomi Bot - Linux Setup"
echo "=========================================="
echo ""

# Update system packages
echo "📦 Updating system packages..."
sudo apt update
sudo apt upgrade -y

# Install dependencies
echo "📦 Installing dependencies..."
sudo apt install -y curl build-essential python3

# Install Node.js (latest LTS)
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally for process management
echo "📦 Installing PM2..."
npm install -g pm2

# Install cloudflared
echo "📦 Installing cloudFlared..."
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Clone or setup bot
echo ""
echo "🤖 Setting up Tanach Yomi Bot..."

# Install project dependencies
if [ -f "package.json" ]; then
    echo "📦 Installing bot dependencies..."
    npm install
    npm run build
else
    echo "⚠️  package.json not found. Please clone the repository first."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo ""
    echo "⚙️  Creating .env file..."
    cp .env.example .env 2>/dev/null || echo "TELEGRAM_BOT_TOKEN=your_token_here" > .env
    echo "⚠️  Edit .env and add your Telegram bot token"
fi

# Setup PM2
echo ""
echo "🚀 Setting up PM2..."
pm2 start index.js --name "tanach-yomi"
pm2 startup
pm2 save

echo ""
echo "=========================================="
echo "✅ Installation complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Edit .env file with your Telegram bot token"
echo "2. Update config.js with admin IDs and groups"
echo "3. View logs: pm2 logs tanach-yomi"
echo "4. Manage bot: pm2 monit"
echo ""
echo "For WhatsApp: bot will show QR code on first run"
echo "=========================================="
