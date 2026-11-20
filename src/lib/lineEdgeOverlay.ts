/**
 * Lightweight real-time Sobel-style line & edge detector for live camera measurement overlays.
 * Draws highlighted architectural edges and guide crosshairs onto an overlay canvas.
 */
export function drawDetectedLinesOnOverlay(
  video: HTMLVideoElement,
  overlayCanvas: HTMLCanvasElement,
  workCanvas: HTMLCanvasElement
): number {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
    return 0;
  }

  const sampleW = 160;
  const sampleH = Math.max(90, Math.round((video.videoHeight / video.videoWidth) * sampleW));

  if (workCanvas.width !== sampleW || workCanvas.height !== sampleH) {
    workCanvas.width = sampleW;
    workCanvas.height = sampleH;
  }

  if (overlayCanvas.width !== video.videoWidth || overlayCanvas.height !== video.videoHeight) {
    overlayCanvas.width = video.videoWidth;
    overlayCanvas.height = video.videoHeight;
  }

  const wCtx = workCanvas.getContext('2d', {willReadFrequently: true});
  const oCtx = overlayCanvas.getContext('2d');
  if (!wCtx || !oCtx) return 0;

  wCtx.drawImage(video, 0, 0, sampleW, sampleH);
  const frame = wCtx.getImageData(0, 0, sampleW, sampleH);
  const data = frame.data;

  oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const scaleX = overlayCanvas.width / sampleW;
  const scaleY = overlayCanvas.height / sampleH;
  const threshold = 44;
  let edgePixels = 0;

  oCtx.fillStyle = 'rgba(255, 122, 26, 0.85)';

  for (let y = 1; y < sampleH - 1; y += 2) {
    for (let x = 1; x < sampleW - 1; x += 2) {
      const idx = (y * sampleW + x) * 4;
      const idxRight = (y * sampleW + (x + 1)) * 4;
      const idxDown = ((y + 1) * sampleW + x) * 4;

      const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      const lumR = (data[idxRight] + data[idxRight + 1] + data[idxRight + 2]) / 3;
      const lumD = (data[idxDown] + data[idxDown + 1] + data[idxDown + 2]) / 3;

      const grad = Math.abs(lum - lumR) + Math.abs(lum - lumD);
      if (grad > threshold) {
        edgePixels++;
        oCtx.fillRect(x * scaleX, y * scaleY, Math.max(2, scaleX * 0.9), Math.max(2, scaleY * 0.9));
      }
    }
  }

  // Highlight strongest horizontal / vertical scan band for tape alignment
  oCtx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
  oCtx.lineWidth = 2;
  oCtx.setLineDash([8, 6]);
  oCtx.beginPath();
  oCtx.moveTo(0, overlayCanvas.height / 2);
  oCtx.lineTo(overlayCanvas.width, overlayCanvas.height / 2);
  oCtx.stroke();
  oCtx.setLineDash([]);

  return edgePixels;
}
