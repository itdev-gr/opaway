# Opawey

Airport transfers, city rides, and curated tours. Astro + Tailwind CSS.

## Project structure

```text
/
├── public/                    # Static assets (served at /)
│   ├── favicon.ico
│   ├── favicon.svg
│   ├── logo-opawey.png
│   ├── logo-opawey.svg
│   ├── booking-hero.png
│   ├── car.avif
│   ├── mini_van.avif
│   ├── van.avif
│   ├── tranfer_image.avif
│   ├── image_tours.avif
│   ├── experience_image.avif
│   ├── sea-2025-12-17-09-44-18-utc.mp4
│   └── the-luxury-car-is-high-in-the-mountains-on-an-obse-2026-01-21-03-24-01-utc.mp4
│
├── src/
│   ├── components/           # Reusable UI
│   │   ├── Navbar.astro
│   │   ├── Footer.astro
│   │   ├── HeroSection.astro
│   │   ├── BookingSection.astro
│   │   ├── FeaturesSection.astro
│   │   ├── GlobalCoverageSection.astro
│   │   ├── ToursSection.astro
│   │   ├── ExperienceSection.astro
│   │   ├── about/
│   │   │   ├── AboutHero.astro
│   │   │   ├── AboutStory.astro
│   │   │   ├── AboutFleet.astro
│   │   │   └── AboutCommitment.astro
│   │   └── experiences/
│   │       ├── ExperiencesHero.astro
│   │       └── ExperiencesList.astro
│   │
│   ├── layouts/
│   │   └── Layout.astro      # Navbar + slot + Footer
│   │
│   ├── pages/
│   │   ├── index.astro       # Home: hero, booking, features, coverage, tours, experience
│   │   ├── about.astro       # About: hero, story, fleet, commitment
│   │   ├── experiences.astro # Experiences: hero, list
│   │   ├── book.astro        # Book landing: Transfer | Tour cards
│   │   ├── book/
│   │   │   ├── transfer.astro  # Transfer booking form + fleet carousel
│   │   │   └── tour.astro      # Tour booking form + tour carousel
│   │   ├── contact.astro     # Contact
│   │   ├── login.astro       # Sign in
│   │   └── register.astro    # Create account
│   │
│   └── styles/
│       └── global.css        # Tailwind
│
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── start-dev.sh
└── README.md
```

## Routes

| URL | Page |
|-----|------|
| `/` | Home |
| `/about` | About Us |
| `/book` | Book Online (choose Transfer or Tour) |
| `/book/transfer` | Book a Transfer |
| `/book/tour` | Book a Tour |
| `/experiences` | Experiences |
| `/contact` | Contact |
| `/login` | Sign in |
| `/register` | Create account |
| `/profile` | Profile (signed-in users) |

## Commands

| Command | Action |
|---------|--------|
| `npm install` | Install dependencies |
| `npm run dev` | Dev server (default port 4321) |
| `npm run dev -- --port 4321` | Dev server on port 4321 |
| `npm run build` | Production build to `./dist/` |
| `npm run preview` | Preview production build |

## Firebase Auth (login / register)

Login and register use **Firebase Authentication** (email/password and Google).

### Firebase setup

1. Create a project at [Firebase Console](https://console.firebase.google.com/).
2. **Authentication → Sign-in method:** enable **Email/Password** and **Google** (otherwise login/register will fail with 400 or auth errors).
3. **Authentication → Settings → Authorized domains:** add `localhost` for local dev and your production domain (e.g. `opaway.vercel.app`). If the app’s domain is not listed, Auth requests can return 400.
4. Add a web app in the project, then copy the config object.
5. In the project root, copy `.env.example` to `.env` and set the `PUBLIC_FIREBASE_*` variables (for Vercel, set the same in Project → Settings → Environment Variables):

   ```env
   PUBLIC_FIREBASE_API_KEY=...
   PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   PUBLIC_FIREBASE_PROJECT_ID=...
   PUBLIC_FIREBASE_STORAGE_BUCKET=...
   PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
   PUBLIC_FIREBASE_APP_ID=...
   ```

6. Restart the dev server. Sign in and register will use Firebase.

## Google reviews (homepage section, admin-approved)

Reviews from the Google Business Profile are pulled once a day by a Vercel cron
(`vercel.json` → `GET /api/admin/sync-google-reviews`) and by the **Sync now**
button on `/admin/reviews`. New reviews land as *pending*; only reviews the
admin approves show in the homepage section (hidden while there are none).

Env vars (server-side, set in Vercel → Production and in local `.env`):

| Name | Purpose |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Key with the Places API enabled (not the browser-restricted `PUBLIC_GOOGLE_MAPS_API_KEY`) |
| `GOOGLE_PLACE_ID` | The business's Place ID (`ChIJ…`) |
| `CRON_SECRET` | Random string; Vercel sends it as `Authorization: Bearer …` on cron calls |

Google returns at most five reviews per call (newest five + most relevant
five are merged), so the archive grows from the first sync onward. Migration:
`db/migrations/2026-09-17-google-reviews.sql`.

## Tech

- [Astro](https://astro.build)
- [Tailwind CSS](https://tailwindcss.com) via `@tailwindcss/vite`
- [Firebase](https://firebase.google.com) (Authentication)
