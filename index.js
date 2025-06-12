const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'https://pvbvznvgdrpnzorevxp.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2YnZ6bnl2Z2RycG56b3JldnhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk1NzM2MTMsImV4cCI6MjA2NTE0OTYxM30.Nnvp0kw5G_yOG7S-5VGc1XrUYTjpYNrt8lz6hLkR0vI';
const supabase = createClient(supabaseUrl, supabaseKey);

// ADICIONAR ESTAS LINHAS PARA DEBUG:
console.log('🔍 DEBUG - URL do Supabase:', supabaseUrl);
console.log('🔍 DEBUG - Key do Supabase:', supabaseKey ? 'PRESENTE' : 'AUSENTE');
console.log('🔍 DEBUG - Testando conexão...');

const app = express();

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

// Middleware para validar userId
function validateUserId(req, res, next) {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório' });
  }
  req.userId = userId;
  next();
}

// ===== FUNÇÕES AUXILIARES PARA O BOT =====

// Buscar serviços ativos do usuário (para o bot)
async function getUserServices(userId) {
  try {
    const { data, error } = await supabase
      .from('user_services')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Erro ao buscar serviços do usuário:', error);
    return [];
  }
}

// Buscar profissionais ativos do usuário (para o bot)
async function getUserProfessionals(userId) {
  try {
    const { data, error } = await supabase
      .from('user_professionals')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Erro ao buscar profissionais do usuário:', error);
    return [];
  }
}

// Buscar fluxograma ativo do usuário (para o bot)
async function getUserFlow(userId) {
  try {
    const { data, error } = await supabase
      .from('user_flows')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  } catch (error) {
    console.error('Erro ao buscar fluxograma do usuário:', error);
    return null;
  }
}

// Buscar configuração do bot para um usuário
async function getUserBotConfig(userId) {
  try {
    const flow = await getUserFlow(userId);
    if (flow) {
      return flow;
    }
    
    // Configuração padrão se não houver fluxograma personalizado
    return {
      welcome_message: 'Olá! Bem-vindo(a)! 😊\n\nComo posso ajudá-lo(a) hoje?',
      services_message: 'Aqui estão nossos serviços disponíveis:\n\n',
      date_message: 'Por favor, informe a data desejada (formato: dd/mm/aaaa):',
      time_message: 'Escolha um dos horários disponíveis:\n\n',
      professional_message: 'Escolha o profissional de sua preferência:\n\n',
      confirmation_message: 'Por favor, confirme os dados do seu agendamento:\n\n',
      completed_message: '✅ Agendamento confirmado com sucesso!\n\nObrigado por escolher nossos serviços!',
      invalid_message: 'Opção inválida. Por favor, tente novamente.'
    };
  } catch (error) {
    console.error('Erro ao buscar configuração do bot:', error);
    return null;
  }
}

// Buscar horários disponíveis
async function getAvailableSlots(userId, date, duration) {
  try {
    // Buscar agendamentos do dia
    const { data: appointments, error } = await supabase
      .from('appointments')
      .select('appointment_time, duration')
      .eq('user_id', userId)
      .eq('appointment_date', date)
      .eq('status', 'confirmed');

    if (error) throw error;

    // Buscar configurações de horário do negócio
    const { data: business } = await supabase
      .from('user_business_config')
      .select('working_hours')
      .eq('user_id', userId)
      .single();

    // Horários padrão se não houver configuração
    let allSlots = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];
    
    // Se houver configuração de horário de trabalho, usar ela
    if (business && business.working_hours) {
      // TODO: Implementar lógica baseada em working_hours
      // Por enquanto usar os horários padrão
    }
    
    const occupiedSlots = (appointments || []).map(apt => apt.appointment_time);
    
    return allSlots.filter(slot => !occupiedSlots.includes(slot));
  } catch (error) {
    console.error('Erro ao buscar horários disponíveis:', error);
    return ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00']; // Fallback
  }
}

// ===== APIS PRINCIPAIS =====

