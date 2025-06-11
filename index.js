const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');      // << add
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let qrCodeBase64 = null;
let isReady = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './sessions' }),
  puppeteer      // << passa o pacote puppeteer completo
});

client.on('qr', async (qr) => {
  qrCodeBase64 = await qrcode.toDataURL(qr);
  isReady = false;
  console.log('QR Code gerado. Escaneie para conectar');
});

client.on('ready', () => {
  isReady = true;
  console.log('WhatsApp conectado');
});

client.initialize();

app.get('/qr', (req, res) => {
  if (qrCodeBase64) return res.json({ qr: qrCodeBase64 });
  res.status(404).json({ error: 'QR Code indisponível' });
});

app.get('/status', (req, res) => {
  res.json({ connected: isReady });
});

app.post('/send-message', async (req, res) => {
  const { to, message } = req.body;
  if (!isReady) return res.status(400).json({ error: 'Não conectado' });
  if (!to || !message) return res.status(400).json({ error: '"to" e "message" são obrigatórios' });

  try {
    await client.sendMessage(to, message);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha ao enviar' });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando em porta ${port}`);
});
