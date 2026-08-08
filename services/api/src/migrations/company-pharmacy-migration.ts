import { firestore } from '../firebase.js';
import { nowIso } from '../http.js';
import type { Company, PortalOrganisation } from '../types.js';


export interface MigrationSummary {
  companiesCreated: number;
  pharmaciesMigrated: number;
  recordsUpdated: {
    patients: number;
    orders: number;
    eligibilitySubmissions: number;
    staff: number;
    financeEvents: number;
    setupTasks: number;
  };
  errors: string[];
  completedAt: string;
}

export async function runCompanyPharmacyMigration(): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    companiesCreated: 0,
    pharmaciesMigrated: 0,
    recordsUpdated: {
      patients: 0,
      orders: 0,
      eligibilitySubmissions: 0,
      staff: 0,
      financeEvents: 0,
      setupTasks: 0,
    },
    errors: [],
    completedAt: nowIso(),
  };

  try {
    // 1. Migrate organisations to pharmacies & companies
    const orgsSnapshot = await firestore.collection('organisations').get();
    for (const doc of orgsSnapshot.docs) {
      const orgData = doc.data() as PortalOrganisation;
      const pharmacyId = orgData.id || doc.id;
      const companyId = `company-${pharmacyId}`;

      // Create Company document if not exists
      const companyRef = firestore.collection('companies').doc(companyId);
      const companySnap = await companyRef.get();
      if (!companySnap.exists) {
        const companyRecord: Company = {
          id: companyId,
          legalName: orgData.name || 'Legal Company',
          companyNumber: orgData.companyNumber || 'UNKNOWN',
          registeredAddress: orgData.address || '',
          ownerContact: {
            name: orgData.mainContactName || 'Owner',
            email: orgData.mainContactEmail || '',
            phone: orgData.mainContactPhone || '',
          },
          superintendent: {
            name: orgData.superintendent || '',
            gphcNumber: orgData.gphcNumber || '',
          },
          gdprConfirmed: false,
          gdprDocUrl: null,
          gdprConfirmedAt: null,
          gdprConfirmedBy: null,
          gdprComplianceFlag: false,
          branchesOwned: [pharmacyId],
          notes: 'Created via automated migration',
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        await companyRef.set(companyRecord);
        summary.companiesCreated += 1;
      }

      // Create Pharmacy document in pharmacies collection
      const pharmacyRef = firestore.collection('pharmacies').doc(pharmacyId);
      const pharmacyRecord: PortalOrganisation = {
        ...orgData,
        id: pharmacyId,
        orgId: companyId,
      };
      await pharmacyRef.set(pharmacyRecord, { merge: true });
      summary.pharmaciesMigrated += 1;

      // 2. Rewrite tenant references across tenant-scoped collections
      const tenantCollections = [
        { name: 'patients', key: 'patients' },
        { name: 'orders', key: 'orders' },
        { name: 'eligibilitySubmissions', key: 'eligibilitySubmissions' },
        { name: 'staff', key: 'staff' },
        { name: 'financeEvents', key: 'financeEvents' },
        { name: 'setupTasks', key: 'setupTasks' },
      ] as const;

      for (const col of tenantCollections) {
        const snap = await firestore
          .collection(col.name)
          .where('organisationId', '==', pharmacyId)
          .get();

        for (const itemDoc of snap.docs) {
          await itemDoc.ref.update({
            pharmacyId,
            updatedAt: nowIso(),
          });
          summary.recordsUpdated[col.key] += 1;
        }
      }
    }
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
  }

  summary.completedAt = nowIso();
  return summary;
}
