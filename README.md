# Compétences interculturelles et ÉDD – Selbstlern-App

Selbstlern-App zum Parcours «Compétences interculturelles et éducation au développement durable» (Didactique du français 1, PHTG, HS 2026/27).

## Grundprinzip

- **Antworten der Studierenden bleiben auf ihrem Gerät.** Es gibt keine Datenbank und kein Login für Studierende. Die App speichert lokal im Browser und – auf Knopfdruck – in einer Projektdatei (`mon-parcours-interculturel.json`), die man wieder öffnen kann, auch auf einem anderen Gerät.
- **Inhalte liegen als JSON-Dateien im Repo** (`content/`) und werden im Redaktionseditor unter `/admin` bearbeitet. Eine Textänderung braucht keine Programmierung.
- **Lehrplan:** wird live von tg.lehrplan.ch in einem Seitenfenster angezeigt (Suche oder direkte Links), nichts davon wird gespeichert.

## Aufbau

```
index.html, app.js, style.css   App (statisch, ohne Build-Schritt)
motifs.js                       Motive «L’entre-deux»
assets/fonts/                   Schriften (OFL)
vendor/marked.esm.js            Markdown-Parser (MIT)
content/parcours.json           Startseite, Rahmen, Ziele, Reihenfolge der Tâches
content/taches/t1…t4.json       Tâches als Liste von Blöcken
admin/                          Redaktionseditor (Sveltia CMS)
vercel.json                     Hosting-Einstellungen
```

## Gestaltung «L’entre-deux»

- **Leitidee:** der Raum zwischen den Perspektiven. Motive aus halbtransparenten, organischen Formen, die sich überlagern (`motifs.js`) – keine Menschen, Flaggen, Globen oder Hände.
- **Farben – zwei Varianten zum Vergleich** (Umschalter unten auf der Startseite oder `?theme=phtg` in der Adresse):
  - **A «Bleu»** (Standard): Palette #2559A1 / #469BD4 / #50AFD5 / #EBC655 / #F2F2F2 auf Weiss.
  - **B «PHTG»**: Schwarz auf Weiss, Lime #DEF428 und Blau #0059FF als Akzente (wie phtg.ch).
  Nach dem Entscheid wird die andere Variante entfernt.
- **Schriften (lokal ausgeliefert, OFL):** Schibsted Grotesk für Titel (nahe an der PHTG-Grotesk), Atkinson Hyperlegible für Text.
- **Schrittmodus:** Jede Konsigne beginnt einen eigenen Schritt (`#/t1/3`). Fortschrittsbalken oben, Schrittliste in der Seitenleiste, Pfeiltasten ← → zum Blättern.
- **Ton:** Jede Konsigne hat eine kurze Einstiegsfrage (`accroche`). Selbstchecks heissen «Regard sur mon travail», Musterlösungen «un regard possible», Sortierübungen vergleichen «avec notre proposition» – Hinweise statt Noten.
- **Interdisziplinärer Bezug:** Tâche 3 (6a) und Tâche finale verweisen zusätzlich auf den ÉDD-Kompetenzrahmen *A Rounder Sense of Purpose* (Empathie, Valeurs, Esprit critique, Participation, Attention; CC BY 4.0). Massgebend bleibt der Lehrplan Thurgau.

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
| Konsigne | Aufgabenstellung mit Titel, Einstiegsfrage, Dauer, Sozialform; beginnt einen neuen Schritt |
| Text | Lesetext, Situation, Gedicht (optional zugeklappt) |
| Antwortfeld | Freitext, optional mit Zielwortzahl; «privat» = nicht im Dossier/Export (ausser auf Wunsch) |
| Tabelle | Raster mit Spalten und Beispielzeilen |
| Sortierübung | Elemente in Kategorien ordnen, mit Prüfung; Lösung `les-deux` = beide möglich; Darstellung «Baum» (Krone / Wurzeln) für zwei Kategorien |
| Schema | vordefinierte Grafik, z. B. Kopf – Herz – Hand |
| Selbstcheck | Checkliste plus aufdeckbares Beispiel |
| Externe Ressource | Hinweis auf ILIAS, Lehrmittel usw. |
| Lehrplan-Fenster | Schaltflächen, die tg.lehrplan.ch im Seitenfenster öffnen (Suchwort oder URL) |
| Weiterführender Bezug | Kasten mit Links, z. B. zu A Rounder Sense of Purpose |
| Audio | MP3 im Editor hochladen, eigener Player in der App |
| Rückblick | zeigt eine frühere Antwort erneut an |
| Silhouette | Wörter auf eine Figur ziehen |
| Karte zum Drucken | z. B. Störkarte aus mehreren Antwortfeldern |

## Offene Punkte (inhaltlich)

- [ ] **Musterlösungen und Sortierlisten** sind Entwürfe (Status «Entwurf – à valider»): t1-a3-arbre, t1-a4-check, t2-2-check, t3-2-tri, t3-3-tri, t3-4-check, t3-5-check.
- [ ] **ILIAS-Link** zum Classeur der 5. Séance (t3-1-ressources).
- [ ] **Schema** (t3-3-schema): als Kopf–Herz–Hand-Grafik nachgezeichnet. Falls im Kurs ein bestimmtes Schema aus der Lektüre gemeint ist, dieses prüfen bzw. ersetzen.
- [ ] **Kontrollfragen zu Fäcke / Chaves et al.** (t3-1) – bisher nur Selbsteinschätzung; inhaltliche Fragen sollten aus den Texten formuliert werden.

### Gegenüber dem Word-Dokument bereits angepasst
- Zeilenverweise («lignes 5-8») durch Absatznummern ¶1–¶4 ersetzt.
- Cadre de travail: Tâche 1 ist Einzelarbeit, Austausch zu zweit erst ab Tâche 2.
- Tâche 3, Schritt 6: 6a und 6b je ~30 min (statt 20 + 20 bei «~60 min»), damit die Summe 3 h ergibt.
- Doppelte Nennung der Silhouette bei den Resultaten von Tâche 2 entfernt; Tippfehler «Reprenezz» korrigiert.
- Kulturbaum und Silhouette sind interaktiv in der App statt als Bild.

## Audio

Das Gedicht «MOI / ICH» (Tâche 2) liegt als synthetische Lesung bei (`assets/uploads/`), erzeugt mit der freien Sprachsynthese Piper:
- Französisch: Stimme «siwis» (Datensatz CC BY 4.0) – sehr gut verständlich.
- Deutsch: Stimme «thorsten» (CC0) – gut verständlich, Männerstimme, einzelne Wörter (z. B. «Russin») unsauber.

Eine echte Lesung (z. B. von einer Studentin) ersetzt die Datei jederzeit über den Editor.

## Datenschutz

Quellenangaben zu Text und Gedicht werden beim Erklären der Aufgabe im Kurs ausgewiesen, nicht in der App.

Die App sendet keine Antworten an einen Server. Vercel liefert nur die statischen Dateien und Inhalte aus. Private Felder (Gedicht, Carte «Moi», Silhouette, persönliches Beispiel) werden standardmässig weder in die Sicherungsdatei noch ins Dossier übernommen.
