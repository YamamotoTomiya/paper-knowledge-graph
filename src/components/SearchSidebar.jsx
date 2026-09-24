import React, { useCallback, useMemo, useState } from 'react';
import { CATEGORIES, CATEGORY_TEXT_COLORS, ENTITY_LABELS, PAPER_ENTRIES, searchPapers } from '../data/graph.js';
import { preloadSemanticSearch, semanticSearchPapers } from '../data/semanticSearch.js';

const BASE_URL = import.meta.env?.BASE_URL ?? '/';
const DEFAULT_LIMIT = 20;
const DEFAULT_THRESHOLD = 0.55;
// キーワード未入力時に出すランキング（JP_Market_Vis の SearchSidebar が空欄時に
// 関係数ランキングを出すのと同じ考え方。こちらはスコア順）
const SCORE_RANKING = [...PAPER_ENTRIES].sort((a, b) => b.score - a.score).slice(0, 40);

export default function SearchSidebar({ selectedUrl, onSelect }) {
  const [mode, setMode] = useState('text'); // 'text' | 'semantic'
  const [query, setQuery] = useState('');
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [semanticState, setSemanticState] = useState({ status: 'idle', rows: [], entityHitCount: 0, paperHitCount: 0 });

  const textResults = useMemo(
    () => (mode === 'text' && query.trim() ? searchPapers(query, limit) : []),
    [mode, query, limit],
  );

  const switchMode = useCallback((next) => {
    setMode(next);
    if (next === 'semantic') preloadSemanticSearch(BASE_URL);
  }, []);

  const runSemanticSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSemanticState((s) => ({ ...s, status: 'loading' }));
    try {
      const { rows, entityHitCount, paperHitCount } = await semanticSearchPapers(BASE_URL, query, { threshold, limit });
      setSemanticState({ status: 'done', rows, entityHitCount, paperHitCount });
    } catch (err) {
      setSemanticState({ status: 'error', rows: [], entityHitCount: 0, paperHitCount: 0, message: err.message });
    }
  }, [query, threshold, limit]);

  const onKeyDown = (e) => {
    if (mode === 'semantic' && e.key === 'Enter') runSemanticSearch();
  };

  return (
    <aside className="search-sidebar" aria-label="論文検索">
      <h2>論文を検索</h2>
      <div className="search-mode-tabs">
        <button className={mode === 'text' ? 'active' : ''} onClick={() => switchMode('text')}>タイトル・要約</button>
        <button className={mode === 'semantic' ? 'active' : ''} onClick={() => switchMode('semantic')}>意味検索</button>
      </div>
      <input
        className="search-input"
        placeholder={mode === 'text' ? 'タイトル・要約のキーワード' : '例: diffusion model, crystal structure'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />

      {mode === 'semantic' && (
        <div className="semantic-controls">
          <p className="control-note">
            クエリと、論文タイトル/要約およびConcept/Method/Representationの名称をブラウザ内で埋め込みベクトル化し、コサイン類似度で検索します（初回は軽量モデル ~25MB を読み込みます）。
          </p>
          <label className="range-caption" htmlFor="sem-threshold">類似度閾値 <strong>{threshold.toFixed(2)}</strong></label>
          <input id="sem-threshold" type="range" min="0.3" max="0.9" step="0.01" value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))} />
          <label className="range-caption" htmlFor="sem-limit">可視化する候補数 <strong>{limit}</strong></label>
          <input id="sem-limit" type="range" min="5" max="100" step="5" value={limit}
            onChange={(e) => setLimit(Number(e.target.value))} />
          <button className="btn search-run-btn" onClick={runSemanticSearch} disabled={!query.trim() || semanticState.status === 'loading'}>
            {semanticState.status === 'loading' ? '検索中…' : '意味検索を実行'}
          </button>
          {semanticState.status === 'error' && <p className="control-note" style={{ color: '#9a3412' }}>読み込みに失敗しました: {semanticState.message}</p>}
        </div>
      )}

      {mode === 'text' && (
        <div className="search-results" aria-live="polite">
          <p className="control-note">{query.trim() ? `検索結果 ${textResults.length} 件` : 'スコア上位40件（キーワード未入力時）'}</p>
          {(query.trim() ? textResults : SCORE_RANKING.map((paper) => ({ url: paper.url, paper }))).map(({ url, paper }) => (
            <button key={url} className={`search-result${url === selectedUrl ? ' active' : ''}`} onClick={() => onSelect(url)}>
              <span style={{ color: CATEGORY_TEXT_COLORS[paper.category] }}>{CATEGORIES[paper.category] ?? paper.category}</span>
              <br />{paper.title}
              <br /><small>score {paper.score}</small>
            </button>
          ))}
          {query.trim() && !textResults.length && <p>該当する論文がありません</p>}
        </div>
      )}

      {mode === 'semantic' && semanticState.status === 'done' && (
        <div className="search-results" aria-live="polite">
          {semanticState.rows.length > 0 && (
            <p className="control-note">
              類似Concept/Method/Representation {semanticState.entityHitCount}件・類似論文（タイトル/要約）{semanticState.paperHitCount}件がヒットしました。
            </p>
          )}
          {semanticState.rows.map(({ url, paper, match }) => (
            <button key={url} className={`search-result${url === selectedUrl ? ' active' : ''}`} onClick={() => onSelect(url)}>
              <span style={{ color: CATEGORY_TEXT_COLORS[paper.category] }}>{CATEGORIES[paper.category] ?? paper.category}</span>
              <br />{paper.title}
              <br />
              <small>
                {match.source === 'paper'
                  ? `タイトル/要約が類似 · 類似度 ${match.similarity.toFixed(2)}`
                  : `${ENTITY_LABELS[match.entityKind]}「${match.entityName}」 類似度 ${match.similarity.toFixed(2)}`}
                {' '}· score {paper.score}
              </small>
            </button>
          ))}
          {!semanticState.rows.length && <p>該当する論文がありません（閾値を下げてみてください）</p>}
        </div>
      )}
    </aside>
  );
}
