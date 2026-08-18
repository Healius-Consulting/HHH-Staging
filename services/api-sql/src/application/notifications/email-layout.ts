export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] ?? character));
}

export function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
  } catch {
    return '';
  }
  return '';
}

export function brandedEmail(input: {
  preheader: string;
  title: string;
  paragraphs: string[];
  cta?: { label: string; href: string };
  details?: Array<{ label: string; value: string }>;
  footerNote?: string;
}) {
  const paragraphs = input.paragraphs.filter(Boolean).map(paragraph =>
    `<p style="margin:0 0 16px; color:#34423f; font-size:16px; line-height:24px;">${paragraph}</p>`
  ).join('');
  const href = input.cta ? safeHttpUrl(input.cta.href) : '';
  const cta = href
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;"><tr><td style="border-radius:999px; background:#1baa92;"><a href="${escapeHtml(href)}" style="display:inline-block; padding:14px 28px; color:#ffffff; font-size:16px; font-weight:700; text-decoration:none;">${escapeHtml(input.cta!.label)}</a></td></tr></table>`
    : '';
  const details = (input.details ?? []).filter(item => item.value).map(item =>
    `<p style="margin:0 0 6px; color:#31413d; font-size:16px; line-height:24px;"><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</p>`
  ).join('');
  const detailsBlock = details
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; margin:8px 0 24px; border:1px solid #d7e0de; border-radius:18px; background:#f6fbfa;"><tr><td style="padding:20px 24px;">${details}</td></tr></table>`
    : '';
  const footerNote = input.footerNote
    ? `<p style="margin:8px 0 0; color:#5a6662; font-size:14px; line-height:22px;">${input.footerNote}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<body style="margin:0; padding:0; background:#f3f8f7;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${escapeHtml(input.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f8f7;">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px; background:#ffffff; border-radius:18px; overflow:hidden;">
          <tr><td style="padding:28px 32px; background:#123f36; color:#dce9e5; font-family:Arial, Helvetica, sans-serif; font-size:13px; letter-spacing:1.4px; text-transform:uppercase;">Holistic Health Hub</td></tr>
          <tr>
            <td style="padding:36px 32px 28px; font-family:Arial, Helvetica, sans-serif;">
              <h1 style="margin:0 0 18px; color:#123f36; font-size:28px; line-height:34px;">${escapeHtml(input.title)}</h1>
              ${paragraphs}
              ${cta}
              ${detailsBlock}
              ${footerNote}
            </td>
          </tr>
          <tr><td style="padding:22px 32px; background:#123f36; color:#dce9e5; font-family:Arial, Helvetica, sans-serif; font-size:12px;">Powered by Holistic Health Hub</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
