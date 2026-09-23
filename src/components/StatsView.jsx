import React, { useMemo } from 'react';
import { CATEGORIES, CATEGORY_TEXT_COLORS, META, PAPER_GLOBAL_GRAPH, STATS, TOPICS } from '../data/graph.js';

export default function StatsView({ onOpenPaper }) {
  const topTopics = useMemo(
    () => Object.entries(STATS.byTopic).sort((a, b) => b[1] - a[1]).slice(0, 15),
    [],
  );
  // 類似論文数（SIMILAR_TO）が多い、いわゆるハブ論文のランキング（JP_Market_Vis の
  // 「ハブ企業ランキング」と同じ考え方）。クリックでその論文を中心に関係グラフを開く。
  const hubPapers = useMemo(
    () => [...PAPER_GLOBAL_GRAPH.nodes].sort((a, b) => b.degree - a.degree).slice(0, 20),
    [],
  );

  return (
    <div className="stats-view">
      <section className="stats-summary">
        <div><strong>{STATS.papers.toLocaleString()}</strong><span>論文</span></div>
        <div><strong>{STATS.topics.toLocaleString()}</strong><span>トピック</span></div>
        <div><strong>{STATS.concepts.toLocaleString()}</strong><span>コンセプト</span></div>
        <div><strong>{STATS.methods.toLocaleString()}</strong><span>手法</span></div>
        <div><strong>{STATS.representations.toLocaleString()}</strong><span>表現形式</span></div>
        <div><strong>{STATS.relations.toLocaleString()}</strong><span>関係</span></div>
        <div><strong>{STATS.avgScore.toFixed(1)}</strong><span>平均スコア</span></div>
      </section>

      <section className="stats-block">
        <h3>カテゴリ別件数</h3>
        <div className="bar-list">
          {Object.entries(CATEGORIES).map(([key, label]) => {
            const count = STATS.byCategory[key] ?? 0;
            const pct = STATS.papers ? (count / STATS.papers) * 100 : 0;
            return (
              <div className="bar-row" key={key}>
                <span className="bar-label">{label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${pct}%`, background: CATEGORY_TEXT_COLORS[key] }} />
                </div>
                <span className="bar-value">{count.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="stats-block">
        <h3>論文数の多いトピック トップ15</h3>
        <div className="bar-list">
          {topTopics.map(([topicId, count]) => (
            <div className="bar-row" key={topicId}>
              <span className="bar-label">{TOPICS[topicId]?.label ?? topicId}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(count / topTopics[0][1]) * 100}%`, background: '#475569' }} />
              </div>
              <span className="bar-value">{count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stats-block stats-block-wide">
        <h3>ハブ論文ランキング（類似論文数 上位20件）</h3>
        <table className="data-table">
          <thead>
            <tr>
              {['#', 'タイトル', 'カテゴリ', 'score', '類似論文数'].map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {hubPapers.map((p, i) => (
              <tr key={p.id} tabIndex={0} className="clickable-row"
                onClick={() => onOpenPaper?.(p.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpenPaper?.(p.id); }}
              >
                <td>{i + 1}</td>
                <td className="hub-title">{p.title}</td>
                <td style={{ color: CATEGORY_TEXT_COLORS[p.category] }}>{CATEGORIES[p.category] ?? p.category}</td>
                <td>{p.score}</td>
                <td>{p.degree}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="stats-footnote">データ生成 {META.generatedAt?.slice(0, 19).replace('T', ' ')} UTC</p>
    </div>
  );
}
