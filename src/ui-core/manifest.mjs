/** Canonical assets and load order for desktop serving and the FE-1b mobile build. */
export const uiCoreAssets = Object.freeze([
  'store.js', 'human-format.js', 'shortcuts.js', 'release-notes.js', 'help.js', 'personalization.js', 'onboarding-copy.js', 'offline.js', 'auth.js', 'shell.js', 'presence.js', 'settings.js', 'connectors.js', 'backup.js', 'data.js', 'account.js', 'memory.js',
  'attachments.js', 'sessions.js', 'messages.js', 'message-actions.js', 'approvals.js', 'tasks.js',
  'questions.js', 'resources.js', 'phone.js', 'composer.js', 'model-services.js', 'phone-model-services.js', 'timeline-model.js', 'subtasks.js',
  'appearance.js', 'settings-registry.js', 'client.js', 'cloud-auth.js', 'cloud-account.js', 'usage.js', 'update.js', 'schedules.js', 'chat-window.js', 'main-chat.js', 'computers.js', 'work-and-chat.js', 'activity.js', 'goals.js', 'health.js', 'library.js', 'search.js', 'adapters/android-bridge.js', 'adapters/mobile-web.js', 'adapters/mobile.js',
  'adapters/mobile-host.js', 'adapters/mobile-decisions.js', 'adapters/mobile-settings.js', 'next-suggestions.js', 'slash-commands.js', 'chat-scope.js',
])

/** Shared content presentation is browser-only; feature factories remain DOM-free. */
export const uiCorePresentationAssets = Object.freeze(['controls.js', 'connector-view.js', 'permission-view.js', 'rendering.js', 'reply-motion.js', 'appearance-controls.js', 'model-label.js', 'model-picker.js', 'dialogs.js', 'composer-press.js', 'slash-menu.js']);
export const uiCoreStyleAssets = Object.freeze(['connectors.css', 'reply-motion.css', 'appearance.css', 'dialogs.css', 'model-picker.css', 'controls.css']);
export const uiCoreBrowserAssets = Object.freeze([uiCoreAssets[0], ...uiCorePresentationAssets, ...uiCoreAssets.slice(1), ...uiCoreStyleAssets, 'model-service-catalog.mjs']);
export const uiCoreSourceAsset = name => name === 'model-service-catalog.mjs' ? '../model-service-catalog.mjs' : name;
