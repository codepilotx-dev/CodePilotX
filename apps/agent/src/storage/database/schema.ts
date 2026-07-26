/** SQLite schema owned by the current Agent data epoch. */
export const SCHEMA_VERSION = 21

/**
 * A data epoch is deliberately incompatible with every earlier epoch.
 * Opening an older database resets only the configured SQLite files.
 */
export const DATA_EPOCH = 3

/** Profile data has an independent, never-reset lifecycle. */
export const PROFILE_SCHEMA_VERSION = 3
export const PROFILE_APPLICATION_ID = 0x43505850
