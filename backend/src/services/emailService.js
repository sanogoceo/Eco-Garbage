const nodemailer = require('nodemailer');

const mailPort = parseInt(process.env.MAIL_PORT) || 2525;
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'sandbox.smtp.mailtrap.io',
  port: mailPort,
  secure: mailPort === 465,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const isEmailConfigured = () => Boolean(
  process.env.MAIL_HOST
  && process.env.MAIL_USER
  && process.env.MAIL_PASS
);

const sendNotificationFallbackEmail = async ({
  toEmail,
  userName,
  title,
  message,
  targetPath,
}) => {
  const baseUrl = String(process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeName = escapeHtml(userName);
  const safePath = String(targetPath || '/dashboard/notifications');
  const link = `${baseUrl}${safePath.startsWith('/') ? safePath : `/${safePath}`}`;
  await transporter.sendMail({
    from: `"EcoGarbage" <${process.env.MAIL_FROM || 'no-reply@ecogarbage.app'}>`,
    to: toEmail,
    subject: `${title} - EcoGarbage`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#f7faf8;border-radius:12px;">
        <h2 style="color:#1A8A3C;margin-top:0;">EcoGarbage</h2>
        <p>Bonjour ${safeName},</p>
        <h3 style="color:#1f2937;">${safeTitle}</h3>
        <p style="color:#4b5563;line-height:1.6;">${safeMessage}</p>
        <p style="margin:28px 0;">
          <a href="${escapeHtml(link)}" style="background:#1A8A3C;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
            Ouvrir EcoGarbage
          </a>
        </p>
        <p style="color:#9ca3af;font-size:12px;">Cet email a ete envoye car la notification push n a pas pu etre remise.</p>
      </div>
    `,
  });
};

const sendVerificationEmail = async (toEmail, userName, token) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const link = `${baseUrl}/verify-email?token=${token}`;

  await transporter.sendMail({
    from: `"EcoGarbage" <${process.env.MAIL_FROM || 'no-reply@ecogarbage.app'}>`,
    to: toEmail,
    subject: 'Vérifiez votre adresse email – EcoGarbage',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f7faf8;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <span style="font-size:40px;">♻️</span>
          <h2 style="color:#1A8A3C;margin:8px 0 0;">EcoGarbage</h2>
        </div>
        <h3 style="color:#111;margin-bottom:8px;">Bonjour ${userName} 👋</h3>
        <p style="color:#555;line-height:1.6;">
          Merci de vous être inscrit sur <strong>EcoGarbage</strong>. Cliquez sur le bouton ci-dessous pour vérifier votre adresse email et activer votre compte.
        </p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${link}"
            style="background:#1A8A3C;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">
            Vérifier mon email
          </a>
        </div>
        <p style="color:#999;font-size:13px;text-align:center;">
          Ce lien expire dans <strong>24 heures</strong>.<br/>
          Si vous n'avez pas créé de compte, ignorez cet email.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <p style="color:#bbb;font-size:11px;text-align:center;">© 2025 EcoGarbage. Tous droits réservés.</p>
      </div>
    `,
  });
};


const sendResetPasswordEmail = async (toEmail, userName, token) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const link = `${baseUrl}/reset-password?token=${token}`;

  await transporter.sendMail({
    from: `"EcoGarbage" <${process.env.MAIL_FROM || 'no-reply@ecogarbage.app'}>`,
    to: toEmail,
    subject: 'Réinitialisation de mot de passe – EcoGarbage',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f7faf8;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <span style="font-size:40px;">🔒</span>
          <h2 style="color:#1A8A3C;margin:8px 0 0;">EcoGarbage</h2>
        </div>
        <h3 style="color:#111;margin-bottom:8px;">Bonjour ${userName} 👋</h3>
        <p style="color:#555;line-height:1.6;">
          Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
        </p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${link}"
            style="background:#1A8A3C;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">
            Réinitialiser mon mot de passe
          </a>
        </div>
        <p style="color:#999;font-size:13px;text-align:center;">
          Ce lien expire dans <strong>1 heure</strong>.<br/>
          Si vous n'avez pas fait cette demande, ignorez cet email.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <p style="color:#bbb;font-size:11px;text-align:center;">© 2025 EcoGarbage. Tous droits réservés.</p>
      </div>
    `,
  });
};

const sendCollectorDecisionEmail = async (toEmail, userName, decision, notes) => {
  const approved = decision === 'approved';
  const safeName = escapeHtml(userName);
  const safeNotes = escapeHtml(notes || 'Dossier non conforme.');
  await transporter.sendMail({
    from: `"EcoGarbage" <${process.env.MAIL_FROM || 'no-reply@ecogarbage.app'}>`,
    to: toEmail,
    subject: approved
      ? 'Votre candidature collecteur est approuvee - EcoGarbage'
      : 'Decision concernant votre candidature collecteur - EcoGarbage',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f7faf8;border-radius:12px;">
        <h2 style="color:#1A8A3C;">EcoGarbage</h2>
        <h3>Bonjour ${safeName},</h3>
        <p style="color:#555;line-height:1.6;">
          ${approved
            ? 'Votre candidature a ete approuvee. Votre compte dispose maintenant des fonctionnalites collecteur.'
            : `Votre candidature n a pas ete approuvee. Motif : ${safeNotes}`}
        </p>
        <p style="color:#777;font-size:13px;">Connectez-vous a EcoGarbage pour consulter votre espace.</p>
      </div>
    `,
  });
};

module.exports = {
  isEmailConfigured,
  sendCollectorDecisionEmail,
  sendNotificationFallbackEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
};
