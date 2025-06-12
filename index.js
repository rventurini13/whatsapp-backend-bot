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

// Tentar importar Supabase apenas se as variáveis existirem
let supabase = null;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (supabaseUrl && supabaseKey) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase conectado com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao conectar Supabase:', error.message);
  }
} else {
  console.warn('⚠️  Supabase não configurado - rodando sem banco de dados');
}

// Rota principal
app.get('/', (req, res) => {
  const dbStatus = supabase ? 'Conectado' : 'Não conectado';
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
        h1 { color: #25D366; }
        .status {
          padding: 10px;
          border-radius: 4px;
          margin: 20px 0;
          font-weight: bold;
        }
        .connected { background-color: #d4edda; color: #155724; }
        .disconnected { background-color: #f8d7da; color: #721c24; }
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
        <h1>WhatsApp Bot Multi-Usuário</h1>
        <div class="status ${supabase ? 'connected' : 'disconnected'}">
          Status do Banco de Dados: ${dbStatus}
        </div>
        <p>Servidor rodando na porta ${PORT}</p>
        <h3>Endpoints disponíveis:</h3>
        <div class="endpoint">
          <span class="method">GET</span> /debug - Verificar configurações
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
      </div>
    </body>
    </html>
  `);
});

// Rota de debug
app.get('/debug', (req, res) => {
  res.json({
    status: 'running',
    database: supabase ? 'connected' : 'not connected',
    environment: {
      SUPABASE_URL: process.env.SUPABASE_URL || 'NOT SET',
      SUPABASE_KEY: process.env.SUPABASE_KEY ? 'SET' : 'NOT SET',
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? 'SET' : 'NOT SET',
      PORT: process.env.PORT || '8080',
      NODE_ENV: process.env.NODE_ENV || 'not set'
    },
    timestamp: new Date().toISOString()
  });
});

// Buscar serviços
app.get('/api/services/:userId', async (req, res) => {
  if (!supabase) {
    return res.json({ error: 'Database not connected', data: [] });
  }
  
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('user_id', userId);
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Buscar profissionais
app.get('/api/professionals/:userId', async (req, res) => {
  if (!supabase) {
    return res.json({ error: 'Database not connected', data: [] });
  }
  
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('professionals')
      .select('*')
      .eq('user_id', userId);
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Buscar agendamentos
app.get('/api/appointments/:userId', async (req, res) => {
  if (!supabase) {
    return res.json({ error: 'Database not connected', data: [] });
  }
  
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('user_id', userId);
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📱 WhatsApp Bot Multi-Usuário ativo!`);
  console.log(`🔗 Acesse: http://localhost:${PORT}`);
  if (!supabase) {
    console.log('\n⚠️  Para conectar o banco de dados:');
    console.log('   Configure SUPABASE_KEY no Railway');
  }
});
