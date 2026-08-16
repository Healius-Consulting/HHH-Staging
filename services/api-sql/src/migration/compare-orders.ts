import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../bootstrap/config.js';
import { dataConnect } from '../bootstrap/firebase.js';

const LIST_POSTGRES_ORDERS_GQL = `
  query ListAllPostgresOrders {
    orders(limit: 100) {
      id
      orderNumber
      status
      paymentStatus
      fulfilmentStatus
      totalPence
    }
  }
`;

async function compare() {
  const app = getApps().length === 0 ? initializeApp({ projectId: config.FIREBASE_PROJECT_ID }) : getApps()[0]!;
  const firestore = getFirestore(app);

  const firestoreSnap = await firestore.collection('orders').get();
  console.log(`Firestore 'orders' collection count: ${firestoreSnap.size}`);

  const pgResult = await dataConnect.executeGraphql<{ orders: any[] }, any>(LIST_POSTGRES_ORDERS_GQL);
  const pgOrders = pgResult.data.orders || [];
  console.log(`PostgreSQL 'Order' table count: ${pgOrders.length}\n`);

  console.log('PostgreSQL Orders:');
  for (const o of pgOrders) {
    console.log(`- [${o.status} / ${o.paymentStatus}] Order: ${o.orderNumber} (ID: ${o.id}, Total: £${(o.totalPence / 100).toFixed(2)})`);
  }
}

void compare();
