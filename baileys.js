const { default: makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const { useMongoDBAuthState } = require('mongo-baileys');
const { MongoClient } = require('mongodb');
const QRCode = require('qrcode');

let latestQR = null;
let sock = null;
let connectionStatus = 'disconnected';
let mongoClient = null;

async function startBaileys(onMessage) {
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    console.log('[SYSTEM] Terhubung ke MongoDB untuk sesi Baileys');
  }

  const collection = mongoClient.db('daengbaco').collection('baileys_sessions');
  const { state, saveCreds } = await useMongoDBAuthState(collection);

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
