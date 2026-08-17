export type PortalSourceType = 'general_hhh_website' | 'future_pharmacy_qr' | 'legacy_pharmacy_qr';

export function portalSourceType(sourceType: string | null | undefined): PortalSourceType | null {
  if (sourceType === 'GENERAL_HHH_WEBSITE') return 'general_hhh_website';
  if (sourceType === 'PHARMACY_QR') return 'future_pharmacy_qr';
  if (sourceType === 'LEGACY_PHARMACY_QR') return 'legacy_pharmacy_qr';
  return null;
}

export function portalSourceLabel(sourceType: PortalSourceType | string | null | undefined) {
  switch (sourceType) {
    case 'future_pharmacy_qr':
    case 'PHARMACY_QR':
      return 'Pharmacy QR link';
    case 'legacy_pharmacy_qr':
    case 'LEGACY_PHARMACY_QR':
      return 'Legacy pharmacy QR';
    case 'general_hhh_website':
    case 'GENERAL_HHH_WEBSITE':
      return 'HHH website';
    default:
      return null;
  }
}

export function pendingEnquiryDisplayStatus(followUpStatus: string | null | undefined) {
  return followUpStatus === 'NOT_STARTED' ? 'New enquiry' as const : 'Under HHH review' as const;
}
