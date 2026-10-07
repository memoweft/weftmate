import { failure } from './common.mjs';
import { handlePersonalMemoryHttp } from '../personal-memory/http.mjs';

export function createMemoryHttpHandler(context) {
  async function handleMemoryHttp(request, response, url, pathname, ownerId, deviceId) {
    const mutation = ['POST', 'PATCH', 'DELETE'].includes(request.method);
    const current = context.authenticate(request, mutation ? 'account:manage' : 'sessions:read');
    if (current.ownerId !== ownerId || current.deviceId !== deviceId) throw failure('UNAUTHORIZED', 401);
    if (context.memoryManager === null) {
      if (request.method === 'GET' && !url.search && pathname === '/personal/v1/memory/status') {
        return context.json(response, 200, { state: 'disabled', worldRevision: null,
          ownerId,
          capabilities: { list: false, source: false, correct: false, mute: false,
            inject: false, deleteEvidence: false, deleteWorldItem: false } });
      }
      throw failure('MEMORY_DISABLED', 503);
    }
    const result = await handlePersonalMemoryHttp({ manager: context.memoryManager,
      ownerId, request, pathname, url, readJson: context.readJson });
    return context.json(response, result.status, { ownerId, ...result.body });
  }
  return { handleMemoryHttp };
}
