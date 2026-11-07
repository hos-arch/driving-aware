import { Camera, cameraMessage } from './camera.js';
import { Gps } from './gps.js';
import { WakeLock } from './wakelock.js';
import { Pipeline } from './pipeline.js';
import { createRecognizers, STATES } from './recognizers/index.js';
import { msToKmh, formatSpeed, isOverspeed, describeGps } from './format.js';
import { loadLaneConfig, getRefDx, setRefDx } from './config.js';
import { drawOverlay } from './overlay.js';

const $ = (id) => document.getElementById(id);

const STATE_TEXT = {
  [STATES.DETECTED]: '検出',
  [STATES.NOT_DETECTED]: '検出されず',
  [STATES.UNCHECKED]: '未確認',
};

const STALL_MS = 2000; // 処理が止まったとみなすまでの時間

// --- 状態 -------------------------------------------------------------
let started = false;
let camState = 'stopped'; // stopped | starting | ok | <失敗の種類>
let speedLimitKmh = null; // 標識認識（ステップ3）が入るまで常に null
let refDx = getRefDx(); // 自車の中心の、画像中心からのずれ（幅に対する比）。未設定なら null
let lastLane = null;

const camera = new Camera($('cam'), {
  onEnded: () => {
    camState = 'stopped';
    pipeline.stop();
    renderAll();
  },
});
const gps = new Gps({ onChange: () => renderAll() });
const wakeLock = new WakeLock({ onChange: () => renderAll() });
const recognizers = createRecognizers({ lane: loadLaneConfig() });
const pipeline = new Pipeline($('cam'), recognizers, {
  onResult: (results) => renderRecognizers(results),
});

// --- 描画 -------------------------------------------------------------
function renderSpeed() {
  const desc = describeGps({ ...gps.snapshot(), now: Date.now() });
  const kmh = desc.kind === 'ok' ? msToKmh(gps.speedMs) : null;
  const over = isOverspeed(kmh, speedLimitKmh);

  $('speed').textContent = formatSpeed(kmh);
  $('speed').dataset.state = over ? 'over' : kmh == null ? 'unknown' : 'ok';
  $('gpsNote').textContent = desc.text;
  $('overspeed').hidden = !over;

  $('limit').textContent = speedLimitKmh == null ? '--' : String(speedLimitKmh);
  $('limitNote').textContent =
    speedLimitKmh == null ? '未確認（標識の認識は未実装）' : '認識した速度標識';

  return desc;
}

function renderRecognizers(results) {
  for (const r of recognizers) {
    const res = results[r.id] ?? { state: STATES.UNCHECKED, detail: '' };
    const row = document.querySelector(`.status li[data-id="${r.id}"]`);
    if (!row) continue;
    const stateEl = row.querySelector('.state');
    stateEl.dataset.state = res.state;
    stateEl.textContent = STATE_TEXT[res.state] ?? STATE_TEXT[STATES.UNCHECKED];
    row.querySelector('.detail').textContent = res.detail ? `（${res.detail}）` : '';
  }
  renderLane(results.lane ? results.lane.lane : null);
}

// 車線: 映像への重ね描きと、車線内の位置
function renderLane(lane) {
  lastLane = lane;
  const both = !!(lane && lane.left && lane.right);
  const carX = both && refDx != null ? (0.5 + refDx) * lane.frameW : null;
  drawOverlay($('overlay'), $('cam'), lane, carX);

  const dot = $('laneDot');
  const text = $('lanePosText');
  $('calBtn').disabled = !both;
  dot.hidden = true;
  if (!lane || (!lane.left && !lane.right)) {
    text.textContent = '位置 未確認';
  } else if (!both) {
    text.textContent = '位置 未確認（片側のみ）';
  } else if (refDx == null) {
    text.textContent = '位置 基準未設定';
  } else {
    const pos = (carX - lane.left.xb) / (lane.right.xb - lane.left.xb);
    dot.hidden = false;
    dot.style.left = `${Math.min(1, Math.max(0, pos)) * 100}%`;
    const off = Math.round((pos - 0.5) * 100);
    text.textContent = Math.abs(off) < 3 ? '位置 中央' : `位置 中央から${off < 0 ? '左' : '右'}へ ${Math.abs(off)}%`;
  }
}

