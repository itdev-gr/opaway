# Spanish Translations — Client Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the client's Spanish (es) copy revisions from `OPAWEY Website testing 20260429.docx` across all visible UI surfaces. Only `data-i18n-es` attribute values (and the equivalent `…Es` data fields) change; English text, Greek text, structure, classes, behavior, and unrelated styles are NOT touched.

**Architecture:** The site uses a runtime DOM-swap i18n strategy in `src/layouts/Layout.astro`: each translatable element carries `data-i18n-el="…"` and `data-i18n-es="…"`, and the original English text lives in the markup. Vehicle data and feature data come from local arrays with `titleEs`/`modelsEs`/`descriptionEs` fields. Updating Spanish copy means rewriting the `data-i18n-es` value (or the `…Es` array field). No new components, no new files, no behavior changes.

**Tech Stack:** Astro components (`.astro`).

**Key client notes (carry forward):**
1. The dominant tonal change requested is **formal "usted" → informal "tú"** ("Reserve" → "Reserva", "Su" → "Tu", "disponga" → "dispón", "necesite" → "necesites", "Póngase" → "Ponte", "Llámenos" → "Llámanos", etc.). Apply consistently — do not invent new register changes outside what's in the doc.
2. Several home-page **section eyebrows and body paragraphs are completely rewritten** (Experience, Tours, Hourly, Global Coverage). Use the doc's full-paragraph copy verbatim — don't merge with existing text.
3. The client flagged that the **tour catalog cards (titles + descriptions on `/book/tour` and `/experiences`) render in English** because that text comes from the database, not from `data-i18n-es` attributes. This plan does NOT touch DB content — that's a separate question the client raised ("send translations or auto-translate?"). Track it in the final task as a follow-up note, do not attempt to translate DB rows.
4. The repeated marker "*This text is the same as the text of transfers*" in the doc applies to the home-page hourly section: the screenshot annotated both transfer and hourly sections, but the doc still provides distinct copy for hourly. Use the distinct hourly copy from lines 27–37 of the doc.

---

## File Structure

Files modified (Spanish copy only — no other edits):

- `src/components/HourlySection.astro` — homepage Hourly section
- `src/components/ExperienceSection.astro` — homepage Experience section
- `src/components/ToursSection.astro` — homepage Tours section
- `src/components/GlobalCoverageSection.astro` — homepage transfer/coverage section
- `src/components/FeaturesSection.astro` — homepage features grid (4 cards)
- `src/pages/work-with-us.astro` — Work With Us page (hero, partner cards, footer CTA)
- `src/pages/contact.astro` — Contact page (eyebrow, label cards, country select)
- `src/pages/experiences.astro` — Experiences page (heading wording)

Files NOT modified despite appearing in the doc (already match client copy or not under `data-i18n-es` control):
- `src/components/BookingSection.astro` (Sedán, Furgoneta, Minibús already match)
- `src/pages/book/transfer.astro`, `book/hourly.astro`, `book/tour.astro` (header CTAs already match)
- `src/components/about/*.astro` (already match doc copy)
- DB-driven tour/experience catalog rows (out of scope — see follow-up note)

---

## Task 1: Homepage — HourlySection.astro

**Files:**
- Modify: `src/components/HourlySection.astro:14`, `:18`, `:23`, `:26`, `:36`

- [ ] **Step 1: Update eyebrow `data-i18n-es`**

In `src/components/HourlySection.astro`, on line 14 change:

```
data-i18n-es="Su conductor, su horario"
```

to:

```
data-i18n-es="Tu conductor, tu horario"
```

- [ ] **Step 2: Update title `data-i18n-es`**

On line 18 change:

```
data-i18n-es="Reserve por hora"
```

to:

```
data-i18n-es="Reserva por hora"
```

- [ ] **Step 3: Update first paragraph `data-i18n-es`**

On line 23 change the `data-i18n-es` value to:

```
¿Necesitas un conductor para varias paradas, reuniones de negocios o un día de turismo? Reserva por hora y dispón de tu conductor y vehículo durante el tiempo que necesites, con total flexibilidad sobre tu itinerario.
```

(Leave `data-i18n-el` and the English fallback text untouched.)

- [ ] **Step 4: Update second paragraph `data-i18n-es`**

On line 26 change the `data-i18n-es` value to:

```
Ideal para tours por la ciudad, traslados a eventos y jornadas con múltiples destinos. Sin recogidas y entregas rígidas: un conductor profesional y un vehículo a tu disposición durante las horas que reserves.
```

- [ ] **Step 5: Update CTA button `data-i18n-es`**

On line 36 change:

```
data-i18n-es="Reserve por hora"
```

to:

```
data-i18n-es="Reserva por hora"
```

- [ ] **Step 6: Verify no other lines touched**

