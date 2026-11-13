import fs from 'fs';

const domainTiers = JSON.parse(
  fs.readFileSync(new URL('../data/domainTiers.json', import.meta.url), 'utf8')
);

function getTier(urlStr = '', domainStr = '') {
  const cleanDomain = (domainStr || '').toLowerCase().replace(/^www\./, '');
  const cleanUrl = (urlStr || '').toLowerCase();

  // Check path-based entries first (e.g. reuters.com/fact-check)
  for (const [key, tier] of Object.entries(domainTiers)) {
    if (key.includes('/') && cleanUrl.includes(key.toLowerCase())) {
      return tier;
    }
  }

  // Exact domain match
  if (domainTiers[cleanDomain]) {
    return domainTiers[cleanDomain];
  }

  // Subdomain match (e.g., news.bbc.com matches bbc.com)
  for (const [key, tier] of Object.entries(domainTiers)) {
    if (!key.includes('/') && (cleanDomain === key || cleanDomain.endsWith(`.${key}`))) {
      return tier;
    }
  }

  // Default tier for unlisted sources
  return 3;
}

export function rankSources(sources = []) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return [];
  }

  const scored = sources.map((s, index) => ({
    ...s,
    tier: s.tier || getTier(s.url, s.domain),
    originalIndex: index
  }));

  scored.sort((a, b) => {
    // 1. Sort by tier ascending (Tier 1 > Tier 2 > Tier 3)
    if (a.tier !== b.tier) {
      return a.tier - b.tier;
    }

    // 2. Sort by relevance (higher score first if both have scores, else preserve search rank)
    if (typeof a.score === 'number' && typeof b.score === 'number') {
      return b.score - a.score;
    }

    return a.originalIndex - b.originalIndex;
  });

  return scored.slice(0, 4).map(({ originalIndex, score, ...rest }) => rest);
}
