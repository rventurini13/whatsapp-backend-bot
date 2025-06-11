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

// Sistema de conversas ativas
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

// Configuração padrão do bot para cada usuário
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

// Dados mock para teste (depois vamos integrar com Supabase)
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

// Função utilitária para extrair números da mensagem
function extractNumber(text) {
  // Procurar por dígitos na mensagem
  const numbers = text.match(/\d+/);
  return numbers ? parseInt(numbers[0]) : -1;
}

// Função melhorada para formatar data
function formatDate(date) {
  const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  
  const dayName = days[date.getDay()];
  const day = date.getDate().toString().padStart(2, '0');
  const month = months[date.getMonth()];
  
  return `${dayName}, ${day} de ${month}`;
}

// Função melhorada para processar mensagens recebidas do WhatsApp
async function processIncomingMessage(userId, phoneNumber, messageText, client) {
  console.log(`[${userId}] Mensagem recebida de ${phoneNumber}: "${messageText}"`);
  
  const conversationKey = `${userId}:${phoneNumber}`;
  let conversation = activeConversations.get(conversationKey);
  
  // Normalizar mensagem - remover acentos, converter para minúsculo, remover espaços extras
  const normalizedMessage = messageText
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // Remove acentos
  
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
      startedAt: new Date(),
      lastInteraction: new Date()
    };
    activeConversations.set(conversationKey, conversation);
    console.log(`[${userId}] Nova conversa iniciada com ${phoneNumber}`);
  }
  
  // Atualizar última interação
  conversation.lastInteraction = new Date();
  
  // Detectar palavras-chave para resetar conversa
  const resetKeywords = ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'inicio', 'menu', 'start'];
  const isGreeting = resetKeywords.some(keyword => normalizedMessage.includes(keyword));
  
  // Se é uma saudação e não está no estado inicial, resetar conversa
  if (isGreeting && conversation.state !== CONVERSATION_STATES.WAITING_SERVICE) {
    console.log(`[${userId}] Resetando conversa para ${phoneNumber} - saudação detectada`);
    conversation.state = CONVERSATION_STATES.WAITING_SERVICE;
    conversation.selectedService = null;
    conversation.selectedDate = null;
    conversation.selectedTime = null;
    conversation.selectedProfessional = null;
  }
  
  // Processar mensagem baseado no estado atual
  let responseMessage = '';
  
  try {
    switch (conversation.state) {
      case CONVERSATION_STATES.WAITING_SERVICE:
        responseMessage = await handleServiceSelection(userId, conversation, messageText, normalizedMessage);
        break;
        
      case CONVERSATION_STATES.WAITING_DATE:
        responseMessage = await handleDateSelection(userId, conversation, messageText, normalizedMessage);
        break;
        
      case CONVERSATION_STATES.WAITING_TIME:
        responseMessage = await handleTimeSelection(userId, conversation, messageText, normalizedMessage);
        break;
        
      case CONVERSATION_STATES.WAITING_PROFESSIONAL:
        responseMessage = await handleProfessionalSelection(userId, conversation, messageText, normalizedMessage);
        break;
        
      case CONVERSATION_STATES.WAITING_CONFIRMATION:
        responseMessage = await handleConfirmation(userId, conversation, messageText, normalizedMessage);
        break;
        
      default:
        console.log(`[${userId}] Estado desconhecido: ${conversation.state}, resetando...`);
        responseMessage = await handleServiceSelection(userId, conversation, messageText, normalizedMessage);
        conversation.state = CONVERSATION_STATES.WAITING_SERVICE;
    }
    
    // Atualizar conversa
    activeConversations.set(conversationKey, conversation);
    
    // Enviar resposta
    if (responseMessage) {
      await client.sendMessage(phoneNumber, responseMessage);
      console.log(`[${userId}] Resposta enviada para ${phoneNumber}: "${responseMessage.substring(0, 50)}..."`);
    }
    
  } catch (error) {
    console.error(`[${userId}] Erro ao processar mensagem de ${phoneNumber}:`, error);
    await client.sendMessage(phoneNumber, "Ops! Ocorreu um erro temporário. Digite *menu* para recomeçar ou entre em contato conosco. 😊");
  }
}

