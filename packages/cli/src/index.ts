#!/usr/bin/env node

const [, , command, ...args] = process.argv;

switch (command) {
  case 'init': {
    const { init } = await import('./commands/init.js');
    try {
      init(args[0] ?? 'my-agent');
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
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
  case 'eval': {
    const sub = args[0];
    const rest = args.slice(1);
    const { evalRun, evalList, evalCompare } =
      await import('./commands/eval.js');
    if (sub === 'run') {
      await evalRun(rest);
      break;
    }
    if (sub === 'list') {
      await evalList(rest);
      break;
    }
    if (sub === 'compare') {
      await evalCompare(rest);
      break;
    }
    console.log('Usage: artificer eval <run|list|compare> [args]');
    console.log('');
    console.log('  eval run [--suite smoke] [--task <id>] [--preset <id>]');
    console.log(
      '           [--pack swebench-lite-30] [--limit N] [--llm-judge]',
    );
    console.log('  eval list');
    console.log('  eval compare [baseline] [candidate] [--write]');
    process.exit(sub ? 1 : 0);
    break;
  }
  default:
    console.log('Usage: artificer <init|dev|start|eval> [args]');
    console.log('');
    console.log('Commands:');
    console.log('  init <name>    Create a new agent project');
    console.log('  dev            Start in development mode');
    console.log('  start          Start in production mode');
    console.log(
      '  eval run|list|compare  Run, list, or compare identity evals',
    );
}