// Página inicial
app.get('/', (req, res) => {
  res.send(`
    <h1>WhatsApp Bot Multi-Usuário - VERSÃO ATUALIZADA</h1>
    <p>Servidor rodando na porta ${port}</p>
    <p>Endpoints disponíveis:</p>
    <ul>
      <li>GET /api/qr/:userId - Obter QR Code</li>
      <li>GET /api/status/:userId - Status da conexão</li>
      <li>POST /api/send/:userId - Enviar mensagem</li>
      <li>POST /api/disconnect/:userId - Desconectar</li>
    </ul>
  `);
});

// Obter QR Code para um usuário específico
app.get('/api/qr/:userId', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;
    
    // Se já existe um cliente para este usuário, verificar status
    if (clients.has(userId)) {
      const client = clients.get(userId);
      const state = await client.getState();
      
      if (state === 'CONNECTED') {
        return res.json({ 
          success: true, 
          status: 'connected',
          message: 'WhatsApp já está conectado!' 
        });
      }
    }

    // Criar novo cliente
    const client = new Client({
      authStrategy: new LocalAuth({ 
        clientId: userId,
        dataPath: './wwebjs_auth'
      }),
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

    clients.set(userId, client);
    clientStatus.set(userId, 'initializing');

    // Evento QR Code
    client.on('qr', async (qr) => {
      try {
        const qrCodeDataURL = await qrcode.toDataURL(qr);
        qrCodes.set(userId, qrCodeDataURL);
        clientStatus.set(userId, 'qr_ready');
        console.log(`QR Code gerado para usuário ${userId}`);
      } catch (error) {
        console.error('Erro ao gerar QR code:', error);
      }
    });

    // Evento de conexão
    client.on('ready', () => {
      console.log(`Cliente ${userId} está pronto!`);
      clientStatus.set(userId, 'connected');
      qrCodes.delete(userId);
    });

    // Evento de mensagem recebida
    client.on('message', async (message) => {
      await handleIncomingMessage(userId, message);
    });

    // Evento de desconexão
    client.on('disconnected', (reason) => {
      console.log(`Cliente ${userId} desconectado:`, reason);
      clientStatus.set(userId, 'disconnected');
      clients.delete(userId);
      qrCodes.delete(userId);
    });

    // Inicializar cliente
    await client.initialize();

    // Aguardar QR code ser gerado
    let attempts = 0;
    while (!qrCodes.has(userId) && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (qrCodes.has(userId)) {
      res.json({
        success: true,
        qrCode: qrCodes.get(userId),
        status: 'qr_ready'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Timeout ao gerar QR code'
      });
    }

  } catch (error) {
    console.error('Erro ao gerar QR:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao inicializar WhatsApp'
    });
  }
});

// Verificar status da conexão
app.get('/api/status/:userId', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;
    
    if (!clients.has(userId)) {
      return res.json({ 
        success: true, 
        status: 'not_initialized',
        connected: false 
      });
    }

    const client = clients.get(userId);
    const state = await client.getState();
    const status = clientStatus.get(userId) || 'unknown';

    res.json({
      success: true,
      status: status,
      state: state,
      connected: state === 'CONNECTED',
      hasQR: qrCodes.has(userId)
    });

  } catch (error) {
    console.error('Erro ao verificar status:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao verificar status'
    });
  }
});

// Enviar mensagem
app.post('/api/send/:userId', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;
    const { number, message } = req.body;

    if (!number || !message) {
      return res.status(400).json({
        success: false,
        error: 'Número e mensagem são obrigatórios'
      });
    }

    if (!clients.has(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Cliente não inicializado'
      });
    }

    const client = clients.get(userId);
    const state = await client.getState();

    if (state !== 'CONNECTED') {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp não está conectado'
      });
    }

    const chatId = number + '@c.us';
    await client.sendMessage(chatId, message);

    res.json({
      success: true,
      message: 'Mensagem enviada com sucesso'
    });

  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao enviar mensagem'
    });
  }
});

// Desconectar cliente
app.post('/api/disconnect/:userId', validateUserId, async (req, res) => {
  try {
    const userId = req.userId;

    if (clients.has(userId)) {
      const client = clients.get(userId);
      await client.destroy();
      clients.delete(userId);
      clientStatus.delete(userId);
      qrCodes.delete(userId);
    }

    res.json({
      success: true,
      message: 'Cliente desconectado com sucesso'
    });

  } catch (error) {
    console.error('Erro ao desconectar:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao desconectar'
    });
  }
});

