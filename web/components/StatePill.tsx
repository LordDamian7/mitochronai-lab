import { STATE_LABEL, type OrderState } from "@/lib/lab";

export default function StatePill({ state }: { state: OrderState }) {
  const [label, tone] = STATE_LABEL[state];
  return <span className={`pill ${tone}`}>{label}</span>;
}
