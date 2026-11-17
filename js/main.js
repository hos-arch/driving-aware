import { Camera, cameraMessage } from './camera.js';
import { Gps } from './gps.js';
import { WakeLock } from './wakelock.js';
import { Pipeline } from './pipeline.js';
import { createRecognizers, STATES } from './recognizers/index.js';
import { msToKmh, formatSpeed, describeGps } from './format.js';
import { loadLaneConfig, getRefDx, setRefDx } from './config.js';
import { drawOverlay } from './overlay.js';
import { loadOrtDetector, personModelName, setPersonModel, MODEL_LABELS } from './recognizers/person-ort.js';
import { Capture } from './capture.js';
import { assess, WarnHolder, LEVELS } from './danger-core.js';
import { Beeper } from './audio.js';

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
let refDx = getRefDx(); // 自車の中心の、画像中心からのずれ（幅に対する比）。未設定なら null
let lastLane = null;
let lastPerson = null;
let lastDanger = null; // 人の危険判定の結果（映像に重ねる用）
const warnHolder = new WarnHolder();
const beeper = new Beeper();
let personModel = personModelName(); // いま選んでいる人の検出モデル（nano | tiny）
let personInfo = null; // 読み込み済みのモデルの名前とスレッド数（読み込み中は null）
let clearArmedAt = 0; // 「消去」を 1 回押した時刻（もう一度押すと消す）

const camera = new Camera($('cam'), {
  onEnded: () => {
    camState = 'stopped';
    pipeline.stop();
    renderAll();
  },
});
const gps = new Gps({ onChange: () => renderAll() });
const wakeLock = new WakeLock({ onChange: () => renderAll() });
const capture = new Capture({ limit: 1000, onChange: () => renderCapture() });
const recognizers = createRecognizers({
  lane: loadLaneConfig(),
  person: {
    loadDetector: async (name) => {
      const want = name ?? personModel;
      const d = await loadOrtDetector(want);
      if (want === personModel) personInfo = d.info; // 読み込み中にまた切り替えられたときは、古い方の情報を入れない
      return d;
    },
    onScan: (scan) => {
      const v = $('cam');
      capture.offer(scan, { model: personInfo && personInfo.model, video: [v.videoWidth, v.videoHeight] });
    },
  },
});
const personRecognizer = recognizers.find((r) => r.id === 'pedestrian');
const pipeline = new Pipeline($('cam'), recognizers, {
  onResult: (results) => renderRecognizers(results),
});

// --- 描画 -------------------------------------------------------------
function renderSpeed() {
  const desc = describeGps({ ...gps.snapshot(), now: Date.now() });
  const kmh = desc.kind === 'ok' ? msToKmh(gps.speedMs) : null;

  $('speed').textContent = formatSpeed(kmh);
  $('speed').dataset.state = kmh == null ? 'unknown' : 'ok';
  $('gpsNote').textContent = desc.text;

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
  lastPerson = results.pedestrian ? results.pedestrian.person : null;
  const lane = results.lane ? results.lane.lane : null;
  renderWarn(lane);
  renderLane(lane);
}

const WARN_TEXT = { [LEVELS.NEAR]: '前方に人', [LEVELS.CAUTION]: '人 注意', [LEVELS.DANGER]: '人 危険' };

function currentKmh() {
  const desc = describeGps({ ...gps.snapshot(), now: Date.now() });
  return desc.kind === 'ok' ? msToKmh(gps.speedMs) : null;
}

// 人の危険判定: 検出した人が、自分の車線（とその少し外側）の中にいるかを見て、表示と音で知らせる。
// 何も出ないことは、安全を意味しない（見ているのは人の検出の範囲だけで、見落としもある）。
function renderWarn(lane) {
  lastDanger = assess(lastPerson ? lastPerson.items : [], lane, currentKmh());
  const level = warnHolder.update(lastDanger.level, performance.now());
  const el = $('warn');
  el.hidden = level === LEVELS.NONE;
  el.dataset.level = level;
  el.textContent = WARN_TEXT[level] ?? '';
  beeper.setLevel(level);
}

