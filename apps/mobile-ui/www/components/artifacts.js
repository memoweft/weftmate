/* Per-turn output summary; the shared renderer also serves the phone. */
(() => {
    function artifactCard(row, data, options) {
        const saved = { expanded: row.querySelector('.artifact-summary')?.dataset.expanded === 'true' };
        row.replaceChildren(globalThis.WeftContent.artifactSummary(data.artifacts || [data], options, saved));
    }
    globalThis.WeftTimelineCards = { ...globalThis.WeftTimelineCards, artifact: artifactCard };
})();
