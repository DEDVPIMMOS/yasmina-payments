const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const { put } = require('@vercel/blob');

const MONTANT_CENTIMES = 85000;
// 2 Mo par fichier : le base64 gonfle de ~33 % et Vercel plafonne le corps
// de requete a 4,5 Mo. 2 + 2 Mo encodes tiennent sous la limite.
const MAX_FICHIER = 2 * 1024 * 1024;
const TYPES_CV = ['application/pdf', 'image/jpeg', 'image/png'];
const TYPES_PHOTO = ['image/jpeg', 'image/png', 'image/webp'];

const trunc = (v, n = 480) => String(v || '').trim().slice(0, n);
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CIVILITES = { M: 'M.', Mme: 'Mme', Autre: '' };

/** "data:image/jpeg;base64,AAAA" -> { buffer, mime } */
function decodeFichier(dataUrl, typesAutorises) {
  if (!dataUrl) return null;
  const m = /^data:([\w./+-]+);base64,(.+)$/.exec(String(dataUrl));
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!typesAutorises.includes(mime)) return { erreur: `Format non accepté (${mime})` };
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length) return null;
  if (buffer.length > MAX_FICHIER) return { erreur: 'Fichier trop volumineux (2 Mo maximum)' };
  return { buffer, mime };
}

const extension = (mime) => ({
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
}[mime] || 'bin');

