/**
 * Per-card image carousel. Renders a fixed-aspect wrapper containing every
 * image stacked on top of each other; only one is opaque at a time. Arrows
 * fade in on hover (desktop) and are always visible on mobile. Dots sit at
 * the bottom. Single-image inputs short-circuit to a plain <img> (no nav).
 *
 * Rendering is string-based to match the existing tour.astro / experiences.astro
 * inline-JS render pattern. Initialization is a separate pass so templates can
 * be batch-rendered first, then wired up.
 */

export interface ImageCarouselOptions {
  /** Already-escaped alt text (caller runs esc()). */
  alt: string;
  /** Tailwind classes applied to the outer aspect wrapper. */
  wrapperClass: string;
  /** Extra classes for each <img> (e.g. `group-hover:scale-105`). */
  imgClass?: string;
}

const escAttr = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderImageCarouselHTML(
  images: string[],
  { alt, wrapperClass, imgClass = '' }: ImageCarouselOptions,
): string {
  const safeImages = images.filter(u => typeof u === 'string' && u.length > 0);

  // Fallback: empty or single-image → render a plain <img>, no carousel chrome.
  if (safeImages.length <= 1) {
    const src = safeImages[0] ?? '';
    return `
      <div class="${wrapperClass} bg-neutral-100">
        <img
          src="${escAttr(src)}"
          alt="${alt}"
          class="w-full h-full object-cover ${imgClass}"
          onerror="this.parentElement.style.background='#e5e7eb';this.style.display='none'"
        />
      </div>`;
  }

  const slides = safeImages.map((src, i) => `
    <img
      src="${escAttr(src)}"
      alt="${alt}"
      data-image-slide
      data-idx="${i}"
      class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${imgClass} ${i === 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}"
      onerror="this.style.background='#e5e7eb'"
    />
  `).join('');

  const dots = safeImages.map((_, i) => `
    <button
      type="button"
      data-image-dot
      data-idx="${i}"
      aria-label="Image ${i + 1} of ${safeImages.length}"
      class="w-1.5 h-1.5 rounded-full transition-all ${i === 0 ? 'bg-white w-4' : 'bg-white/60 hover:bg-white/80'}"
    ></button>
  `).join('');

  // Arrows: hidden on desktop by default, fade in on carousel hover via named
  // group. Always visible on mobile (<md) so touch users can tap them.
  const arrowBase = 'absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-neutral-800 shadow-md transition-opacity duration-200 md:opacity-0 md:group-hover/carousel:opacity-100';

  return `
    <div
      data-image-carousel
      class="group/carousel relative ${wrapperClass} bg-neutral-100"
    >
      ${slides}
      <button
        type="button"
        data-image-prev
        aria-label="Previous image"
        class="${arrowBase} left-2"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        type="button"
        data-image-next
        aria-label="Next image"
        class="${arrowBase} right-2"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <div class="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
        ${dots}
      </div>
    </div>`;
}

export function initImageCarousels(root: ParentNode): void {
  const carousels = root.querySelectorAll<HTMLElement>('[data-image-carousel]');

  carousels.forEach(carousel => {
    // Skip if already wired (idempotent — defensive against double-init).
    if (carousel.dataset.imageCarouselReady === '1') return;
    carousel.dataset.imageCarouselReady = '1';

    const slides = Array.from(carousel.querySelectorAll<HTMLImageElement>('[data-image-slide]'));
    const dots   = Array.from(carousel.querySelectorAll<HTMLButtonElement>('[data-image-dot]'));
    const prev   = carousel.querySelector<HTMLButtonElement>('[data-image-prev]');
    const next   = carousel.querySelector<HTMLButtonElement>('[data-image-next]');
    if (slides.length <= 1) return;

    let current = 0;

    function show(idx: number) {
      const target = (idx + slides.length) % slides.length;
      if (target === current) return;

      slides[current].classList.remove('opacity-100');
      slides[current].classList.add('opacity-0', 'pointer-events-none');
      slides[target].classList.remove('opacity-0', 'pointer-events-none');
      slides[target].classList.add('opacity-100');

      dots[current]?.classList.remove('bg-white', 'w-4');
      dots[current]?.classList.add('bg-white/60', 'hover:bg-white/80');
      dots[target]?.classList.add('bg-white', 'w-4');
      dots[target]?.classList.remove('bg-white/60', 'hover:bg-white/80');

      current = target;
    }

    prev?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      show(current - 1);
    });
    next?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      show(current + 1);
    });
    dots.forEach((dot, i) => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        show(i);
      });
    });
  });
}
