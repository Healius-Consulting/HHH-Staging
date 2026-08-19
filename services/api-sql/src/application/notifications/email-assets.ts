import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMAIL_CID, type EmailHeader } from './email-layout.js';

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../assets/email');

export type EmailInlineImage = {
  filename: string;
  content: string;
  content_id: string;
  content_type: 'image/png';
};

function readPng(filename: string, contentId: string): EmailInlineImage | null {
  try {
    return {
      filename,
      content: readFileSync(join(assetsDir, filename)).toString('base64'),
      content_id: contentId,
      content_type: 'image/png',
    };
  } catch {
    return null;
  }
}

export function emailInlineImages(header: EmailHeader): EmailInlineImage[] {
  const images = [
    readPng('hhh-logo.png', EMAIL_CID.hhh),
    readPng('curaleaf-clinic-white.png', EMAIL_CID.curaleaf),
  ];
  if (header.assetFile && header.logoUrl === `cid:${EMAIL_CID.header}`) {
    images.push(readPng(header.assetFile, EMAIL_CID.header));
  }
  return images.filter((image): image is EmailInlineImage => Boolean(image));
}
