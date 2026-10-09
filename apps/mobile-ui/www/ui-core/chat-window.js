/* Logical history model shared by desktop, remote web and mobile. No DOM. */
(() => {
    const formatters = new Map();
    const day = (at, timeZone = 'UTC') => {
        if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
        return formatters.get(timeZone).format(new Date(at));
    };
    const label = (date, timeZone, now = Date.now()) => {
        const today = day(now, timeZone);
        if (date === today) return '今天';
        const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
        if (date === yesterday) return '昨天';
        const [year, month, number] = date.split('-').map(Number);
        return `${year !== Number(day(now, timeZone).slice(0, 4)) ? year + ' 年 ' : ''}${month} 月 ${number} 日`;
    };
    function create(limit = 1000) {
        const state = { events: new Map(), syncCursor: null, olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false,
            contentRevision: null, timeZone: 'UTC', indexState: 'building', expanded: new Set(), collapsed: new Set(), dayCounts: new Map(), search: { query: '', hits: [], index: -1 }, generation: 0 };
        const reset = () => { state.events.clear(); state.syncCursor = state.olderCursor = state.newerCursor = null;
            state.hasOlder = state.hasNewer = false; state.contentRevision = null; state.search = { query: '', hits: [], index: -1 };
            state.expanded.clear(); state.collapsed.clear(); state.dayCounts.clear(); state.generation++; };
        const ordered = () => [...state.events.values()].sort((a, b) => a.orderKey.localeCompare(b.orderKey));
        function merge(page, direction = 'tail') {
            if (state.contentRevision !== null && page.contentRevision !== undefined && state.contentRevision !== page.contentRevision) reset();
            state.contentRevision = page.contentRevision ?? state.contentRevision;
            state.timeZone = page.timeZone || state.timeZone; state.indexState = page.indexState || state.indexState;
            for (const removal of page.removals || []) state.events.delete(removal.eventId);
            for (const event of page.items || page.upserts || []) {
                const prior = state.events.get(event.eventId);
                if (!prior || event.revision >= prior.revision) state.events.set(event.eventId, event);
            }
            // Historical pages never replace the independently established live watermark.
            if (direction === 'changes') state.syncCursor = page.nextCursor;
            else {
                state.syncCursor ||= page.syncCursor;
                if (direction !== 'newer') { state.olderCursor = page.olderCursor; state.hasOlder = page.hasOlder; }
                if (direction !== 'older') { state.newerCursor = page.newerCursor; state.hasNewer = page.hasNewer; }
            }
            const events = ordered();
            if (events.length > limit) {
                const removed = direction === 'older' ? events.slice(limit) : events.slice(0, events.length - limit);
                removed.forEach(event => state.events.delete(event.eventId));
                if (direction === 'older') { state.hasNewer = true; state.newerCursor = null; }
                else { state.hasOlder = true; state.olderCursor = null; }
            }
            return ordered();
        }
        function days(now = Date.now()) {
            const groups = new Map();
            for (const event of ordered()) {
                const date = day(event.at, state.timeZone);
                if (!groups.has(date)) groups.set(date, { date, label: label(date, state.timeZone, now), events: [] });
                groups.get(date).events.push(event);
            }
            return [...groups.values()].map(group => ({ ...group, collapsed: state.collapsed.has(group.date) || !state.expanded.has(group.date) && !['今天', '昨天'].includes(group.label) }));
        }
        return { state, reset, ordered, merge, days };
    }
    globalThis.WeftUiCore.ChatWindow = { create, day, label };
})();
