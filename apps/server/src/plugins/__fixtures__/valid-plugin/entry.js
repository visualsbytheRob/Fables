/**
 * Word count plugin fixture.
 * This is a valid plugin entry that the test harness can load.
 */
export default function(host) {
  return {
    async onLoad() {
      // Verify we can call notes API
      await host.notes.query({ limit: 1 });
    },
    onUnload() {},
    onNotePostProcess(markdown, _noteId) {
      // Count words and annotate
      const words = markdown.split(/\s+/).filter(Boolean).length;
      return `${markdown}\n<!-- word-count:${words} -->`;
    },
  };
}
