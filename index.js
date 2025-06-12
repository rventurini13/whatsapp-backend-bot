import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Dados em memória (funciona SEMPRE)
const database = {
  services: [
    { id: 1, user_id: 'teste123', name: 'Corte de Cabelo', price: 30, duration: 30 },
    { id: 2, user_id: 'teste123', name: 'Barba', price: 20, duration: 20 }
  ],
  professionals: [
    { id: 1, user_id: 'teste123', name: 'João Silva' },
    { id: 2, user_id: 'teste123', name: 'Maria Santos' }
  ],
  appointments: [
    { id: 1, user_id: 'teste123', service_id: 1, professional_id: 1, date: '2024-06-15', time: '14:00' }
  ]
};

// Página principal
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WhatsApp Bot Backend</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f0f0f0; }
        .container { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #25D366; }
        .success { background: #d4edda; color: #155724; padding: 10px; border-radius: 4px; margin: 20px 0; }
        .endpoint { background: #f8f8f8; padding: 10px; margin: 10px 0; border-radius: 4px; font-family: monospace; }
        .method { font-weight: bold; color: #007bff; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>WhatsApp Bot Backend - FUNCIONANDO!</h1>
        <div class="success">✅ Sistema funcionando com banco de dados local</div>
        <h3>Endpoints disponíveis:</h3>
        <div class="endpoint"><span class="method">GET</span> /api/services/:userId</div>
        <div class="endpoint"><span class="method">GET</span> /api/professionals/:userId</div>
        <div class="endpoint"><span class="method">GET</span> /api/appointments/:userId</div>
        <h3>Testar agora:</h3>
        <div class="endpoint">
          <a href="/api/services/teste123">/api/services/teste123</a> - Ver serviços
        </div>
        <div class="endpoint">
          <a href="/api/professionals/teste123">/api/professionals/teste123</a> - Ver profissionais
        </div>
        <div class="endpoint">
          <a href="/api/appointments/teste123">/api/appointments/teste123</a> - Ver agendamentos
        </div>
      </div>
    </body>
    </html>
  `);
});

// API: Buscar serviços
app.get('/api/services/:userId', (req, res) => {
  const { userId } = req.params;
  const services = database.services.filter(s => s.user_id === userId);
  res.json(services);
});

// API: Buscar profissionais
app.get('/api/professionals/:userId', (req, res) => {
  const { userId } = req.params;
  const professionals = database.professionals.filter(p => p.user_id === userId);
  res.json(professionals);
});

// API: Buscar agendamentos
app.get('/api/appointments/:userId', (req, res) => {
  const { userId } = req.params;
  const appointments = database.appointments.filter(a => a.user_id === userId);
  res.json(appointments);
});

// API: Criar serviço
app.post('/api/services', (req, res) => {
  const newService = {
    id: database.services.length + 1,
    ...req.body,
    created_at: new Date().toISOString()
  };
  database.services.push(newService);
  res.json(newService);
});

// API: Criar profissional
app.post('/api/professionals', (req, res) => {
  const newProfessional = {
    id: database.professionals.length + 1,
    ...req.body,
    created_at: new Date().toISOString()
  };
  database.professionals.push(newProfessional);
  res.json(newProfessional);
});

// API: Criar agendamento
app.post('/api/appointments', (req, res) => {
  const newAppointment = {
    id: database.appointments.length + 1,
    ...req.body,
    created_at: new Date().toISOString()
  };
  database.appointments.push(newAppointment);
  res.json(newAppointment);
});

// Debug
app.get('/debug', (req, res) => {
  res.json({
    status: 'Sistema funcionando perfeitamente',
    database: 'Memória local (sem erros)',
    totalServices: database.services.length,
    totalProfessionals: database.professionals.length,
    totalAppointments: database.appointments.length
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`✅ Sistema funcionando COM DADOS!`);
  console.log(`🔗 Acesse: http://localhost:${PORT}`);
});
