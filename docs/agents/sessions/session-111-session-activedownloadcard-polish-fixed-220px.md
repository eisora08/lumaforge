## Session — ActiveDownloadCard polish: fixed 220px floating glass cards + entry animation
### Goal
Pulir el ActiveDownloadCard tras el rediseño premium: cards fijas y compactas que flotan sobre el arte del juego, stats en una sola fila, fila de controles en orden exacto y animación de entrada de barras/progreso.

### Decisiones del usuario
- Dark glass HARDCODEADO (bg-black/40 + texto blanco) — sustituye el glass theme-driven (.lf-glass-strong) de la sesión anterior; ignora temas intencionalmente.
- Altura fija h-[220px] en ambas cards.

### Part 1: Layout / altura / floating (ActiveDownloadCard.tsx)
- Grid wrapper: px-4 py-10 sm:px-6 md:grid-cols-2 md:py-12 (sin lg:min-h-[380px]) → arte del juego visible arriba/abajo de las cards.
- Cards: flex h-[220px] flex-col justify-between rounded-xl border border-white/10 bg-black/40 p-5 shadow-xl shadow-black/40 backdrop-blur-xl.

### Part 2: Card izquierda (gráfico)
- Header compacto ("Velocidad en vivo" text-white/50 + pill "Torrent" accent).
- Gráfico flex-1 items-end gap-[3px] (≈80% de la altura), barras from-(--color-accent)/25 to-(--color-accent)/70, transition-[height] duration-500 ease-out.
- Footer eliminado (el timeRemaining vive en la card derecha).

### Part 3: Card derecha (controles)
- Header: título truncate text-white + línea de tamaño text-white/60; pill repacker + botón Open Steam icono (ICON_BTN h-7 w-7) movidos aquí.
- Stats RED · PICO · SEEDS·PEERS en UNA fila compacta (gap-x-4, StatRow blanco, icono opcional).
- Fila inferior única flex items-center gap-3 en orden exacto: barra h-3.5 flex-1 rounded-full bg-white/15 → % w-16 font-bold tabular-nums → botón Pausar/Reanudar → Cancelar.
- CTRL_BTN = inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md transition hover:bg-black/70; Cancelar + hover:bg-red-500/40.

### Part 4: Animación de entrada
- const [entered, setEntered] = useState(false) + requestAnimationFrame(() => setEntered(true)) en mount.
- Barra: width entered ? pct : "0%" (transition-[width] duration-500 ease-out); barras: height entered ? h : 0%.
- Se reproduce al entrar a la página y al cambiar de descarga activa (ActiveDownloadRow keyed por job.id).
- Indeterminado: animate-pulse bg-white/60.

### Intacto
- Estado, mock, ambient feed "downloads-hero" (set/clear solo en unmount), hero-transition (crossfade useCrossfadeSrc / kenburns / focus), lógica canPause/canResume/canCancel/isOpenSteam, imgFailed → bg-(--color-bg).

### Key Files Changed
- src/components/downloads/ActiveDownloadCard.tsx — rewrite completo (layout, stats, controles, animación de entrada)

### Build
- tsc --noEmit ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en tocados)
- vite build ✅ (2.07s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos; verificadas strings "Velocidad en vivo"/"SEEDS:"/"RED"/"PICO"/"downloads-hero"/"Open Steam" + clases CSS .from-\(--color-accent\)\/25, .to-\(--color-accent\)\/70, .bg-white\/15, .bg-black\/40, .border-white\/20, .shadow-black\/40)
- cargo check ⏭️ skipped (no Rust changes)
