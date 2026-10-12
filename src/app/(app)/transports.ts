import type { Transport } from '@/core/planner/types';

/** Ways of getting around that can be chosen; stored plans and settings may still say 'bike'. */
export const TRANSPORTS = [
  {
    value: 'deutschlandticket',
    label: 'Deutschlandticket',
    hint: 'Public transport, regional trains',
  },
  { value: 'car', label: 'Car', hint: 'Drive between stops' },
  { value: 'walk', label: 'On foot', hint: 'Everything within ~4 km' },
] as const satisfies readonly { value: Transport; label: string; hint: string }[];
