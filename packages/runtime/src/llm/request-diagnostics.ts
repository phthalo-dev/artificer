import type { ModelMessage, ToolResultPart } from 'ai';

export interface RequestDiagnosticsSummary {
  stepNumber: number;
  estimatedTokens: number;
  systemChars: number;
  messageChars: number;
  toolResultChars: number;
  largestToolResults: Array<{ toolName: string; chars: number }>;
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3);
}

function toolResultBodyChars(output: ToolResultPart['output']): number {
  if (output.type === 'text') {
    return output.value.length;
  }
  if (output.type === 'json') {
    return JSON.stringify(output.value).length;
  }
  if (output.type === 'execution-denied') {
    return output.reason?.length ?? 0;
  }
  if (output.type === 'error-text') {
    return output.value.length;
  }
  if (output.type === 'error-json') {
    return JSON.stringify(output.value).length;
  }
  if (output.type === 'content') {
    return output.value.reduce((total, part) => {
      if (part.type === 'text') {
        return total + part.text.length;
      }
      return total;
    }, 0);
  }
  return 0;
}

function countTextPart(text: string): number {
  return text.length;
}

function walkMessageContent(
  content: ModelMessage['content'],
  onText: (chars: number) => void,
  onToolResult: (toolName: string, chars: number) => void,
): void {
  if (typeof content === 'string') {
    onText(countTextPart(content));
    return;
  }
  if (!Array.isArray(content)) {
    return;
  }
  for (const part of content) {
    switch (part.type) {
      case 'text':
        onText(countTextPart(part.text));
        break;
      case 'reasoning':
        onText(countTextPart(part.text));
        break;
      case 'tool-result': {
        const chars = toolResultBodyChars(part.output);
        onToolResult(part.toolName, chars);
        break;
      }
      default:
        break;
    }
  }
}

export function summarizeStepRequest(
  messages: ModelMessage[],
  system: string | undefined,
  stepNumber: number,
): RequestDiagnosticsSummary {
  const systemChars = system?.length ?? 0;
  let messageChars = 0;
  let toolResultChars = 0;
  const toolResults: Array<{ toolName: string; chars: number }> = [];

  for (const message of messages) {
    walkMessageContent(
      message.content,
      (chars) => {
        messageChars += chars;
      },
      (toolName, chars) => {
        toolResultChars += chars;
        toolResults.push({ toolName, chars });
      },
    );
  }

  toolResults.sort((a, b) => b.chars - a.chars);

  const totalChars = systemChars + messageChars + toolResultChars;

  return {
    stepNumber,
    estimatedTokens: estimateTokens(totalChars),
    systemChars,
    messageChars,
    toolResultChars,
    largestToolResults: toolResults,
  };
}

/** Total estimated character count for a model request (system + messages). */
export function estimateRequestChars(
  messages: ModelMessage[],
  system: string | undefined,
): number {
  const summary = summarizeStepRequest(messages, system, 0);
  return summary.systemChars + summary.messageChars + summary.toolResultChars;
}
