# Compétences interculturelles et ÉDD – Selbstlern-App

Selbstlern-App zum Parcours «Compétences interculturelles et éducation au développement durable» (Didactique du français 1, PHTG, HS 2026/27).

## Grundprinzip

- **Antworten der Studierenden bleiben auf ihrem Gerät.** Es gibt keine Datenbank und kein Login für Studierende. Die App speichert lokal im Browser und – auf Knopfdruck – in einer Projektdatei (`mon-parcours-interculturel.json`), die man wieder öffnen kann, auch auf einem anderen Gerät.
- **Inhalte liegen als JSON-Dateien im Repo** (`content/`) und werden im Redaktionseditor unter `/admin` bearbeitet. Eine Textänderung braucht keine Programmierung.
- **Lehrplan:** wird live von tg.lehrplan.ch in einem Seitenfenster angezeigt (Suche oder direkte Links), nichts davon wird gespeichert.

## Aufbau

```
index.html, app.js, style.css   App (statisch, ohne Build-Schritt)
vendor/marked.esm.js            Markdown-Parser (MIT)
content/parcours.json           Startseite, Rahmen, Ziele, Reihenfolge der Tâches
content/taches/t1…t4.json       Tâches als Liste von Blöcken
admin/                          Redaktionseditor (Sveltia CMS)
vercel.json                     Hosting-Einstellungen
```

## Einmalige Einrichtung

### 1. Vercel verbinden
1. Auf vercel.com → **Add New… → Project** → Repo `frisolaan/projet-interculturel-edd` importieren.
2. Framework Preset: **Other**. Build Command und Output Directory leer lassen.
3. **Deploy.** Danach baut Vercel bei jeder Änderung im Repo automatisch neu (ca. 1 Minute).

### 2. Zugang zum Redaktionseditor (pro Person)
1. GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained tokens → Generate new token**.
2. Repository access: **Only select repositories** → `projet-interculturel-edd`.
3. Permissions → Repository permissions → **Contents: Read and write**.
4. Ablaufdatum setzen (z. B. Semesterende).
5. `https://<eure-app>.vercel.app/admin` öffnen → **Sign in with Token** → Token einfügen.

Die zweite Person braucht ein GitHub-Konto und muss im Repo als **Collaborator** eingeladen werden (Repo → Settings → Collaborators), bevor sie ein Token erstellen kann.

## Redigieren

- `/admin` → **Tâches** → Tâche wählen → Blöcke bearbeiten → **Speichern**. Die Änderung ist nach ca. 1 Minute live.
- **Redaktionsansicht der App:** `https://<eure-app>.vercel.app/?redaction` zeigt bei jedem Block Typ, ID und Status (z. B. «Entwurf – à valider»).
- **Block-IDs nie umbenennen oder wiederverwenden.** Die Antworten der Studierenden hängen daran. Neue Blöcke bekommen neue, eindeutige IDs.

### Blocktypen

| Typ | Zweck |
|---|---|
| Konsigne | Aufgabenstellung mit Titel, Dauer, Sozialform |
| Text | Lesetext, Situation, Gedicht (optional zugeklappt) |
| Antwortfeld | Freitext, optional mit Zielwortzahl; «privat» = nicht im Dossier/Export (ausser auf Wunsch) |
| Tabelle | Raster mit Spalten und Beispielzeilen |
| Sortierübung | Elemente in Kategorien ordnen, mit Prüfung; Lösung `les-deux` = beide möglich |
| Selbstcheck | Checkliste plus aufdeckbares Beispiel |
| Externe Ressource | Hinweis auf ILIAS, Lehrmittel usw. |
| Lehrplan-Fenster | Schaltflächen, die tg.lehrplan.ch im Seitenfenster öffnen (Suchwort oder URL) |
| Rückblick | zeigt eine frühere Antwort erneut an |
| Silhouette | Wörter auf eine Figur ziehen |
| Karte zum Drucken | z. B. Störkarte aus mehreren Antwortfeldern |

## Offene Punkte (inhaltlich)

- [ ] **Musterlösungen und Sortierlisten** sind Entwürfe (Status «Entwurf – à valider»): t1-a3-arbre, t1-a4-check, t2-2-check, t3-2-tri, t3-3-tri, t3-4-check, t3-5-check.
- [ ] **Quelle** des Texts «Qu’est-ce que la culture ?» (t1-texte) und des deutschen Originalgedichts (t2-poeme-de) ergänzen.
- [ ] **ILIAS-Link** zum Classeur der 5. Séance (t3-1-ressources).
- [ ] **Schema** der interkulturellen Kompetenz (t3-3-dimensions) fehlt noch als Bild.
- [ ] **Kontrollfragen zu Fäcke / Chaves et al.** (t3-1) – bisher nur Selbsteinschätzung; inhaltliche Fragen sollten aus den Texten formuliert werden.

### Gegenüber dem Word-Dokument bereits angepasst
- Zeilenverweise («lignes 5-8») durch Absatznummern ¶1–¶4 ersetzt.
- Cadre de travail: Tâche 1 ist Einzelarbeit, Austausch zu zweit erst ab Tâche 2.
- Tâche 3, Schritt 6: 6a und 6b je ~30 min (statt 20 + 20 bei «~60 min»), damit die Summe 3 h ergibt.
- Doppelte Nennung der Silhouette bei den Resultaten von Tâche 2 entfernt; Tippfehler «Reprenezz» korrigiert.
- Kulturbaum und Silhouette sind interaktiv in der App statt als Bild.

## Datenschutz

Die App sendet keine Antworten an einen Server. Vercel liefert nur die statischen Dateien und Inhalte aus. Private Felder (Gedicht, Carte «Moi», Silhouette, persönliches Beispiel) werden standardmässig weder in die Sicherungsdatei noch ins Dossier übernommen.
