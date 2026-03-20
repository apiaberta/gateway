/**
 * Email Service - Mailgun integration
 */

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'apiaberta.pt'
const MAILGUN_FROM = process.env.MAILGUN_FROM || 'hi@apiaberta.pt'
const MAILGUN_REGION = process.env.MAILGUN_REGION || 'eu'
const APP_URL = process.env.APP_URL || 'https://app.apiaberta.pt'

const MAILGUN_ENDPOINT = MAILGUN_REGION === 'eu' 
  ? `https://api.eu.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`
  : `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`

export async function sendPasswordResetEmail(to, token) {
  if (!MAILGUN_API_KEY) {
    console.warn('MAILGUN_API_KEY not configured, skipping email')
    return { success: false, error: 'Email not configured' }
  }

  const resetUrl = `${APP_URL}/reset-password?token=${token}`
  
  const text = `Olá,

Recebemos um pedido para redefinir a tua password na API Aberta.

Clica no link abaixo para criar uma nova password:
${resetUrl}

Este link expira em 1 hora.

Se não pediste esta alteração, ignora este email.

- Equipa API Aberta`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #16a34a;">🔐 Redefinir Password</h2>
  <p>Olá,</p>
  <p>Recebemos um pedido para redefinir a tua password na API Aberta.</p>
  <p style="margin: 30px 0;">
    <a href="${resetUrl}" style="background: #16a34a; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
      Redefinir Password
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">Este link expira em 1 hora.</p>
  <p style="color: #666; font-size: 14px;">Se não pediste esta alteração, ignora este email.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">API Aberta — Dados públicos de Portugal</p>
</body>
</html>`

  const formData = new URLSearchParams()
  formData.append('from', `API Aberta <${MAILGUN_FROM}>`)
  formData.append('to', to)
  formData.append('subject', '🔐 Redefinir password — API Aberta')
  formData.append('text', text)
  formData.append('html', html)

  try {
    const res = await fetch(MAILGUN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from('api:' + MAILGUN_API_KEY).toString('base64')
      },
      body: formData
    })

    const data = await res.json()
    
    if (res.ok) {
      console.log('Password reset email sent to', to)
      return { success: true, messageId: data.id }
    } else {
      console.error('Mailgun error:', data)
      return { success: false, error: data.message }
    }
  } catch (err) {
    console.error('Email send error:', err)
    return { success: false, error: err.message }
  }
}
