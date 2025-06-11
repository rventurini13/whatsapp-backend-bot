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

app.get('/qr-page', (req, res) => {
  if (!qrCodeBase64) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp QR Code</title>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
          .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; }
          h1 { color: #25D366; }
          button { background: #25D366; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
          button:hover { background: #1ea952; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Aguardando QR Code...</h1>
          <p>O QR Code ainda não foi gerado. Aguarde alguns segundos e atualize a página.</p>
          <button onclick="location.reload()">Atualizar Página</button>
        </div>
      </body>
      </html>
    `);
  }
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>WhatsApp QR Code</title>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
        .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; }
        .qr-code { border: 3px solid #25D366; border-radius: 10px; padding: 20px; background: white; margin: 20px 0; }
        h1 { color: #25D366; margin-bottom: 20px; }
        .instructions { background: #e8f5e8; padding: 20px; border-radius: 8px; margin-top: 20px; }
        .status { margin-top: 20px; }
        button { background: #25D366; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 10px; }
        button:hover { background: #1ea952; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>WhatsApp QR Code</h1>
        <p>Escaneie o QR Code abaixo com seu WhatsApp:</p>
        
        <div class="qr-code">
          <img src="${qrCodeBase64}" alt="QR Code WhatsApp" style="max-width: 100%; height: auto;"/>
        </div>
        
        <div class="instructions">
          <h3>Como conectar:</h3>
          <p>1. Abra o WhatsApp no seu celular</p>
          <p>2. Vá em <strong>Menu</strong> → <strong>Dispositivos conectados</strong></p>
          <p>3. Toque em <strong>Conectar dispositivo</strong></p>
          <p>4. Escaneie o QR Code acima</p>
        </div>
        
        <div class="status">
          <button onclick="checkStatus()">Verificar Status</button>
          <button onclick="location.reload()">Novo QR Code</button>
          <div id="statusResult" style="margin-top: 15px;"></div>
        </div>
      </div>
      
      <script>
        async function checkStatus() {
          try {
            const response = await fetch('/status');
            const data = await response.json();
            const statusDiv = document.getElementById('statusResult');
            
            if (data.connected) {
              statusDiv.innerHTML = '<p style="color: #25D366; font-weight: bold;">WhatsApp Conectado!</p>';
            } else {
              statusDiv.innerHTML = '<p style="color: #ff6b6b; font-weight: bold;">Ainda não conectado</p>';
            }
          } catch (error) {
            document.getElementById('statusResult').innerHTML = '<p style="color: #ff6b6b;">Erro ao verificar status</p>';
          }
        }
        
        // Verificar status automaticamente a cada 5 segundos
        setInterval(checkStatus, 5000);
        checkStatus(); // Verificar imediatamente
      </script>
    </body>
    </html>
  `;
  res.send(html);
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
