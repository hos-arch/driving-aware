// カメラ映像の上に、探索範囲と検出した車線を重ねて描く。
// video は object-fit: cover で表示しているので、同じ変換で座標を合わせる。

const LINE_COLOR = '#4fe3ff';

const PERSON_COLOR = '#ffb020';

// 人の検出。細い枠は「人を探している範囲」（その外は見ていない）。
// 実線の枠は検出（続けて見つかった、確からしさの高いもの）。点線の枠は候補（まだ確かでないもの）。
function drawPersons(ctx, person, ox, oy, dw, dh) {
  if (!person) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 176, 32, 0.45)';
  for (const t of person.tiles) ctx.strokeRect(ox + t.x * dw, oy + t.y * dh, t.w * dw, t.h * dh);
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  for (const it of person.items) {
    const x = ox + it.x * dw;
    const y = oy + it.y * dh;
    const w = it.w * dw;
    const h = it.h * dh;
    ctx.strokeStyle = PERSON_COLOR;
    if (it.confirmed) {
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(x - 2, y - 20, 22, 17);
      ctx.fillStyle = PERSON_COLOR;
      ctx.fillText('人', x + 2, y - 4);
    } else {
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    }
  }
  ctx.restore();
}

export function drawOverlay(canvas, video, lane, carX, person) {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!video.videoWidth || !video.videoHeight) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sc = Math.max(cw / vw, ch / vh);
  const ox = (cw - vw * sc) / 2;
  const oy = (ch - vh * sc) / 2;
  drawPersons(ctx, person, ox, oy, vw * sc, vh * sc);
  if (!lane) return;
  const mx = (fx) => ox + (fx / lane.frameW) * vw * sc;
  const my = (fy) => oy + (fy / lane.frameH) * vh * sc;

  // 探索範囲（どこを見て判定しているかを示す）
  const top = my(lane.roi[0]);
  const bottom = my(lane.roi[1]);
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.strokeRect(0.5, top, cw - 1, bottom - top);
  ctx.restore();

  // 検出した境界線。近い側（ROI 下端から消失点に向かう途中まで）だけを描く。
  const [vx, vy] = lane.vp;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = LINE_COLOR;
  for (const side of [lane.left, lane.right]) {
    if (!side) continue;
    const x0 = side.xb;
    const y0 = lane.roi[1];
    const x1 = x0 + (vx - x0) * 0.55;
    const y1 = y0 + (vy - y0) * 0.55;
    ctx.beginPath();
    ctx.moveTo(mx(x0), my(y0));
    ctx.lineTo(mx(x1), my(y1));
    ctx.stroke();
  }

  // 自車の位置（基準を設定済みで、左右が検出できているときだけ）
  if (carX != null && lane.left && lane.right) {
    const x = mx(carX);
    const y = bottom;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x - 9, y + 4);
    ctx.lineTo(x + 9, y + 4);
    ctx.closePath();
    ctx.fill();
  }
}
