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

// LOGS DE DEBUG
console.log('🔍 DEBUG - URL do Supabase:', supabaseUrl);
console.log('🔍 DEBUG - Key do Supabase:', supabaseKey ? 'PRESENTE' : 'AUSENTE');
console.log('🔍 DEBUG - Testando conexão...');

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
      <li>GET /api/services/:userId - Listar serviços</li>
      <li>GET /api/professionals/:userId - Listar profissionais</li>
      <li>GET /api/appointments/:userId - Listar agendamentos</li>
      <li>POST /api/send/:userId - Enviar mensagem</li>
      <li>POST /api/disconnect/:userId - Desconectar</li>
    </ul>
  `);
});

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

// ===== ROTA DE DEBUG =====
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
  console.log(`🚀 Servidor rodando na porta ${port}`);
  console.log(`📱 WhatsApp Bot Multi-Usuário ativo!`);
  console.log(`🔗 Acesse: http://localhost:${port}`);
});
