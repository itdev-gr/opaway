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

## Tech

- [Astro](https://astro.build)
- [Tailwind CSS](https://tailwindcss.com) via `@tailwindcss/vite`
