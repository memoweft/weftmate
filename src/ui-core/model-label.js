/* Shared model label presentation; the composer feature layer stays DOM-free. */
globalThis.WeftModelLabel = (label, name) => {
    if (label.dataset.modelName === name) return;
    label.dataset.modelName = name; label.title = name;
    const fit = () => {
        const full = label.dataset.modelName; label.textContent = full;
        if (!label.clientWidth || label.scrollWidth <= label.clientWidth) return;
        const chars = Array.from(full);
        for (let count = chars.length - 1; count >= 2; count--) {
            label.textContent = chars.slice(0, Math.ceil(count / 2)).join('') + '…' + chars.slice(-Math.floor(count / 2)).join('');
            if (label.scrollWidth <= label.clientWidth) break;
        }
    };
    if (!label.modelResize && globalThis.ResizeObserver) { label.modelResize = new ResizeObserver(fit); label.modelResize.observe(label); }
    fit();
};