Run: `git diff src/components/HourlySection.astro`
Expected: only the 5 lines above are modified, only `data-i18n-es` values changed (no English, Greek, classes, structure changes).

---

## Task 2: Homepage — ExperienceSection.astro

**Files:**
- Modify: `src/components/ExperienceSection.astro:14`, `:18`, `:23`, `:26`, `:36`

- [ ] **Step 1: Update eyebrow `data-i18n-es`**

On line 14 change:

```
data-i18n-es="Su conductor personal, a su alcance"
```

to:

```
data-i18n-es="Experimenta el verdadero significado darte un lujo."
```

- [ ] **Step 2: Update title `data-i18n-es`**

On line 18 change:

```
data-i18n-es="Experiencia"
```

to:

```
data-i18n-es="Experiencias"
```

- [ ] **Step 3: Update first paragraph `data-i18n-es`**

On line 23 change the `data-i18n-es` value to:

```
Vive Grecia a través de experiencias exclusivas diseñadas para clientes VIP que buscan lujo, autenticidad y momentos inolvidables. Disfrute de experiencias privadas en Grecia como cenas gourmet, catas de vino, navegación en yate, tours culturales personalizados y actividades únicas cuidadosamente seleccionadas.
```

- [ ] **Step 4: Update second paragraph `data-i18n-es`**

On line 26 change the `data-i18n-es` value to:

```
Nuestro servicio premium le garantiza atención personalizada, acceso privilegiado y un nivel de excelencia en cada detalle.
```

- [ ] **Step 5: Update CTA button `data-i18n-es`**

On line 36 change:

```
data-i18n-es="Explore experiencias"
```

to:

```
data-i18n-es="Explora nuestras Experiencias"
```

- [ ] **Step 6: Verify**

Run: `git diff src/components/ExperienceSection.astro`
Expected: only `data-i18n-es` values changed on the 5 listed lines.

---

## Task 3: Homepage — ToursSection.astro

**Files:**
- Modify: `src/components/ToursSection.astro:23`, `:32`, `:35`, `:45`

(Title on line 27 already reads `data-i18n-es="Tours"` which matches the doc — leave it.)

- [ ] **Step 1: Update eyebrow `data-i18n-es`**

On line 23 change:

```
data-i18n-es="Su conductor personal, a su alcance"
```

to:

```
data-i18n-es="Vive una experiencia única e inolvidable."
```

- [ ] **Step 2: Update first paragraph `data-i18n-es`**

On line 32 change the `data-i18n-es` value to:

```
Descubre Grecia con nuestros exclusivos tours VIP diseñados para viajeros exigentes que buscan lujo, comodidad y experiencias auténticas. Ofrecemos tours privados en Grecia, visitas guiadas premium a sitios arqueológicos, recorridos por islas griegas y experiencias y servicio de alto nivel.
```

- [ ] **Step 3: Update second paragraph `data-i18n-es`**

On line 35 change the `data-i18n-es` value to:

```
Disfrute de un servicio de lujo, atención personalizada y acceso a los destinos más emblemáticos de Grecia con total confort y privacidad.
```

- [ ] **Step 4: Update CTA button `data-i18n-es`**

On line 45 change:

```
data-i18n-es="Reserve un tour"
```

to:

```
data-i18n-es="Reserva tu tour"
```

- [ ] **Step 5: Verify**

Run: `git diff src/components/ToursSection.astro`
Expected: only the 4 listed lines changed, `data-i18n-es` values only.

---

## Task 4: Homepage — GlobalCoverageSection.astro

**Files:**
- Modify: `src/components/GlobalCoverageSection.astro:23`, `:27`, `:32`, `:35`, `:45`

- [ ] **Step 1: Update eyebrow `data-i18n-es`**

On line 23 change:

```
data-i18n-es="Su conductor personal, a su alcance"
```

to:

```
data-i18n-es="Alcanza tu destino con total confort y estilo."
```

- [ ] **Step 2: Update title `data-i18n-es`**

On line 27 change:

```
data-i18n-es="Reserve un traslado"
```

to:

```
data-i18n-es="Reserva un traslado"
```

- [ ] **Step 3: Update first paragraph `data-i18n-es`**

On line 32 change the `data-i18n-es` value to:

```
Desde los bulliciosos centros urbanos hasta los aeropuertos más remotos, nuestros conductores profesionales están disponibles las 24 horas del día para garantizar que tu viaje sea impecable y sin estrés.
```

- [ ] **Step 4: Update second paragraph `data-i18n-es`**

On line 35 change the `data-i18n-es` value to:

```
Con nuestra extensa red que abarca más de 100 países, le conectamos entre miles de ciudades y aeropuertos en todo el mundo, ofreciéndole una comodidad sin igual donde quiera que viaje.
```

