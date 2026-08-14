/**
 * Consentement aux traceurs — RGPD / recommandations CNIL.
 *
 * Principes tenus :
 *  - rien de non essentiel n'est chargé avant un choix explicite ;
 *  - refuser est aussi simple qu'accepter (deux boutons de même poids) ;
 *  - le choix est révocable à tout moment via [data-cookies-open] ;
 *  - la preuve du consentement est datée et conservée 6 mois ;
 *  - l'absence de choix vaut refus.
 *
 * Seul YouTube est concerné. Stripe est strictement nécessaire au paiement
 * demandé par l'utilisateur, donc exempté de consentement.
 */
(function () {
  'use strict';

  var CLE = 'ypt-consentement';
  var VALIDITE_MOIS = 6;

  function lire() {
    try {
      var brut = localStorage.getItem(CLE);
      if (!brut) return null;
      var v = JSON.parse(brut);
      var limite = new Date(v.date);
      limite.setMonth(limite.getMonth() + VALIDITE_MOIS);
      if (new Date() > limite) { localStorage.removeItem(CLE); return null; }
      return v;
    } catch (e) { return null; }
  }

  function ecrire(videos) {
    try {
      localStorage.setItem(CLE, JSON.stringify({
        videos: !!videos,
        date: new Date().toISOString(),
        version: 1,
      }));
    } catch (e) { /* stockage refusé : on ne bloque pas la navigation */ }
  }

  function accepte() {
    var v = lire();
    return !!(v && v.videos);
  }

  /* ── Styles ─────────────────────────────────────────────────────── */
  var css = document.createElement('style');
  css.textContent = [
    '.ypt-cnt{position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:16px;',
    '  display:flex;justify-content:center;pointer-events:none}',
    '.ypt-cnt-in{pointer-events:auto;max-width:620px;width:100%;background:#fff;',
    '  border:1px solid #E3E8F2;border-radius:16px;padding:20px 22px;',
    '  box-shadow:0 18px 50px -20px rgba(11,18,48,.35);',
    '  font-family:"Instrument Sans",system-ui,sans-serif;color:#0B1230;',
    '  animation:ypt-up .35s cubic-bezier(.22,1,.36,1) both}',
    '@keyframes ypt-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}',
    '.ypt-cnt-t{font-family:"Bricolage Grotesque",system-ui,sans-serif;font-weight:800;',
    '  font-size:16px;letter-spacing:-.02em;margin-bottom:7px}',
    '.ypt-cnt-p{font-size:13.5px;line-height:1.6;color:#5B6478;margin-bottom:16px}',
    '.ypt-cnt-p a{color:#1B3FCC}',
    '.ypt-cnt-b{display:flex;gap:10px;flex-wrap:wrap}',
    '.ypt-cnt-b button{flex:1 1 160px;padding:12px 18px;border-radius:10px;cursor:pointer;',
    '  font-family:inherit;font-weight:600;font-size:14px;border:1px solid #D3DAE9;',
    '  background:#fff;color:#0B1230;transition:all .18s cubic-bezier(.22,1,.36,1)}',
    '.ypt-cnt-b button:hover{border-color:#1B3FCC}',
    '.ypt-cnt-b .ypt-ok{background:#1B3FCC;border-color:#1B3FCC;color:#fff}',
    '.ypt-cnt-b .ypt-ok:hover{background:#2A56E8}',
    '.ypt-ph{display:grid;place-items:center;text-align:center;padding:24px;gap:12px;',
    '  background:#0F0D1A;border-radius:16px;aspect-ratio:16/9;border:1px solid #E3E8F2}',
    '.ypt-ph p{font-size:13px;line-height:1.6;color:#9891B8;max-width:34ch;margin:0}',
    '.ypt-ph button{padding:11px 20px;border-radius:100px;border:0;cursor:pointer;',
    '  background:#1B3FCC;color:#fff;font-family:inherit;font-weight:600;font-size:13.5px}',
    '.ypt-ph button:hover{background:#2A56E8}',
  ].join('');
  document.head.appendChild(css);

  /* ── Vidéos : substitut tant que le consentement manque ─────────── */
  function rendreVideos() {
    var ok = accepte();
    document.querySelectorAll('[data-yt]').forEach(function (el) {
      var id = (el.dataset.yt || '').trim();
      if (!id) return;
      if (!ok) {
        if (el.dataset.yptBloque === '1') return;
        el.dataset.yptBloque = '1';
        el.innerHTML = '';
        var ph = document.createElement('div');
        ph.className = 'ypt-ph';
        var p = document.createElement('p');
        p.textContent = 'Cette vidéo est hébergée par YouTube. La lire déposera des traceurs de Google sur votre appareil.';
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Autoriser et lire';
        b.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          ecrire(true); fermer(); rendreVideos();
        });
        ph.appendChild(p); ph.appendChild(b);
        el.appendChild(ph);
        el.disabled = false;
      } else if (el.dataset.yptBloque === '1') {
        // Consentement donné : on rend la main au script de la page.
        delete el.dataset.yptBloque;
        el.innerHTML = '';
        document.dispatchEvent(new CustomEvent('ypt:videos-autorisees'));
      }
    });
  }

  /* ── Bandeau ────────────────────────────────────────────────────── */
  var bandeau = null;
  function fermer() { if (bandeau) { bandeau.remove(); bandeau = null; } }

  function ouvrir() {
    fermer();
    bandeau = document.createElement('div');
    bandeau.className = 'ypt-cnt';
    bandeau.setAttribute('role', 'dialog');
    bandeau.setAttribute('aria-label', 'Gestion des traceurs');

    var boite = document.createElement('div');
    boite.className = 'ypt-cnt-in';

    var t = document.createElement('div');
    t.className = 'ypt-cnt-t';
    t.textContent = 'Vidéos hébergées par YouTube';

    var p = document.createElement('p');
    p.className = 'ypt-cnt-p';
    p.innerHTML = 'Ce site ne mesure pas votre audience et n\'affiche aucune publicité. ' +
      'Seule la lecture des vidéos de présentation dépose des traceurs, ceux de Google. ' +
      'Le paiement, lui, reste fonctionnel dans tous les cas. ' +
      '<a href="confidentialite.html">En savoir plus</a>.';

    var zone = document.createElement('div');
    zone.className = 'ypt-cnt-b';

    var refus = document.createElement('button');
    refus.type = 'button';
    refus.textContent = 'Continuer sans les vidéos';
    refus.addEventListener('click', function () { ecrire(false); fermer(); rendreVideos(); });

    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'ypt-ok';
    ok.textContent = 'Autoriser les vidéos';
    ok.addEventListener('click', function () { ecrire(true); fermer(); rendreVideos(); });

    zone.appendChild(refus);
    zone.appendChild(ok);
    boite.appendChild(t); boite.appendChild(p); boite.appendChild(zone);
    bandeau.appendChild(boite);
    document.body.appendChild(bandeau);
  }

  function init() {
    document.querySelectorAll('[data-cookies-open]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); ouvrir(); });
    });
    rendreVideos();
    // Le bandeau n'apparaît que si un choix reste à faire ET qu'une vidéo
    // est réellement présente. Un emplacement encore vide ne dépose rien :
    // solliciter l'utilisateur pour rien serait du bruit, et la CNIL
    // proscrit les demandes de consentement sans finalité effective.
    var videoReelle = [].some.call(
      document.querySelectorAll('[data-yt]'),
      function (el) { return (el.dataset.yt || '').trim(); }
    );
    if (!lire() && videoReelle) ouvrir();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  window.yptConsentement = { accepte: accepte, ouvrir: ouvrir };
})();
