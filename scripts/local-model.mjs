import { resolve } from 'node:path';
import { createLocalModelController } from '../src/local-model-service.mjs';
const [action = 'status', configFile] = process.argv.slice(2);
if (!configFile) throw new Error('Usage: node scripts/local-model.mjs start|stop|restart|status <outside-repository config.json>');
const controller = createLocalModelController(resolve(configFile));
console.log(JSON.stringify(await (action === 'status' ? controller.status() : controller.control(action))));
