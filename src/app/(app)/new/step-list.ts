/** Wizard steps in order; also counted on the home screen tile. */
export const STEPS = ['when', 'where', 'plans', 'how', 'mood', 'food'] as const;
export type Step = (typeof STEPS)[number];
