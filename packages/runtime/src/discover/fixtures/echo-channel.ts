import { defineChannel } from '../../api/define-channel.js';

export default defineChannel({
  name: 'echo',
  description: 'Test channel that echoes input',
  receive: async (payload) => ({
    content: String(payload.text ?? ''),
    metadata: { channel: 'echo' },
  }),
  format: async (output) => ({ text: output.content }),
});
