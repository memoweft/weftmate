// Try every cleanup, retaining the body failure as the primary cause.
export async function withTestCleanup(body, cleanups) {
  const errors = [];
  let result;
  try { result = await body(); }
  catch (error) { errors.push(error); }
  for (const cleanup of cleanups) {
    try { await cleanup(); }
    catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    const causes = error => error instanceof AggregateError ? error.errors.flatMap(causes) : [error];
    const primary = errors[0];
    throw new AggregateError(errors.flatMap(causes), primary instanceof Error ? primary.message : 'Test or cleanup failed',
      { cause: primary });
  }
  return result;
}
