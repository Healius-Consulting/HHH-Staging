import { SqlIntegrationRepository } from '../../repositories/sql/integration.sql.js';
import { SqlNotificationRepository } from '../../repositories/sql/notification.sql.js';
import { SqlOrderRepository } from '../../repositories/sql/order.sql.js';
import { SqlPatientFinanceRepository } from '../../repositories/sql/patient-finance.sql.js';
import { SqlPatientRepository } from '../../repositories/sql/patient.sql.js';
import { SqlPaymentRepository } from '../../repositories/sql/payment.sql.js';
import { SqlPrescriptionRepository } from '../../repositories/sql/prescription.sql.js';

export function sqlWorkerDeps() {
  const paymentRepo = new SqlPaymentRepository();
  const orderRepo = new SqlOrderRepository();
  const integrationRepo = new SqlIntegrationRepository();
  const patientRepo = new SqlPatientRepository();
  const patientFinanceRepo = new SqlPatientFinanceRepository();
  const notificationRepo = new SqlNotificationRepository();
  const prescriptionRepo = new SqlPrescriptionRepository();
  return {
    paymentRepo,
    orderRepo,
    integrationRepo,
    patientRepo,
    patientFinanceRepo,
    patientFinanceDeps: { patientRepo, patientFinanceRepo },
    notificationRepo,
    prescriptionRepo,
  };
}
