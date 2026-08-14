const Stripe = require('stripe');

/**
 * État de santé de la chaîne de paiement — lecture seule, aucun effet de bord.
 * Ne renvoie jamais de secret : uniquement des booléens, des noms de moyens
 * de paiement et des événements de webhook, tous déjà publics côté client.
 */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const env = {
    STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
    STRIPE_PUBLISHABLE_KEY: !!process.env.STRIPE_PUBLISHABLE_KEY,
    STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
    ZOHO_USER: !!process.env.ZOHO_USER,
    ZOHO_PASS: !!process.env.ZOHO_PASS,
    NOTIFY_TO: !!process.env.NOTIFY_TO,
    BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
  };

  const out = { env, mode: null, compte: null, moyens: null, webhooks: null, applePay: null, erreurs: [] };

  if (!process.env.STRIPE_SECRET_KEY) {
    out.erreurs.push('STRIPE_SECRET_KEY absente : aucun diagnostic Stripe possible');
    return res.status(200).json(out);
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  out.mode = /^sk_live/.test(process.env.STRIPE_SECRET_KEY) ? 'live' : 'test';

  const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
  if (pk) {
    const pkMode = /^pk_live/.test(pk) ? 'live' : 'test';
    if (pkMode !== out.mode) {
      out.erreurs.push(`Clés incohérentes : secrète en ${out.mode}, publiable en ${pkMode}`);
    }
  }

  await Promise.all([
    stripe.accounts.retrieve()
      .then((a) => {
        out.compte = {
          id: a.id,
          pays: a.country,
          paiements_actifs: a.charges_enabled,
          virements_actifs: a.payouts_enabled,
          exigences_en_attente: (a.requirements?.currently_due || []).length,
          exigences: a.requirements?.currently_due || [],
        };
        // Une capacité absente ou "inactive" prime sur la configuration des
        // moyens de paiement : le moyen ne sera jamais proposé.
        out.capacites = {
          alma: a.capabilities?.alma_payments || 'absente',
          card: a.capabilities?.card_payments || 'absente',
          klarna: a.capabilities?.klarna_payments || 'absente',
        };
        if (!a.charges_enabled) out.erreurs.push("Le compte n'est pas autorisé à encaisser");
      })
      .catch((e) => out.erreurs.push('Compte illisible : ' + e.message)),

    stripe.paymentMethodConfigurations.list({ limit: 3 })
      .then((r) => {
        out.moyens = r.data.map((c) => ({
          nom: c.name,
          actifs: Object.keys(c)
            .filter((k) => c[k] && typeof c[k] === 'object' && c[k].display_preference?.value === 'on')
            .sort(),
        }));
        const tous = out.moyens.flatMap((c) => c.actifs);
        if (!tous.includes('alma')) {
          out.erreurs.push("Alma n'est pas activé : il n'apparaîtra pas dans le formulaire");
        }
        if (!tous.includes('apple_pay')) {
          out.erreurs.push("Apple Pay n'est pas activé dans la configuration des moyens de paiement");
        }
      })
      .catch((e) => out.erreurs.push('Moyens de paiement illisibles : ' + e.message)),

    stripe.webhookEndpoints.list({ limit: 10 })
      .then((r) => {
        out.webhooks = r.data.map((w) => ({
          url: w.url,
          statut: w.status,
          evenements: w.enabled_events,
        }));
        const bon = r.data.some((w) => w.status === 'enabled' &&
          (w.enabled_events.includes('payment_intent.succeeded') || w.enabled_events.includes('*')));
        if (!bon) {
          out.erreurs.push("Aucun webhook actif n'écoute payment_intent.succeeded : aucun e-mail ne partira après paiement");
        }
      })
      .catch((e) => out.erreurs.push('Webhooks illisibles : ' + e.message)),

    stripe.applePayDomains.list({ limit: 10 })
      .then((r) => {
        out.applePay = r.data.map((d) => d.domain_name);
        if (!r.data.length) {
          out.erreurs.push("Aucun domaine Apple Pay déclaré : le bouton Apple Pay n'apparaîtra pas");
        }
      })
      .catch((e) => out.erreurs.push('Domaines Apple Pay illisibles : ' + e.message)),
  ]);

  // ?intent=1 : crée une intention de paiement puis l'annule immédiatement,
  // pour lire exactement ce qui sera proposé au candidat. Aucun débit.
  if (req.query && req.query.intent) {
    try {
      const pi = await stripe.paymentIntents.create({
        amount: 85000,
        currency: 'eur',
        automatic_payment_methods: { enabled: true },
        description: 'Sonde de diagnostic — annulée aussitôt',
      });
      out.intention = { moyens_proposes: pi.payment_method_types, statut: pi.status };
      await stripe.paymentIntents.cancel(pi.id);
      out.intention.annulee = true;
      if (!pi.payment_method_types.includes('alma')) {
        out.erreurs.push("Alma est activé mais non proposé sur ce montant — vérifier les plafonds Alma");
      }
    } catch (e) {
      out.erreurs.push('Sonde d\'intention impossible : ' + e.message);
    }
  }

  out.pret = out.erreurs.length === 0;
  return res.status(200).json(out);
};
