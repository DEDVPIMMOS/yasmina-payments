# Structure du site — images séparées

## Ce qui a changé

Avant : `index.html` faisait **3,2 Mo**, avec les 36 photos collées en texte
dans le fichier (base64). Chaque modification, même un texte, obligeait à
manipuler ce bloc énorme — c'est ce qui a causé la confusion avec le fichier
PopStraps.

Maintenant : `index.html` fait **128 Ko**. Les photos sont des vrais fichiers
à côté, dans `images/`.

```
index.html
images/
  hero-photo.jpg
  casse-tete-chinois.jpg
  yasmina-pastural-et-harvey-keitel.jpg
  ... (36 fichiers)
```

Rien n'a changé à l'affichage — le rendu est identique. Seule la structure
des fichiers a bougé.

---

## Ajouter une photo

1. Dépose le fichier dans `images/`. Nom simple, sans espace ni accent :
   `stagiaire-portrait.jpg`, `atelier-mars-2026.jpg`.
2. Dans `index.html`, à l'endroit voulu, ajoute :
   ```html
   <img src="images/stagiaire-portrait.jpg" alt="Description courte" loading="lazy">
   ```
3. Commit + push.

## Ajouter une vidéo

1. Dépose le fichier dans un dossier `videos/` (à créer s'il n'existe pas :
   `mkdir videos`).
2. Dans `index.html` :
   ```html
   <video src="videos/backstage.mp4" controls></video>
   ```
   Pour une vidéo qui se joue au clic (comme les témoignages actuels), suivre
   le même modèle que les blocs `temo-c` existants — copier un de ces blocs
   et changer le nom du fichier.

## Remplacer une photo existante

Écrase le fichier dans `images/` en gardant le même nom, ou renomme et mets
à jour la ligne `src="images/..."` correspondante dans `index.html`.

---

## Ce qui n'a pas changé

- `api/candidature.js` — la fonction d'envoi mail, inchangée.
- Le formulaire, les animations, le fond du canapé (section « Le stage »),
  tout le reste du site — identique à avant l'extraction.

## À savoir

Quatre miniatures de témoignages vidéo (`temoignage-thumb-1/2/3.jpg`,
`hero-photo.jpg`) n'avaient pas de texte alternatif dans le fichier
d'origine — je leur ai donné des noms descriptifs, mais l'attribut `alt`
dans le HTML reste vide pour ces quatre-là. Pas bloquant, juste un détail
d'accessibilité à corriger un jour si besoin.