- [ ] **Step 5: Update CTA button `data-i18n-es`**

On line 45 change:

```
data-i18n-es="Reserve un traslado"
```

to:

```
data-i18n-es="Reserva un traslado"
```

- [ ] **Step 6: Verify**

Run: `git diff src/components/GlobalCoverageSection.astro`
Expected: only the 5 listed lines changed.

---

## Task 5: Homepage — FeaturesSection.astro

**Files:**
- Modify: `src/components/FeaturesSection.astro:9`, `:27`, `:36`

The features array uses `descriptionEs`/`titleEs` fields. The client doc text matches existing `titleEs` values (Cobertura global / Conductor por hora / Trayectos por la ciudad). Two `descriptionEs` strings need an informal-register pass; one ("Trayectos por la ciudad" description) already matches except for "a largas distancias" → "en largas distancias" per the doc.

- [ ] **Step 1: Update Cobertura global `descriptionEs` (line 9)**

Change:

```
descriptionEs: 'Donde sea que le lleve su viaje, Opawey garantiza su comodidad durante todo el recorrido.',
```

to:

```
descriptionEs: 'Donde sea que te lleve tu viaje, Opawey garantiza su comodidad durante todo el recorrido.',
```

- [ ] **Step 2: Update Conductor por hora `descriptionEs` (line 27)**

Change:

```
descriptionEs: 'Contrate un conductor por hora para sus necesidades de negocio o de ocio.',
```

to:

```
descriptionEs: 'Contrata un conductor por hora para sus necesidades de negocio o de ocio.',
```

- [ ] **Step 3: Update Trayectos por la ciudad `descriptionEs` (line 36)**

Change:

```
descriptionEs: 'Explore la ciudad en cualquier momento y lugar, incluso a largas distancias.',
```

to:

```
descriptionEs: 'Explora la ciudad en cualquier momento y lugar, incluso en largas distancias.',
```

- [ ] **Step 4: Verify**

Run: `git diff src/components/FeaturesSection.astro`
Expected: only the 3 listed `descriptionEs` lines changed.

---

## Task 6: Work With Us — work-with-us.astro

**Files:**
- Modify: `src/pages/work-with-us.astro:19`, `:22`, `:47`, `:68`, `:99`, `:117`, `:167`, `:176`, `:198`, `:253`, `:278`, `:279`, `:286`

- [ ] **Step 1: Update partner-eyebrow on line 19**

Change:

```
data-i18n-es="Asóciese con nosotros"
```

to:

```
data-i18n-es="Asóciate con nosotros"
```

- [ ] **Step 2: Update hero subhead on line 22**

Change the `data-i18n-es` value to:

```
Únete a la red Opaway y haz crecer tu negocio con nosotros. Ya sea que gestiones un hotel, una agencia de viajes o conduzcas profesionalmente, tenemos una colaboración hecha a tu medida.
```

- [ ] **Step 3: Update "Choose Your Partnership" heading on line 47**

Change:

```
data-i18n-es="Elija su colaboración"
```

to:

```
data-i18n-es="Elige tu colaboración"
```

- [ ] **Step 4: Update Hotels & Boutiques body on line 68**

Change the `data-i18n-es` value to:

```
Mejora la estancia de tus huéspedes ofreciendo traslados al aeropuerto impecables, tours privados por la ciudad y excursiones cuidadosamente seleccionadas, todo coordinado directamente a través de su conserjería.
```

- [ ] **Step 5: Update Hotels & Boutiques CTA on line 99**

Change:

```
data-i18n-es="Póngase en contacto"
```

to:

```
data-i18n-es="Ponte en contacto"
```

- [ ] **Step 6: Update Travel Agencies body on line 117**

Change the `data-i18n-es` value to:

```
Ofrece a tus clientes traslados de primer nivel y experiencias seleccionadas en Grecia. Integra nuestros servicios premium en tus paquetes con facilidad y total confianza.
```

- [ ] **Step 7: Update Drivers body on line 167**

Change the `data-i18n-es` value to:

```
¿Eres un conductor profesional en busca de más clientes? Únete a nuestra creciente red y accede a traslados premium, trayectos al aeropuerto y tours seleccionados, según tu propio horario.
```

- [ ] **Step 8: Update Drivers benefit "flexible hours" on line 176**

Change:

```
data-i18n-es="Horario flexible: trabaje cuando quiera"
```

to:

```
data-i18n-es="Horario flexible: trabaja cuando quieras"
```

- [ ] **Step 9: Update Drivers CTA on line 198**

Change:

```
data-i18n-es="Solicítelo ahora"
```

to:

```
data-i18n-es="Solicítalo ahora"
```

- [ ] **Step 10: Update "Premium Fleet" feature description on line 253**

