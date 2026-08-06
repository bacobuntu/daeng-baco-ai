const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');

let latestQR = null;
let sock = null;
let connectionStatus = 'disconnected';

async function startBaileys(onMessage) {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
  sock = makeWASocket({ auth: state, printQRInTerminal: false });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      latestQR = await QRCode.toDataURL(qr);
      connectionStatus = 'waiting_scan';
    }
    if (connection === 'open') {
      connectionStatus = 'connected';
      latestQR = null;
      console.log('Baileys terhubung!');
    }
    if (connection === 'close') {
      connectionStatus = 'disconnected';
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startBaileys(onMessage);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const from = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (text) onMessage(from, text, sock);
  });
}

function getQR() { return latestQR; }
function getStatus() { return connectionStatus; }
function getSock() { return sock; }

module.exports = { startBaileys, getQR, getStatus, getSock };
