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
      welcome_message: 'Ol
