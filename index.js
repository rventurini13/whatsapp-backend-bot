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

// NOVO: Sistema de conversas ativas
const activeConversations = new Map(); // phoneNumber -> conversationState
const userBotConfigs = new Map(); // userId -> botConfig

// Estados possíveis da conversa
const CONVERSATION_STATES = {
  WAITING_SERVICE: 'waiting_service',
  WAITING_DATE: 'waiting_date', 
  WAITING_TIME: 'waiting_time',
  WAITING_PROFESSIONAL: 'waiting_professional',
  WAITING_CONFIRMATION: 'waiting_confirmation',
  COMPLETED: 'completed'
};

// NOVO: Configuração padrão do bot para cada usuário
const DEFAULT_BOT_CONFIG = {
  welcomeMessage: "Olá! Bem-vindo ao nosso atendimento automatizado. Como posso ajudá-lo?",
  servicesMessage: "Escolha um dos nossos serviços:",
  dateMessage: "Escolha uma data para seu agendamento:",
  timeMessage: "Escolha um horário disponível:",
  professionalMessage: "Escolha um profissional:",
  confirmationMessage: "Confirme seu agendamento:",
  completedMessage: "Agendamento confirmado com sucesso! Obrigado!",
  invalidMessage: "Opção inválida. Por favor, digite apenas o número da opção desejada.",
  backOption: "Digite 0 para voltar ao menu anterior."
};

// NOVO: Dados mock para teste (depois vamos integrar com banco de dados)
const MOCK_SERVICES = {
  'reventurini_hotmail_com': [
    { id: 1, name: 'Corte de Cabelo Masculino', duration: 60, price: 60 },
    { id: 2, name: 'Barba Masculina', duration: 35, price: 40 },
    { id: 3, name: 'Corte + Barba', duration: 90, price: 90 }
  ]
};

const MOCK_PROFESSIONALS = {
  'reventurini_hotmail_com': [
    { id: 1, name: 'João Silva', services: [1, 2, 3] },
    { id: 2, name: 'Pedro Santos', services: [1, 3] }
  ]
};

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

// NOVO: Função para processar mensagens recebidas do WhatsApp
async function processIncomingMessage(userId, phoneNumber, messageText, client) {
  console.log(`[${userId}] Mensagem recebida de ${phoneNumber}: ${messageText}`);
  
  const conversationKey = `${userId}:${phoneNumber}`;
  let conversation = activeConversations.get(conversationKey);
  
  // Se não existe conversa, criar nova
  if (!conversation) {
    conversation = {
      userId: userId,
      phoneNumber: phoneNumber,
      state: CONVERSATION_STATES.WAITING_SERVICE,
      selectedService: null,
      selectedDate: null,
      selectedTime: null,
      selectedProfessional: null,
      startedAt: new Date()
    };
    activeConversations.set(conversationKey, conversation);
  }
  
  // Processar mensagem baseado no estado atual
  let responseMessage = '';
  
  try {
    switch (conversation.state) {
      case CONVERSATION_STATES.WAITING_SERVICE:
        responseMessage = await handleServiceSelection(userId, conversation, messageText);
        break;
        
      case CONVERSATION_STATES.WAITING_DATE:
        responseMessage = await handleDateSelection(userId, conversation, messageText);
        break;
        
      case CONVERSATION_STATES.WAITING_TIME:
        responseMessage = await handleTimeSelection(userId, conversation, messageText);
        break;
        
      case CONVERSATION_STATES.WAITING_PROFESSIONAL:
        responseMessage = await handleProfessionalSelection(userId, conversation, messageText);
        break;
        
      case CONVERSATION_STATES.WAITING_CONFIRMATION:
        responseMessage = await handleConfirmation(userId, conversation, messageText);
        break;
        
      default:
        responseMessage = await handleServiceSelection(userId, conversation, messageText);
        conversation.state = CONVERSATION_STATES.WAITING_SERVICE;
    }
    
    // Atualizar conversa
    activeConversations.set(conversationKey, conversation);
    
    // Enviar resposta
    if (responseMessage) {
      await client.sendMessage(phoneNumber, responseMessage);
      console.log(`[${userId}] Resposta enviada para ${phoneNumber}`);
    }
    
  } catch (error) {
    console.error(`Erro ao processar mensagem de ${phoneNumber}:`, error);
    await client.sendMessage(phoneNumber, "Desculpe, ocorreu um erro. Tente novamente ou entre em contato conosco.");
  }
}