// Funções melhoradas para cada etapa da conversa
async function handleServiceSelection(userId, conversation, messageText, normalizedMessage) {
  const services = MOCK_SERVICES[userId] || [];
  
  console.log(`[${userId}] Processando seleção de serviço: "${messageText}"`);
  
  // Palavras-chave para mostrar menu inicial
  const menuKeywords = ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'menu', 'servicos', 'opcoes'];
  const showMenu = menuKeywords.some(keyword => normalizedMessage.includes(keyword));
  
  if (showMenu || conversation.selectedService === null) {
    let message = "🤖 *Olá! Bem-vindo(a)!*\n\n";
    message += "Sou seu assistente virtual de agendamentos! 😊\n\n";
    message += "*📋 Nossos Serviços:*\n\n";
    
    services.forEach((service, index) => {
      message += `*${index + 1}* - ${service.name}\n`;
      message += `   ⏱️ ${service.duration} min | 💰 R$ ${service.price}\n\n`;
    });
    
    message += "📝 *Digite o número do serviço desejado*\n";
    message += "ou digite *menu* para ver novamente";
    
    return message;
  }
  
  // Tentar interpretar número da opção
  const serviceNumber = extractNumber(messageText);
  console.log(`[${userId}] Número extraído: ${serviceNumber}`);
  
  if (serviceNumber >= 1 && serviceNumber <= services.length) {
    const selectedService = services[serviceNumber - 1];
    conversation.selectedService = selectedService;
    conversation.state = CONVERSATION_STATES.WAITING_DATE;
    
    console.log(`[${userId}] Serviço selecionado: ${selectedService.name}`);
    
    let message = `✅ *Serviço selecionado:*\n`;
    message += `*${selectedService.name}*\n`;
    message += `⏱️ Duração: ${selectedService.duration} min\n`;
    message += `💰 Valor: R$ ${selectedService.price}\n\n`;
    
    return message + await handleDateSelection(userId, conversation, 'show_dates', 'show_dates');
  } else {
    let message = "❌ *Opção inválida!*\n\n";
    message += "Por favor, digite apenas o *número* do serviço:\n\n";
    services.forEach((service, index) => {
      message += `*${index + 1}* - ${service.name}\n`;
    });
    message += "\n💡 Exemplo: Digite *1* para o primeiro serviço";
    
    return message;
  }
}

async function handleDateSelection(userId, conversation, messageText, normalizedMessage) {
  console.log(`[${userId}] Processando seleção de data: "${messageText}"`);
  
  if (messageText === 'show_dates' || normalizedMessage.includes('data')) {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    
    let message = "📅 *Escolha uma data:*\n\n";
    message += `*1* - Hoje (${formatDate(today)})\n`;
    message += `*2* - Amanhã (${formatDate(tomorrow)})\n`;
    message += `*3* - ${formatDate(dayAfterTomorrow)}\n`;
    message += `*4* - Outra data\n\n`;
    message += `*0* - ⬅️ Voltar aos serviços\n\n`;
    message += "📝 *Digite o número da data desejada*";
    
    return message;
  }
  
  const option = extractNumber(messageText);
  console.log(`[${userId}] Opção de data selecionada: ${option}`);
  
  // Detectar palavra "voltar"
  if (option === 0 || normalizedMessage.includes('voltar')) {
    conversation.state = CONVERSATION_STATES.WAITING_SERVICE;
    conversation.selectedService = null;
    return await handleServiceSelection(userId, conversation, 'menu', 'menu');
  }
  
  let selectedDate;
  let dateMessage = '';
  
  switch (option) {
    case 1:
      selectedDate = new Date();
      dateMessage = 'hoje';
      break;
      
    case 2:
      selectedDate = new Date();
      selectedDate.setDate(selectedDate.getDate() + 1);
      dateMessage = 'amanhã';
      break;
      
    case 3:
      selectedDate = new Date();
      selectedDate.setDate(selectedDate.getDate() + 2);
      dateMessage = formatDate(selectedDate);
      break;
      
    case 4:
      return "📅 *Digite a data desejada*\n\nFormato: DD/MM/AAAA\n💡 Exemplo: 15/06/2025\n\nOu digite *0* para voltar";
      
    default:
      // Tentar interpretar como data DD/MM/AAAA
      const dateMatch = messageText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (dateMatch) {
        const [, day, month, year] = dateMatch;
        selectedDate = new Date(year, month - 1, day);
        if (selectedDate > new Date()) {
          dateMessage = formatDate(selectedDate);
          break;
        }
      }
      
      return "❌ *Data inválida!*\n\nEscolha uma das opções:\n*1* - Hoje\n*2* - Amanhã\n*3* - Outro dia\n*4* - Data específica\n\n*0* - Voltar";
  }
  
  conversation.selectedDate = selectedDate;
  conversation.state = CONVERSATION_STATES.WAITING_TIME;
  
  let message = `✅ *Data selecionada:*\n${dateMessage}\n\n`;
  return message + await handleTimeSelection(userId, conversation, 'show_times', 'show_times');
}

