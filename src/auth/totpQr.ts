import QRCode from 'qrcode';

export async function totpQrDataUrl(otpauthUrl: string): Promise<string | null> {
  if (!otpauthUrl.startsWith('otpauth://')) return null;
  try {
    return await QRCode.toDataURL(otpauthUrl, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    });
  } catch {
    return null;
  }
}
