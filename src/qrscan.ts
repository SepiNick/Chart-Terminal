// Camera QR scanner for the pairing code (getUserMedia + jsqr, loaded only when scanning starts).
// Android: the app grants the camera to its own origins only (WebChromeClient.onPermissionRequest); elsewhere the browser asks.
import { dialog } from './login.ts';
import { scanResult, type ScanResult } from './pairing.ts';

export const cameraSupported = () => !!globalThis.navigator?.mediaDevices?.getUserMedia;

/** Opens the scanner; resolves with the first QR text that is a pairing payload or a server address, or null when closed / no camera. */
export function scanQr(): Promise<ScanResult | null> {
  return new Promise(resolve => {
    dialog('Scan QR code', `<p class="muted">On the other device open <b>Pair a phone</b> (account menu), then point the camera at the QR code.</p>
      <video playsinline muted style="width:100%;max-height:320px;background:#000;border-radius:6px"></video>
      <div class="muted" data-msg>Starting the camera…</div>
      <div class="row"><span class="grow"></span><button type="button" data-x class="on">Cancel</button></div>`, (f, close) => {
      const video = f.querySelector<HTMLVideoElement>('video')!, msg = f.querySelector<HTMLElement>('[data-msg]')!;
      let stream: MediaStream | undefined, stopped = false, timer = 0;
      const finish = (r: ScanResult | null) => { if (stopped) return; stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); video.srcObject = null; close(); resolve(r) };
      f.querySelector<HTMLElement>('[data-x]')!.onclick = () => finish(null);
      f.closest('dialog')!.addEventListener('close', () => finish(null));
      f.onsubmit = e => e.preventDefault();
      void (async () => {
        if (!cameraSupported()) { msg.textContent = 'No camera is available here (browsers allow it only on https or localhost). Type the pairing code instead.'; return }
        let jsQR: typeof import('jsqr').default;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
          jsQR = (await import('jsqr')).default;
        } catch (e) { msg.textContent = (e as { name?: string }).name === 'NotAllowedError' ? 'Camera permission was refused. Allow it in the app settings, or type the pairing code instead.' : 'Could not start the camera. Type the pairing code instead.'; return }
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return }
        video.srcObject = stream; await video.play().catch(() => {});
        msg.textContent = 'Point the camera at the QR code.';
        const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true })!;
        const tick = () => {
          if (stopped) return;
          if (video.videoWidth) {
            const k = Math.min(1, 640 / video.videoWidth);   // decode a downscaled frame: fast enough on a phone
            cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
            cx.drawImage(video, 0, 0, cv.width, cv.height);
            const q = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'dontInvert' });
            if (q?.data) { const r = scanResult(q.data); if (r.kind !== 'ignore') return finish(r); msg.textContent = 'That QR code is not from Chart Terminal.' }
          }
          timer = window.setTimeout(tick, 150);
        };
        tick();
      })();
    }, true);
  });
}