// ===== SISTEMA DE BOT CONVERSACIONAL =====

// Função para lidar com mensagens recebidas
async function handleIncomingMessage(userId, message) {
  try {
    // Ignorar mensagens de grupos e status
    if (message.from.includes('@g.us') || message.from.includes('status@broadcast')) {
      return;
    }

    const phoneNumber = message.from.replace('@c.us', '');
    const messageText = message.body.toLowerCase().trim();
    
    console.log(`[${userId}] Mensagem recebida de ${phoneNumber}: ${messageText}`);

    // Buscar configuração do bot para este usuário
    const botConfig = await getUserBotConfig(userId);
    if (!botConfig) {
      console.log(`Configuração do bot não encontrada para usuário ${userId}`);
      return;
    }

    // Verificar se há uma conversa ativa
    const conversationKey = `${userId}_${phoneNumber}`;
    let conversation = activeConversations.get(conversationKey);

    if (!conversation) {
      // Iniciar nova conversa
      conversation = {
        step: 'welcome',
        data: {},
        lastActivity: Date.now()
      };
      activeConversations.set(conversationKey, conversation);
    }

    // Atualizar última atividade
    conversation.lastActivity = Date.now();

    // Processar mensagem baseado no step atual
    await processConversationStep(userId, phoneNumber, messageText, conversation, botConfig);

  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
  }
}

