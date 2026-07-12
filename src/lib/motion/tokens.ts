/** Single tuning point for every spring/stagger in the app. */
export const SPRING_UI = { type: 'spring', visualDuration: 0.3, bounce: 0.15 } as const;
export const SPRING_POP = { type: 'spring', visualDuration: 0.35, bounce: 0.3 } as const;
export const SPRING_REVEAL = { type: 'spring', visualDuration: 0.4, bounce: 0.18 } as const;
export const SPRING_GENTLE = { type: 'spring', visualDuration: 0.45, bounce: 0 } as const;

export const STAGGER_STEP = 0.06;
export const STAGGER_CAP = 0.36;
