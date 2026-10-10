/** Modules holding in-memory run state register a reset callback here (avoids import cycles). */
export const resetHooks: (() => void | Promise<void>)[] = [];