// Processar step da conversa
async function processConversationStep(userId, phoneNumber, messageText, conversation, botConfig) {
  const client = clients.get(userId);
  const chatId = phoneNumber + '@c.us';

  switch (conversation.step) {
    case 'welcome':
      await client.sendMessage(chatId, botConfig.welcome_message || 'Olá! Como posso ajudá-lo?');
      
      // Mostrar serviços disponíveis
      const availableServices = await getUserServices(userId);
      if (availableServices.length > 0) {
        let servicesMessage = botConfig.services_message || 'Nossos serviços disponíveis:\n\n';
        availableServices.forEach((service, index) => {
          servicesMessage += `${index + 1}. ${service.name} - R$ ${service.price}\n`;
          if (service.description) {
            servicesMessage += `   ${service.description}\n`;
          }
        });
        servicesMessage += '\nDigite o número do serviço desejado:';
        
        await client.sendMessage(chatId, servicesMessage);
        conversation.step = 'choosing_service';
      } else {
        await client.sendMessage(chatId, 'Desculpe, não temos serviços disponíveis no momento.');
      }
      break;

    case 'choosing_service':
      const servicesList = await getUserServices(userId);
      const serviceIndex = parseInt(messageText) - 1;
      
      if (serviceIndex >= 0 && serviceIndex < servicesList.length) {
        conversation.data.service = servicesList[serviceIndex];
        await client.sendMessage(chatId, `Ótimo! Você escolheu: ${servicesList[serviceIndex].name}\n\n${botConfig.date_message || 'Agora, por favor, informe a data desejada (dd/mm/aaaa):'}`);
        conversation.step = 'choosing_date';
      } else {
        await client.sendMessage(chatId, botConfig.invalid_message || 'Opção inválida. Por favor, digite o número do serviço desejado.');
      }
      break;

    case 'choosing_date':
      // Validar formato da data
      const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
      if (dateRegex.test(messageText)) {
        conversation.data.date = messageText;
        
        // Buscar horários disponíveis
        const availableSlots = await getAvailableSlots(userId, messageText, conversation.data.service.duration);
        
        if (availableSlots.length > 0) {
          let timeMessage = botConfig.time_message || 'Horários disponíveis:\n\n';
          availableSlots.forEach((slot, index) => {
            timeMessage += `${index + 1}. ${slot}\n`;
          });
          timeMessage += '\nDigite o número do horário desejado:';
          
          await client.sendMessage(chatId, timeMessage);
          conversation.data.availableSlots = availableSlots;
          conversation.step = 'choosing_time';
        } else {
          await client.sendMessage(chatId, 'Desculpe, não há horários disponíveis para esta data. Por favor, escolha outra data:');
        }
      } else {
        await client.sendMessage(chatId, 'Formato de data inválido. Por favor, use o formato dd/mm/aaaa:');
      }
      break;

    case 'choosing_time':
      const timeIndex = parseInt(messageText) - 1;
      const availableSlots = conversation.data.availableSlots;
      
      if (timeIndex >= 0 && timeIndex < availableSlots.length) {
        conversation.data.time = availableSlots[timeIndex];
        
        // Buscar profissionais
        const professionalsList = await getUserProfessionals(userId);
        
        if (professionalsList.length > 0) {
          let profMessage = botConfig.professional_message || 'Profissionais disponíveis:\n\n';
          professionalsList.forEach((prof, index) => {
            profMessage += `${index + 1}. ${prof.name}\n`;
          });
          profMessage += '\nDigite o número do profissional desejado:';
          
          await client.sendMessage(chatId, profMessage);
          conversation.data.professionalsList = professionalsList;
          conversation.step = 'choosing_professional';
        } else {
          // Pular seleção de profissional se não houver
          conversation.data.professional = null;
          await requestClientName(userId, phoneNumber, conversation, botConfig);
        }
      } else {
        await client.sendMessage(chatId, botConfig.invalid_message || 'Opção inválida. Por favor, digite o número do horário desejado.');
      }
      break;

    case 'choosing_professional':
      const profIndex = parseInt(messageText) - 1;
      const professionalsData = conversation.data.professionalsList;
      
      if (profIndex >= 0 && profIndex < professionalsData.length) {
        conversation.data.professional = professionalsData[profIndex];
        await requestClientName(userId, phoneNumber, conversation, botConfig);
      } else {
        await client.sendMessage(chatId, botConfig.invalid_message || 'Opção inválida. Por favor, digite o número do profissional desejado.');
      }
      break;

    case 'requesting_name':
      conversation.data.clientName = messageText;
      await confirmBooking(userId, phoneNumber, conversation, botConfig);
      break;

    case 'confirming':
      if (messageText === '1' || messageText.includes('sim') || messageText.includes('confirmar')) {
        await saveAppointment(userId, phoneNumber, conversation, botConfig);
      } else if (messageText === '2' || messageText.includes('não') || messageText.includes('cancelar')) {
        await client.sendMessage(chatId, 'Agendamento cancelado. Digite "oi" para começar novamente.');
        activeConversations.delete(`${userId}_${phoneNumber}`);
      } else {
        await client.sendMessage(chatId, 'Por favor, digite 1 para confirmar ou 2 para cancelar.');
      }
      break;

    default:
      // Resetar conversa
      conversation.step = 'welcome';
      await processConversationStep(userId, phoneNumber, messageText, conversation, botConfig);
  }
}

// Solicitar nome do cliente
async function requestClientName(userId, phoneNumber, conversation, botConfig) {
  const client = clients.get(userId);
  const chatId = phoneNumber + '@c.us';
  
  await client.sendMessage(chatId, 'Por favor, informe seu nome completo:');
  conversation.step = 'requesting_name';
}

// Confirmar agendamento
async function confirmBooking(userId, phoneNumber, conversation, botConfig) {
  const client = clients.get(userId);
  const chatId = phoneNumber + '@c.us';
  
  let confirmMessage = botConfig.confirmation_message || 'Confirme seus dados:\n\n';
  confirmMessage += `📋 Serviço: ${conversation.data.service.name}\n`;
  confirmMessage += `📅 Data: ${conversation.data.date}\n`;
  confirmMessage += `⏰ Horário: ${conversation.data.time}\n`;
  
  if (conversation.data.professional) {
    confirmMessage += `👤 Profissional: ${conversation.data.professional.name}\n`;
  }
  
  confirmMessage += `🏷️ Valor: R$ ${conversation.data.service.price}\n`;
  confirmMessage += `📞 Cliente: ${conversation.data.clientName}\n\n`;
  confirmMessage += `Digite:\n1 - Confirmar agendamento\n2 - Cancelar`;
  
  await client.sendMessage(chatId, confirmMessage);
  conversation.step = 'confirming';
}

