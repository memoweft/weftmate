/* Keep a composer gesture intact until the browser has dispatched its click. */
globalThis.WeftComposerPress = {
    mount(button, repaint) {
        let pointer = null, releaseTimer;
        const release = () => {
            clearTimeout(releaseTimer);
            if (pointer === null) return;
            pointer = null;
            repaint();
        };
        button.addEventListener('pointerdown', event => {
            if (button.disabled || pointer !== null) return;
            pointer = event.pointerId;
            // Retain textarea focus and its keyboard throughout a touch/mouse tap.
            // Keyboard activation keeps normal focus and submit behavior.
            event.preventDefault();
        });
        document.addEventListener('pointerup', event => {
            if (event.pointerId === pointer && !button.contains(event.target)) release();
        }, true);
        // The default submit runs after click listeners. Repainting on pointerup
        // (or in a microtask inside click) can still remove its activation target.
        button.addEventListener('click', () => { if (pointer !== null) releaseTimer = setTimeout(release, 0); });
        button.addEventListener('contextmenu', release);
        document.addEventListener('pointercancel', event => {
            if (event.pointerId === pointer) release();
        }, true);
        globalThis.addEventListener?.('blur', release);
        return { get active() { return pointer !== null; } };
    },
};