async function handleTimeSelection(userId, conversation, messageText, normalizedMessage) {
  console.log(`[${userId}] Processando seleção de horário: "${messageText}"`);
  
  if (messageText === 'show_times' || normalizedMessage.includes('horario')) {
    // TODO: Aqui consultaremos horários reais da agenda
    // Por enquanto, horários mockados
    const availableTimes = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
    
    let message = "🕐 *Horários disponíveis:*\n\n";
    availableTimes.forEach((time, index) => {
      message += `*${index + 1}* - ${time}\n`;
    });
    message += `\n*0* - ⬅️ Voltar às datas\n\n`;
    message += "📝 *Digite o número do horário*";
    
    return message;
  }
  
  const availableTimes = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
  const option = extractNumber(messageText);
  console.log(`[${userId}] Opção de horário selecionada: ${option}`);
  
  if (option === 0 || normalizedMessage.includes('voltar')) {
    conversation.state = CONVERSATION_STATES.WAITING_DATE;
    return await handleDateSelection(userId, conversation, 'show_dates', 'show_dates');
  }
  
  const timeIndex = option - 1;
  if (timeIndex >= 0 && timeIndex < availableTimes.length) {
    conversation.selectedTime = availableTimes[timeIndex];
    
    console.log(`[${userId}] Horário selecionado: ${conversation.selectedTime}`);
    
    // Verificar se tem profissionais cadastrados
    const professionals = MOCK_PROFESSIONALS[userId] || [];
    if (professionals.length > 0) {
      conversation.state = CONVERSATION_STATES.WAITING_PROFESSIONAL;
      let message = `✅ *Horário selecionado:*\n${conversation.selectedTime}\n\n`;
      return message + await handleProfessionalSelection(userId, conversation, 'show_professionals', 'show_professionals');
    } else {
      conversation.state = CONVERSATION_STATES.WAITING_CONFIRMATION;
      let message = `✅ *Horário selecionado:*\n${conversation.selectedTime}\n\n`;
      return message + await handleConfirmation(userId, conversation, 'show_confirmation', 'show_confirmation');
    }
  } else {
    return "❌ *Horário inválido!*\n\nDigite o *número* correspondente ao horário desejado.\n\n*0* para voltar";
  }
}

async function handleProfessionalSelection(userId, conversation, messageText, normalizedMessage) {
  console.log(`[${userId}] Processando seleção de profissional: "${messageText}"`);
  
  const professionals = MOCK_PROFESSIONALS[userId] || [];
  
  if (messageText === 'show_professionals' || normalizedMessage.includes('profissional')) {
    let message = "👨‍💼 *Escolha um profissional:*\n\n";
    professionals.forEach((professional, index) => {
      message += `*${index + 1}* - ${professional.name}\n`;
    });
    message += `\n*0* - ⬅️ Voltar aos horários\n\n`;
    message += "📝 *Digite o número do profissional*";
    
    return message;
  }
  
  const option = extractNumber(messageText);
  console.log(`[${userId}] Opção de profissional selecionada: ${option}`);
  
  if (option === 0 || normalizedMessage.includes('voltar')) {
    conversation.state = CONVERSATION_STATES.WAITING_TIME;
    return await handleTimeSelection(userId, conversation, 'show_times', 'show_times');
  }
  
  const professionalIndex = option - 1;
  if (professionalIndex >= 0 && professionalIndex < professionals.length) {
    conversation.selectedProfessional = professionals[professionalIndex];
    conversation.state = CONVERSATION_STATES.WAITING_CONFIRMATION;
    
    console.log(`[${userId}] Profissional selecionado: ${conversation.selectedProfessional.name}`);
    
    let message = `✅ *Profissional selecionado:*\n${conversation.selectedProfessional.name}\n\n`;
    return message + await handleConfirmation(userId, conversation, 'show_confirmation', 'show_confirmation');
  } else {
    return "❌ *Profissional inválido!*\n\nDigite o *número* correspondiente ao profissional.\n\n*0* para voltar";
  }
}