// Salvar agendamento
async function saveAppointment(userId, phoneNumber, conversation, botConfig) {
  const client = clients.get(userId);
  const chatId = phoneNumber + '@c.us';
  
  try {
    // Salvar no Supabase
    const { data, error } = await supabase
      .from('appointments')
      .insert([{
        user_id: userId,
        client_phone: phoneNumber,
        client_name: conversation.data.clientName,
        service_id: conversation.data.service.id,
        professional_id: conversation.data.professional?.id || null,
        appointment_date: conversation.data.date,
        appointment_time: conversation.data.time,
        duration: conversation.data.service.duration,
        price: conversation.data.service.price,
        status: 'confirmed'
      }]);

    if (error) throw error;

    const completedMessage = botConfig.completed_message || 
      `✅ Agendamento confirmado com sucesso!\n\n` +
      `📋 Serviço: ${conversation.data.service.name}\n` +
      `📅 Data: ${conversation.data.date}\n` +
      `⏰ Horário: ${conversation.data.time}\n` +
      `📞 Cliente: ${conversation.data.clientName}\n\n` +
      `Obrigado por escolher nossos serviços!`;

    await client.sendMessage(chatId, completedMessage);
    
    // Limpar conversa
    activeConversations.delete(`${userId}_${phoneNumber}`);
    
  } catch (error) {
    console.error('Erro ao salvar agendamento:', error);
    await client.sendMessage(chatId, 'Ops! Ocorreu um erro ao salvar seu agendamento. Tente novamente mais tarde.');
  }
}

// ===== APIS DO SUPABASE =====

// Listar serviços de um usuário
app.get('/api/services/:userId', validateUserId, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_services')
      .select('*')
      .eq('user_id', req.userId)
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ services: data || [] });
  } catch (error) {
    console.error('Erro ao buscar serviços:', error);
    res.status(500).json({ error: 'Erro ao buscar serviços' });
  }
});

// Criar novo serviço
app.post('/api/services/:userId', validateUserId, async (req, res) => {
  try {
    const { name, description, duration, price } = req.body;

    if (!name || !duration || !price) {
      return res.status(400).json({ error: 'Nome, duração e preço são obrigatórios' });
    }

    const { data, error } = await supabase
      .from('user_services')
      .insert([{
        user_id: req.userId,
        name,
        description,
        duration: parseInt(duration),
        price: parseFloat(price)
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, service: data });
  } catch (error) {
    console.error('Erro ao criar serviço:', error);
    res.status(500).json({ error: 'Erro ao criar serviço' });
  }
});

// Atualizar serviço
app.put('/api/services/:userId/:serviceId', validateUserId, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { name, description, duration, price } = req.body;

    const { data, error } = await supabase
      .from('user_services')
      .update({
        name,
        description,
        duration: parseInt(duration),
        price: parseFloat(price),
        updated_at: new Date().toISOString()
      })
      .eq('id', serviceId)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, service: data });
  } catch (error) {
    console.error('Erro ao atualizar serviço:', error);
    res.status(500).json({ error: 'Erro ao atualizar serviço' });
  }
});

// Deletar serviço (soft delete)
app.delete('/api/services/:userId/:serviceId', validateUserId, async (req, res) => {
  try {
    const { serviceId } = req.params;

    const { error } = await supabase
      .from('user_services')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', serviceId)
      .eq('user_id', req.userId);

    if (error) throw error;

    res.json({ success: true, message: 'Serviço removido' });
  } catch (error) {
    console.error('Erro ao deletar serviço:', error);
    res.status(500).json({ error: 'Erro ao deletar serviço' });
  }
});

// Listar profissionais de um usuário
app.get('/api/professionals/:userId', validateUserId, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_professionals')
      .select('*')
      .eq('user_id', req.userId)
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ professionals: data || [] });
  } catch (error) {
    console.error('Erro ao buscar profissionais:', error);
    res.status(500).json({ error: 'Erro ao buscar profissionais' });
  }
});

