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

1. Create a project at [Firebase Console](https://console.firebase.google.com/).
2. Enable **Authentication** → Sign-in method: **Email/Password** and **Google**.
3. Add a web app and copy the config object.
4. In the project root, copy `.env.example` to `.env` and set:

   ```env
   PUBLIC_FIREBASE_API_KEY=...
   PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   PUBLIC_FIREBASE_PROJECT_ID=...
   PUBLIC_FIREBASE_STORAGE_BUCKET=...
   PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
   PUBLIC_FIREBASE_APP_ID=...
   ```

5. Restart the dev server. Sign in and register will use Firebase.

## Tech

- [Astro](https://astro.build)
- [Tailwind CSS](https://tailwindcss.com) via `@tailwindcss/vite`
- [Firebase](https://firebase.google.com) (Authentication)
