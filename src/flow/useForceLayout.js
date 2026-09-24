import { useEffect, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';

// 全体マップ（react-force-graph-2d）の warmupTicks={30} / cooldownTime={3000} と
// 同じタイミングにする。alphaDecay/alphaMin/velocityDecayもd3-forceの既定値のまま
// （どちらも上書きしていない）にして、力学シミュレーションの「動き方」を揃える。
const WARMUP_TICKS = 30;
const COOLDOWN_MS = 3000;

// 関係グラフ（エゴネットワーク）に、全体マップと同じような力学シミュレーションでの
// 自然な動き（反発・リンクによる引き合い・衝突回避）を持たせる。
// buildEgoNetwork() が算出するセクター配置（種別ごとに放射状に並べた位置）を初期値として使い、
// そこから物理演算で自然に落ち着く位置へアニメーションさせる（中心ノードは原点に固定）。
export function useForceLayout(nodes, edges) {
  const [positions, setPositions] = useState({});

  useEffect(() => {
    if (!nodes.length) {
      setPositions({});
      return undefined;
    }

    const simNodes = nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, isCenter: n.type === 'center', isPaper: n.type === 'paper' }));
    for (const n of simNodes) {
      if (n.isCenter) { n.fx = 0; n.fy = 0; }
    }
    const simLinks = edges.map((e) => ({ source: e.source, target: e.target }));

    // 論文ノードは円だけの小さい見た目になったので、カード表示のConcept/Method/
    // Representationノードほど間隔を広げる必要はない（衝突半径を小さくする）。
    const collideRadius = (d) => (d.isCenter ? 90 : d.isPaper ? 24 : 60);
    const sim = forceSimulation(simNodes)
      .force('charge', forceManyBody().strength(-320))
      .force('link', forceLink(simLinks).id((d) => d.id).distance(150).strength(0.55))
      .force('collide', forceCollide(collideRadius))
      .force('center', forceCenter(0, 0).strength(0.02))
      .stop();

    const applyPositions = () => {
      const next = {};
      for (const n of simNodes) next[n.id] = { x: n.x, y: n.y };
      setPositions(next);
    };

    // 全体マップのwarmupTicksと同じく、最初の数十ティックはまとめて計算してから描画する
    // （1ティックずつ描くと初動がだらだら長く見え、マップの「パッと大まかな形になってから
    // 微調整で落ち着く」動きと違って見えるため）。
    for (let i = 0; i < WARMUP_TICKS; i += 1) sim.tick();
    applyPositions();

    let frame = null;
    const start = performance.now();
    const tick = () => {
      sim.tick();
      applyPositions();
      const elapsed = performance.now() - start;
      if (sim.alpha() > sim.alphaMin() && elapsed < COOLDOWN_MS) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      sim.stop();
    };
  }, [nodes, edges]);

  return positions;
}
