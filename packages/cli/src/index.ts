#!/usr/bin/env node

const [, , command, ...args] = process.argv;

switch (command) {
  case 'init': {
    const { init } = await import('./commands/init.js');
    init(args[0] ?? 'my-agent');
    break;
  }
  case 'dev': {
    const { dev } = await import('./commands/dev.js');
    await dev(args[0]);
    break;
  }
  case 'start': {
    const { start } = await import('./commands/start.js');
    await start(args[0]);
    break;
  }
  default:
    console.log('Usage: artificer <init|dev|start> [args]');
    console.log('');
    console.log('Commands:');
    console.log('  init <name>    Create a new agent project');
    console.log('  dev            Start in development mode');
    console.log('  start          Start in production mode');
}
