export interface PreparedImage {
  analysisDataUrl: string;
  thumbnailDataUrl: string;
  mimeType: string;
}

export async function prepareImageFromSrc(src: string): Promise<PreparedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        // Optimized detail image for fast Gemini Vision & OCR (max 1024px, JPEG 0.72)
        const maxDim = 1024;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('تعذر معالجة الصورة'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const analysisDataUrl = canvas.toDataURL('image/jpeg', 0.72);

        // Compact thumbnail for Firestore (<200KB limit)
        const thumbMax = 640;
        let tw = img.naturalWidth || img.width;
        let th = img.naturalHeight || img.height;
        if (tw > thumbMax || th > thumbMax) {
          const tr = Math.min(thumbMax / tw, thumbMax / th);
          tw = Math.round(tw * tr);
          th = Math.round(th * tr);
        }
        const tCanvas = document.createElement('canvas');
        tCanvas.width = tw;
        tCanvas.height = th;
        const tCtx = tCanvas.getContext('2d');
        if (!tCtx) {
          reject(new Error('تعذر إنشاء مصغرة الصورة'));
          return;
        }
        tCtx.drawImage(img, 0, 0, tw, th);
        let thumbnailDataUrl = tCanvas.toDataURL('image/jpeg', 0.65);
        if (thumbnailDataUrl.length > 230000) {
          thumbnailDataUrl = tCanvas.toDataURL('image/jpeg', 0.4);
        }

        resolve({
          analysisDataUrl,
          thumbnailDataUrl,
          mimeType: 'image/jpeg',
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('ما قدرناش نقراو هاد الصورة'));
    img.src = src;
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('وقع خطأ فـ قراءة الملف'));
    reader.readAsDataURL(file);
  });
}
