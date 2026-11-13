import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code, CodeBlock, Link } from '@var-ui/react';
import { prose, preWrapper } from './MarkdownContent.styles';

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className={prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <Link href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </Link>
          ),
          code: ({ className, children }) => {
            const text = String(children).replace(/\n$/, '');
            const isBlock = Boolean(className) || text.includes('\n');
            if (isBlock) {
              const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
              return <CodeBlock code={text} language={language} />;
            }
            return <Code>{children}</Code>;
          },
          pre: ({ children }) => <div className={preWrapper}>{children}</div>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
