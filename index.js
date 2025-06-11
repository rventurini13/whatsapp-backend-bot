const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

let qrCodeBase64 = null;
let isReady = false;

// Função para encontrar o Chromium no Nixpacks
function findChromiumPath() {
  const fs = require('fs');
  const paths = [
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome'
  ];
  
  for (const path of paths) {
    if (path && fs.existsSync(path)) {
      console.log(`Executável encontrado em: ${path}`);
      return path;
    }
  }
  
  console.log('Deixando Puppeteer encontrar automaticamente');
  return undefined;
}

const client = new Client({
  puppeteer: {
    executablePath: findChromiumPath(),
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
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
  console.log('WhatsApp conectado com sucesso!');
});

client.on('auth_failure', (msg) => {
  console.error('Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
  console.log('Cliente desconectado:', reason);
  isReady = false;
});

client.on('error', (error) => {
  console.error('Erro no cliente WhatsApp:', error);
});

console.log('Inicializando cliente WhatsApp...');
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
    console.error('Erro ao enviar mensagem:', err);
    res.status(500).json({ error: 'falha ao enviar mensagem' });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