// NOVO: Funções para cada etapa da conversa
async function handleServiceSelection(userId, conversation, messageText) {
  const services = MOCK_SERVICES[userId] || [];
  
  // Se é uma nova conversa, mostrar welcome + serviços
  if (messageText.toLowerCase().includes('oi') || messageText.toLowerCase().includes('olá') || 
      messageText.toLowerCase().includes('bom dia') || messageText.toLowerCase().includes('boa tarde') ||
      conversation.state === CONVERSATION_STATES.WAITING_SERVICE) {
    
    let message = DEFAULT_BOT_CONFIG.welcomeMessage + "\n\n";
    message += DEFAULT_BOT_CONFIG.servicesMessage + "\n\n";
    
    services.forEach((service, index) => {
      message += `${index + 1} - ${service.name} (${service.duration}min - R$ ${service.price})\n`;
    });
    
    message += "\nDigite o número do serviço desejado:";
    
    return message;
  }
  
  // Processar seleção de serviço
  const serviceIndex = parseInt(messageText) - 1;
  
  if (serviceIndex >= 0 && serviceIndex < services.length) {
    conversation.selectedService = services[serviceIndex];
    conversation.state = CONVERSATION_STATES.WAITING_DATE;
    
    return await handleDateSelection(userId, conversation, 'show_dates');
  } else {
    return DEFAULT_BOT_CONFIG.invalidMessage + "\n\n" + 
           "Serviços disponíveis:\n" +
           services.map((service, index) => `${index + 1} - ${service.name}`).join('\n');
  }
}

async function handleDateSelection(userId, conversation, messageText) {
  if (messageText === 'show_dates') {
    // Mostrar opções de data
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    
    let message = DEFAULT_BOT_CONFIG.dateMessage + "\n\n";
    message += `1 - Hoje (${formatDate(today)})\n`;
    message += `2 - Amanhã (${formatDate(tomorrow)})\n`;
    message += `3 - ${formatDate(dayAfterTomorrow)}\n`;
    message += `4 - Outra data\n`;
    message += `0 - Voltar aos serviços\n`;
    
    return message;
  }
  
  const option = parseInt(messageText);
  let selectedDate;
  
  switch (option) {
    case 0:
      conversation.state = CONVERSATION_STATES.WAITING_SERVICE;
      return await handleServiceSelection(userId, conversation, 'show_services');
      
    case 1:
      selectedDate = new Date();
      break;
      
    case 2:
      selectedDate = new Date();
      selectedDate.setDate(selectedDate.getDate() + 1);
      break;
      
    case 3:
      selectedDate = new Date();
      selectedDate.setDate(selectedDate.getDate() + 2);
      break;
      
    case 4:
      return "Por favor, digite a data desejada no formato DD/MM/AAAA:";
      
    default:
      return DEFAULT_BOT_CONFIG.invalidMessage;
  }
  
  conversation.selectedDate = selectedDate;
  conversation.state = CONVERSATION_STATES.WAITING_TIME;
  
  return await handleTimeSelection(userId, conversation, 'show_times');
}

async function handleTimeSelection(userId, conversation, messageText) {
  if (messageText === 'show_times') {
    // Aqui consultaríamos a agenda real, por enquanto horários mock
    const availableTimes = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
    
    let message = DEFAULT_BOT_CONFIG.timeMessage + "\n\n";
    availableTimes.forEach((time, index) => {
      message += `${index + 1} - ${time}\n`;
    });
    message += `0 - Voltar às datas\n`;
    
    return message;
  }
  
  const availableTimes = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
  const option = parseInt(messageText);
  
  if (option === 0) {
    conversation.state = CONVERSATION_STATES.WAITING_DATE;
    return await handleDateSelection(userId, conversation, 'show_dates');
  }
  
  const timeIndex = option - 1;
  if (timeIndex >= 0 && timeIndex < availableTimes.length) {
    conversation.selectedTime = availableTimes[timeIndex];
    
    // Verificar se tem profissionais cadastrados
    const professionals = MOCK_PROFESSIONALS[userId] || [];
    if (professionals.length > 0) {
      conversation.state = CONVERSATION_STATES.WAITING_PROFESSIONAL;
      return await handleProfessionalSelection(userId, conversation, 'show_professionals');
    } else {
      conversation.state = CONVERSATION_STATES.WAITING_CONFIRMATION;
      return await handleConfirmation(userId, conversation, 'show_confirmation');
    }
  } else {
    return DEFAULT_BOT_CONFIG.invalidMessage;
  }
}

