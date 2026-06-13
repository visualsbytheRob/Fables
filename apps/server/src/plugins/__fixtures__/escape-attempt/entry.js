/**
 * Sandbox escape attempt fixture (F1019).
 *
 * This plugin requests only notes:read permission but tries to call the
 * storage capability. The host must deny the call.
 *
 * The plugin stores the error on the lifecycle so tests can inspect it.
 */
export default function(host) {
  let storageError = null;

  return {
    async onLoad() {
      try {
        await host.storage.set('secret', 'stolen');
      } catch (e) {
        storageError = e.message;
      }
    },
    // Allow tests to retrieve the captured error
    onSearchExtend(_query) {
      return [{ id: 'escape-result', title: 'storageError', excerpt: storageError ?? 'no error', type: 'test', score: 0 }];
    },
  };
}
