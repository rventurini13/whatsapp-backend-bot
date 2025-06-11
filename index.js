const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Armazenar múltiplas instâncias de clientes WhatsApp
const clients = new Map();
const qrCodes = new Map();
const clientStatus = new Map();

// Função melhorada para encontrar o Chromium no Nixpacks
function findChromiumPath() {
  const fs = require('fs');
  const { execSync } = require('child_process');
  
  const paths = [
    process.env.CHROMIUM_PATH,
    process.env.CHROME_PATH
  ];
  
  for (const path of paths) {
    if (path) {
      try {
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

// Criar cliente WhatsApp para um usuário específico
function createWhatsAppClient(userId) {
  if (clients.has(userId)) {
    console.log(`Cliente já existe para usuário: ${userId}`);
    return clients.get(userId);
  }

  console.log(`Criando novo cliente para usuário: ${userId}`);
  
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
    authStrategy: new LocalAuth({ 
      dataPath: `./sessions/${userId}`,
      clientId: userId
    })
  });

  // Event listeners específicos para este usuário
  client.on('qr', async (qr) => {
    try {
      const qrCodeBase64 = await qrcode.toDataURL(qr);
      qrCodes.set(userId, qrCodeBase64);
      clientStatus.set(userId, 'waiting_qr');
      console.log(`QR gerado para usuário: ${userId}`);
    } catch (error) {
      console.error(`Erro ao gerar QR para usuário ${userId}:`, error);
    }
  });

  client.on('ready', () => {
    clientStatus.set(userId, 'connected');
    qrCodes.delete(userId); // Remove QR code quando conectado
    console.log(`WhatsApp conectado para usuário: ${userId}`);
  });

  client.on('auth_failure', (msg) => {
    clientStatus.set(userId, 'auth_failure');
    console.error(`Falha na autenticação para usuário ${userId}:`, msg);
  });

  client.on('disconnected', (reason) => {
    clientStatus.set(userId, 'disconnected');
    console.log(`Cliente desconectado para usuário ${userId}:`, reason);
  });

  client.on('error', (error) => {
    clientStatus.set(userId, 'error');
    console.error(`Erro no cliente para usuário ${userId}:`, error);
  });

  // Armazenar cliente
  clients.set(userId, client);
  clientStatus.set(userId, 'initializing');

  // Inicializar cliente
  client.initialize().catch(error => {
    console.error(`Erro ao inicializar cliente para usuário ${userId}:`, error);
    clientStatus.set(userId, 'error');
  });

  return client;
}

// Middleware para validar userId
function validateUserId(req, res, next) {
  const userId = req.params.userId || req.body.userId;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório' });
  }
  
  req.userId = userId;
  next();
}

// Endpoint para inicializar cliente de um usuário
app.post('/initialize/:userId', validateUserId, (req, res) => {
  try {
    createWhatsAppClient(req.userId);
    res.json({ 
      success: true, 
      message: `Cliente inicializado para usuário: ${req.userId}`,
      status: clientStatus.get(req.userId) || 'initializing'
    });
  } catch (error) {
    console.error(`Erro ao inicializar para usuário ${req.userId}:`, error);
    res.status(500).json({ error: 'Erro ao inicializar cliente' });
  }
});

// Endpoint para obter QR Code de um usuário específico
app.get('/qr/:userId', validateUserId, (req, res) => {
  const qrCodeBase64 = qrCodes.get(req.userId);
  
  if (qrCodeBase64) {
    return res.json({ qr: qrCodeBase64 });
  }
  
  const status = clientStatus.get(req.userId);
  if (status === 'connected') {
    return res.status(200).json({ message: 'Já conectado', connected: true });
  }
  
  res.status(404).json({ error: 'QR não disponível', status: status || 'not_initialized' });
});

// Endpoint para página visual do QR Code
app.get('/qr-page/:userId', validateUserId, (req, res) => {
  const qrCodeBase64 = qrCodes.get(req.userId);
  const status = clientStatus.get(req.userId);
  
  if (!qrCodeBase64 && status !== 'connected') {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp QR Code - Usuário ${req.userId}</title>
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
          <h1>Inicializando WhatsApp...</h1>
          <p>Status: ${status || 'Não inicializado'}</p>
          <p>Aguarde alguns segundos e atualize a página.</p>
          <button onclick="location.reload()">Atualizar Página</button>
          <br><br>
          <button onclick="initializeBot()">Inicializar Bot</button>
        </div>
        <script>
          async function initializeBot() {
            try {
              const response = await fetch('/initialize/${req.userId}', { method: 'POST' });
              const data = await response.json();
              alert(data.message);
              setTimeout(() => location.reload(), 2000);
            } catch (error) {
              alert('Erro ao inicializar bot');
            }
          }
        </script>
      </body>
      </html>
    `);
  }

  if (status === 'connected') {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp Conectado - Usuário ${req.userId}</title>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
          .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; }
          h1 { color: #25D366; }
          .success { color: #25D366; font-size: 1.2em; margin: 20px 0; }
          button { background: #dc3545; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 10px; }
          button:hover { background: #c82333; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>WhatsApp Conectado!</h1>
          <div class="success">✅ Seu WhatsApp está conectado e pronto para uso!</div>
          <p>Usuário: ${req.userId}</p>
          <button onclick="disconnectBot()">Desconectar WhatsApp</button>
        </div>
        <script>
          async function disconnectBot() {
            if (confirm('Tem certeza que deseja desconectar o WhatsApp?')) {
              try {
                const response = await fetch('/disconnect/${req.userId}', { method: 'POST' });
                const data = await response.json();
                alert(data.message);
                location.reload();
              } catch (error) {
                alert('Erro ao desconectar');
              }
            }
          }
        </script>
      </body>
      </html>
    `);
  }
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>WhatsApp QR Code - Usuário ${req.userId}</title>
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
        .user-info { background: #f8f9fa; padding: 10px; border-radius: 5px; margin-bottom: 20px; font-size: 0.9em; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="user-info">Conectando WhatsApp para: ${req.userId}</div>
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
            const response = await fetch('/status/${req.userId}');
            const data = await response.json();
            const statusDiv = document.getElementById('statusResult');
            
            if (data.connected) {
              statusDiv.innerHTML = '<p style="color: #25D366; font-weight: bold;">WhatsApp Conectado!</p>';
              setTimeout(() => location.reload(), 2000);
            } else {
              statusDiv.innerHTML = '<p style="color: #ff6b6b; font-weight: bold;">Ainda não conectado</p>';
            }
          } catch (error) {
            document.getElementById('statusResult').innerHTML = '<p style="color: #ff6b6b;">Erro ao verificar status</p>';
          }
        }
        
        setInterval(checkStatus, 5000);
        checkStatus();
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// Endpoint para verificar status de um usuário específico
app.get('/status/:userId', validateUserId, (req, res) => {
  const client = clients.get(req.userId);
  const status = clientStatus.get(req.userId);
  
  if (!client) {
    return res.json({ 
      connected: false, 
      status: 'not_initialized',
      message: 'Cliente não inicializado'
    });
  }
  
  const isConnected = status === 'connected';
  res.json({ 
    connected: isConnected,
    status: status || 'unknown',
    userId: req.userId
  });
});

// Endpoint para enviar mensagem de um usuário específico
app.post('/send-message/:userId', validateUserId, async (req, res) => {
  const { to, message } = req.body;
  const client = clients.get(req.userId);
  const status = clientStatus.get(req.userId);
  
  if (!client) {
    return res.status(400).json({ error: 'Cliente não inicializado para este usuário' });
  }
  
  if (status !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp não está conectado para este usuário' });
  }
  
  if (!to || !message) {
    return res.status(400).json({ error: '"to" e "message" são obrigatórios' });
  }
  
  try {
    await client.sendMessage(to, message);
    res.json({ 
      success: true,
      userId: req.userId,
      sentTo: to,
      message: message
    });
  } catch (err) {
    console.error(`Erro ao enviar mensagem para usuário ${req.userId}:`, err);
    res.status(500).json({ error: 'Falha ao enviar mensagem' });
  }
});

// Endpoint para desconectar usuário específico
app.post('/disconnect/:userId', validateUserId, async (req, res) => {
  const client = clients.get(req.userId);
  
  if (!client) {
    return res.status(400).json({ error: 'Cliente não encontrado para este usuário' });
  }
  
  try {
    await client.logout();
    await client.destroy();
    
    // Limpar dados do usuário
    clients.delete(req.userId);
    qrCodes.delete(req.userId);
    clientStatus.delete(req.userId);
    
    // Remover pasta de sessão
    const sessionPath = `./sessions/${req.userId}`;
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    
    console.log(`Usuario ${req.userId} desconectado e sessão removida`);
    res.json({ 
      success: true, 
      message: 'WhatsApp desconectado com sucesso',
      userId: req.userId
    });
  } catch (error) {
    console.error(`Erro ao desconectar usuário ${req.userId}:`, error);
    res.status(500).json({ error: 'Erro ao desconectar WhatsApp' });
  }
});

// Endpoint para listar todos os usuários conectados (admin)
app.get('/admin/users', (req, res) => {
  const users = [];
  
  for (const [userId, status] of clientStatus.entries()) {
    users.push({
      userId,
      status,
      hasQR: qrCodes.has(userId),
      hasClient: clients.has(userId)
    });
  }
  
  res.json({ users });
});

// Criar diretório de sessões se não existir
const sessionsDir = './sessions';
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

console.log('Servidor WhatsApp Multi-usuário iniciado');
console.log('Endpoints disponíveis:');
console.log('- POST /initialize/:userId - Inicializar cliente');
console.log('- GET /qr/:userId - Obter QR Code');
console.log('- GET /qr-page/:userId - Página do QR Code');
console.log('- GET /status/:userId - Status do cliente');
console.log('- POST /send-message/:userId - Enviar mensagem');
console.log('- POST /disconnect/:userId - Desconectar cliente');

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
