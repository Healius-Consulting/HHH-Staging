import { splitMedicineLabel } from '../utils/medicineLabel';

export default function MedicineLabel({ name }: { name: string }) {
  const { title, strength } = splitMedicineLabel(name);
  return (
    <>
      <strong>{title}</strong>
      {strength ? <span className="medicine-label__strength">{strength}</span> : null}
    </>
  );
}
