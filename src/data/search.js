// 論文・Concept/Method/Representationのキーワード検索。タイトル・abstract・要約・カテゴリ名の
// 部分一致（大小無視）。件数が多いため、まず単純な線形走査＋スコアリングで実装する。
export const normalizeText = (s) => (s ?? '').normalize('NFKC').toLowerCase().trim();

function scoreMatch(text, q) {
  const t = normalizeText(text);
  if (!t.includes(q)) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 10;
  return 1;
}

export function createPaperSearcher(papersByUrl) {
  const index = Object.entries(papersByUrl).map(([url, p]) => ({ url, paper: p }));
  return function searchPapers(query, limit = 30) {
    const q = normalizeText(query);
    if (!q) return [];
    const hits = [];
    for (const { url, paper } of index) {
      const titleScore = scoreMatch(paper.title, q) * 3;
      const abstractScore = scoreMatch(paper.abstract, q);
      const summaryScore = scoreMatch(paper.ai_summary, q) * 2;
      const score = titleScore + abstractScore + summaryScore;
      if (score > 0) hits.push({ url, paper, score, matchScore: score + paper.score / 100 });
    }
    return hits.sort((a, b) => b.matchScore - a.matchScore).slice(0, limit);
  };
}

export function createEntitySearcher(entitiesByName) {
  const index = Object.entries(entitiesByName).map(([normalizedName, e]) => ({ normalizedName, entity: e }));
  return function searchEntities(query, limit = 20) {
    const q = normalizeText(query);
    if (!q) return [];
    const hits = [];
    for (const { normalizedName, entity } of index) {
      const nameScore = scoreMatch(entity.name, q);
      const aliasScore = (entity.aliases || []).some((a) => normalizeText(a).includes(q)) ? 0.5 : 0;
      const score = nameScore + aliasScore;
      if (score > 0) hits.push({ normalizedName, entity, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  };
}
