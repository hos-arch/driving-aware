// 背面カメラの取得。失敗の種類を分けて返す。

const PRIMARY = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

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

export class Camera {
  constructor(videoEl, { onEnded } = {}) {
    this.video = videoEl;
    this.onEnded = onEnded ?? (() => {});
    this.stream = null;
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
      stream = await navigator.mediaDevices.getUserMedia(PRIMARY);
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