Find the line containing `data-i18n-es="Desde sedanes hasta microbuses: nuestros vehículos son limpios, modernos y están meticulosamente mantenidos."` and change `microbuses` to `minibuses`:

```
data-i18n-es="Desde sedanes hasta minibuses: nuestros vehículos son limpios, modernos y están meticulosamente mantenidos."
```

(The client doc explicitly uses "minibuses".)

- [ ] **Step 11: Update "Ready to Partner" heading on line 278**

Change:

```
data-i18n-es="¿Listo para asociarse con nosotros?"
```

to:

```
data-i18n-es="¿Listo para asociarte con nosotros?"
```

- [ ] **Step 12: Update final-CTA paragraph on line 279**

Change the `data-i18n-es` value to:

```
Ponte en contacto con nosotros y uno de nuestros colaboradores te responderá en un plazo de 24 horas. Sin compromiso.
```

- [ ] **Step 13: Update final CTA button on line 286**

Change:

```
data-i18n-es="Contáctenos ahora"
```

to:

```
data-i18n-es="Contáctanos ahora"
```

- [ ] **Step 14: Verify**

Run: `git diff src/pages/work-with-us.astro`
Expected: only `data-i18n-es` value edits on the 13 listed lines. No English/Greek changes, no class changes, no element changes.

---

## Task 7: Contact page — contact.astro

**Files:**
- Modify: `src/pages/contact.astro:25`, `:42`, `:56`, `:70`, `:119`

- [ ] **Step 1: "Get in Touch" eyebrow on line 25**

Change:

```
data-i18n-es="Póngase en contacto"
```

to:

```
data-i18n-es="Ponte en contacto"
```

- [ ] **Step 2: "Call Us" label on line 42**

Change:

```
data-i18n-es="Llámenos"
```

to:

```
data-i18n-es="Llámanos"
```

- [ ] **Step 3: "Find Us" label on line 56**

Change:

```
data-i18n-es="Encuéntrenos"
```

to:

```
data-i18n-es="Encuéntranos"
```

- [ ] **Step 4: "Email Us" label on line 70**

Change:

```
data-i18n-es="Envíenos un correo"
```

to:

```
data-i18n-es="Envíanos un correo"
```

- [ ] **Step 5: Country select placeholder on line 119**

Change:

```
data-i18n-es="Seleccione su país"
```

to:

```
data-i18n-es="Selecciona tu país"
```

- [ ] **Step 6: Verify**

Run: `git diff src/pages/contact.astro`
Expected: 5 `data-i18n-es` value edits only.

---

## Task 8: Experiences page — experiences.astro

**Files:**
- Modify: `src/pages/experiences.astro:64`

The doc shows the booking-experience form heading as **"Solicitud de Cotización de Experiencias"** (image 6 / line 130 of the doc). Currently `experiences.astro:64` reads `data-i18n-es="Solicitud de experiencia"`. Update to match the doc.

- [ ] **Step 1: Update Experience Request heading on line 64**

Change:

```
data-i18n-es="Solicitud de experiencia"
```

to:

```
data-i18n-es="Solicitud de Cotización de Experiencias"
```

- [ ] **Step 2: Verify**

Run: `git diff src/pages/experiences.astro`
Expected: 1 `data-i18n-es` value change only.

---

## Task 9: Final commit + follow-up note

- [ ] **Step 1: Stage everything and commit**

```bash
git add src/components/HourlySection.astro \
        src/components/ExperienceSection.astro \
        src/components/ToursSection.astro \
        src/components/GlobalCoverageSection.astro \
        src/components/FeaturesSection.astro \
        src/pages/work-with-us.astro \
        src/pages/contact.astro \
        src/pages/experiences.astro
git commit -m "i18n(es): apply client Spanish copy revisions across site"
```

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Report follow-up**

Tell the user: the tour and experience **catalog cards** (titles + descriptions on `/book/tour` and `/experiences`) still render in English because that text comes from the database, not from `data-i18n-es` attributes. The client's note in the doc — *"The text in the tours is in the original language (English). Is it possible to automatically translate this as well? Otherwise to send you the translations :)"* — needs a product decision: either (a) the client sends ES copy for each catalog row and we add `title_es`/`description_es` columns + edits in the admin UI, or (b) we wire an auto-translation step. This is out of scope for the current change.

---

## Self-Review Checklist (run after writing code, before committing)

- [ ] Every modified line is a `data-i18n-es=` attribute or a `…Es:` array field.
- [ ] No English fallback text was rewritten.
- [ ] No `data-i18n-el` (Greek) value was rewritten.
- [ ] No CSS class, structural HTML, or behavior change.
- [ ] Plural/grammar sanity-checked the strings (especially "Explora **nuestras Experiencias**" — feminine plural; "minibuses" plural).
- [ ] Verified `git diff --stat` shows exactly the 8 files listed above and no others.
