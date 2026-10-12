// Observe only when the real HTTP handler consumes the body. A data listener would
// switch IncomingMessage to flowing mode and lose bytes during authentication awaits.
export function observeBody(request, received) {
    const iterator = request[Symbol.asyncIterator].bind(request);
    request[Symbol.asyncIterator] = async function* () {
        const parts = [];
        for await (const part of { [Symbol.asyncIterator]: iterator }) {
            parts.push(Buffer.from(part)); yield part;
        }
        received(Buffer.concat(parts));
    };
}
