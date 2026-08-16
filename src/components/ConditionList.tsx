import { conditionLabel } from '@hhh/domain';

interface ConditionListProps {
  conditions: string[];
  primaryCondition: string;
}

export default function ConditionList({ conditions, primaryCondition }: ConditionListProps) {
  const ordered = [primaryCondition, ...conditions.filter(id => id !== primaryCondition)];
  return <div className="condition-list" aria-label="Selected conditions">
    {ordered.map(conditionId => <span className={`condition-pill ${conditionId === primaryCondition ? 'primary' : 'secondary'}`} key={conditionId}>
      {conditionLabel(conditionId)}{conditionId === primaryCondition && <small>Primary</small>}
    </span>)}
  </div>;
}
