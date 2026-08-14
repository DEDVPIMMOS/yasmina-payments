# Configuration du paiement

## Parcours

1. Le candidat remplit `candidater.html` (identité, motivation, lien vidéo, CV et photo).
2. `POST /api/candidature` : stocke les pièces (Vercel Blob), envoie un premier
   e-mail à Yasmina avec les pièces jointes, puis crée une intention de paiement
   Stripe et renvoie son `client_secret`.
3. Le Payment Element s'affiche dans la page. Les moyens proposés sont ceux
   activés sur le compte Stripe (`automatic_payment_methods`).
4. Paiement confirmé -> Stripe émet `payment_intent.succeeded`.
5. `POST /api/stripe-webhook` envoie « Candidature et inscription de M./Mme X »
   avec le reçu de paiement, plus un accusé de réception au candidat.

## Variables d'environnement (Vercel, Production)

| Variable | Rôle | Sans elle |
|---|---|---|
| `STRIPE_SECRET_KEY` | API Stripe | Rien ne fonctionne |
| `STRIPE_PUBLISHABLE_KEY` | Affichage du Payment Element | Le paiement ne s'affiche pas |
| `STRIPE_WEBHOOK_SECRET` | Vérification de signature | Aucun e-mail de confirmation |
| `ZOHO_USER` / `ZOHO_PASS` | Envoi SMTP | Aucun e-mail |
| `BLOB_READ_WRITE_TOKEN` | Stockage CV et photo | Pièces uniquement dans le 1er e-mail |
| `NOTIFY_TO` | Destinataire (défaut : `ZOHO_USER`) | — |

## Webhook Stripe

Destination : `https://yptraining.vercel.app/api/stripe-webhook`
Événement requis : **`payment_intent.succeeded`**
(`checkout.session.completed` reste accepté pour l'ancien parcours.)

## Vérifier que tout répond

```bash
curl -s https://yptraining.vercel.app/api/diagnostic | python3 -m json.tool
```

Lecture seule, aucun secret exposé. Renvoie l'état des variables, du compte,
des capacités, des moyens de paiement actifs, des événements de webhook et
des domaines Apple Pay. `"pret": true` = chaîne complète.

Ajouter `?intent=1` pour créer une intention de paiement puis l'annuler
aussitôt, et lire les moyens réellement proposés au candidat.

## Alma

Cocher Alma dans la configuration des moyens de paiement ne suffit pas :
il faut que la **capacité** `alma_payments` soit accordée au compte, ce qui
passe par une souscription depuis le Dashboard (Paramètres → Moyens de
paiement → Alma). Tant que `capacites.alma` vaut `absente` dans le
diagnostic, Alma ne sera jamais proposé.

## Apple Pay

Le bouton n'apparaît que si le domaine est enregistré :
Stripe -> Settings -> Payment methods -> Apple Pay -> ajouter `yptraining.vercel.app`.
Apple Pay n'est pas un moyen de paiement distinct : il s'appuie sur `card`.

## Paiement fractionné

Alma n'est pas activé sur le compte. Aucune modification de code ne sera
nécessaire : `automatic_payment_methods` l'affichera dès son activation.

## Vidéos de la page

Dans `candidater.html`, renseigner `data-yt="IDENTIFIANT"` sur les blocs
`.vid-frame`. Pour `youtube.com/watch?v=AbCdEf12345` -> `data-yt="AbCdEf12345"`.
