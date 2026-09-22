import React, { useMemo, useState } from 'react';
import { CATEGORIES, CATEGORY_TEXT_COLORS, searchPapers } from '../data/graph.js';

export default function SearchSidebar({ selectedUrl, onSelect }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchPapers(query, 15), [query]);

  return (
    <aside className="search-sidebar" aria-label="論文検索">
      <h2>論文を検索</h2>
      <input
        className="search-input"
        placeholder="タイトル・要約のキーワード"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() && (
        <div className="search-results" aria-live="polite">
          {results.map(({ url, paper }) => (
            <button
              key={url}
              className={`search-result${url === selectedUrl ? ' active' : ''}`}
              onClick={() => onSelect(url)}
            >
              <span style={{ color: CATEGORY_TEXT_COLORS[paper.category] }}>
                {CATEGORIES[paper.category] ?? paper.category}
              </span>
              <br />
              {paper.title}
              <br />
              <small>score {paper.score}</small>
            </button>
          ))}
          {!results.length && <p>該当する論文がありません</p>}
        </div>
      )}
    </aside>
  );
}
