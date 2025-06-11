const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let qrCodeBase64 = null;
let isReady = false;

const client = new Client({
  puppeteer: {
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
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
  },
  authStrategy: new LocalAuth({ dataPath: './sessions' })
});

client.on('qr', async (qr) => {
  qrCodeBase64 = await qrcode.toDataURL(qr);
  isReady = false;
  console.log('QR gerado – escaneie para conectar');
});

client.on('ready', () => {
  isReady = true;
  console.log('WhatsApp conectado');
});

client.initialize();

app.get('/qr', (req, res) => {
  if (qrCodeBase64) return res.json({ qr: qrCodeBase64 });
  res.status(404).json({ error: 'QR não disponível' });
});

app.get('/status', (req, res) => {
  res.json({ connected: isReady });
});

app.post('/send-message', async (req, res) => {
  const { to, message } = req.body;
  if (!isReady) return res.status(400).json({ error: 'não conectado' });
  if (!to || !message) return res.status(400).json({ error: '"to" e "message" obrigatórios' });

  try {
    await client.sendMessage(to, message);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'falha ao enviar mensagem' });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
