const Stripe = require('stripe');
const { put, del } = require('@vercel/blob');

/**
 * Deux essais concrets, POST uniquement :
 *  - demander la capacité alma_payments au compte
 *  - vérifier que le store Blob répond et sous quel régime
 * Renvoie la réponse brute de Stripe pour qu'on sache exactement pourquoi
 * ça passe ou non.
 */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST uniquement' });
  }

  const out = { alma: null, blob: null };

  // ── Alma : demander la capacité ──────────────────────────────────────
  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const avant = await stripe.accounts.retrieve();
    out.alma = { avant: avant.capabilities?.alma_payments || 'absente' };
    try {
      const maj = await stripe.accounts.update(avant.id, {
        capabilities: { alma_payments: { requested: true } },
      });
      out.alma.apres = maj.capabilities?.alma_payments || 'absente';
      out.alma.exigences = maj.requirements?.currently_due || [];
      out.alma.resultat = out.alma.apres === 'absente' ? 'refusée sans erreur' : 'demandée';
    } catch (e) {
      out.alma.resultat = 'refusée';
      out.alma.erreur = { type: e.type, code: e.code, message: e.message };
    }
  } catch (e) {
    out.alma = { resultat: 'compte illisible', erreur: e.message };
  }

  // ── Blob : dépôt puis suppression d'un fichier témoin ────────────────
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    out.blob = { resultat: 'BLOB_READ_WRITE_TOKEN absente du déploiement' };
  } else {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    for (const access of ['public', 'private']) {
      try {
        const r = await put(`diagnostic/test-${access}.txt`, 'ok', {
          access, token, addRandomSuffix: true, contentType: 'text/plain',
        });
        let ouvrable = false;
        try {
          const v = await fetch(r.url);
          ouvrable = v.ok;
        } catch (_) { /* url non joignable */ }
        out.blob = { resultat: 'dépôt réussi', access, url_ouvrable_sans_jeton: ouvrable };
        try { await del(r.url, { token }); out.blob.nettoye = true; } catch (_) {}
        break;
      } catch (e) {
        out.blob = { resultat: 'échec', access, erreur: e.message };
      }
    }
  }

  return res.status(200).json(out);
};
