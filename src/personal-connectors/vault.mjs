import { createHash } from 'node:crypto';

const prefixFor = (owner, connector) => `thirdparty-${createHash('sha256').update(JSON.stringify([owner, connector])).digest('hex').slice(0, 40)}-`;
const validSlot = slot => typeof slot === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(slot);
/** Main-process API for passwords, authorization codes and refresh tokens alike.
 * IDs and values use the existing encrypted model vault. No plaintext index. */
export function createConnectorVault(storage) {
  const reference = (owner, connector, slot) => {
    if (!owner || !connector || !validSlot(slot)) throw new TypeError('Invalid credential slot');
    return prefixFor(owner, connector) + Buffer.from(slot).toString('base64url');
  };
  return {
    save(owner, connector, slot, value) { storage.saveCredential(reference(owner, connector, slot), value); },
    rotate(owner, connector, slot, value) { storage.saveCredential(reference(owner, connector, slot), value); },
    get(owner, connector, slot) { return storage.getCredential(reference(owner, connector, slot)); },
    remove(owner, connector, slot) { storage.removeCredential(reference(owner, connector, slot)); },
    list(owner, connector) {
      const prefix = prefixFor(owner, connector);
      return storage.listCredentialIds().filter(ref => ref.startsWith(prefix)).map(ref => {
        const value = storage.getCredential(ref);
        return { name: Buffer.from(ref.slice(prefix.length), 'base64url').toString(), saved: !!value, last4: value && value.length > 4 ? value.slice(-4) : '' };
      });
    },
    removeConnector(owner, connector) {
      for (const ref of storage.listCredentialIds().filter(ref => ref.startsWith(prefixFor(owner, connector)))) storage.removeCredential(ref);
    },
  };
}
