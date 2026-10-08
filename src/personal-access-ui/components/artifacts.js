/* Artifact card component; all operations are injected feature actions. */
(() => {
    const node = (tag, cls, text) => {
        const n = document.createElement(tag);
        n.className = cls || '';
        if (text)
            n.textContent = text;
        return n;
    };
    function artifactCard(row, data, options) {
        row.append(node('p', '', options.fileLabel ? options.fileLabel(data) : `${data.contentType || '文件'} · ${data.size || 0} 字节`));
        const open = node('button', 'artifact-action', '打开成果');
        open.type = 'button';
        open.addEventListener('click', () => options.openArtifact?.(data, open));
        row.append(open);
        if (options.downloadArtifact) {
            const download = node('button', 'artifact-action', '下载');
            download.type = 'button';
            download.addEventListener('click', () => options.downloadArtifact(data));
            row.append(download);
        }
        options.appendArtifactActions?.(row, data);
    }
    globalThis.WeftTimelineCards = { ...globalThis.WeftTimelineCards, artifact: artifactCard };
})();
