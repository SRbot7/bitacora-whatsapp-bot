#!/bin/bash

echo "Reiniciando bot..."

pm2 restart bitacora-bot

sleep 5

pm2 status

echo ""
echo "Bot reiniciado"
