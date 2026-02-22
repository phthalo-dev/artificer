export const DEFAULT_EC2_INSTANCE_TYPE = 't3.medium';
export const DEFAULT_EC2_IMAGE_ID = 'ami-0c55b159cbfafe1f0'; // Ubuntu 22.04 LTS (adjust based on region)

export const DEFAULT_OPENCODE_CONFIG = {
  workDirectory: '/home/ubuntu/workspace',
  logLevel: 'info',
  autoCommit: false,
};

export const AGENT_STATUS_LABELS: Record<string, string> = {
  STOPPED: 'Stopped',
  STARTING: 'Starting',
  RUNNING: 'Running',
  ERROR: 'Error',
  STOPPING: 'Stopping',
};

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  COMMIT_CREATED: 'Commit Created',
  PR_OPENED: 'PR Opened',
  PR_REVIEWED: 'PR Reviewed',
  PR_MERGED: 'PR Merged',
  ISSUE_COMMENTED: 'Issue Commented',
  CODE_CHANGE: 'Code Changed',
  ERROR: 'Error',
};

export const MAX_AGENTS_PER_USER = 10;
export const MAX_AGENTS_PER_TEAM = 50;

export const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
export const ENCRYPTION_KEY_LENGTH = 32;
