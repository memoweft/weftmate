/** Platform assets generated from design/icons/app by scripts/generate-icons.mjs. */
import { join } from 'node:path';
export const appIcon = join(import.meta.dirname, 'assets/icons/app.ico');
export const notificationIcon = join(import.meta.dirname, 'assets/icons/notification.png');
export const trayIcon = dark => join(import.meta.dirname, `assets/icons/tray-${dark ? 'dark' : 'light'}.png`);
export const windowIcon = dark => join(import.meta.dirname, `assets/icons/window-${dark ? 'dark' : 'light'}.ico`);
