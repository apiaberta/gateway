/**
 * Email Routes
 * Endpoints para envio de emails (password reset, etc.)
 */

import { FastifyInstance } from 'fastify';
import {
  sendPasswordResetEmail,
  testEmail
} from '../services/mailgun.service.js';

/**
 * POST /v1/email/test
 * Enviar email de teste (dev only)
 * Body: { to: "email@example.com" }
 */
export async function registerEmailRoutes(app) {
  app.post('/v1/email/test', async (request, reply) => {
    const { to } = request.body;

    if (!to) {
      return reply.code(400).send({
        error: 'Missing "to" field in request body'
      });
    }

    try {
      const result = await testEmail(to);
      return reply.send({
        success: true,
        message: `Test email sent to ${to}`,
        messageId: result.messageId
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'Failed to send test email',
        details: error.message
      });
    }
  });

  /**
   * POST /v1/auth/forgot-password
   * Pedir reset de password
   * Body: { email: "user@example.com" }
   */
  app.post('/v1/auth/forgot-password', async (request, reply) => {
    const { email } = request.body;

    if (!email) {
      return reply.code(400).send({
        error: 'Missing "email" field'
      });
    }

    try {
      // TODO: Validar que email existe na BD
      // TODO: Gerar token reset com expiry 24h
      // TODO: Guardar token na BD

      const resetToken = 'TOKEN_PLACEHOLDER'; // Placeholder
      const resetLink = `https://app.apiaberta.pt/auth/reset-password?token=${resetToken}`;

      await sendPasswordResetEmail({
        to: email,
        name: 'User', // TODO: Pegar nome real da BD
        resetLink
      });

      return reply.send({
        success: true,
        message: 'Password reset email sent. Check your inbox.'
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'Failed to send password reset email',
        details: error.message
      });
    }
  });
}
