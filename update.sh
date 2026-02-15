#!/bin/bash

# Tanach Yomi Bot - Update Script
# מריצים את הסקריפט הזה אחרי כל דחיפת קוד חדש לגיטהאב

set -e

echo "=========================================="
echo "🔄 Updating Tanach Yomi Bot..."
echo "=========================================="
echo ""

echo "📥 Pulling latest code from Git..."
git pull

echo "📦 Installing/Updating dependencies..."
npm ci

echo "🏗️ Compiling TypeScript to JavaScript..."
npm run build

echo "🚀 Restarting the bot with PM2..."
pm2 restart tanach-yomi

echo ""
echo "=========================================="
echo "✅ Update complete! Bot is back online."
echo "=========================================="
echo ""
echo "📋 Showing latest logs (Press Ctrl+C to exit logs view):"
pm2 logs tanach-yomi --lines 15