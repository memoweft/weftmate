export async function pruneEphemeral(database, mailer, now = Date.now()) {
  database.prepare('DELETE FROM failure_limits WHERE window_start<=? AND blocked_until<=?').run(now - 3600000, now);
  database.prepare('DELETE FROM host_proof_replays WHERE expires_at<=?').run(now);
  database.prepare('DELETE FROM interaction_forms WHERE expires_at<=?').run(now);
  database.prepare('DELETE FROM email_challenges WHERE expires_at<=?').run(now);
  database.prepare('DELETE FROM password_tickets WHERE expires_at<=?').run(now);
  database.prepare('DELETE FROM oidc_records WHERE expires_at<=?').run(now);
  await mailer.prune?.(now);
}
