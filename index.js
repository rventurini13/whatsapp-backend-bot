const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');

process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let qrCodeBase64 = null;
let isReady = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './sessions' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  }
});

client.on('qr', async (qr) => {
  qrCodeBase64 = await qrcode.toDataURL(qr);
  isReady = false;
  console.log('Escaneie o QR Code para conectar ao WhatsApp');
});

client.on('ready', () => {
  isReady = true;
  console.log('WhatsApp conectado!');
});

client.initialize();

app.get('/qr', (req, res) => {
  if (qrCodeBase64) {
    res.json({ qr: qrCodeBase64 });
  } else {
    res.status(404).json({ error: 'QR Code ainda não gerado' });
  }
});

app.get('/status', (req, res) => {
  res.json({ connected: isReady });
});

app.post('/send-message', async (req, res) => {
  const { to, message } = req.body;

  if (!isReady) {
    return res.status(400).json({ error: 'WhatsApp ainda não conectado.' });
  }

  if (!to || !message) {
    return res.status(400).json({ error: 'Parâmetros "to" e "message" são obrigatórios.' });
  }

  try {
    await client.sendMessage(to, message);
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagem.' });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
