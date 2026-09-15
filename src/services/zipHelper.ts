/**
 * zipHelper.ts
 * Đóng gói nhiều file SRT thành tệp ZIP chuẩn UTF-8 để tải về một lần
 */
import JSZip from 'jszip';

export interface SrtFileEntry {
  filename: string;
  content: string;
}

export async function downloadAllSrtAsZip(
  files: SrtFileEntry[],
  zipFilename: string = 'phu-de-srt.zip'
): Promise<void> {
  if (!files || files.length === 0) return;

  const zip = new JSZip();

  for (const f of files) {
    // Đảm bảo có BOM UTF-8 (\uFEFF) cho các phần mềm Windows/VLC
    const contentWithBom = f.content.startsWith('\uFEFF') ? f.content : '\uFEFF' + f.content;
    const cleanName = f.filename.endsWith('.srt') ? f.filename : `${f.filename}.srt`;
    zip.file(cleanName, contentWithBom);
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipFilename.endsWith('.zip') ? zipFilename : `${zipFilename}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