// 車線: 映像への重ね描きと、車線内の位置
function renderLane(lane) {
  lastLane = lane;
  const both = !!(lane && lane.left && lane.right);
  const carX = both && refDx != null ? (0.5 + refDx) * lane.frameW : null;
  drawOverlay($('overlay'), $('cam'), lane, carX, lastPerson, lastDanger);

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

// 人の検出モデルの表示と、切り替えボタン。切り替えは、止まっているときだけできる（運転中に操作しない）。
function isMoving() {
  const kmh = gps.speedMs == null ? null : msToKmh(gps.speedMs);
  return kmh != null && kmh > 5;
}

function renderModel() {
  const st = personRecognizer.modelState();
  const other = personModel === 'nano' ? 'tiny' : 'nano';
  $('modelText').textContent =
    st === 'loading' ? `人モデル ${personModel} 読み込み中` : st === 'failed' ? `人モデル ${personModel} 読み込めません` : `人モデル ${personModel}（${MODEL_LABELS[personModel]}）`;
  $('modelBtn').textContent = `${other}（${MODEL_LABELS[other]}）へ`;
  $('modelBtn').disabled = st === 'loading' || isMoving();
}

// 学習用の保存の表示。取り出しは、止まっているときだけできる。
function renderCapture() {
  const moving = isMoving();
  const none = capture.status !== 'ready' || capture.count === 0;
  $('capText').textContent =
    capture.status === 'unavailable'
      ? '学習用の保存 使えません'
      : `学習用の保存 ${capture.count}/${capture.limit}${capture.full ? '（いっぱい）' : ''}`;
  $('capSave').disabled = none || moving;
  $('capClear').disabled = none || moving;
  $('capClear').textContent = Date.now() - clearArmedAt < 4000 ? 'もう一度で消去' : '消去';
}

function setSys(id, level, text) {
  const el = $(id);
  el.dataset.level = level;
  el.textContent = text;
}

function renderSys(gpsDesc) {
  // カメラ
  if (camState === 'ok' && camera.live) setSys('sysCam', 'ok', `カメラ ${camera.sizeText || '動作中'}`);
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
  const ms = personRecognizer.modelState();
  if (personInfo && ms === 'ready') setSys('sysModel', 'ok', `人モデル ${personInfo.model}・${personInfo.threads}スレッド`);
  else if (ms === 'failed') setSys('sysModel', 'ng', '人モデル 読み込み失敗');
  else setSys('sysModel', 'warn', '人モデル 読み込み中');
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
  renderCapture();
  renderModel();
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
  beeper.unlock(); // 警告音を出せるようにし、確認の音を 1 回鳴らす
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

// 学習用の画像を ZIP にまとめて取り出す。共有シート（「ファイルに保存」）が使えればそれを使い、なければダウンロードする。
$('capSave').addEventListener('click', async () => {
  $('capSave').disabled = true;
  try {
    const { name, blob } = await capture.exportZip();
    const file = new File([blob], name, { type: 'application/zip' });
    let shared = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        shared = true;
      } catch (err) {
        if (err && err.name === 'AbortError') shared = true; // 利用者が取り消した
      }
    }
    if (!shared) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
  } catch (err) {
    console.error('[capture]', err);
    $('capText').textContent = '学習用の保存 取り出しに失敗';
  }
  renderCapture();
});

// 人の検出モデルを切り替える。読み込み中も、車線など他の認識は止めない。
$('modelBtn').addEventListener('click', async () => {
  if (personRecognizer.modelState() === 'loading' || isMoving()) return;
  personModel = personModel === 'nano' ? 'tiny' : 'nano';
  setPersonModel(personModel);
  personInfo = null;
  const done = personRecognizer.reload(personModel);
  renderAll();
  await done;
  renderAll();
});

// 押しまちがいで消さないよう、2 回押したときだけ消す
$('capClear').addEventListener('click', async () => {
  if (Date.now() - clearArmedAt < 4000) {
    clearArmedAt = 0;
    await capture.clear();
  } else {
    clearArmedAt = Date.now();
    setTimeout(renderCapture, 4100);
  }
  renderCapture();
});

capture.init();

document.addEventListener('visibilitychange', () => {
  if (!started || document.visibilityState !== 'visible') return;
  wakeLock.reacquire();
  if (!camera.live) startCamera();
});

// GPS の途絶・処理の停止は、イベントが来ないことで起きるので定期的に確認する
setInterval(renderAll, 500);
