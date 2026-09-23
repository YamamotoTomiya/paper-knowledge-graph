import React, { useEffect, useMemo, useState } from 'react';
import {
  CATEGORIES, CATEGORY_TEXT_COLORS, PAPERS, RELATIONS, RELATION_TYPE_JA, nodeName,
} from '../data/graph.js';
import DetailPanel from './DetailPanel.jsx';

// JP_Market_Vis の「関係一覧」タブに相当。個々のSIMILAR_TO/DISCUSSES/USES_METHOD/
// USES_REPRESENTATION関係を種別・カテゴリ・キーワードで絞り込み、一覧・詳細を見られる。
const MAX_ROWS = 300;
const TYPES = ['SIMILAR_TO', 'DISCUSSES', 'USES_METHOD', 'USES_REPRESENTATION'];

function normalize(s) {
  return (s ?? '').normalize('NFKC').toLowerCase();
}

function relationCategory(rel) {
  return PAPERS[rel.source.key]?.category ?? null;
}

function filterRelations(relations, { type, category, query }) {
  const q = normalize(query);
  return relations.filter((rel) => {
    if (type !== 'all' && rel.type !== type) return false;
    if (category !== 'all' && relationCategory(rel) !== category) return false;
    if (q) {
      const s = normalize(nodeName(rel.source));
      const t = normalize(nodeName(rel.target));
      if (!s.includes(q) && !t.includes(q)) return false;
    }
    return true;
  });
}

export default function RelationTable({ onOpenPaper }) {
  const [type, setType] = useState('all');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);

  useEffect(() => { setPage(0); setSelected(null); }, [type, category, query]);

  const filtered = useMemo(
    () => filterRelations(RELATIONS, { type, category, query }),
    [type, category, query],
  );
  const pageItems = filtered.slice(page * MAX_ROWS, (page + 1) * MAX_ROWS);
  const pageCount = Math.max(1, Math.ceil(filtered.length / MAX_ROWS));

  return (
    <div className="table-view relation-table-view">
      <div className="relation-table-main">
        <div className="table-controls">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">すべての種別</option>
            {TYPES.map((t) => <option key={t} value={t}>{RELATION_TYPE_JA[t] ?? t}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">すべてのカテゴリ</option>
            {Object.entries(CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <input
            className="search-input"
            placeholder="論文タイトル・Concept名などで検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="table-count">{filtered.length.toLocaleString()} 件</span>
        </div>
        <div className="relation-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {['ID', 'From', '種別', 'To', 'スコア/確信度'].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((rel) => {
                const color = CATEGORY_TEXT_COLORS[relationCategory(rel)] ?? 'var(--text-2)';
                const scoreVal = rel.score ?? rel.confidence;
                const isSel = selected?.id === rel.id;
                return (
                  <tr
                    key={rel.id}
                    className={`clickable-row${isSel ? ' selected' : ''}`}
                    tabIndex={0}
                    onClick={() => setSelected(isSel ? null : rel)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelected(isSel ? null : rel); }}
                  >
                    <td style={{ color: 'var(--text-2)' }}>{rel.id}</td>
                    <td>
                      {rel.source.kind === 'paper' ? (
                        <button className="link-cell" onClick={(e) => { e.stopPropagation(); onOpenPaper?.(rel.source.key); }}>
                          {nodeName(rel.source)}
                        </button>
                      ) : nodeName(rel.source)}
                    </td>
                    <td>
                      <span className="pill" style={{ color, background: `${color}14` }}>{RELATION_TYPE_JA[rel.type] ?? rel.type}</span>
                    </td>
                    <td>
                      <button className="link-cell" onClick={(e) => { e.stopPropagation(); onOpenPaper?.(rel.target.kind === 'paper' ? rel.target.key : rel.target); }}>
                        {nodeName(rel.target)}
                      </button>
                    </td>
                    <td>{scoreVal != null ? scoreVal.toFixed(3) : '—'}{rel.rescued && ' (救済)'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!pageItems.length && <p className="detail-empty">該当する関係がありません</p>}
        </div>
        <div className="table-pagination">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← 前へ</button>
          <span>{page + 1} / {pageCount}</span>
          <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>次へ →</button>
        </div>
      </div>
      {selected && (
        <DetailPanel
          selection={{ kind: 'edge', relation: selected }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
