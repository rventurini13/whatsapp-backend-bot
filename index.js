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

// Função melhorada para encontrar o Chromium no Nixpacks
function findChromiumPath() {
  const fs = require('fs');
  const { execSync } = require('child_process');
  
  const paths = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_PATH
  ];
  
  // Primeiro tenta os caminhos das variáveis de ambiente
  for (const path of paths) {
    if (path) {
      try {
        // Se tem wildcard, expande o caminho
        if (path.includes('*')) {
          const expandedPath = execSync(`ls ${path} 2>/dev/null | head -1`, { encoding: 'utf8' }).trim();
          if (expandedPath && fs.existsSync(expandedPath)) {
            console.log(`Chromium encontrado via wildcard: ${expandedPath}`);
            return expandedPath;
          }
        } else if (fs.existsSync(path)) {
          console.log(`Chromium encontrado: ${path}`);
          return path;
        }
      } catch (error) {
        console.log(`Erro ao verificar path ${path}:`, error.message);
      }
    }
  }
  
  // Se não encontrou, tenta buscar automaticamente no Nix store
  try {
    const nixStorePath = execSync('find /nix/store -name chromium -type f -executable 2>/dev/null | head -1', { encoding: 'utf8' }).trim();
    if (nixStorePath && fs.existsSync(nixStorePath)) {
      console.log(`Chromium encontrado no Nix store: ${nixStorePath}`);
      return nixStorePath;
    }
  } catch (error) {
    console.log('Não foi possível buscar no Nix store:', error.message);
  }
  
  console.log('Chromium não encontrado, deixando Puppeteer detectar automaticamente');
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
      '--disable-features=VizDisplayCompositor',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
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
