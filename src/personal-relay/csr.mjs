import { ensureCsrPatched } from './csr-integrity.mjs';

export async function createCsr(options) {
  ensureCsrPatched();
  const { default: CSR } = await import('@root/csr');
  return CSR.csr(options);
}