// Criar novo profissional
app.post('/api/professionals/:userId', validateUserId, async (req, res) => {
  try {
    const { name, email, phone, specialties } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const { data, error } = await supabase
      .from('user_professionals')
      .insert([{
        user_id: req.userId,
        name,
        email,
        phone,
        specialties: specialties || []
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, professional: data });
  } catch (error) {
    console.error('Erro ao criar profissional:', error);
    res.status(500).json({ error: 'Erro ao criar profissional' });
  }
});

// Atualizar profissional
app.put('/api/professionals/:userId/:professionalId', validateUserId, async (req, res) => {
  try {
    const { professionalId } = req.params;
    const { name, email, phone, specialties } = req.body;

    const { data, error } = await supabase
      .from('user_professionals')
      .update({
        name,
        email,
        phone,
        specialties: specialties || [],
        updated_at: new Date().toISOString()
      })
      .eq('id', professionalId)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, professional: data });
  } catch (error) {
    console.error('Erro ao atualizar profissional:', error);
    res.status(500).json({ error: 'Erro ao atualizar profissional' });
  }
});

// Deletar profissional (soft delete)
app.delete('/api/professionals/:userId/:professionalId', validateUserId, async (req, res) => {
  try {
    const { professionalId } = req.params;

    const { error } = await supabase
      .from('user_professionals')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', professionalId)
      .eq('user_id', req.userId);

    if (error) throw error;

    res.json({ success: true, message: 'Profissional removido' });
  } catch (error) {
    console.error('Erro ao deletar profissional:', error);
    res.status(500).json({ error: 'Erro ao deletar profissional' });
  }
});

// Obter fluxograma ativo do usuário
app.get('/api/flow/:userId', validateUserId, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_flows')
      .select('*')
      .eq('user_id', req.userId)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({ flow: data || null });
  } catch (error) {
    console.error('Erro ao buscar fluxograma:', error);
    res.status(500).json({ error: 'Erro ao buscar fluxograma' });
  }
});

