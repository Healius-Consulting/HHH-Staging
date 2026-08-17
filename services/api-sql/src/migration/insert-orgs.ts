import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { config } from '../bootstrap/config.js';
import { dataConnect } from '../bootstrap/firebase.js';

function tokenHash(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

const CREATE_ORGANISATION_GQL = `
  mutation CreateOrganisation(
    $id: UUID!
    $name: String!
    $tradingName: String!
    $gphcNumber: String!
    $superintendentName: String!
    $address: String!
    $primaryColour: String!
    $logoText: String!
    $portalName: String!
    $status: OrganisationStatus!
    $classification: WorkspaceClassification!
    $intakeEnabled: Boolean!
    $prescriptionEnabled: Boolean!
    $paymentsEnabled: Boolean!
    $supplierOrdersEnabled: Boolean!
    $patientsEnabled: Boolean!
    $resourcesEnabled: Boolean!
    $worldpayEnabled: Boolean!
    $defaultPaymentRoute: PaymentRoute!
  ) {
    organisation_insert(data: {
      id: $id
      name: $name
      tradingName: $tradingName
      gphcNumber: $gphcNumber
      superintendentName: $superintendentName
      address: $address
      primaryColour: $primaryColour
      logoText: $logoText
      portalName: $portalName
      status: $status
      classification: $classification
      intakeEnabled: $intakeEnabled
      prescriptionEnabled: $prescriptionEnabled
      paymentsEnabled: $paymentsEnabled
      supplierOrdersEnabled: $supplierOrdersEnabled
      patientsEnabled: $patientsEnabled
      resourcesEnabled: $resourcesEnabled
      worldpayEnabled: $worldpayEnabled
      defaultPaymentRoute: $defaultPaymentRoute
    })
  }
`;

const CREATE_ORGANISATION_DOMAIN_GQL = `
  mutation CreateOrganisationDomain(
    $organisationId: UUID!
    $hostname: String!
  ) {
    organisationDomain_insert(data: {
      organisationId: $organisationId
      hostname: $hostname
    })
  }
`;

const CREATE_REFERRAL_TOKEN_GQL = `
  mutation CreateReferralToken(
    $organisationId: UUID!
    $tokenHash: String!
    $intakeVersion: String!
  ) {
    referralToken_insert(data: {
      organisationId: $organisationId
      tokenHash: $tokenHash
      intakeVersion: $intakeVersion
    })
  }
`;

async function insertAllOrgs() {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);

  const snap = await firestore.collection('organisations').get();
  console.log(`Inserting ${snap.size} organisations into PostgreSQL Organisation table...\n`);

  for (const doc of snap.docs) {
    const data = doc.data();

    const statusMap: Record<string, string> = {
      live: 'LIVE',
      intake_live: 'INTAKE_LIVE',
      onboarding: 'ONBOARDING',
      paused: 'PAUSED',
    };

    const classificationMap: Record<string, string> = {
      allocation_holding: 'ALLOCATION_HOLDING',
      training: 'TRAINING',
      standard: 'STANDARD',
    };

    const status = statusMap[data.status] || 'ONBOARDING';
    const classification = classificationMap[data.workspaceClassification] || (data.testAccount ? 'TRAINING' : 'STANDARD');
    const defaultPaymentRoute = data.defaultPaymentRoute === 'worldpay' ? 'WORLDPAY' : 'MANUAL';

    try {
      await dataConnect.executeGraphql<any, any>(CREATE_ORGANISATION_GQL, {
        variables: {
          id: doc.id,
          name: data.name || data.tradingName || 'Pharmacy',
          tradingName: data.tradingName || data.name || 'Pharmacy',
          gphcNumber: data.gphcNumber || `GPHC-${doc.id.slice(0, 7)}`,
          superintendentName: data.superintendent || 'Superintendent Pharmacist',
          address: data.address || 'London, UK',
          primaryColour: data.primaryColour || '#0f766e',
          logoText: data.logoText || 'HHH',
          portalName: data.portalName || data.name || 'Pharmacy Portal',
          status,
          classification,
          intakeEnabled: Boolean(data.modules?.intake),
          prescriptionEnabled: Boolean(data.modules?.rx),
          paymentsEnabled: Boolean(data.modules?.payments),
          supplierOrdersEnabled: Boolean(data.modules?.supplierOrders),
          patientsEnabled: Boolean(data.modules?.patients),
          resourcesEnabled: Boolean(data.modules?.resources),
          worldpayEnabled: Boolean(data.worldpayEnabled),
          defaultPaymentRoute,
        },
      });
      console.log(`✔ Inserted Organisation: ${doc.id} (${data.name})`);

      // Insert website domains
      if (Array.isArray(data.websiteDomains)) {
        for (const host of data.websiteDomains) {
          try {
            await dataConnect.executeGraphql<any, any>(CREATE_ORGANISATION_DOMAIN_GQL, {
              variables: { organisationId: doc.id, hostname: host.toLowerCase() },
            });
            console.log(`  ✔ Domain: ${host}`);
          } catch (e: any) {
            console.warn(`  - Domain ${host} already exists or error:`, e?.message);
          }
        }
      }

      // Insert referral tokens
      if (data.referralToken) {
        try {
          await dataConnect.executeGraphql<any, any>(CREATE_REFERRAL_TOKEN_GQL, {
            variables: {
              organisationId: doc.id,
              tokenHash: tokenHash(data.referralToken),
              intakeVersion: 'v2',
            },
          });
          console.log('  ✔ Referral token stored as a one-way hash');
        } catch (e: any) {
          console.warn(`  - Referral token already exists:`, e?.message);
        }
      }
    } catch (err: any) {
      console.error(`❌ Failed inserting organisation ${doc.id}:`, err);
    }
  }

  console.log('\nFinished populating PostgreSQL organisations.');
}

void insertAllOrgs();
