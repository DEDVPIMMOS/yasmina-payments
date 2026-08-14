const Stripe = require('stripe');
const nodemailer = require('nodemailer');

/**
 * Exercice des droits RGPD (accès, rectification, effacement, opposition,
 * limitation, portabilité). La demande est tracée et notifiée au responsable,
 * qui dispose d'un mois pour répondre.
 *
 * Le traitement reste humain à dessein : supprimer automatiquement sur simple
 * requête HTTP ouvrirait la porte à l'effacement malveillant du dossier d'un
 * tiers. On enregistre la demande, on notifie, on accuse réception.
 */
const DROITS = {
  acces: "Accès à mes données",
  rectification: "Rectification d'une donnée inexacte",
  effacement: "Effacement de mes données",
  limitation: "Limitation du traitement",
  opposition: "Opposition au traitement",
  portabilite: "Portabilité de mes données",
};

const MAX_CORPS = 64 * 1024;
const trunc = (v, n = 500) => String(v || '').trim().slice(0, n);
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    let taille = 0;
    const chunks = [];
    req.on('data', (c) => {
      taille += c.length;
      if (taille > MAX_CORPS) { reject(new Error('trop volumineux')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ droits: DROITS });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  let d;
  try { d = JSON.parse(await lireCorps(req)); }
  catch { return res.status(400).json({ error: 'Requête illisible' }); }

  if (trunc(d.website)) return res.status(200).json({ ok: true });

  const email = trunc(d.email, 255);
  const droit = DROITS[d.droit] ? d.droit : null;
  const precisions = trunc(d.precisions, 1500);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Adresse e-mail invalide', champ: 'email' });
  }
  if (!droit) return res.status(400).json({ error: 'Droit à exercer manquant', champ: 'droit' });

  const manquantes = ['ZOHO_USER', 'ZOHO_PASS'].filter((k) => !process.env[k]);
  if (manquantes.length) {
    console.error('[mes-donnees] variables manquantes :', manquantes.join(', '));
    return res.status(500).json({ error: 'Service indisponible', code: 'config_manquante' });
  }

  // Contexte utile au responsable : les paiements liés à cette adresse.
  let contexte = 'Recherche Stripe non effectuée.';
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      const r = await stripe.paymentIntents.search({
        query: `metadata['email']:'${email.replace(/'/g, '')}'`,
        limit: 10,
      });
      contexte = r.data.length
        ? r.data.map((p) => `${p.id} — ${(p.amount / 100).toFixed(2)} € — ${p.status} — ${new Date(p.created * 1000).toLocaleDateString('fr-FR')}`).join('<br>')
        : 'Aucun paiement trouvé pour cette adresse.';
    } catch (e) {
      contexte = 'Recherche Stripe impossible : ' + e.message;
    }
  }

  const recu = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const echeance = new Date(Date.now() + 30 * 86400000).toLocaleDateString('fr-FR');

  try {
    const transport = nodemailer.createTransport({
      host: process.env.ZOHO_HOST || 'smtp.zoho.eu',
      port: 465, secure: true,
      auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
    });

    await transport.sendMail({
      from: `"Demande RGPD — site" <${process.env.ZOHO_USER}>`,
      to: process.env.NOTIFY_TO || process.env.ZOHO_USER,
      replyTo: email,
      subject: `RGPD — ${DROITS[droit]} — ${email}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto">
        <div style="font:700 11px system-ui;letter-spacing:.2em;text-transform:uppercase;color:#B45309">Demande d'exercice de droit</div>
        <h1 style="font-size:21px;margin:8px 0 4px;color:#0B1230">${esc(DROITS[droit])}</h1>
        <p style="font-size:14px;color:#5B6478;margin:0 0 16px">
          Reçue le ${esc(recu)} · <b>réponse due avant le ${esc(echeance)}</b> (un mois, art. 12.3 RGPD)
        </p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #E3E8F2;font-size:14px">
          <tr><td style="padding:9px 13px;background:#F8FAFD;white-space:nowrap">Demandeur</td><td style="padding:9px 13px">${esc(email)}</td></tr>
          <tr><td style="padding:9px 13px;background:#F8FAFD;white-space:nowrap;vertical-align:top">Précisions</td><td style="padding:9px 13px;line-height:1.6">${esc(precisions).replace(/\n/g, '<br>') || '—'}</td></tr>
          <tr><td style="padding:9px 13px;background:#F8FAFD;white-space:nowrap;vertical-align:top">Paiements liés</td><td style="padding:9px 13px;line-height:1.6">${contexte}</td></tr>
        </table>
        <p style="margin:18px 0 0;font-size:13px;color:#5B6478;line-height:1.7">
          <b>À faire :</b> vérifier l'identité du demandeur en cas de doute raisonnable, puis traiter.<br>
          Pour un effacement : supprimer le dossier de la messagerie et les pièces du stockage.
          <b>Les factures et pièces comptables doivent être conservées 10 ans</b> — elles sont
          exclues du droit à l'effacement (art. 17.3.b RGPD).<br>
          Répondre à cet e-mail écrit directement au demandeur.
        </p>
      </div>`,
    });

    // Accusé de réception : obligatoire pour que la personne sache que sa
    // demande est prise en compte et dans quel délai.
    try {
      await transport.sendMail({
        from: `"Yasmina Pastural Training" <${process.env.ZOHO_USER}>`,
        to: email,
        subject: 'Votre demande relative à vos données personnelles',
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
          <h1 style="font-size:20px;color:#0B1230">Demande bien reçue</h1>
          <p style="font-size:15px;line-height:1.7;color:#0B1230">
            Nous avons enregistré votre demande — <b>${esc(DROITS[droit])}</b> — le ${esc(recu)}.
          </p>
          <p style="font-size:15px;line-height:1.7;color:#0B1230">
            Conformément au RGPD, une réponse vous sera apportée <b>dans un délai d'un mois</b>,
            soit avant le ${esc(echeance)}. Ce délai peut être prolongé de deux mois si la demande
            est complexe ; vous en seriez alors informé.
          </p>
          <p style="font-size:13.5px;line-height:1.7;color:#5B6478">
            Si vous n'êtes pas à l'origine de cette demande, signalez-le en répondant à cet e-mail.
          </p>
        </div>`,
      });
    } catch (e) {
      console.error('[mes-donnees] accusé non envoyé :', e.message);
    }

    return res.status(200).json({ ok: true, echeance });
  } catch (err) {
    console.error('[mes-donnees] échec :', err.message);
    return res.status(502).json({ error: "Envoi impossible, écrivez-nous directement" });
  }
};

// Corps lu a la main : a declarer APRES l affectation du handler.
module.exports.config = { api: { bodyParser: false } };
