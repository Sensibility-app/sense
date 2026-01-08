export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export class TokenTracker {
  private sessionUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  addUsage(usage: TokenUsage): void {
    this.sessionUsage.inputTokens += usage.inputTokens;
    this.sessionUsage.outputTokens += usage.outputTokens;
    this.sessionUsage.totalTokens += usage.totalTokens;
  }

  getSessionUsage(): TokenUsage {
    return { ...this.sessionUsage };
  }

  reset(): void {
    this.sessionUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
  }

  formatUsage(): string {
    const { inputTokens, outputTokens, totalTokens } = this.sessionUsage;
    return `${totalTokens.toLocaleString()} tokens (${inputTokens.toLocaleString()} in, ${outputTokens.toLocaleString()} out)`;
  }
}

// Global token tracker instance
export const tokenTracker = new TokenTracker();