// Salvar/Atualizar fluxograma
app.post('/api/flow/:userId', validateUserId, async (req, res) => {
  try {
    const {
      name,
      welcome_message,
      services_message,
      date_message,
      time_message,
      professional_message,
      confirmation_message,
      completed_message,
      invalid_message
    } = req.body;

    // Verificar se já existe um fluxograma ativo
    const { data: existing } = await supabase
      .from('user_flows')
      .select('id')
      .eq('user_id', req.userId)
      .eq('active', true)
      .single();

    let result;

    if (existing) {
      // Atualizar existente
      const { data, error } = await supabase
        .from('user_flows')
        .update({
          name,
          welcome_message,
          services_message,
          date_message,
          time_message,
          professional_message,
          confirmation_message,
          completed_message,
          invalid_message,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Criar novo
      const { data, error } = await supabase
        .from('user_flows')
        .insert([{
          user_id: req.userId,
          name,
          welcome_message,
          services_message,
          date_message,
          time_message,
          professional_message,
          confirmation_message,
          completed_message,
          invalid_message
        }])
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    res.json({ success: true, flow: result });
  } catch (error) {
    console.error('Erro ao salvar fluxograma:', error);
    res.status(500).json({ error: 'Erro ao salvar fluxograma' });
  }
});

// Obter configurações do negócio
app.get('/api/business/:userId', validateUserId, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_business_config')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({ business: data || null });
  } catch (error) {
    console.error('Erro ao buscar configurações:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

// Salvar/Atualizar configurações do negócio
app.post('/api/business/:userId', validateUserId, async (req, res) => {
  try {
    const {
      business_name,
      description,
      address,
      phone,
      email,
      working_hours
    } = req.body;

    // Verificar se já existem configurações
    const { data: existing } = await supabase
      .from('user_business_config')
      .select('id')
      .eq('user_id', req.userId)
      .single();

    let result;

    if (existing) {
      // Atualizar existente
      const { data, error } = await supabase
        .from('user_business_config')
        .update({
          business_name,
          description,
          address,
          phone,
          email,
          working_hours,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', req.userId)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Criar novo
      const { data, error } = await supabase
        .from('user_business_config')
        .insert([{
          user_id: req.userId,
          business_name,
          description,
          address,
          phone,
          email,
          working_hours
        }])
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    res.json({ success: true, business: result });
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    res.status(500).json({ error: 'Erro ao salvar configurações' });
  }
});

// Listar agendamentos de um usuário
app.get('/api/appointments/:userId', validateUserId, async (req, res) => {
  try {
    const { date } = req.query;
    
    let query = supabase
      .from('appointments')
      .select(`
        *,
        service:user_services(name, duration, price),
        professional:user_professionals(name)
      `)
      .eq('user_id', req.userId)
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true });

    if (date) {
      query = query.eq('appointment_date', date);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ appointments: data || [] });
  } catch (error) {
    console.error('Erro ao buscar agendamentos:', error);
    res.status(500).json({ error: 'Erro ao buscar agendamentos' });
  }
});

// Criar novo agendamento
app.post('/api/appointments/:userId', validateUserId, async (req, res) => {
  try {
    const {
      client_phone,
      client_name,
      service_id,
      professional_id,
      appointment_date,
      appointment_time,
      duration,
      price,
      notes
    } = req.body;

    if (!client_phone || !service_id || !appointment_date || !appointment_time) {
      return res.status(400).json({ 
        error: 'Telefone, serviço, data e horário são obrigatórios' 
      });
    }

    // Verificar se horário está disponível
    const { data: existing } = await supabase
      .from('appointments')
      .select('id')
      .eq('user_id', req.userId)
      .eq('appointment_date', appointment_date)
      .eq('appointment_time', appointment_time)
      .eq('status', 'confirmed');

    if (existing && existing.length > 0) {
      return res.status(400).json({ 
        error: 'Horário já está ocupado' 
      });
    }

    const { data, error } = await supabase
      .from('appointments')
      .insert([{
        user_id: req.userId,
        client_phone,
        client_name,
        service_id,
        professional_id,
        appointment_date,
        appointment_time,
        duration,
        price,
        notes
      }])
      .select(`
        *,
        service:user_services(name, duration, price),
        professional:user_professionals(name)
      `)
      .single();

    if (error) throw error;

    res.json({ success: true, appointment: data });
  } catch (error) {
    console.error('Erro ao criar agendamento:', error);
    res.status(500).json({ error: 'Erro ao criar agendamento' });
  }
});

// Cancelar agendamento
app.delete('/api/appointments/:userId/:appointmentId', validateUserId, async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const { data, error } = await supabase
      .from('appointments')
      .update({ 
        status: 'cancelled',
        updated_at: new Date().toISOString() 
      })
      .eq('id', appointmentId)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, appointment: data });
  } catch (error) {
    console.error('Erro ao cancelar agendamento:', error);
    res.status(500).json({ error: 'Erro ao cancelar agendamento' });
  }
});

// Limpeza automática de conversas inativas (executa a cada 30 minutos)
setInterval(() => {
  const now = Date.now();
  const thirtyMinutes = 30 * 60 * 1000;
  
  for (const [key, conversation] of activeConversations.entries()) {
    if (now - conversation.lastActivity > thirtyMinutes) {
      activeConversations.delete(key);
      console.log(`Conversa expirada removida: ${key}`);
    }
  }
}, 30 * 60 * 1000);

// Iniciar servidor
// ===== ROTA DE DEBUG - ADICIONAR ANTES DO app.listen =====
app.get('/debug', (req, res) => {
  res.json({
    status: 'Railway funcionando',
    supabaseUrl: process.env.SUPABASE_URL || 'VARIÁVEL NÃO ENCONTRADA',
    supabaseKeyExists: !!process.env.SUPABASE_ANON_KEY,
    supabaseKeyLength: process.env.SUPABASE_ANON_KEY ? process.env.SUPABASE_ANON_KEY.length : 0,
    supabaseUrlFromCode: supabaseUrl,
    supabaseKeyFromCode: supabaseKey ? 'PRESENTE' : 'AUSENTE',
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT
    }
  });
});

// Iniciar servidor
app.listen(port, () => {
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  console.log(`📱 WhatsApp Bot Multi-Usuário ativo!`);
  console.log(`🔗 Acesse: http://localhost:${port}`);
});
