const Stripe = require('stripe');

const MONTANT_CENTIMES = 85000;
const trunc = (v, n = 490) => String(v || '').trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[create-checkout] STRIPE_SECRET_KEY manquant');
    return res.status(500).json({ error: 'Paiement non configuré' });
  }
  let d = req.body;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return res.status(400).json({ error: 'JSON invalide' }); }
  }
  const email = trunc(d?.email);
  const prenom = trunc(d?.prenom);
  const nom = trunc(d?.nom);
  const cvUrl = trunc(d?.cvUrl);
  const photoUrl = trunc(d?.photoUrl);
  const videoUrl = trunc(d?.videoUrl);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Adresse e-mail invalide' });
  }
  if (!prenom || !nom) {
    return res.status(400).json({ error: 'Nom et prénom requis' });
  }
  if (![cvUrl, photoUrl, videoUrl].every((u) => /^https?:\/\//.test(u))) {
    return res.status(400).json({ error: 'Liens CV / photo / vidéo manquants ou invalides' });
  }
  const siteUrl = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');
  const buildSession = (methods) => ({
    mode: 'payment',
    payment_method_types: methods,
    customer_email: email,
    line_items: [{
      price_data: {
        currency: 'eur',
        unit_amount: MONTANT_CENTIMES,
        product_data: {
          name: 'Stage jeu cinéma — Yasmina Pastural Training',
          description: 'Session du 7 au 11 septembre 2026 · 850 € tout compris',
        },
      },
      quantity: 1,
    }],
    metadata: {
      prenom,
      nom,
      email,
      telephone: trunc(d?.telephone),
      ville: trunc(d?.ville),
      formation: trunc(d?.formation),
      experiences: trunc(d?.experiences),
      motivation: trunc(d?.motivation),
      cvUrl,
      photoUrl,
      videoUrl,
    },
    success_url: `${siteUrl}/candidater.html?paiement=ok`,
    cancel_url: `${siteUrl}/candidater.html?paiement=annule`,
  });

  // Alma si le compte l'a activé, sinon carte seule : on ne bloque jamais le paiement
  // parce qu'un moyen de paiement n'est pas (encore) disponible côté Stripe.
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const session = await stripe.checkout.sessions.create(buildSession(['card', 'alma']));
    return res.status(200).json({ url: session.url });
  } catch (err) {
    const methodIndisponible = err?.type === 'StripeInvalidRequestError'
      && /payment_method_types|payment method type|alma/i.test(`${err?.param || ''} ${err?.message || ''}`);
    if (!methodIndisponible) {
      console.error('[create-checkout] échec Stripe :', err.code || '-', err.message);
      return res.status(502).json({ error: 'Impossible de créer le paiement', code: err.code || err.type || null });
    }
    console.warn('[create-checkout] Alma indisponible sur ce compte, repli sur la carte seule');
    try {
      const session = await stripe.checkout.sessions.create(buildSession(['card']));
      return res.status(200).json({ url: session.url });
    } catch (err2) {
      console.error('[create-checkout] échec Stripe (repli carte) :', err2.code || '-', err2.message);
      return res.status(502).json({ error: 'Impossible de créer le paiement', code: err2.code || err2.type || null });
    }
  }
};
