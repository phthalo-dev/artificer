import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import {
  RuntimeClient,
  type InboundWork,
  parseInboundWork,
  serializeInboundWork,
} from '@artificer/agent-gateway';

export interface QueueBridgeConfig {
  region: string;
  queueUrl: string;
  runtimeUrl: string;
  runtimeAuthToken?: string;
  /** Long-poll wait time in seconds (max 20). */
  waitTimeSeconds?: number;
  maxMessages?: number;
}

export class QueueBridge {
  private sqs: SQSClient;
  private runtime: RuntimeClient;
  private queueUrl: string;
  private waitTimeSeconds: number;
  private maxMessages: number;

  constructor(config: QueueBridgeConfig) {
    this.sqs = new SQSClient({ region: config.region });
    this.runtime = new RuntimeClient({
      baseUrl: config.runtimeUrl,
      authToken: config.runtimeAuthToken,
    });
    this.queueUrl = config.queueUrl;
    this.waitTimeSeconds = config.waitTimeSeconds ?? 20;
    this.maxMessages = config.maxMessages ?? 5;
  }

  getRuntimeClient(): RuntimeClient {
    return this.runtime;
  }

  /** Enqueue work for delivery when the runtime is ready. */
  async enqueue(work: InboundWork): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: serializeInboundWork(work),
      }),
    );
  }

  /**
   * Long-poll SQS once and forward any messages to the runtime.
   * Returns the number of messages successfully delivered.
   */
  async pollOnce(): Promise<number> {
    const result = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: this.maxMessages,
        WaitTimeSeconds: this.waitTimeSeconds,
        VisibilityTimeout: 300,
      }),
    );

    let delivered = 0;
    for (const message of result.Messages ?? []) {
      if (!message.Body || !message.ReceiptHandle) continue;
      try {
        const work = parseInboundWork(message.Body);
        await this.runtime.sendMessage(work.content);
        await this.sqs.send(
          new DeleteMessageCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
        delivered += 1;
      } catch (err) {
        console.error('[queue-bridge] failed to deliver message:', err);
      }
    }
    return delivered;
  }

  /** Poll until the runtime accepts connections, then drain the queue once. */
  async drainAfterWake(): Promise<number> {
    await this.runtime.waitUntilHealthy();
    let total = 0;
    // Drain in batches until the queue is empty for one poll cycle.
    for (;;) {
      const n = await this.pollOnce();
      total += n;
      if (n === 0) break;
    }
    return total;
  }
}
