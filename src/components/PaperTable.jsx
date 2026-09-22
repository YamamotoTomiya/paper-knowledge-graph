import React, { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, CATEGORY_TEXT_COLORS, PAPER_ENTRIES, TOPICS } from '../data/graph.js';

const PAGE_SIZE = 30;

export default function PaperTable({ onOpenGraph }) {
  const [category, setCategory] = useState('');
  const [topic, setTopic] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PAPER_ENTRIES
      .filter((p) => !category || p.category === category)
      .filter((p) => !topic || p.topic_id === topic)
      .filter((p) => !q || p.title.toLowerCase().includes(q) || p.abstract.toLowerCase().includes(q))
      .sort((a, b) => b.score - a.score);
  }, [category, topic, query]);

  useEffect(() => setPage(0), [category, topic, query]);

  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  return (
    <div className="table-view">
      <div className="table-controls">
        <input
          className="search-input"
          placeholder="タイトル・abstractで検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={category} onChange={(e) => { setCategory(e.target.value); setTopic(''); }}>
          <option value="">すべてのカテゴリ</option>
          {Object.entries(CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option value="">すべてのトピック</option>
          {Object.entries(TOPICS).map(([id, info]) => <option key={id} value={id}>{info.label}</option>)}
        </select>
        <span className="table-count">{filtered.length.toLocaleString()} 件</span>
      </div>
      <div className="paper-list">
        {pageItems.map((p) => (
          <button key={p.url} className="paper-row" onClick={() => onOpenGraph(p.url)}>
            <span className="paper-row-cat" style={{ color: CATEGORY_TEXT_COLORS[p.category] }}>
              {CATEGORIES[p.category] ?? p.category}
            </span>
            <span className="paper-row-title">{p.title}</span>
            <span className="paper-row-score">score {p.score}</span>
          </button>
        ))}
        {!pageItems.length && <p className="detail-empty">該当する論文がありません</p>}
      </div>
      <div className="table-pagination">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← 前へ</button>
        <span>{page + 1} / {pageCount}</span>
        <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>次へ →</button>
      </div>
    </div>
  );
}
