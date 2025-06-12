import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

console.log('🔍 DEBUG - URL do Supabase:', supabaseUrl);
console.log('🔍 DEBUG - Key do Supabase:', supabaseKey ? 'PRESENTE' : 'AUSENTE');
console.log('🔍 DEBUG - Testando conexão...');

// Criar cliente Supabase com opções adicionais
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: fetch,
    headers: {
      'User-Agent': 'WhatsApp-Bot-Server/1.0',
    },
  },
});

// Middlewares
app.use(cors());
app.use(express.json());

// Rota principal
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WhatsApp Bot Backend</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 40px;
          background-color: #f0f0f0;
        }
        .container {
          background-color: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
          color: #25D366;
        }
        .endpoint {
          background-color: #f8f8f8;
          padding: 10px;
          margin: 10px 0;
          border-radius: 4px;
          font-family: monospace;
        }
        .method {
          font-weight: bold;
          color: #007bff;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>WhatsApp Bot Multi-Usuário - VERSÃO ATUALIZADA</h1>
        <p>Servidor rodando na porta ${PORT}</p>
        <h3>Endpoints disponíveis:</h3>
        <div class="endpoint">
          <span class="method">GET</span> /api/qr/:userId - Obter QR Code
        </div>
        <div class="endpoint">
          <span class="method">GET</span> /api/status/:userId - Status da conexão
        </div>
        <div class="endpoint">
          <span class="method">GET</span> /api/services/:userId - Listar serviços
        </div>
        <div class="endpoint">
          <span class="method">GET</span> /api/professionals/:userId - Listar profissionais
        </div>
        <div class="endpoint">
          <span class="method">GET</span> /api/appointments/:userId - Listar agendamentos
        </div>
        <div class="endpoint">
          <span class="method">POST</span> /api/send/:userId - Enviar mensagem
        </div>
        <div class="endpoint">
          <span class="method">POST</span> /api/disconnect/:userId - Desconectar
        </div>
      </div>
    </body>
    </html>
  `);
});

// Rota de debug para verificar variáveis de ambiente do Railway
app.get('/debug', (req, res) => {
  const railwayVars = {
    RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
    RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID,
    RAILWAY_SERVICE_ID: process.env.RAILWAY_SERVICE_ID,
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    SUPABASE_URL: process.env.SUPABASE_URL ? 'CONFIGURADO' : 'NÃO CONFIGURADO',
    SUPABASE_KEY: process.env.SUPABASE_KEY ? 'CONFIGURADO' : 'NÃO CONFIGURADO'
  };
  
  res.json({
    status: 'Railway funcionando',
    funcionando: 'supabase',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY ? 'true' : 'false',
    supabaseKeyLength: process.env.SUPABASE_KEY?.length || 0,
    supabaseUrlFromCode: supabaseUrl,
    supabaseKeyFromCode: supabaseKey ? 'PRESENTE' : 'AUSENTE',
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
});

// Endpoint de teste de conexão com o banco
app.get('/api/test-db', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    if (error) {
      return res.status(500).json({ 
        status: 'error',
        message: 'Falha na conexão com banco de dados',
        error: error.message 
      });
    }
    
    res.json({ 
      status: 'success',
      message: 'Conexão com banco de dados OK',
      supabaseUrl: process.env.SUPABASE_URL 
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      message: 'Erro ao testar conexão',
      error: error.message 
    });
  }
});

// Buscar serviços
app.get('/api/services/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`Buscando serviços para usuário: ${userId}`);
    
    // Teste de conexão primeiro
    const { data: testData, error: testError } = await supabase
      .from('users')
      .select('id')
      .limit(1);
    
    if (testError) {
      console.error('Erro ao testar conexão com Supabase:', testError);
      return res.status(500).json({ 
        error: 'Erro de conexão com banco de dados',
        details: testError.message 
      });
    }
    
    // Busca os serviços
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Erro ao buscar serviços:', error);
      return res.status(500).json({ 
        error: 'Erro ao buscar serviços',
        details: error.message 
      });
    }
    
    res.json(data || []);
  } catch (error) {
    console.error('Erro não esperado:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error.message 
    });
  }
});

// Buscar profissionais
app.get('/api/professionals/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const { data, error } = await supabase
      .from('professionals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Erro ao buscar profissionais:', error);
      return res.status(500).json({ error: 'Erro ao buscar profissionais' });
    }
    
    res.json(data || []);
  } catch (error) {
    console.error('Erro ao buscar profissionais:', {
      message: error.message,
      details: error.toString()
    });
    res.status(500).json({ error: 'Erro ao buscar profissionais' });
  }
});

// Buscar agendamentos
app.get('/api/appointments/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        services (
          name,
          price,
          duration
        ),
        professionals (
          name
        )
      `)
      .eq('user_id', userId)
      .order('appointment_date', { ascending: true });
    
    if (error) {
      console.error('Erro ao buscar agendamentos:', error);
      return res.status(500).json({ error: 'Erro ao buscar agendamentos' });
    }
    
    res.json(data || []);
  } catch (error) {
    console.error('Erro ao buscar agendamentos:', {
      message: error.message,
      details: error.toString()
    });
    res.status(500).json({ error: 'Erro ao buscar agendamentos' });
  }
});

// Rota para enviar mensagem (exemplo)
app.post('/api/send/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { message, to } = req.body;
    
    // Aqui você implementaria a lógica de envio de mensagem
    // Por enquanto, apenas retorna sucesso
    res.json({ 
      success: true, 
      message: 'Mensagem enviada',
      userId,
      to,
      sentAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

// Rota para obter QR Code (exemplo)
app.get('/api/qr/:userId', (req, res) => {
  const { userId } = req.params;
  
  // Aqui você implementaria a lógica de geração do QR Code
  // Por enquanto, apenas retorna um status
  res.json({
    userId,
    status: 'pending',
    message: 'QR Code será gerado quando WhatsApp estiver conectado'
  });
});

// Rota para status da conexão
app.get('/api/status/:userId', (req, res) => {
  const { userId } = req.params;
  
  // Aqui você implementaria a lógica de verificação de status
  // Por enquanto, apenas retorna desconectado
  res.json({
    userId,
    connected: false,
    status: 'disconnected'
  });
});

// Rota para desconectar
app.post('/api/disconnect/:userId', (req, res) => {
  const { userId } = req.params;
  
  // Aqui você implementaria a lógica de desconexão
  res.json({
    userId,
    success: true,
    message: 'Desconectado com sucesso'
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log('📱 WhatsApp Bot Multi-Usuário ativo!');
  console.log(`🔗 Acesse: http://localhost:${PORT}`);
});
