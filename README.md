# Paper Knowledge Graph

AI・材料科学・量子計算などの分野で日次収集・評価している論文を、カテゴリ・トピック・概念（Concept/Method/Representation）でつないだ、ブラウザで探索できるナレッジグラフです。

**公開ページ: https://\<owner\>.github.io/paper-knowledge-graph/**

[JP_Market_Vis](https://github.com/mattyamonaca/JP_Market_Vis)（日本の上場企業マップ）の構成を参考に、Neo4j等のサーバーを使わず、静的JSON + React（Vite）だけで動く構成にしています。

## できること

- **全体マップ**: 論文1本=円1つのForce-directedグラフ（[JP_Market_Vis](https://github.com/mattyamonaca/JP_Market_Vis)の全体マップを踏襲）。白い円の縁の色=カテゴリ、大きさ=類似論文（SIMILAR_TO）の本数。カテゴリ絞り込み・最小類似論文数・表示件数上限（可視化候補数）を調整可能。クリックでその論文を中心に関係グラフへ
- **関係グラフ**: 論文を選ぶと、類似論文（embeddingコサイン類似度）・LLM抽出したConcept/Method/Representationとの関係をReact Flowのエゴネットワークで表示
- **検索（タイトル・要約 / 意味検索）**: タイトル・要約の部分一致に加え、Concept/Method/Representationに対する**意味検索**（埋め込みベースの類似度検索）が可能。クエリをブラウザ内で軽量モデル（all-MiniLM-L6-v2、transformers.js）でembedding化し、事前計算済みのConcept/Method/Representation embeddingとコサイン類似度を取る。類似度閾値・可視化する候補数はスライダーで調整可能
- **論文一覧**: カテゴリ・トピック・キーワードで絞り込み、スコア順に一覧
- **統計**: カテゴリ別件数・トピック別件数などのサマリー

## データの出所

- 収集元: `paper-bot`（arXiv / PubMed / RSS）が日次で収集し、LLMがスコア・カテゴリ・要約を自動付与
- グラフ化: `knowledge-graph/export_static.py`（このリポジトリの外、`daily_task/knowledge-graph/` にあるパイプライン）が
  - `sentence-transformers`（Qwen3-Embedding-8B）でtitle+abstractをembedding化
  - KMeansでトピッククラスタリング
  - コサイン類似度top-kで論文間 `SIMILAR_TO` を計算
  - LLM抽出したConcept/Method/Representationを名寄せして `DISCUSSES` / `USES_METHOD` / `USES_REPRESENTATION` を生成
  - `public/data/papers.json` / `public/data/graph.json` として書き出し
  - 意味検索用に、2件以上の論文に出現するConcept/Method/Representation（実測9,735件）を軽量モデル
    `all-MiniLM-L6-v2`（384次元、ブラウザ実行を前提に本体のQwen3-Embedding-8Bとは別で計算）で
    embedding化し `public/data/entity_search.bin`（生バイナリ、Float32）/
    `entity_search_meta.json` として書き出し

`score` / `ai_summary` / `reason` はLLMによる自動評価であり、正確性を保証するものではありません。意味検索はクエリ埋め込み・モデルダウンロードのため初回のみ huggingface.co への外部通信が発生します（`@huggingface/transformers` によるブラウザ内WASM推論、サーバーへの送信は無し）。

## データの更新

```bash
cd daily_task/knowledge-graph
.venv/bin/python export_static.py --out-dir site/public/data
cd site
git add public/data
git commit -m "update data"
git push
```

push すると GitHub Actions (`.github/workflows/pages.yml`) がビルドしてGitHub Pagesに自動デプロイします。

## ローカル開発

```bash
npm install
npm run dev       # http://localhost:5185
npm run build     # dist/ に静的ビルド
```

`public/data/papers.json` / `public/data/graph.json` が無いと起動できません。先に `export_static.py` を実行してください。
