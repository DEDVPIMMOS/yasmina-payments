const Stripe = require('stripe');
const nodemailer = require('nodemailer');

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

const CIVILITES = { M: 'M.', Mme: 'Mme', Autre: '' };

// Le formulaire crée un PaymentIntent ; l'ancien parcours Checkout est conservé
// le temps que les sessions déjà ouvertes se terminent.
const EVENEMENTS = ['payment_intent.succeeded', 'checkout.session.completed'];

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

  if (!EVENEMENTS.includes(event.type)) {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const objet = event.data.object;
  const m = objet.metadata || {};
  if (!m.email || !m.nom) {
    console.error('[stripe-webhook] paiement sans métadonnées candidat', objet.id);
    return res.status(200).json({ received: true, error: 'métadonnées manquantes' });
  }

  const centimes = objet.amount_received || objet.amount || objet.amount_total || 0;
  const montant = (centimes / 100).toFixed(2).replace('.', ',');

  // Reçu Stripe : porté par la charge, qu'il faut demander explicitement.
  let recuUrl = '';
  let moyen = '';
  try {
    if (objet.object === 'payment_intent') {
      const pi = await stripe.paymentIntents.retrieve(objet.id, { expand: ['latest_charge'] });
      const charge = pi.latest_charge;
      if (charge) {
        recuUrl = charge.receipt_url || '';
        moyen = charge.payment_method_details?.type || '';
      }
    }
  } catch (e) {
    console.error('[stripe-webhook] reçu indisponible :', e.message);
  }

  try {
    const civiliteTxt = CIVILITES[m.civilite] || '';
    const nomComplet = `${esc(m.prenom)} ${esc(m.nom)}`.trim();
    const intitule = `${civiliteTxt ? civiliteTxt + ' ' : ''}${nomComplet}`.trim();

    const ligne = (t, v) => (String(v || '').trim()
      ? `<tr><td style="padding:9px 14px;background:#f6f2e9;font:600 12px system-ui;text-transform:uppercase;color:#7a6e62;white-space:nowrap;vertical-align:top">${t}</td>
           <td style="padding:9px 14px;font:400 15px/1.6 system-ui;color:#1a1410">${esc(v).replace(/\n/g, '<br>')}</td></tr>`
      : '');
    const ligneLien = (t, url, libelle) => (String(url || '').trim()
      ? `<tr><td style="padding:9px 14px;background:#f6f2e9;font:600 12px system-ui;text-transform:uppercase;color:#7a6e62;white-space:nowrap;vertical-align:top">${t}</td>
           <td style="padding:9px 14px;font:400 15px/1.6 system-ui"><a href="${esc(url)}" style="color:#a06800">${esc(libelle || url)}</a></td></tr>`
      : '');

    const html = `
    <div style="max-width:640px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif">
      <div style="border-top:3px solid #ff4d97;padding:22px 0 14px">
        <div style="font:800 11px system-ui;letter-spacing:.28em;text-transform:uppercase;color:#ff4d97">Inscription payée</div>
        <h1 style="font-size:25px;margin:10px 0 4px;color:#1a1410">${intitule}</h1>
        <div style="font-size:14px;color:#1a1410;font-weight:600">
          ${montant} € réglés${moyen ? ` · ${esc(moyen)}` : ''} · confirmé par Stripe
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e3ddd0">
        ${ligne('E-mail', m.email)}
        ${ligne('Téléphone', m.telephone)}
        ${ligne('Ville', m.ville)}
        ${ligne('Motivation', m.motivation)}
        ${ligneLien('Vidéo', m.videoUrl)}
        ${ligne('Pièces archivées', [m.cvChemin, m.photoChemin].filter(Boolean).join('\n'))}
        ${ligneLien('Reçu de paiement', recuUrl, 'Ouvrir le reçu Stripe')}
      </table>
      <p style="margin:18px 0 0;font-size:13px;color:#7a6e62;line-height:1.6">
        Le CV et la photo sont en pièces jointes du premier e-mail « Dossier reçu ».<br>
        ${m.cvChemin ? 'Ils sont aussi archivés dans l\'espace privé de stockage (Paris), consultable depuis le tableau de bord Vercel.<br>' : ''}
        Répondre directement à cet e-mail écrit au candidat.<br>
        En cas de refus après coup : remboursement depuis le dashboard Stripe.
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
      subject: `Candidature et inscription de ${intitule}`,
      html,
    });

    try {
      await transport.sendMail({
        from: `"Yasmina Pastural Training" <${process.env.ZOHO_USER}>`,
        to: m.email,
        subject: 'Inscription confirmée — stage du 28 septembre au 2 octobre 2026',
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
          <h1 style="font-size:22px;color:#1a1410">Merci ${esc(m.prenom)}.</h1>
          <p style="font-size:15px;line-height:1.7;color:#1a1410">
            Votre paiement de ${montant} € est confirmé et votre dossier est transmis à Yasmina.
            Elle revient vers vous sous 48 h.
          </p>
          ${recuUrl ? `<p style="font-size:15px"><a href="${esc(recuUrl)}" style="color:#ff4d97">Consulter votre reçu</a></p>` : ''}
        </div>`,
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

// Signature Stripe : le corps doit rester brut. A declarer APRES
// l affectation du handler, sinon module.exports l ecrase.
module.exports.config = { api: { bodyParser: false } };
