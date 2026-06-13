/**
 * Broken plugin fixture — throws during load.
 * Used to test crash isolation and quarantine.
 */
throw new Error('intentional load failure for testing');
