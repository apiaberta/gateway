/**
 * Mailgun Email Service
 * Envio de emails via Mailgun API (EU region)
 */

import FormData from 'form-data';
import Mailgun from 'mailgun.js';

const mailgun = new Mailgun(FormData);

const client = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY,
  url: 'https://api.eu.mailgun.net'
});

const domain = process.env.MAILGUN_DOMAIN || 'mg.apiaberta.pt';
const fromAddress = process.env.MAILGUN_FROM || 'noreply@mg.apiaberta.pt';

/**
 * Enviar email
 * @param {Object} options
 * @param {string} options.to - Email destinatário
 * @param {string} options.subject - Assunto
 * @param {string} options.text - Corpo (text/plain)
 * @param {string} [options.html] - Corpo (text/html, opcional)
 * @param {string} [options.from] - Remetente (default: noreply@mg.apiaberta.pt)
 * @returns {Promise<Object>} Resposta Mailgun
 */
export async function sendEmail({
  to,
  subject,
  text,
  html = null,
  from = fromAddress
}) {
  try {
    const messageData = {
      from,
      to,
      subject,
      text
    };

    if (html) {
      messageData.html = html;
    }

    const result = await client.messages.create(domain, messageData);
    console.log(`[Mailgun] Email enviado para ${to}:`, result.id);
    return { success: true, messageId: result.id };
  } catch (error) {
    console.error(`[Mailgun] Erro ao enviar email para ${to}:`, error.message);
    throw error;
  }
}

/**
 * Enviar email de password reset
 * @param {Object} options
 * @param {string} options.to - Email do utilizador
 * @param {string} options.name - Nome do utilizador
 * @param {string} options.resetLink - Link de reset (completo, com token)
 * @returns {Promise<Object>}
 */
export async function sendPasswordResetEmail({ to, name, resetLink }) {
  const subject = 'Password Reset - API Aberta';

  const text = `
Olá ${name},

Pediste para resetar a tua password. Clica no link abaixo:

${resetLink}

Este link expira em 24 horas.

Se não pediste isto, ignora este email.

---
API Aberta
  `.trim();

  const html = `
<html>
<body style="font-family: Arial, sans-serif; color: #333;">
  <h2>Password Reset</h2>
  <p>Olá <strong>${name}</strong>,</p>
  <p>Pediste para resetar a tua password. Clica no botão abaixo:</p>
  <p>
    <a href="${resetLink}" style="
      background-color: #007bff;
      color: white;
      padding: 10px 20px;
      text-decoration: none;
      border-radius: 4px;
      display: inline-block;
    ">
      Reset Password
    </a>
  </p>
  <p>Ou copia e cola este link:</p>
  <p><code>${resetLink}</code></p>
  <p style="color: #999; font-size: 12px;">Este link expira em 24 horas.</p>
  <p style="color: #999; font-size: 12px;">Se não pediste isto, ignora este email.</p>
  <hr/>
  <p style="color: #999; font-size: 12px;">API Aberta</p>
</body>
</html>
  `.trim();

  return sendEmail({ to, subject, text, html });
}

/**
 * Test: enviar email de teste
 */
export async function testEmail(to) {
  return sendEmail({
    to,
    subject: 'Test Email - API Aberta',
    text: 'Este é um email de teste da API Aberta.\n\nSe recebeste isto, o Mailgun está funcional!'
  });
}
