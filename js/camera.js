// 背面カメラの取得。失敗の種類を分けて返す。

// 頼む映像の大きさ。標識の小さい候補を元の解像度で見直すため、既定は 1920×1080。
// 実機の負荷を比べるため、URL に ?cam=720 / ?cam=1080 / ?cam=4k を付けると変えられる。
const SIZES = {
  720: [1280, 720],
  1080: [1920, 1080],
  '4k': [3840, 2160],
};

function requestedSize() {
  try {
    const q = new URLSearchParams(location.search).get('cam');
    if (q && SIZES[q]) return SIZES[q];
  } catch {
    // URL を読めない環境では既定
  }
  return SIZES[1080];
}

function primaryConstraints() {
  const [width, height] = requestedSize();
  return {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: width },
      height: { ideal: height },
    },
  };
}

const MESSAGES = {
  insecure: 'この接続ではカメラを使えません（HTTPS が必要です）',
  unsupported: 'このブラウザはカメラの取得に対応していません',
  denied: 'カメラが許可されていません。ブラウザの設定で許可してください',
  none: 'カメラが見つかりません',
  busy: 'カメラが他のアプリで使用中です',
  error: 'カメラを開始できませんでした',
};

export function cameraMessage(kind) {
  return MESSAGES[kind] ?? MESSAGES.error;
}

function classify(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'none';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'busy';
    default:
      return 'error';
  }
}

/**
 * 「ideal（できれば）」の頼み方では、端末が小さい映像を選ぶことがある（iPhone で 1280×720 のままだった）。
 * 届いた映像が頼んだ大きさより小さいときだけ、「exact（必ず）」で頼み直す。縦向きの端末では幅と高さが逆になるので、両方試す。
 * 頼み直しに失敗しても、今の映像のまま続ける。
 */
async function upgradeSize(track) {
  const [w, h] = requestedSize();
  const long = (s) => Math.max(s.width || 0, s.height || 0);
  try {
    if (long(track.getSettings()) >= w) return;
  } catch {
    return;
  }
  for (const [ew, eh] of [
    [w, h],
    [h, w],
  ]) {
    try {
      await track.applyConstraints({ width: { exact: ew }, height: { exact: eh } });
      if (long(track.getSettings()) >= w) return;
    } catch {
      // この組み合わせは出せない。次を試す
    }
  }
}

export class Camera {
  constructor(videoEl, { onEnded } = {}) {
    this.video = videoEl;
    this.onEnded = onEnded ?? (() => {});
    this.stream = null;
  }

  /**
   * 届いている映像の大きさと、このカメラが出せる最大の大きさ（分かる場合）を、表示用の文字で返す。
   * 例: "1280×720（最大 3840×2160）"
   */
  get sizeText() {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!w || !h) return '';
    let max = '';
    try {
      const cap = this.stream?.getVideoTracks()[0]?.getCapabilities?.();
      if (cap?.width?.max && cap?.height?.max) max = `（最大 ${cap.width.max}×${cap.height.max}）`;
    } catch {
      // 対応していないブラウザでは、最大は表示しない
    }
    const [rw, rh] = requestedSize();
    return `${w}×${h}（頼んだ ${rw}×${rh}${max ? `、${max.slice(1, -1)}` : ''}）`;
  }

  /** 映像が流れている状態か */
  get live() {
    const track = this.stream?.getVideoTracks()[0];
    return !!track && track.readyState === 'live';
  }

  /** @returns {Promise<{ok:true}|{ok:false, kind:string}>} */
  async start() {
    if (!window.isSecureContext) return { ok: false, kind: 'insecure' };
    if (!navigator.mediaDevices?.getUserMedia) return { ok: false, kind: 'unsupported' };

    this.stop();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(primaryConstraints());
    } catch (err) {
      if (err && err.name === 'OverconstrainedError') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        } catch (err2) {
          return { ok: false, kind: classify(err2) };
        }
      } else {
        return { ok: false, kind: classify(err) };
      }
    }

    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    await upgradeSize(track);
    track.addEventListener('ended', () => this.onEnded());
    this.video.srcObject = stream;
    try {
      await this.video.play();
    } catch (_) {
      // autoplay 属性があるため、play() の拒否は致命的ではない
    }
    return { ok: true };
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
  }
}
