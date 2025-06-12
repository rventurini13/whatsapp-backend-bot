import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middlewares
app.use(cors());
app.use(express.json());

// Dados temporários em memória (substitui o Supabase temporariamente)
const mockData = {
  services: [],
  professionals: [],
  appointments: []
};

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
        .warning {
          background-color: #fff3cd;
          border: 1px solid #ffeeba;
          color: #856404;
          padding: 10px;
          border-radius: 4px;
          margin: 20px 0;
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
        <h1>WhatsApp Bot Multi-Usuário - VERSÃO TEMPORÁRIA</h1>
        <div class="warning">
          ⚠️ <strong>Atenção:</strong> Rodando sem conexão com banco de dados. Configure SUPABASE_KEY no Railway.
        </div>
        <p>Servidor rodando na porta ${PORT}</p>
        <h3>Endpoints disponíveis:</h3>
        <div class="endpoint">
          <span class="method">GET</span> /debug - Verificar variáveis de ambiente
        </div>
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

// Rota de debug para verificar variáveis de ambiente
app.get('/debug', (req, res) => {
  // Lista todas as variáveis de ambiente que contêm SUPABASE
  const supabaseVars = {};
  Object.keys(process.env).forEach(key => {
    if (key.includes('SUPABASE')) {
      supabaseVars[key] = key.includes('KEY') ? `***${process.env[key]?.slice(-4) || ''}` : process.env[key];
    }
  });
  
  res.json({
    status: 'Running without database',
    environment: {
      NODE_ENV: process.env.NODE_ENV || 'not set',
      PORT: process.env.PORT || 'not set',
      RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT || 'not set',
    },
    supabase: {
      SUPABASE_URL: process.env.SUPABASE_URL || 'NOT SET',
      SUPABASE_KEY: process.env.SUPABASE_KEY ? 'SET' : 'NOT SET',
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? 'SET' : 'NOT SET',
      all_vars: supabaseVars
    },
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
});

// Buscar serviços (retorna dados mock)
app.get('/api/services/:userId', async (req, res) => {
  const { userId } = req.params;
  console.log(`Buscando serviços para usuário: ${userId}`);
  
  res.json({
    message: 'Database not connected. Configure SUPABASE_KEY in Railway.',
    data: mockData.services
  });
});

// Buscar profissionais (retorna dados mock)
app.get('/api/professionals/:userId', async (req, res) => {
  const { userId } = req.params;
  console.log(`Buscando profissionais para usuário: ${userId}`);
  
  res.json({
    message: 'Database not connected. Configure SUPABASE_KEY in Railway.',
    data: mockData.professionals
  });
});

// Buscar agendamentos (retorna dados mock)
app.get('/api/appointments/:userId', async (req, res) => {
  const { userId } = req.params;
  console.log(`Buscando agendamentos para usuário: ${userId}`);
  
  res.json({
    message: 'Database not connected. Configure SUPABASE_KEY in Railway.',
    data: mockData.appointments
  });
});

// Rota para enviar mensagem
app.post('/api/send/:userId', async (req, res) => {
  const { userId } = req.params;
  const { message, to } = req.body;
  
  res.json({ 
    success: true, 
    message: 'Message would be sent (database not connected)',
    userId,
    to,
    sentAt: new Date().toISOString()
  });
});

// Rota para obter QR Code
app.get('/api/qr/:userId', (req, res) => {
  const { userId } = req.params;
  
  res.json({
    userId,
    status: 'pending',
    message: 'QR Code generation requires database connection'
  });
});

// Rota para status da conexão
app.get('/api/status/:userId', (req, res) => {
  const { userId } = req.params;
  
  res.json({
    userId,
    connected: false,
    status: 'database_not_connected'
  });
});

// Rota para desconectar
app.post('/api/disconnect/:userId', (req, res) => {
  const { userId } = req.params;
  
  res.json({
    userId,
    success: true,
    message: 'Disconnect requires database connection'
  });
});

// Endpoint de teste
app.get('/api/test-db', (req, res) => {
  res.json({
    status: 'error',
    message: 'Database not configured',
    hint: 'Add SUPABASE_KEY to Railway environment variables',
    supabase_url: process.env.SUPABASE_URL || 'not set',
    supabase_key: process.env.SUPABASE_KEY ? 'configured' : 'not set'
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log('⚠️  ATENÇÃO: Rodando sem conexão com banco de dados!');
  console.log('📱 WhatsApp Bot Multi-Usuário ativo!');
  console.log(`🔗 Acesse: http://localhost:${PORT}`);
  console.log('\n🔧 Para conectar o banco de dados:');
  console.log('   1. Adicione SUPABASE_KEY nas variáveis do Railway');
  console.log('   2. Faça redeploy da aplicação');
});
