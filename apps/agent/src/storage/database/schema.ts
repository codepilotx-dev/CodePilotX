/** SQLite schema owned by the current Agent data epoch. */
export const SCHEMA_VERSION = 18

/**
 * A data epoch is deliberately incompatible with every earlier epoch.
 * Opening an older database resets only the configured SQLite files.
 */
export const DATA_EPOCH = 2

/** Profile data has an independent, never-reset lifecycle. */
export const PROFILE_SCHEMA_VERSION = 1
export const PROFILE_APPLICATION_ID = 0x43505850