const MAX_CORPS = 6 * 1024 * 1024;

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    let taille = 0;
    const chunks = [];
    req.on('data', (c) => {
      taille += c.length;
      if (taille > MAX_CORPS) {
        reject(Object.assign(new Error('Dossier trop volumineux'), { tropGros: true }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  const manquantes = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'ZOHO_USER', 'ZOHO_PASS']
    .filter((k) => !process.env[k]);
  if (manquantes.length) {
    console.error('[candidature] variables manquantes :', manquantes.join(', '));
    return res.status(500).json({ error: 'Service non configuré', code: 'config_manquante' });
  }

  // Le retour d'un paiement redirigé a besoin de la clé publiable pour
  // interroger Stripe ; elle est publique par nature.
  if (req.method === 'GET') {
    return res.status(200).json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  let d;
  try {
    const brut = await lireCorps(req);
    d = JSON.parse(brut);
  } catch (e) {
    if (e.tropGros) {
      return res.status(413).json({
        error: 'Dossier trop volumineux — réduisez la taille du CV ou de la photo',
        champ: 'cvFile',
      });
    }
    return res.status(400).json({ error: 'Requête illisible' });
  }
  if (!d || typeof d !== 'object') return res.status(400).json({ error: 'Corps de requête vide' });

  // Piège à robots : rempli => on répond OK sans rien faire.
  if (trunc(d.website)) return res.status(200).json({ ok: true });

  const civilite = CIVILITES[d.civilite] !== undefined ? d.civilite : 'Autre';
  const prenom = trunc(d.prenom, 100);
  const nom = trunc(d.nom, 100);
  const email = trunc(d.email, 255);
  const telephone = trunc(d.telephone, 30);
  const ville = trunc(d.ville, 100);
  const motivation = trunc(d.motivation);
  const videoUrl = trunc(d.videoUrl, 400);

  if (!prenom || !nom) return res.status(400).json({ error: 'Nom et prénom requis', champ: 'nom' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Adresse e-mail invalide', champ: 'email' });
  }
  if (!motivation) return res.status(400).json({ error: 'Motivation requise', champ: 'motivation' });
  if (!/^https?:\/\//i.test(videoUrl)) {
    return res.status(400).json({ error: 'Lien vidéo requis (https://…)', champ: 'videoUrl' });
  }

  const cv = decodeFichier(d.cvFile, TYPES_CV);
  const photo = decodeFichier(d.photoFile, TYPES_PHOTO);
  if (!cv) return res.status(400).json({ error: 'CV requis (PDF, JPG ou PNG)', champ: 'cvFile' });
  if (cv.erreur) return res.status(400).json({ error: `CV : ${cv.erreur}`, champ: 'cvFile' });
  if (!photo) return res.status(400).json({ error: 'Photo requise (JPG, PNG ou WebP)', champ: 'photoFile' });
  if (photo.erreur) return res.status(400).json({ error: `Photo : ${photo.erreur}`, champ: 'photoFile' });

  const civiliteTxt = CIVILITES[civilite];
  const nomComplet = `${prenom} ${nom}`.trim();
  const intitule = `${civiliteTxt ? civiliteTxt + ' ' : ''}${nomComplet}`.trim();
  const slug = nomComplet.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'candidat';

  try {
    // ── 1. Stockage des pièces ──────────────────────────────────────────
    let cvUrl = '';
    let photoUrl = '';
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      // Le store peut être public ou privé : on tente le public (lien
      // ouvrable depuis l'e-mail), sinon on bascule en privé et on
      // n'expose aucun lien inutilisable.
      const deposer = async (chemin, buffer, contentType) => {
        const base = { addRandomSuffix: true, token: process.env.BLOB_READ_WRITE_TOKEN, contentType };
        try {
          const r = await put(chemin, buffer, { ...base, access: 'public' });
          return { url: r.url, ouvrable: true };
        } catch (e) {
          const r = await put(chemin, buffer, { ...base, access: 'private' });
          return { url: r.url, ouvrable: false };
        }
      };
      const [rCv, rPhoto] = await Promise.all([
        deposer(`candidatures/${slug}-cv.${extension(cv.mime)}`, cv.buffer, cv.mime),
        deposer(`candidatures/${slug}-photo.${extension(photo.mime)}`, photo.buffer, photo.mime),
      ]);
      if (rCv.ouvrable) cvUrl = rCv.url;
      if (rPhoto.ouvrable) photoUrl = rPhoto.url;
      if (!rCv.ouvrable) {
        console.warn('[candidature] store Blob privé : liens omis, pièces jointes seules');
      }
    } else {
      console.warn('[candidature] BLOB_READ_WRITE_TOKEN absent : pièces envoyées par e-mail uniquement');
    }

    // ── 2. Intention de paiement ────────────────────────────────────────
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const intent = await stripe.paymentIntents.create({
      amount: MONTANT_CENTIMES,
      currency: 'eur',
      // Laisse Stripe proposer tout ce qui est activé sur le compte :
      // carte, Apple Pay, Link… et Alma dès qu'il sera activé.
      automatic_payment_methods: { enabled: true },
      receipt_email: email,
      description: `Stage jeu cinéma 7→11 sept. 2026 — ${intitule}`,
      metadata: {
        civilite, prenom, nom, email, telephone, ville,
        motivation, videoUrl, cvUrl, photoUrl,
      },
    });

    // ── 3. Notification immédiate (filet de sécurité avant paiement) ────
    try {
      const transport = nodemailer.createTransport({
        host: process.env.ZOHO_HOST || 'smtp.zoho.eu',
        port: 465,
        secure: true,
        auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
      });
      await transport.sendMail({
        from: `"Candidatures — site" <${process.env.ZOHO_USER}>`,
        to: process.env.NOTIFY_TO || process.env.ZOHO_USER,
        replyTo: `"${nomComplet}" <${email}>`,
        subject: `Dossier reçu (paiement en cours) — ${intitule}`,
        html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto">
          <div style="font:800 11px system-ui;letter-spacing:.24em;text-transform:uppercase;color:#a06800">Paiement en cours</div>
          <h1 style="font-size:23px;margin:8px 0 6px;color:#1a1410">${esc(intitule)}</h1>
          <p style="font-size:14px;color:#6a5e4a;line-height:1.6;margin:0 0 16px">
            Ce dossier vient d'être déposé. Les pièces sont en pièces jointes.<br>
            <b>Le paiement n'est pas encore confirmé</b> — vous recevrez un second e-mail avec le reçu s'il aboutit.
          </p>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e3ddd0;font-size:14px">
            <tr><td style="padding:8px 12px;background:#f6f2e9;white-space:nowrap">E-mail</td><td style="padding:8px 12px">${esc(email)}</td></tr>
            <tr><td style="padding:8px 12px;background:#f6f2e9;white-space:nowrap">Téléphone</td><td style="padding:8px 12px">${esc(telephone) || '—'}</td></tr>
            <tr><td style="padding:8px 12px;background:#f6f2e9;white-space:nowrap">Ville</td><td style="padding:8px 12px">${esc(ville) || '—'}</td></tr>
            <tr><td style="padding:8px 12px;background:#f6f2e9;white-space:nowrap;vertical-align:top">Motivation</td><td style="padding:8px 12px;line-height:1.6">${esc(motivation).replace(/\n/g, '<br>')}</td></tr>
            <tr><td style="padding:8px 12px;background:#f6f2e9;white-space:nowrap">Vidéo</td><td style="padding:8px 12px"><a href="${esc(videoUrl)}">${esc(videoUrl)}</a></td></tr>
          </table>
        </div>`,
        attachments: [
          { filename: `${slug}-cv.${extension(cv.mime)}`, content: cv.buffer, contentType: cv.mime },
          { filename: `${slug}-photo.${extension(photo.mime)}`, content: photo.buffer, contentType: photo.mime },
        ],
      });
    } catch (e) {
      // L'e-mail est un filet de sécurité : son échec ne doit pas bloquer le paiement.
      console.error('[candidature] notification immédiate non envoyée :', e.message);
    }

    return res.status(200).json({
      clientSecret: intent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      montant: MONTANT_CENTIMES,
    });
  } catch (err) {
    console.error('[candidature] échec :', err.code || '-', err.message);
    return res.status(502).json({
      error: "Impossible d'ouvrir le paiement",
      code: err.code || err.type || null,
    });
  }
};

// Corps lu a la main (pieces en base64) : doit etre declare APRES
// l affectation du handler, sinon module.exports l ecrase.
module.exports.config = { api: { bodyParser: false } };
