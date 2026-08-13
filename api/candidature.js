const nodemailer = require('nodemailer');

/* ─────────────────────────────────────────────────────────────
   Réception d'une candidature → e-mail à Yasmina + accusé au candidat.

   Variables d'environnement à définir dans Vercel
   (Settings → Environment Variables) :
     ZOHO_USER   contact@yasminapasturaltraining.com
     ZOHO_PASS   mot de passe d'application Zoho (PAS le mot de passe du compte)
     ZOHO_HOST   optionnel — smtp.zoho.eu par défaut
     NOTIFY_TO   optionnel — destinataire des notifications, ZOHO_USER par défaut
   ───────────────────────────────────────────────────────────── */

const MAX_CV_BYTES = 3.5 * 1024 * 1024;

const esc = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const LABELS = {
  '1x': 'En 1 fois — 850 €',
  '2x': 'En 2 fois — 2 × 425 €, sans frais (Alma)',
  '3x': 'En 3 fois — sans frais (Alma)',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  if (!process.env.ZOHO_USER || !process.env.ZOHO_PASS) {
    console.error('[candidature] ZOHO_USER / ZOHO_PASS manquants');
    return res.status(500).json({ error: 'Service e-mail non configuré' });
  }

  let d = req.body;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return res.status(400).json({ error: 'JSON invalide' }); }
  }
  if (!d || typeof d !== 'object') return res.status(400).json({ error: 'Corps de requête vide' });

  // ── Validation serveur (ne jamais se fier au navigateur) ──
  const manque = ['prenom', 'nom', 'email', 'telephone', 'motivation']
    .filter((k) => !String(d[k] || '').trim());
  if (manque.length) {
    return res.status(400).json({ error: 'Champs manquants', champs: manque });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(d.email).trim())) {
    return res.status(400).json({ error: 'Adresse e-mail invalide' });
  }

  // ── Pot de miel anti-spam : rempli = robot, on répond 200 sans rien envoyer ──
  if (String(d.website || '').trim()) return res.status(200).json({ ok: true });

  const nomComplet = `${String(d.prenom).trim()} ${String(d.nom).trim()}`;
  const formule = LABELS[d.paiement] || String(d.paiement || '—');

  // ── CV en pièce jointe si transmis et raisonnable ──
  const pieces = [];
  let noteCv = 'Aucun CV joint.';
  if (d.cvData && d.cvNom) {
    const b64 = String(d.cvData).split(',').pop();
    const taille = Math.floor((b64.length * 3) / 4);
    if (taille > MAX_CV_BYTES) {
      noteCv = `CV « ${d.cvNom} » trop volumineux pour l'envoi automatique — à redemander au candidat.`;
    } else {
      pieces.push({ filename: String(d.cvNom), content: b64, encoding: 'base64' });
      noteCv = `CV joint : ${d.cvNom}`;
    }
  } else if (d.cvNom) {
    noteCv = `CV « ${d.cvNom} » sélectionné mais non transmis.`;
  }

  const ligne = (t, v) => (String(v || '').trim()
    ? `<tr><td style="padding:9px 14px;background:#f6f2e9;font:600 12px/1.4 system-ui;text-transform:uppercase;letter-spacing:.06em;color:#7a6e62;white-space:nowrap;vertical-align:top">${t}</td>
         <td style="padding:9px 14px;font:400 15px/1.6 system-ui;color:#1a1410">${esc(v).replace(/\n/g, '<br>')}</td></tr>`
    : '');

  const mailYasmina = `
  <div style="max-width:640px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif">
    <div style="border-top:3px solid #ffd400;padding:22px 0 14px">
      <div style="font:800 11px/1 system-ui;letter-spacing:.28em;text-transform:uppercase;color:#a06800">Nouvelle candidature</div>
      <h1 style="font-size:25px;margin:10px 0 4px;color:#1a1410">${esc(nomComplet)}</h1>
      <div style="font-size:13px;color:#7a6e62">Session ${esc(d.session || '—')}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e3ddd0">
      ${ligne('E-mail', d.email)}
      ${ligne('Téléphone', d.telephone)}
      ${ligne('Ville', d.ville)}
      ${ligne('Formation', d.formation)}
      ${ligne('Expériences', d.experiences)}
      ${ligne('Motivations', d.motivation)}
      ${ligne('Vidéo', d.videoUrl)}
      ${ligne('Règlement souhaité', formule)}
      ${ligne('CV', noteCv)}
    </table>
    <p style="margin:18px 0 0;font-size:13px;color:#7a6e62">
      Répondre directement à cet e-mail écrit au candidat.
    </p>
  </div>`;

  const mailCandidat = `
  <div style="max-width:600px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;color:#1a1410">
    <div style="border-top:3px solid #ffd400;padding:22px 0 12px">
      <div style="font:800 11px/1 system-ui;letter-spacing:.28em;text-transform:uppercase;color:#a06800">Candidature reçue</div>
      <h1 style="font-size:24px;margin:10px 0 0">Merci ${esc(String(d.prenom).trim())}.</h1>
    </div>
    <p style="font-size:15px;line-height:1.75;color:#4a4038">
      Votre candidature au stage du <strong>${esc(d.session || '')}</strong> est bien arrivée.
      Yasmina lit chaque dossier personnellement et vous répond sous 48 h.
    </p>
    <p style="font-size:15px;line-height:1.75;color:#4a4038">
      En cas de validation, vous recevrez le lien de paiement sécurisé ainsi que
      le questionnaire d'inscription et la fiche de renseignements à compléter
      avant le premier jour.
    </p>
    <p style="font-size:15px;line-height:1.75;color:#4a4038">
      Aucun montant n'est débité à ce stade.
    </p>
    <div style="border-top:1px solid #e3ddd0;margin-top:26px;padding-top:14px;font-size:12.5px;color:#7a6e62">
      Yasmina Pastural Training · contact@yasminapasturaltraining.com
    </div>
  </div>`;

  try {
    const transport = nodemailer.createTransport({
      host: process.env.ZOHO_HOST || 'smtp.zoho.eu',
      port: 465,
      secure: true,
      auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
    });

    // 1. Notification à Yasmina — bloquante : si elle échoue, la candidature est perdue.
    await transport.sendMail({
      from: `"Candidatures — site" <${process.env.ZOHO_USER}>`,
      to: process.env.NOTIFY_TO || process.env.ZOHO_USER,
      replyTo: `"${nomComplet}" <${String(d.email).trim()}>`,
      subject: `Candidature — ${nomComplet} (${formule})`,
      html: mailYasmina,
      attachments: pieces,
    });

    // 2. Accusé de réception au candidat — non bloquant.
    try {
      await transport.sendMail({
        from: `"Yasmina Pastural Training" <${process.env.ZOHO_USER}>`,
        to: String(d.email).trim(),
        subject: 'Votre candidature est bien arrivée',
        html: mailCandidat,
      });
    } catch (e) {
      console.error('[candidature] accusé candidat non envoyé :', e.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[candidature] échec envoi :', err);
    return res.status(502).json({ error: "L'envoi a échoué" });
  }
};
