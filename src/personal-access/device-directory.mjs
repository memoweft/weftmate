/** Cloud logins have separate credentials but share a device within a binding. */
export function deviceDirectory(devices, currentId, identityFor) {
  const groups = new Map();
  for (const [id, device] of Object.entries(devices)) {
    const identity = identityFor(id);
    const key = identity?.key ?? id;
    let group = groups.get(key);
    if (!group) {
      group = { members: [], identity, representative: id, first: device.enrolledAt,
        last: device.lastSeenAt ?? device.enrolledAt };
      groups.set(key, group);
    }
    group.members.push(id);
    if (device.directoryName) group.name = device.directoryName;
    if (device.enrolledAt < group.first) group.first = device.enrolledAt;
    const seen = device.lastSeenAt ?? device.enrolledAt;
    if (seen > group.last) group.last = seen;
    const previous = devices[group.representative];
    const preferred = device.revoked === previous.revoked ? device.enrolledAt > previous.enrolledAt : !device.revoked;
    if (id === currentId || (group.representative !== currentId && preferred)) group.representative = id;
  }
  return [...groups.values()].map(group => {
    const id = group.representative, device = devices[id];
    return { members: group.members, row: { id, name: group.name ?? device.name, createdAt: group.first,
      ...(group.identity ? { cloudDeviceId: group.identity.cloudDeviceId } : {}),
      ...(device.lastSeenAt || group.members.length > 1 ? { lastSeenAt: group.last } : {}),
      expiresAt: device.expiresAt ?? null, revoked: device.revoked, current: id === currentId } };
  });
}