async function handleProfessionalSelection(userId, conversation, messageText) {
  const professionals = MOCK_PROFESSIONALS[userId] || [];
  
  if (messageText === 'show_professionals') {
    let message = DEFAULT_BOT_CONFIG.professionalMessage + "\n\n";
    professionals.forEach((professional, index) => {
      message += `${index + 1} - ${professional.name}\n`;
    });
    message += `0 - Voltar aos horários\n`;
    
    return message;
  }
  
  const option = parseInt(messageText);
  
  if (option === 0) {
    conversation.state = CONVERSATION_STATES.WAITING_TIME;
    return await handleTimeSelection(userId, conversation, 'show_times');
  }
  
  const professionalIndex = option - 1;
  if (professionalIndex >= 0 && professionalIndex < professionals.length) {
    conversation.selectedProfessional = professionals[professionalIndex];
    conversation.state = CONVERSATION_STATES.WAITING_CONFIRMATION;
    
    return await handleConfirmation(userId, conversation, 'show_confirmation');
  } else {
    return DEFAULT_BOT_CONFIG.invalidMessage;
  }
}

async function handleConfirmation(userId, conversation, messageText) {
  if (messageText === 'show_confirmation') {
    const professional = conversation.selectedProfessional;
    
    let message = "📋 *RESUMO DO AGENDAMENTO*\n\n";
    message += `🔹 Serviço: ${conversation.selectedService.name}\n`;
    message += `🔹 Data: ${formatDate(conversation.selectedDate)}\n`;
    message += `🔹 Horário: ${conversation.selectedTime}\n`;
    if (professional) {
      message += `🔹 Profissional: ${professional.name}\n`;
    }
    message += `🔹 Duração: ${conversation.selectedService.duration} minutos\n`;
    message += `🔹 Valor: R$ ${conversation.selectedService.price}\n\n`;
    message += "1 - Confirmar agendamento\n";
    message += "0 - Voltar e alterar\n";
    
    return message;
  }
  
  const option = parseInt(messageText);
  
  if (option === 1) {
    // Confirmar agendamento - aqui criaria o agendamento no sistema
    conversation.state = CONVERSATION_STATES.COMPLETED;
    
    // Remover conversa da memória após completar
    const conversationKey = `${userId}:${conversation.phoneNumber}`;
    activeConversations.delete(conversationKey);
    
    return "✅ *AGENDAMENTO CONFIRMADO!*\n\n" +
           "Seu agendamento foi registrado com sucesso.\n" +
           "Você receberá uma confirmação em breve.\n\n" +
           "Obrigado pela preferência!";
  } else if (option === 0) {
    // Voltar - resetar para escolha de serviço
    conversation.state = CONVERSATION_STATES.WAITING_SERVICE;
    conversation.selectedService = null;
    conversation.selectedDate = null;
    conversation.selectedTime = null;
    conversation.selectedProfessional = null;
    
    return await handleServiceSelection(userId, conversation, 'show_services');
  } else {
    return DEFAULT_BOT_CONFIG.invalidMessage;
  }
}