async function handleConfirmation(userId, conversation, messageText, normalizedMessage) {
  console.log(`[${userId}] Processando confirmação: "${messageText}"`);
  
  if (messageText === 'show_confirmation' || normalizedMessage.includes('confirma')) {
    const professional = conversation.selectedProfessional;
    
    let message = "📋 *RESUMO DO AGENDAMENTO*\n\n";
    message += `🔸 *Serviço:* ${conversation.selectedService.name}\n`;
    message += `🔸 *Data:* ${formatDate(conversation.selectedDate)}\n`;
    message += `🔸 *Horário:* ${conversation.selectedTime}\n`;
    if (professional) {
      message += `🔸 *Profissional:* ${professional.name}\n`;
    }
    message += `🔸 *Duração:* ${conversation.selectedService.duration} min\n`;
    message += `🔸 *Valor:* R$ ${conversation.selectedService.price}\n\n`;
    message += "✅ *1* - Confirmar agendamento\n";
    message += "❌ *0* - Cancelar e voltar\n\n";
    message += "📝 *Digite sua opção*";
    
    return message;
  }
  
  const option = extractNumber(messageText);
  console.log(`[${userId}] Opção de confirmação: ${option}`);
  
  // Detectar confirmação por palavras
  const confirmWords = ['sim', 'confirmar', 'confirmo', 'ok', 'certo', 'perfeito'];
  const cancelWords = ['nao', 'cancelar', 'voltar', 'não'];
  
  const isConfirm = option === 1 || confirmWords.some(word => normalizedMessage.includes(word));
  const isCancel = option === 0 || cancelWords.some(word => normalizedMessage.includes(word));
  
  if (isConfirm) {
    // TODO: Aqui criaremos o agendamento no Supabase
    conversation.state = CONVERSATION_STATES.COMPLETED;
    
    // Remover conversa da memória após completar
    const conversationKey = `${userId}:${conversation.phoneNumber}`;
    activeConversations.delete(conversationKey);
    
    console.log(`[${userId}] Agendamento confirmado para ${conversation.phoneNumber}`);
    
    return "🎉 *AGENDAMENTO CONFIRMADO!*\n\n" +
           "✅ Seu agendamento foi registrado com sucesso!\n\n" +
           "📲 Você receberá uma confirmação em breve.\n" +
           "⏰ Lembre-se do horário marcado.\n\n" +
           "🙏 Obrigado pela preferência!\n\n" +
           "💬 Digite *menu* para novo agendamento";
  } else if (isCancel) {
    // Voltar ao menu inicial
    conversation.state = CONVERSATION_STATES.WAITING_SERVICE;
    conversation.selectedService = null;
    conversation.selectedDate = null;
    conversation.selectedTime = null;
    conversation.selectedProfessional = null;
    
    return "❌ *Agendamento cancelado*\n\n" + await handleServiceSelection(userId, conversation, 'menu', 'menu');
  } else {
    return "❓ *Não entendi sua resposta*\n\n" +
           "Digite:\n" +
           "✅ *1* ou *sim* para CONFIRMAR\n" +
           "❌ *0* ou *não* para CANCELAR";
  }
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

  // Event listener para mensagens recebidas
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

// API para consultar conversas ativas de um usuário
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

// API para limpar conversa específica
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

// Cleanup de conversas antigas (rodar a cada hora)
setInterval(() => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  for (const [key, conversation] of activeConversations.entries()) {
    if (conversation.lastInteraction < oneHourAgo) {
      console.log(`Removendo conversa inativa: ${key}`);
      activeConversations.delete(key);
    }
  }
}, 60 * 60 * 1000); // Cada hora

// Criar diretório de sessões se não existir
const sessionsDir = './sessions';
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

console.log('=== SERVIDOR WHATSAPP BOT MULTI-USUÁRIO - VERSÃO MELHORADA ===');
console.log('Funcionalidades:');
console.log('✅ Múltiplos usuários isolados');
console.log('✅ Bot conversacional inteligente com interpretação melhorada');
console.log('✅ Sistema de agendamento automático');
console.log('✅ Respostas formatadas com emojis');
console.log('✅ Navegação natural (números + palavras)');
console.log('✅ Cleanup automático de conversas');
console.log('');
console.log('Melhorias do Bot:');
console.log('🤖 Interpretação inteligente de mensagens');
console.log('🔄 Reset automático com saudações');
console.log('📱 Formatação WhatsApp com negrito e emojis');
console.log('🔍 Extração automática de números');
console.log('⏰ Timeout automático de conversas inativas');
console.log('');
console.log('Endpoints:');
console.log('- GET /conversations/:userId - Listar conversas ativas');
console.log('- DELETE /conversation/:userId/:phoneNumber - Remover conversa');
console.log('- GET /admin/users - Visão geral de todos usuários');
console.log('- POST /initialize/:userId - Inicializar cliente');
console.log('- GET /qr/:userId - Obter QR Code');
console.log('- GET /qr-page/:userId - Página do QR Code');
console.log('- GET /status/:userId - Status do cliente');
console.log('- POST /send-message/:userId - Enviar mensagem');
console.log('- POST /disconnect/:userId - Desconectar cliente');

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  console.log(`🤖 Sistema de bot conversacional MELHORADO ativo!`);
  console.log(`📱 Pronto para responder mensagens com interpretação inteligente!`);
});
