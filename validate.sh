#!/bin/bash
set -e

echo "🔍 Validando sintaxis..."
node -c index.js 2>&1 | head -5 && echo "✅ index.js OK" || echo "❌ index.js ERROR"
node -c handlers/supervisor.js 2>&1 | head -5 && echo "✅ supervisor.js OK" || echo "❌ supervisor.js ERROR"

echo ""
echo "🚀 Reiniciando bot..."
pm2 restart bitacora-bot --silent

echo ""
echo "⏳ Esperando 3 segundos..."
sleep 3

echo ""
echo "📋 Últimas líneas de error.log:"
tail -20 /home/pc-ubuntu/.pm2/logs/bitacora-bot-error.log 2>/dev/null || echo "Sin errores"

echo ""
echo "📋 Últimas líneas de out.log:"
tail -20 /home/pc-ubuntu/.pm2/logs/bitacora-bot-out.log 2>/dev/null || echo "Sin output"
