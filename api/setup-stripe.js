const Stripe = require('stripe');

const DOMAINE = 'yptraining.vercel.app';
const EVENEMENTS_REQUIS = ['payment_intent.succeeded', 'payment_intent.payment_failed'];

/**
 * Mise en conformité du compte Stripe pour ce site. POST uniquement.
 * Idempotent : relancer ne fait rien de plus.
 */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST uniquement' });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY absente' });
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const fait = [];
  const echecs = [];

  // ── 1. Le webhook doit écouter payment_intent.succeeded ──────────────
  try {
    const { data } = await stripe.webhookEndpoints.list({ limit: 20 });
    const cible = data.find((w) => w.url.includes(DOMAINE) && w.status === 'enabled');
    if (!cible) {
      echecs.push({ etape: 'webhook', raison: `Aucun webhook actif vers ${DOMAINE}` });
    } else {
      const manquants = EVENEMENTS_REQUIS.filter((e) => !cible.enabled_events.includes(e));
      if (!manquants.length) {
        fait.push({ etape: 'webhook', resultat: 'déjà conforme', evenements: cible.enabled_events });
      } else {
        const maj = await stripe.webhookEndpoints.update(cible.id, {
          enabled_events: [...new Set([...cible.enabled_events, ...EVENEMENTS_REQUIS])],
        });
        fait.push({ etape: 'webhook', resultat: 'événements ajoutés', ajoutes: manquants, evenements: maj.enabled_events });
      }
    }
  } catch (e) {
    echecs.push({ etape: 'webhook', raison: e.message });
  }

  // ── 2. Domaine déclaré pour Apple Pay ────────────────────────────────
  try {
    const { data } = await stripe.applePayDomains.list({ limit: 20 });
    if (data.some((d) => d.domain_name === DOMAINE)) {
      fait.push({ etape: 'apple_pay', resultat: 'domaine déjà déclaré' });
    } else {
      await stripe.applePayDomains.create({ domain_name: DOMAINE });
      fait.push({ etape: 'apple_pay', resultat: 'domaine déclaré', domaine: DOMAINE });
    }
  } catch (e) {
    echecs.push({ etape: 'apple_pay', raison: e.message });
  }

  // ── 3. Tenter d'activer Alma ─────────────────────────────────────────
  // S'il est simplement désactivé, un basculement suffit. S'il demande une
  // souscription auprès d'Alma, Stripe renvoie une erreur explicite.
  try {
    const { data } = await stripe.paymentMethodConfigurations.list({ limit: 3 });
    const cfg = data[0];
    if (!cfg) {
      echecs.push({ etape: 'alma', raison: 'Aucune configuration de moyens de paiement' });
    } else if (cfg.alma?.display_preference?.value === 'on') {
      fait.push({ etape: 'alma', resultat: 'déjà actif' });
    } else {
      const maj = await stripe.paymentMethodConfigurations.update(cfg.id, {
        alma: { display_preference: { preference: 'on' } },
      });
      const actif = maj.alma?.display_preference?.value === 'on';
      if (actif) fait.push({ etape: 'alma', resultat: 'activé' });
      else echecs.push({
        etape: 'alma',
        raison: "Stripe accepte le réglage mais ne l'active pas : Alma doit être souscrit depuis le Dashboard",
        etat: maj.alma?.display_preference || null,
      });
    }
  } catch (e) {
    echecs.push({ etape: 'alma', raison: e.message });
  }

  return res.status(200).json({ fait, echecs });
};
