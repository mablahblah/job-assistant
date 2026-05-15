// DB-first company name resolution with in-memory cache.
// Checks Company table by atsPlatform+atsSlug, falls back to a fetcher
// function (API call or Playwright scrape), then caches the result.

import { prisma } from "@/lib/prisma";

// In-memory cache for the duration of a pipeline run: "platform:slug" → name
const cache = new Map<string, string>();

function cacheKey(platform: string, slug: string): string {
  return `${platform}:${slug}`;
}

// Resolve a company name by ATS platform and slug.
// 1. Check in-memory cache
// 2. Check DB (Company.atsPlatform + Company.atsSlug)
// 3. Call fetcher if provided (API or Playwright)
// 4. Store result in DB and cache
export async function resolveCompanyName(
  platform: string,
  slug: string,
  fetcher?: (slug: string) => Promise<string | null>,
): Promise<string | null> {
  const key = cacheKey(platform, slug);

  // 1. In-memory cache hit (empty string = cached miss)
  if (cache.has(key)) return cache.get(key) || null;

  // 2. DB lookup
  const existing = await prisma.company.findFirst({
    where: { atsPlatform: platform, atsSlug: slug },
    select: { name: true },
  });
  if (existing) {
    cache.set(key, existing.name);
    return existing.name;
  }

  // 3. No fetcher — can't resolve
  if (!fetcher) return null;

  // 4. Fetch from external source
  const name = await fetcher(slug);
  if (!name) {
    // Cache the miss so we don't retry for this slug during this run
    cache.set(key, "");
    return null;
  }

  // 5. Store in DB and cache
  await prisma.company.upsert({
    where: { name },
    create: { name, atsPlatform: platform, atsSlug: slug },
    update: { atsPlatform: platform, atsSlug: slug },
  });
  cache.set(key, name);
  return name;
}

// Clear in-memory cache — used in tests
export function clearCompanyCache(): void {
  cache.clear();
}