function setSys(id, level, text) {
  const el = $(id);
  el.dataset.level = level;
  el.textContent = text;
}

function renderSys(gpsDesc) {
  // カメラ
  if (camState === 'ok' && camera.live) setSys('sysCam', 'ok', 'カメラ 動作中');
  else if (camState === 'starting') setSys('sysCam', 'warn', 'カメラ 起動中');
  else if (camState === 'stopped') setSys('sysCam', 'ng', 'カメラ 停止');
  else if (camState === 'ok') setSys('sysCam', 'ng', 'カメラ 停止');
  else setSys('sysCam', 'ng', 'カメラ 異常');

  // GPS
  const GPS_SYS = {
    ok: ['ok', 'GPS 受信中'],
    waiting: ['warn', 'GPS 受信待ち'],
    'no-speed': ['ng', 'GPS 速度なし'],
    stale: ['ng', 'GPS 更新なし'],
    denied: ['ng', 'GPS 未許可'],
    unavailable: ['ng', 'GPS 異常'],
  };
  const [gpsLevel, gpsText] = GPS_SYS[gpsDesc.kind] ?? ['ng', 'GPS 異常'];
  setSys('sysGps', gpsLevel, gpsText);

  // 画面常時点灯
  if (wakeLock.status === 'active') setSys('sysWake', 'ok', '常時点灯 有効');
  else if (wakeLock.status === 'unsupported') setSys('sysWake', 'ng', '常時点灯 非対応');
  else setSys('sysWake', 'ng', '常時点灯 無効');

  // 処理
  const alive = pipeline.lastFrameAt != null && Date.now() - pipeline.lastFrameAt < STALL_MS;
  if (alive) {
    setSys('sysProc', 'ok', `処理 ${Math.round(pipeline.fps)}fps ${Math.round(pipeline.procMs)}ms`);
  } else {
    setSys('sysProc', 'ng', '処理 停止');
  }
  return alive;
}

function renderAlert() {
  let text = '';
  let retry = false;
  if (camState !== 'ok' && camState !== 'starting') {
    text = camState === 'stopped' ? 'カメラが停止しています' : cameraMessage(camState);
    retry = true;
  } else if (wakeLock.status === 'unsupported' || wakeLock.status === 'denied') {
    text = '画面が自動で消えることがあります。端末の設定で消灯しないようにしてください';
  }
  $('alert').hidden = !text;
  $('alertText').textContent = text;
  $('retryBtn').hidden = !retry;
}

function renderAll() {
  if (!started) return;
  const gpsDesc = renderSpeed();
  const alive = renderSys(gpsDesc);
  if (!alive) {
    // 処理が止まっている間は、前回の結果を残さず「未確認」に戻す
    renderRecognizers({});
  }
  renderAlert();
}

// --- カメラ -----------------------------------------------------------
async function startCamera() {
  camState = 'starting';
  renderAll();
  const r = await camera.start();
  if (r.ok) {
    camState = 'ok';
    pipeline.start();
  } else {
    camState = r.kind;
    pipeline.stop();
  }
  renderAll();
}

// --- 開始・復帰 -------------------------------------------------------
$('startBtn').addEventListener('click', () => {
  started = true;
  $('start').hidden = true;
  $('hud').hidden = false;
  // 以下はユーザー操作の中で開始する（iOS Safari の要件）
  wakeLock.request();
  gps.start();
  startCamera();
  renderAll();
});

$('retryBtn').addEventListener('click', () => {
  startCamera();
});

// 「いま車が車線の中央にいる」として、自車の位置の基準を決める（停車して行う）
$('calBtn').addEventListener('click', () => {
  const lane = lastLane;
  if (!(lane && lane.left && lane.right)) return;
  refDx = (lane.left.xb + lane.right.xb) / 2 / lane.frameW - 0.5;
  setRefDx(refDx);
  renderLane(lane);
});

document.addEventListener('visibilitychange', () => {
  if (!started || document.visibilityState !== 'visible') return;
  wakeLock.reacquire();
  if (!camera.live) startCamera();
});

// GPS の途絶・処理の停止は、イベントが来ないことで起きるので定期的に確認する
setInterval(renderAll, 500);
