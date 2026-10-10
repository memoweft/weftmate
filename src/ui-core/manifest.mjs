/** Canonical assets and load order for desktop serving and the FE-1b mobile build. */
export const uiCoreAssets = Object.freeze([
  'store.js', 'personalization.js', 'onboarding-copy.js', 'offline.js', 'auth.js', 'shell.js', 'settings.js', 'backup.js', 'account.js', 'memory.js',
  'attachments.js', 'sessions.js', 'messages.js', 'message-actions.js', 'approvals.js', 'tasks.js',
  'questions.js', 'resources.js', 'phone.js', 'composer.js', 'timeline-model.js', 'subtasks.js',
  'appearance.js', 'settings-registry.js', 'client.js', 'cloud-auth.js', 'cloud-account.js', 'usage.js', 'update.js', 'schedules.js', 'chat-window.js', 'main-chat.js', 'activity.js', 'goals.js', 'library.js', 'adapters/android-bridge.js', 'adapters/mobile-web.js', 'adapters/mobile.js',
  'adapters/mobile-host.js', 'adapters/mobile-decisions.js', 'adapters/mobile-settings.js',
])

/** Shared content presentation is browser-only; feature factories remain DOM-free. */
export const uiCorePresentationAssets = Object.freeze(['rendering.js']);
export const uiCoreBrowserAssets = Object.freeze([uiCoreAssets[0], ...uiCorePresentationAssets, ...uiCoreAssets.slice(1)]);
