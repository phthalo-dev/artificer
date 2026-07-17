import path from 'node:path';

export class IdentityLayout {
  constructor(public readonly root: string) {}

  get memoriesDir(): string {
    return path.join(this.root, 'identity', 'memories');
  }

  get memoryIndexFile(): string {
    return path.join(this.root, 'identity', 'index.json');
  }

  memoryFile(id: string): string {
    return path.join(this.memoriesDir, `${id}.md`);
  }

  get skillsDir(): string {
    return path.join(this.root, 'agent', 'skills');
  }

  get toolsDir(): string {
    return path.join(this.root, 'agent', 'tools');
  }

  get channelsDir(): string {
    return path.join(this.root, 'agent', 'channels');
  }

  get schedulesDir(): string {
    return path.join(this.root, 'agent', 'schedules');
  }

  scheduleFile(id: string): string {
    return path.join(this.schedulesDir, `${id}.md`);
  }

  get instructionsFile(): string {
    return path.join(this.root, 'agent', 'instructions.md');
  }

  get configFile(): string {
    return path.join(this.root, 'artificer.config.json');
  }
}
