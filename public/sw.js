// Service Worker nativo — SHARK FH (Next.js 16 Turbopack + iOS Safari PWA)
const CACHE_VERSION = "shark-fh-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;

const PRECACHE_STATIC = [
  "/offline",
  "/offline/cliente",
  "/offline/emprestimo",
  "/manifest.webmanifest",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/logo-symbol.png",
];

const DEFAULT_WARMUP_ROUTES = [
  "/clientes",
  "/clientes/novo",
  "/emprestimos",
  "/emprestimos/novo",
  "/cheques",
  "/parceiros",
  "/offline",
  "/offline/cliente",
  "/offline/emprestimo",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const staticCache = await caches.open(STATIC_CACHE);
      const pageCache = await caches.open(PAGE_CACHE);
      await Promise.allSettled(
        PRECACHE_STATIC.map(async (url) => {
          try {
            const res = await fetch(url, { credentials: "same-origin" });
            if (res.ok && !res.redirected) {
              if (url.startsWith("/offline")) {
                await pageCache.put(url, res.clone());
              } else {
                await staticCache.put(url, res.clone());
              }
            }
          } catch {
            // Ignora falhas individuais no install
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest" ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|ico|webp)$/i.test(pathname)
  );
}

function isFuncionarioRoute(pathname) {
  const reservados = [
    "api",
    "login",
    "clientes",
    "emprestimos",
    "parceiros",
    "cobrancas",
    "configuracoes",
    "cheques",
    "mensagens",
    "perfil",
    "offline",
  ];
  const m = pathname.match(/^\/([^/]+)\/cliente\/?$/);
  return Boolean(m && !reservados.includes(m[1]));
}

function pageCacheKey(request, isRsc) {
  const url = new URL(request.url);
  // Para páginas offline com query param (?id=...), normaliza para a rota base
  if (url.pathname === "/offline/cliente" || url.pathname === "/offline/emprestimo") {
    return isRsc ? `${url.origin}${url.pathname}::rsc` : `${url.origin}${url.pathname}`;
  }
  return isRsc ? `${url.origin}${url.pathname}${url.search}::rsc` : `${url.origin}${url.pathname}${url.search}`;
}

function basePathKey(request, isRsc) {
  const url = new URL(request.url);
  return isRsc ? `${url.origin}${url.pathname}::rsc` : `${url.origin}${url.pathname}`;
}

async function warmupRoutes(routes) {
  const pageCache = await caches.open(PAGE_CACHE);
  const targets = Array.isArray(routes) && routes.length > 0 ? routes : DEFAULT_WARMUP_ROUTES;
  await Promise.allSettled(
    targets.map(async (route) => {
      try {
        const res = await fetch(route, {
          credentials: "same-origin",
          headers: { Accept: "text/html" },
        });
        if (res.ok && !res.redirected) {
          const url = new URL(route, self.location.origin);
          await pageCache.put(`${url.origin}${url.pathname}`, res.clone());
        }
      } catch {
        // Sem rede ou erro transitório
      }
    })
  );
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "WARMUP_ROUTES") {
    event.waitUntil(warmupRoutes(data.routes));
  } else if (data.type === "CLEAR_CACHES") {
    event.waitUntil(
      (async () => {
        await caches.delete(PAGE_CACHE);
      })()
    );
  } else if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Nunca intercepta /sw.js, /api/*, /login ou painel do funcionário
  if (
    url.pathname === "/sw.js" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/login") ||
    isFuncionarioRoute(url.pathname)
  ) {
    return;
  }

  // 1. Assets estáticos: Cache-First
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok && !res.redirected) {
            cache.put(request, res.clone());
          }
          return res;
        } catch {
          return new Response("", { status: 503, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // 2. Navegação HTML e payloads RSC do Next.js: Network-First com Cache Fallback
  const isRsc = request.headers.get("RSC") === "1";
  const isNavigate = request.mode === "navigate";

  if (isNavigate || isRsc) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGE_CACHE);
        const exactKey = pageCacheKey(request, isRsc);
        const pathKey = basePathKey(request, isRsc);

        try {
          const res = await fetch(request);
          // Só cacheia respostas 200 sem redirect (nunca cacheia redirect para /login)
          if (res.ok && !res.redirected) {
            const finalPath = new URL(res.url).pathname;
            if (!finalPath.startsWith("/login")) {
              cache.put(exactKey, res.clone());
              if (pathKey !== exactKey) {
                cache.put(pathKey, res.clone());
              }
            }
          }
          return res;
        } catch {
          // Offline: tenta cache exato, depois cache pelo pathname sem query
          const cachedExact = await cache.match(exactKey);
          if (cachedExact) return cachedExact;

          const cachedPath = await cache.match(pathKey);
          if (cachedPath) return cachedPath;

          // Se for navegação HTML para rotas dinâmicas conhecidas, cai no shell offline correspondente
          if (isNavigate) {
            if (/^\/clientes\/[^/]+(\/editar)?\/?$/.test(url.pathname) && !url.pathname.startsWith("/clientes/novo")) {
              const cliFallback = await cache.match(`${url.origin}/offline/cliente`);
              if (cliFallback) return cliFallback;
            }
            if (/^\/emprestimos\/[^/]+(\/editar)?\/?$/.test(url.pathname) && !url.pathname.startsWith("/emprestimos/novo")) {
              const empFallback = await cache.match(`${url.origin}/offline/emprestimo`);
              if (empFallback) return empFallback;
            }
            const offlinePage = await cache.match(`${url.origin}/offline`);
            if (offlinePage) return offlinePage;
          }

          return new Response("Offline", { status: 503, statusText: "Offline" });
        }
      })()
    );
  }
});
