import dotenv from 'dotenv';
dotenv.config();

function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function searchGoogleFactCheck(query) {
  const apiKey = process.env.GOOGLE_FACTCHECK_API_KEY;
  if (!apiKey || apiKey === 'PASTE_KEY_HERE') {
    return [];
  }

  const endpoint = `https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(query)}&key=${apiKey}`;
  try {
    const res = await fetch(endpoint);
    if (!res.ok) return [];
    const data = await res.json();
    const claims = Array.isArray(data.claims) ? data.claims : [];
    const results = [];

    for (const claim of claims) {
      if (results.length >= 5) break;
      const review = claim.claimReview?.[0];
      if (review && review.url) {
        results.push({
          title: review.title || claim.text || 'Fact Check Review',
          url: review.url,
          snippet: review.textualRating ? `Rating: ${review.textualRating}` : (claim.text || ''),
          domain: getDomain(review.url) || review.publisher?.site || ''
        });
      }
    }
    return results.slice(0, 5);
  } catch (err) {
    console.warn('[Search] Google Fact Check failed:', err.message);
    return [];
  }
}

async function searchTavily(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || apiKey === 'PASTE_KEY_HERE') {
    return [];
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        search_depth: 'basic'
      })
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];

    return results.slice(0, 5).map(r => ({
      title: r.title || 'Search Result',
      url: r.url,
      snippet: r.content || '',
      domain: getDomain(r.url),
      score: r.score
    }));
  } catch (err) {
    console.warn('[Search] Tavily search failed:', err.message);
    return [];
  }
}

export async function searchEvidence(claim) {
  if (!claim) return [];

  const [factCheckResults, tavilyResults] = await Promise.all([
    searchGoogleFactCheck(claim),
    searchTavily(claim)
  ]);

  const combined = [
    ...factCheckResults.slice(0, 5),
    ...tavilyResults.slice(0, 5)
  ];

  return combined.map((source, index) => ({
    id: `S${index + 1}`,
    title: source.title,
    url: source.url,
    domain: source.domain || getDomain(source.url),
    snippet: source.snippet || '',
    score: source.score ?? null
  }));
}
