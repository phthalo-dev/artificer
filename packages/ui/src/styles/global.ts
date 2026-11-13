import { global } from './system';

global.rule('html', { isolation: 'isolate' });
global.rule('body', { position: 'relative' });
global.rule('html, body, #root', { height: '100%' });
