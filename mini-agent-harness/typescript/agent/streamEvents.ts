export type UsageSnapshot = Readonly<{
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadInputTokens?: number | null
}>

export type ModelStreamEvent = Readonly<{
  type: 'raw'
  event: Readonly<{
    type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop'
    index?: number
  }>
}> | Readonly<{
  type: 'assistant.block'
  responseId: string
  text?: string
  toolCall?: Readonly<{ id: string; name: string; input: Readonly<Record<string, unknown>> }>
  usage?: UsageSnapshot
  stopReason?: string | null
}> | Readonly<{
  type: 'retry.notice'
  attempt: number
}>;