// Função utilitária para formatar data
function formatDate(date) {
  const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  
  const dayName = days[date.getDay()];
  const day = date.getDate().toString().padStart(2, '0');
  const month = months[date.getMonth()];
  
  return `${dayName} ${day}/${month}`;
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
    qrCodes.delete(userId);
    console.log(`WhatsApp conectado para usuário: ${userId}`);
  });

  // NOVO: Event listener para mensagens recebidas
  client.on('message', async (message) => {
    // Ignorar mensagens enviadas pelo próprio bot
    if (message.fromMe) return;
    
    // Ignorar mensagens de grupos
    if (message.from.includes('@g.us')) return;
    
    // Processar apenas mensagens de contatos individuais
    if (message.from.includes('@c.us')) {
      await processIncomingMessage(userId, message.from, message.body, client);
    }
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

// NOVO: API para consultar conversas ativas de um usuário
app.get('/conversations/:userId', validateUserId, (req, res) => {
  const userConversations = [];
  
  for (const [key, conversation] of activeConversations.entries()) {
    if (conversation.userId === req.userId) {
      userConversations.push({
        phoneNumber: conversation.phoneNumber,
        state: conversation.state,
        selectedService: conversation.selectedService,
        selectedDate: conversation.selectedDate,
        selectedTime: conversation.selectedTime,
        selectedProfessional: conversation.selectedProfessional,
        startedAt: conversation.startedAt
      });
    }
  }
  
  res.json({ conversations: userConversations });
});

// NOVO: API para limpar conversa específica
app.delete('/conversation/:userId/:phoneNumber', validateUserId, (req, res) => {
  const { phoneNumber } = req.params;
  const conversationKey = `${req.userId}:${phoneNumber}`;
  
  if (activeConversations.has(conversationKey)) {
    activeConversations.delete(conversationKey);
    res.json({ success: true, message: 'Conversa removida' });
  } else {
    res.status(404).json({ error: 'Conversa não encontrada' });
  }
});

// Endpoints existentes (mantidos)
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
          <h1>Inicializando WhatsApp Bot...</h1>
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
        <title>WhatsApp Bot Ativo - ${req.userId}</title>
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
          <h1>🤖 Bot WhatsApp Ativo!</h1>
          <div class="success">✅ Seu bot está conectado e respondendo mensagens automaticamente!</div>
          <p>Usuário: ${req.userId}</p>
          <p>O bot irá responder automaticamente quando clientes enviarem mensagens para seu WhatsApp.</p>
          <button onclick="disconnectBot()">Desconectar Bot</button>
        </div>
        <script>
          async function disconnectBot() {
            if (confirm('Tem certeza que deseja desconectar o bot?')) {
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
      <title>WhatsApp Bot - ${req.userId}</title>
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
        .bot-info { background: #fff3cd; padding: 15px; border-radius: 8px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="user-info">Ativando Bot para: ${req.userId}</div>
        <h1>🤖 WhatsApp Bot QR Code</h1>
        <p>Escaneie o QR Code para ativar o bot de agendamento:</p>
        
        <div class="qr-code">
          <img src="${qrCodeBase64}" alt="QR Code WhatsApp" style="max-width: 100%; height: auto;"/>
        </div>
        
        <div class="instructions">
          <h3>Como ativar o bot:</h3>
          <p>1. Abra o WhatsApp no seu celular</p>
          <p>2. Vá em <strong>Menu</strong> → <strong>Dispositivos conectados</strong></p>
          <p>3. Toque em <strong>Conectar dispositivo</strong></p>
          <p>4. Escaneie o QR Code acima</p>
        </div>
        
        <div class="bot-info">
          <h4>🤖 O que acontece após conectar:</h4>
          <p>• Seu WhatsApp responderá automaticamente aos clientes</p>
          <p>• Bot guiará clientes através do processo de agendamento</p>
          <p>• Agendamentos serão criados automaticamente no sistema</p>
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
              statusDiv.innerHTML = '<p style="color: #25D366; font-weight: bold;">🤖 Bot Ativo e Funcionando!</p>';
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
    userId: req.userId,
    botActive: isConnected
  });
});

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
    
    // Limpar conversas ativas do usuário
    for (const [key, conversation] of activeConversations.entries()) {
      if (conversation.userId === req.userId) {
        activeConversations.delete(key);
      }
    }
    
    // Remover pasta de sessão
    const sessionPath = `./sessions/${req.userId}`;
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    
    console.log(`Usuario ${req.userId} desconectado e sessão removida`);
    res.json({ 
      success: true, 
      message: 'Bot WhatsApp desconectado com sucesso',
      userId: req.userId
    });
  } catch (error) {
    console.error(`Erro ao desconectar usuário ${req.userId}:`, error);
    res.status(500).json({ error: 'Erro ao desconectar WhatsApp' });
  }
});

app.get('/admin/users', (req, res) => {
  const users = [];
  
  for (const [userId, status] of clientStatus.entries()) {
    const userConversations = [];
    for (const [key, conversation] of activeConversations.entries()) {
      if (conversation.userId === userId) {
        userConversations.push({
          phoneNumber: conversation.phoneNumber,
          state: conversation.state
        });
      }
    }
    
    users.push({
      userId,
      status,
      hasQR: qrCodes.has(userId),
      hasClient: clients.has(userId),
      activeConversations: userConversations.length,
      conversations: userConversations
    });
  }
  
  res.json({ users, totalConversations: activeConversations.size });
});

// Criar diretório de sessões se não existir
const sessionsDir = './sessions';
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

console.log('=== SERVIDOR WHATSAPP BOT MULTI-USUÁRIO ===');
console.log('Funcionalidades:');
console.log('✅ Múltiplos usuários isolados');
console.log('✅ Bot conversacional automático');
console.log('✅ Sistema de agendamento inteligente');
console.log('✅ Respostas automáticas personalizadas');
console.log('');
console.log('Novos Endpoints:');
console.log('- GET /conversations/:userId - Listar conversas ativas');
console.log('- DELETE /conversation/:userId/:phoneNumber - Remover conversa');
console.log('- GET /admin/users - Visão geral de todos usuários');
console.log('');
console.log('Endpoints Existentes:');
console.log('- POST /initialize/:userId - Inicializar cliente');
console.log('- GET /qr/:userId - Obter QR Code');
console.log('- GET /qr-page/:userId - Página do QR Code');
console.log('- GET /status/:userId - Status do cliente');
console.log('- POST /send-message/:userId - Enviar mensagem');
console.log('- POST /disconnect/:userId - Desconectar cliente');

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  console.log(`🤖 Sistema de bot conversacional ativo!`);
});
