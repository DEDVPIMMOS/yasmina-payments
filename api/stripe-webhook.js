const Stripe = require('stripe');
const nodemailer = require('nodemailer');

module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const required = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'ZOHO_USER', 'ZOHO_PASS'];
  const manquantes = required.filter((k) => !process.env[k]);
  if (manquantes.length) {
    console.error('[stripe-webhook] variables manquantes :', manquantes.join(', '));
    return res.status(500).end();
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    const rawBody = await readRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] signature invalide :', err.message);
    return res.status(400).send('Signature invalide');
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  const m = session.metadata || {};
  if (!m.email || !m.nom) {
    console.error('[stripe-webhook] session sans metadonnees candidat', session.id);
    return res.status(200).json({ received: true, error: 'métadonnées manquantes' });
  }

  try {
    const nomComplet = `${esc(m.prenom)} ${esc(m.nom)}`;
    const montant = ((session.amount_total || 0) / 100).toFixed(2).replace('.', ',');

    const ligne = (t, v) => (String(v || '').trim()
      ? `<tr><td style="padding:9px 14px;background:#f6f2e9;font:600 12px system-ui;text-transform:uppercase;color:#7a6e62;white-space:nowrap;vertical-align:top">${t}</td>
           <td style="padding:9px 14px;font:400 15px/1.6 system-ui;color:#1a1410">${esc(v).replace(/\n/g, '<br>')}</td></tr>`
      : '');
    const ligneLien = (t, url) => (String(url || '').trim()
      ? `<tr><td style="padding:9px 14px;background:#f6f2e9;font:600 12px system-ui;text-transform:uppercase;color:#7a6e62;white-space:nowrap;vertical-align:top">${t}</td>
           <td style="padding:9px 14px;font:400 15px/1.6 system-ui"><a href="${esc(url)}" style="color:#a06800">${esc(url)}</a></td></tr>`
      : '');

    const html = `
    <div style="max-width:640px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif">
      <div style="border-top:3px solid #22c55e;padding:22px 0 14px">
        <div style="font:800 11px system-ui;letter-spacing:.28em;text-transform:uppercase;color:#15803d">Candidature payée</div>
        <h1 style="font-size:25px;margin:10px 0 4px;color:#1a1410">${nomComplet}</h1>
        <div style="font-size:14px;color:#15803d;font-weight:600">${montant} € réglés · paiement confirmé par Stripe</div>
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e3ddd0">
        ${ligne('E-mail', m.email)}
        ${ligne('Téléphone', m.telephone)}
        ${ligne('Ville', m.ville)}
        ${ligne('Formation', m.formation)}
        ${ligne('Expériences', m.experiences)}
        ${ligne('Motivations', m.motivation)}
        ${ligneLien('CV', m.cvUrl)}
        ${ligneLien('Photo', m.photoUrl)}
        ${ligneLien('Vidéo de présentation', m.videoUrl)}
      </table>
      <p style="margin:18px 0 0;font-size:13px;color:#7a6e62">
        Les liens ci-dessus sont ceux fournis par le candidat (Drive, Dropbox…) — leur disponibilité dépend de lui.<br>
        Répondre directement à cet e-mail écrit au candidat.<br>
        En cas de refus après coup : remboursement manuel depuis le dashboard Stripe.
      </p>
    </div>`;

    const transport = nodemailer.createTransport({
      host: process.env.ZOHO_HOST || 'smtp.zoho.eu',
      port: 465,
      secure: true,
      auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
    });

    await transport.sendMail({
      from: `"Candidatures — site" <${process.env.ZOHO_USER}>`,
      to: process.env.NOTIFY_TO || process.env.ZOHO_USER,
      replyTo: `"${nomComplet}" <${m.email}>`,
      subject: `✅ Candidature payée — ${nomComplet} (${montant} €)`,
      html,
    });

    try {
      await transport.sendMail({
        from: `"Yasmina Pastural Training" <${process.env.ZOHO_USER}>`,
        to: m.email,
        subject: 'Paiement confirmé — candidature reçue',
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
          <h1 style="font-size:22px">Merci ${esc(m.prenom)}.</h1>
          <p>Votre paiement de ${montant} € a bien été confirmé et votre dossier transmis à Yasmina.
          Elle revient vers vous sous 48h.</p></div>`,
      });
    } catch (e) {
      console.error('[stripe-webhook] accusé candidat non envoyé :', e.message);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[stripe-webhook] échec traitement :', err.message);
    return res.status(200).json({ received: true, error: err.message });
  }
};
