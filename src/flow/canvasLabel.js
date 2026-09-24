// ノード上部にホバー時のラベル（白背景付き）を描く共通処理。offsetY=ノード上端からの距離。
// 全体マップ（GlobalMap）・関係グラフ（EgoGraph）のどちらのcanvas描画からも使う。
export function drawHoverLabel(ctx, node, offsetY, scale, text) {
  ctx.font = `600 ${12 / scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  const y = node.y - offsetY;
  const w = ctx.measureText(label).width + 8 / scale;
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.fillRect(node.x - w / 2, y - 12 / scale, w, 14 / scale);
  ctx.fillStyle = '#0f172a';
  ctx.fillText(label, node.x, y);
}
